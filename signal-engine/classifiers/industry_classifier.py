"""Classify company industry from available text signals."""

import re


INDUSTRY_KEYWORDS = {
    "Manufacturing / Automotive": [
        r"manufactur|automotive|auto parts|tier [12]|oem|stamping|assembly|machining|fabricat"
    ],
    "Logistics / Distribution": [
        r"logistics|freight|distribution|supply chain|warehouse|shipping|trucking|fleet|dispatch"
    ],
    "Healthcare": [
        r"health|medical|clinic|hospital|dental|therapy|wellness|pharma|patient|care"
    ],
    "SaaS / Software": [
        r"saas|software|platform|app|startup|tech company|b2b software|api|developer tool"
    ],
    "Legal Services": [
        r"law firm|legal|attorney|litigation|counsel|barrister|paralegal|contract"
    ],
    "Staffing / HR": [
        r"staffing|recruiting|talent|hr|human resource|workforce|placement|hiring firm"
    ],
    "Construction / Real Estate": [
        r"construction|contractor|builder|real estate|property|development|remodel"
    ],
    "Retail / E-commerce": [
        r"retail|ecommerce|e-commerce|store|shop|consumer|marketplace|brand"
    ],
    "Financial Services": [
        r"finance|accounting|insurance|bank|credit|investment|wealth|tax|payroll"
    ],
    "Consulting": [
        r"consulting|advisory|strategy|management consulting|professional service"
    ],
    "AI / Machine Learning": [
        r"\bai\b|artificial intelligence|machine learning|nlp|llm|deep learning|ml "
    ],
}


class IndustryClassifier:
    def classify(self, company_name: str, description: str, job_title: str) -> str:
        text = f"{company_name} {description} {job_title}".lower()

        scores: dict[str, int] = {}
        for industry, patterns in INDUSTRY_KEYWORDS.items():
            count = sum(
                1 for pattern in patterns if re.search(pattern, text, re.IGNORECASE)
            )
            if count > 0:
                scores[industry] = count

        if scores:
            return max(scores, key=lambda k: scores[k])

        return "General Business"
