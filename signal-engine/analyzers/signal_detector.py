"""Detect buying signals from raw lead data."""

import re
from typing import Tuple


SIGNAL_WEIGHTS = {
    "hiring_ops_coordinator": ("operational_scaling", 0.90),
    "hiring_data_entry": ("manual_process_pain", 0.95),
    "hiring_react_developer": ("frontend_modernization", 0.85),
    "hiring_full_stack": ("engineering_scale", 0.80),
    "hiring_devops": ("infrastructure_scaling", 0.75),
    "new_product_launch": ("mvp_iteration", 0.70),
    "rapid_hiring": ("company_growth", 0.75),
    "legacy_system": ("modernization", 0.90),
    "spreadsheet_based": ("automation_need", 0.95),
    "manual_process": ("workflow_automation", 0.88),
    "no_software_team": ("outsource_dev", 0.85),
    "scaling_ops": ("operational_dashboard", 0.80),
}

KEYWORD_SIGNAL_MAP = {
    r"data entry|manual entry|excel|spreadsheet": "manual_process_pain",
    r"operations coordinator|ops coordinator": "operational_scaling",
    r"react|next\.?js|frontend|front.end": "frontend_modernization",
    r"full.?stack|fullstack|software engineer": "engineering_scale",
    r"devops|cloud|infrastructure": "infrastructure_scaling",
    r"launched|product hunt|just shipped": "new_product_launch",
    r"hiring.{0,30}people|rapid growth|fast.?growing|scaling": "rapid_hiring",
    r"legacy|old system|outdated|15.year": "legacy_system",
    r"spreadsheet|excel|sheets|google sheet": "spreadsheet_based",
    r"manual process|manual workflow|paper.based": "manual_process",
    r"no (internal|tech|software) team|outsource|consultant": "no_software_team",
    r"scale|scaling|growing operations": "scaling_ops",
}


DEFAULT_GEO_TARGETS = ["detroit", "michigan", "mi", "dearborn", "warren", "troy"]


class SignalDetector:
    def __init__(self, target_locations: list[str] | None = None):
        self.geo_targets = [loc.lower() for loc in (target_locations or DEFAULT_GEO_TARGETS)]

    def detect(self, lead: dict) -> Tuple[str, float]:
        """
        Detect the primary buying signal type and confidence score.
        Returns (signal_type, confidence).
        """
        text = " ".join(filter(None, [
            lead.get("hiring_signal", ""),
            lead.get("description", ""),
            lead.get("job_title", ""),
            lead.get("industry", ""),
        ])).lower()

        best_signal = "general_opportunity"
        best_confidence = 0.40

        for pattern, signal_key in KEYWORD_SIGNAL_MAP.items():
            if re.search(pattern, text, re.IGNORECASE):
                weight_info = SIGNAL_WEIGHTS.get(signal_key, (signal_key, 0.50))
                signal_type, confidence = weight_info[0], weight_info[1]
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_signal = signal_type

        # Boost confidence if company is in a target location
        location = (lead.get("location") or "").lower()
        if any(loc in location for loc in self.geo_targets):
            best_confidence = min(best_confidence + 0.05, 1.0)

        return best_signal, round(best_confidence, 2)
