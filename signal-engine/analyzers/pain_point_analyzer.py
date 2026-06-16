"""Analyze likely operational pain points and map to ANTA services."""

import re
from typing import Tuple

ANTA_SERVICES = {
    "ai_automation": "AI Automation Systems",
    "saas_dev": "SaaS Development",
    "operational_dashboard": "Operational Dashboard",
    "workflow_automation": "Workflow Automation",
    "internal_tools": "Custom Internal Tools",
    "crm": "CRM System",
    "mvp": "Startup MVP Development",
    "frontend": "React/Next.js Frontend Modernization",
}

INDUSTRY_PAIN_MAP = {
    "manufacturing": {
        "pain_points": [
            "Manual production tracking in spreadsheets",
            "No real-time inventory visibility",
            "Disconnected ERP from shop floor data",
            "Paper-based quality control processes",
        ],
        "service": "ai_automation",
        "angle": "We build operational dashboards that give manufacturing teams real-time visibility into production, inventory, and quality — replacing spreadsheets with live data.",
    },
    "logistics": {
        "pain_points": [
            "Manual route planning and dispatch",
            "No real-time shipment tracking",
            "Paper-based proof of delivery",
            "Disconnected customer communication",
        ],
        "service": "operational_dashboard",
        "angle": "We build logistics ops platforms — route optimization, shipment tracking, driver portals — that replace manual dispatching with automated workflows.",
    },
    "healthcare": {
        "pain_points": [
            "Paper-based patient intake",
            "Manual scheduling across locations",
            "No centralized patient communication",
            "Disconnected billing and care workflows",
        ],
        "service": "workflow_automation",
        "angle": "We build healthcare ops tools — digital intake, scheduling systems, care coordination dashboards — that reduce administrative burden.",
    },
    "saas": {
        "pain_points": [
            "MVP needs full engineering support",
            "Frontend needs professional rebuild",
            "No CI/CD or deployment pipeline",
            "Needs AI feature integration",
        ],
        "service": "saas_dev",
        "angle": "ANTA specializes in helping SaaS founders move fast — from MVP to scalable product architecture using React/Next.js and AI integrations.",
    },
    "legal": {
        "pain_points": [
            "Case management via email chains",
            "Manual document tracking",
            "No client portal",
            "Billing done in spreadsheets",
        ],
        "service": "internal_tools",
        "angle": "We build legal ops tools — case management systems, client portals, document workflows — tailored to how your firm actually works.",
    },
    "staffing": {
        "pain_points": [
            "Candidate tracking in spreadsheets",
            "No internal ATS",
            "Manual client reporting",
            "Disconnected placement workflows",
        ],
        "service": "crm",
        "angle": "We build staffing CRMs and recruitment workflow systems that automate candidate tracking, placement coordination, and client reporting.",
    },
    "default": {
        "pain_points": [
            "Manual operational processes",
            "No centralized data visibility",
            "Disconnected systems and tools",
            "Scaling without software infrastructure",
        ],
        "service": "workflow_automation",
        "angle": "ANTA builds the operational software layer your business needs to scale — from workflow automation to real-time dashboards.",
    },
}

JOB_SIGNAL_MAP = {
    r"data entry|spreadsheet|excel analyst": {
        "pain": "Manual data workflows consuming staff time",
        "service": "workflow_automation",
    },
    r"operations coordinator|ops manager": {
        "pain": "Operational scaling without software support",
        "service": "operational_dashboard",
    },
    r"react|frontend|next\.?js": {
        "pain": "Frontend modernization or new product build",
        "service": "frontend",
    },
    r"full.?stack|software engineer|web developer": {
        "pain": "Building new internal tools or SaaS product",
        "service": "saas_dev",
    },
    r"crm|sales ops|salesforce": {
        "pain": "No centralized CRM or sales ops system",
        "service": "crm",
    },
    r"ai|machine learning|automation": {
        "pain": "Wants AI but lacks engineering to implement",
        "service": "ai_automation",
    },
}


class PainPointAnalyzer:
    def analyze(
        self,
        industry: str,
        hiring_signal: str,
        job_title: str,
        description: str,
        location: str,
        tech_stack: list[str] | None = None,
        tech_gaps: list[str] | None = None,
    ) -> Tuple[list[str], str, str]:
        """
        Returns (pain_points, recommended_service_name, outreach_angle).
        """
        text = f"{hiring_signal} {job_title} {description}".lower()
        industry_lower = industry.lower()
        tech_stack = tech_stack or []
        tech_gaps = tech_gaps or []

        # Match industry
        industry_data = INDUSTRY_PAIN_MAP["default"]
        for key, data in INDUSTRY_PAIN_MAP.items():
            if key != "default" and key in industry_lower:
                industry_data = data
                break

        pain_points = list(industry_data["pain_points"])
        service_key = industry_data["service"]
        angle = industry_data["angle"]

        # Override with job-specific signals if stronger
        for pattern, override in JOB_SIGNAL_MAP.items():
            if re.search(pattern, text, re.IGNORECASE):
                specific_pain = override["pain"]
                if specific_pain not in pain_points:
                    pain_points.insert(0, specific_pain)
                service_key = override["service"]
                break

        # Refine the outreach angle when we have concrete detected tech (not inferred gaps —
        # gap text is speculative and breaks the sentence if appended raw)
        if tech_stack:
            tech_context = f" We can see you're running {', '.join(tech_stack[:3])}."
            angle = angle.rstrip(".") + tech_context

        service_name = ANTA_SERVICES.get(service_key, "Custom Software Development")

        # Add Detroit-specific angle
        if any(loc in location.lower() for loc in ["detroit", "michigan", "dearborn", "warren"]):
            angle = f"As Detroit-based engineers, ANTA understands Michigan business operations. {angle}"

        return pain_points[:4], service_name, angle
