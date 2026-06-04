"""Lead scoring engine - scores 0-100 based on ANTA opportunity signals."""

import re


SIZE_SCORES = {
    "1-10": 8,
    "11-50": 18,
    "51-200": 22,
    "201-500": 20,
    "501-1000": 16,
    "1000+": 10,
    "unknown": 10,
}

HIGH_URGENCY_ROLES = [
    r"data entry|spreadsheet|excel analyst|manual",
    r"operations coordinator|ops manager",
    r"process improvement|workflow",
    r"react developer|frontend developer|next\.?js",
    r"full.?stack|software engineer",
]

DIGITAL_PAIN_SIGNALS = [
    r"spreadsheet|excel|manual|paper.based|legacy",
    r"outdated|old system|15.year|20.year",
    r"whiteboard|phone call|email chain",
    r"no software|no tech team|outsource",
    r"no (crm|erp|dashboard|portal)",
]

GROWTH_SIGNALS = [
    r"rapid growth|fast.?growing|scaling|expand",
    r"hired \d+|added \d+",
    r"new office|new location|series [abc]",
    r"40%|50%|60%|100% growth|yoy",
    r"just launched|recently launched|product hunt",
]

DEFAULT_GEO_BONUS = [
    "detroit", "michigan", "mi", "dearborn", "warren", "troy", "ann arbor",
    "livonia", "sterling heights", "grand rapids", "lansing",
]


class LeadScorer:
    def __init__(self, target_locations: list[str] | None = None):
        self.geo_bonus_list = [loc.lower() for loc in (target_locations or DEFAULT_GEO_BONUS)]

    def score(
        self,
        company_size: str,
        hiring_signal: str,
        job_title: str,
        description: str,
        location: str,
        industry: str,
    ) -> dict:
        text = f"{hiring_signal} {job_title} {description}".lower()
        location_lower = location.lower()

        # ---- Component 1: Company size (0-25) ----
        size_key = company_size.lower().strip()
        company_size_score = SIZE_SCORES.get(size_key, 10)

        # ---- Component 2: Hiring urgency (0-25) ----
        hiring_urgency_score = 10
        for pattern in HIGH_URGENCY_ROLES:
            if re.search(pattern, text, re.IGNORECASE):
                hiring_urgency_score = min(hiring_urgency_score + 5, 25)

        # ---- Component 3: Operational complexity (0-25) ----
        complexity_score = 10
        for pattern in DIGITAL_PAIN_SIGNALS:
            if re.search(pattern, text, re.IGNORECASE):
                complexity_score = min(complexity_score + 5, 25)

        # ---- Component 4: Digital maturity / growth (0-25) ----
        digital_score = 8
        for pattern in GROWTH_SIGNALS:
            if re.search(pattern, text, re.IGNORECASE):
                digital_score = min(digital_score + 4, 20)

        # Digital maturity score (inverse — lower maturity = higher opportunity)
        digital_maturity_raw = 10
        for pattern in DIGITAL_PAIN_SIGNALS:
            if re.search(pattern, text, re.IGNORECASE):
                digital_maturity_raw = max(digital_maturity_raw - 1, 1)
        digital_maturity_score = digital_maturity_raw

        # ---- Target location bonus ----
        location_bonus = 0
        if any(loc in location_lower for loc in self.geo_bonus_list):
            location_bonus = 5

        overall_score = min(
            company_size_score + hiring_urgency_score + complexity_score + digital_score + location_bonus,
            100,
        )

        # ---- Operational maturity classification ----
        if complexity_score >= 20:
            operational_maturity = "Low — likely running manual/legacy systems"
        elif complexity_score >= 15:
            operational_maturity = "Medium — has some systems but gaps remain"
        else:
            operational_maturity = "High — digitally mature, targeted service need"

        # ---- Growth indicators ----
        growth_indicators = []
        for pattern in GROWTH_SIGNALS:
            if re.search(pattern, text, re.IGNORECASE):
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    growth_indicators.append(match.group(0).strip()[:60])

        # ---- Rationale ----
        rationale_parts = []
        if company_size_score >= 18:
            rationale_parts.append(f"company size ({company_size}) is in ANTA's ideal range")
        if hiring_urgency_score >= 20:
            rationale_parts.append("high-urgency hiring signal detected")
        if complexity_score >= 20:
            rationale_parts.append("strong indicators of manual/legacy operational processes")
        if location_bonus:
            rationale_parts.append("target location match")

        rationale = (
            "Strong lead: " + ", ".join(rationale_parts) + "."
            if rationale_parts
            else "Moderate opportunity with standard signals."
        )

        return {
            "overall_score": overall_score,
            "company_size_score": company_size_score,
            "hiring_urgency_score": hiring_urgency_score,
            "complexity_score": complexity_score,
            "digital_score": digital_score,
            "digital_maturity_score": digital_maturity_score,
            "operational_maturity": operational_maturity,
            "growth_indicators": growth_indicators[:4],
            "rationale": rationale,
        }
