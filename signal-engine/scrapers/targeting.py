"""Turn a tenant's targeting settings into scraper search terms.

Every scraper's geography and roles come from the tenant's platform_config.
The defaults here are used only when a tenant has not set a value, and none
of them is a place.
"""

# Hiring roles that signal operational strain or active build work. Used when
# the tenant has not set target_roles.
DEFAULT_HIRING_ROLES = [
    "operations manager",
    "operations coordinator",
    "data entry specialist",
    "software engineer",
    "full stack developer",
]


def search_locations(target_locations: list[str] | None, limit: int = 2) -> list[str]:
    """Up to `limit` locations worth searching on. Abbreviations ("MI", "TX")
    match too loosely to search on alone, so they are used only when the
    tenant listed nothing longer."""
    locs = [l.strip() for l in (target_locations or []) if l and l.strip()]
    meaningful = [l for l in locs if len(l) > 3]
    return (meaningful or locs)[:limit]


def hiring_roles(target_roles: list[str] | None, limit: int = 5) -> list[str]:
    roles = [r.strip() for r in (target_roles or []) if r and r.strip()]
    return (roles or DEFAULT_HIRING_ROLES)[:limit]
