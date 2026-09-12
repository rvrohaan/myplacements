"""Shared role groupings.

Several routers each keep their own copy of these tuples (analytics, companies,
communications, daily_updates, officers). New code should import from here; the
existing copies are left alone deliberately, so that consolidating them is its
own small change rather than noise inside a feature.
"""

from app.models.user import UserRole

# The heads: everyone who sees the whole college rather than their own slice.
LEADERSHIP_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.PRINCIPAL,
    UserRole.PRO_CHANCELLOR,
    UserRole.DEPUTY_PRO_CHANCELLOR,
)

# The people on the ground, who file daily updates and own company allocations.
FILER_ROLES = (
    UserRole.PLACEMENT_OFFICER,
    UserRole.DEPARTMENT_COORDINATOR,
)

# Everyone who works in the staff app. Students are deliberately not here.
STAFF_ROLES = LEADERSHIP_ROLES + FILER_ROLES
