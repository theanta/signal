"""Detect a company's tech stack by fingerprinting their website HTML and HTTP headers."""

import re
import requests
from bs4 import BeautifulSoup

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; ANTALeadRadar/1.0)"})

# Each entry: (display_name, list_of_patterns_to_search_in_html_or_headers)
# Patterns are matched against the full HTML source + header values as a single string.
FINGERPRINTS: list[tuple[str, list[str]]] = [
    # CMS
    ("WordPress", [r"/wp-content/", r"/wp-includes/", r'name="generator"[^>]*WordPress']),
    ("Wix",       [r"wix\.com/", r"X-Wix-", r"_wixCssModules"]),
    ("Squarespace", [r"squarespace\.com", r"static\.squarespace"]),
    ("Webflow",   [r"webflow\.com", r"data-wf-"]),
    ("Shopify",   [r"cdn\.shopify\.com", r"Shopify\.theme", r"myshopify\.com"]),
    ("WooCommerce", [r"woocommerce", r"wc-cart", r"wc-checkout"]),
    ("Magento",   [r"Mage\.Cookies", r"magento", r"/skin/frontend/"]),
    ("Drupal",    [r'name="generator"[^>]*Drupal', r"/sites/default/files/"]),
    ("Joomla",    [r'name="generator"[^>]*Joomla', r"/components/com_"]),
    ("Ghost",     [r"ghost\.org", r"/ghost/api/"]),
    # Ecommerce / booking
    ("BigCommerce", [r"bigcommerce\.com", r"cdn11\.bigcommerce"]),
    ("Stripe",    [r"js\.stripe\.com", r"stripe\.com/v"]),
    ("Square",    [r"squareup\.com", r"square\.com/checkout"]),
    # Analytics
    ("Google Analytics", [r"google-analytics\.com/analytics", r"gtag\(", r"UA-\d{4,}-\d"]),
    ("Google Tag Manager", [r"googletagmanager\.com/gtm\.js", r"GTM-[A-Z0-9]+"]),
    ("Hotjar",    [r"hotjar\.com", r"hj\('trigger'"]),
    ("Mixpanel",  [r"cdn\.mxpnl\.com", r"mixpanel\.init"]),
    ("Segment",   [r"cdn\.segment\.com", r"analytics\.js"]),
    # CRM / Marketing
    ("HubSpot",   [r"js\.hs-scripts\.com", r"hubspot\.com/conversations"]),
    ("Salesforce", [r"salesforce\.com", r"force\.com"]),
    ("Mailchimp", [r"mailchimp\.com", r"chimpstatic\.com"]),
    ("Klaviyo",   [r"klaviyo\.com", r"klaviyo\.init"]),
    ("Intercom",  [r"widget\.intercom\.io", r"intercomSettings"]),
    ("Zendesk",   [r"zendesk\.com", r"zopim\.com"]),
    # Frontend frameworks
    ("React",     [r"react\.development\.js", r"react\.production\.min\.js", r"__REACT_DEVTOOLS"]),
    ("Next.js",   [r"/_next/static/", r"__NEXT_DATA__"]),
    ("Vue.js",    [r"vue\.js", r"vue\.min\.js", r"__vue__"]),
    ("Angular",   [r"angular\.js", r"ng-version="]),
    # Hosting / infra (from headers)
    ("Cloudflare", [r"cloudflare", r"cf-ray", r"__cfduid"]),
    ("AWS",       [r"amazonaws\.com", r"x-amz-"]),
    ("Vercel",    [r"vercel\.com", r"x-vercel-"]),
    # Booking / scheduling
    ("Calendly",  [r"calendly\.com", r"calendly\.initInlineWidget"]),
    ("Acuity",    [r"acuityscheduling\.com"]),
    ("Mindbody",  [r"mindbodyonline\.com"]),
    # Payments
    ("PayPal",    [r"paypal\.com/sdk", r"paypalobjects\.com"]),
    # No CRM / analytics signals (absence detection — handled separately)
]


def detect_tech_stack(url: str) -> list[str]:
    """
    Fetch the website and return a list of detected technology names.
    Returns an empty list if the site can't be reached.
    """
    if not url:
        return []
    try:
        resp = _SESSION.get(url, timeout=10, allow_redirects=True)
        html = resp.text or ""
        # Combine HTML + response headers into one searchable blob
        header_str = " ".join(f"{k}: {v}" for k, v in resp.headers.items()).lower()
        search_blob = html + "\n" + header_str
    except Exception:
        return []

    detected: list[str] = []
    for name, patterns in FINGERPRINTS:
        for pattern in patterns:
            if re.search(pattern, search_blob, re.IGNORECASE):
                detected.append(name)
                break  # only add each tech once

    return detected


def infer_gaps(tech_stack: list[str]) -> list[str]:
    """
    Given detected tech, return a list of likely-missing capabilities
    that ANTA can fill.

    Returns empty list when tech_stack is empty: an empty scan means the site
    was unreachable, behind a CDN we can't fingerprint, or running proprietary
    enterprise infrastructure — none of these are evidence of SMB tech gaps.
    """
    if not tech_stack:
        return []

    gaps: list[str] = []

    has_crm = any(t in tech_stack for t in ["HubSpot", "Salesforce", "Zendesk", "Intercom"])
    has_analytics = any(t in tech_stack for t in ["Google Analytics", "Mixpanel", "Segment", "Hotjar"])
    has_ecommerce = any(t in tech_stack for t in ["Shopify", "WooCommerce", "BigCommerce", "Magento"])
    has_booking = any(t in tech_stack for t in ["Calendly", "Acuity", "Mindbody"])
    has_modern_frontend = any(t in tech_stack for t in ["React", "Next.js", "Vue.js", "Angular"])

    if not has_crm:
        gaps.append("No CRM detected — likely managing customer data manually")
    if not has_analytics:
        gaps.append("No analytics platform detected — no visibility into customer behavior")
    if has_ecommerce and not has_crm:
        gaps.append("Running ecommerce without CRM integration — orders not tied to customer records")
    if not has_booking and not has_ecommerce:
        gaps.append("No online booking or scheduling tool detected")
    if not has_modern_frontend and ("WordPress" in tech_stack or "Wix" in tech_stack or "Squarespace" in tech_stack):
        gaps.append("Website on legacy CMS — no modern web application layer")

    return gaps
