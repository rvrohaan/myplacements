"""Absolute links into the app, for messages that leave the building.

A link in an email has to name the tenant's own host, because that is the only
host where the account can sign in (see auth.login). Anything sent to a
college-less account - a platform admin - points at the console subdomain
instead.
"""

from app.core.config import settings
from app.models.college import College


def tenant_url(college: College | None, path: str) -> str:
    """An absolute URL for ``path`` on the college's own host."""
    host = (
        f"{college.code}.{settings.BASE_DOMAIN}"
        if college
        else f"{settings.ADMIN_SUBDOMAIN}.{settings.BASE_DOMAIN}"
    )
    return f"{settings.LINK_SCHEME}://{host}{path}"
