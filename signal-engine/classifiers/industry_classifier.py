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
        r"saas|software platform|b2b software|developer tool|api platform|tech startup"
    ],
    # "contract" deliberately removed — it matches employment contracts (fulltime/contract jobs)
    # not legal services companies, causing widespread false positives from job board leads.
    "Legal Services": [
        r"law firm|legal services|attorney|litigation|counsel|barrister|paralegal|legal counsel"
    ],
    "IT Consulting / Managed Services": [
        r"it consulting|managed service|managed it|cybersecurity|cyber security|it solution|"
        r"digital transformation|staffing firm|tech staffing|it staffing|consulting firm|"
        r"solutioning|cloud service|enterprise solution|outsourc"
    ],
    "Staffing / HR": [
        r"staffing agency|recruiting|talent acquisition|hr consulting|human resource|workforce solution|placement firm"
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
    def classify(
        self,
        company_name: str,
        description: str,
        job_title: str,
        website_content: str = "",
    ) -> str:
        # Website content is highest-signal — weight it by including it twice
        text = f"{company_name} {description} {job_title} {website_content} {website_content}".lower()

        scores: dict[str, int] = {}
        for industry, patterns in INDUSTRY_KEYWORDS.items():
            count = sum(
                len(re.findall(pattern, text, re.IGNORECASE))
                for pattern in patterns
            )
            if count > 0:
                scores[industry] = count

        if scores:
            return max(scores, key=lambda k: scores[k])

        return "General Business"
