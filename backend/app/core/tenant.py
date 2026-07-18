"""Subdomain-based tenant (college) resolution.

Each college is reached at ``<code>.myplacements.in`` (e.g. ``rit.myplacements.in``).
The tenant is derived from the request's ``Host`` header, falling back to an
explicit ``X-Tenant`` header. The header fallback exists because the Vite dev
proxy rewrites ``Host`` to ``localhost`` (``changeOrigin: true``), so in
development the browser can't signal the tenant via ``Host`` alone — the frontend
sends ``X-Tenant`` derived from ``window.location.hostname`` instead.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.college import College

# Hosts that never carry a tenant subdomain (apex/local bare hosts).
_BARE_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}

# Reserved subdomains that never identify a tenant college. 'www' is an alias of
# the apex marketing site, so it resolves to no tenant (like the bare apex).
_NON_TENANT_SUBDOMAINS = {"www"}


def extract_subdomain(host: str | None) -> str | None:
    """Return the tenant slug from a Host value, or None if there isn't one.

    Examples (BASE_DOMAIN=myplacements.in):
        rit.myplacements.in   -> "rit"
        myplacements.in       -> None        (apex)
        rit.localhost:5173    -> "rit"       (dev)
        localhost:8000        -> None
    """
    if not host:
        return None
    host = host.split(":", 1)[0].strip().lower()  # drop port
    if not host or host in _BARE_HOSTS:
        return None

    base = settings.BASE_DOMAIN.lower()
    if host == base:
        return None
    if host.endswith("." + base):
        label = host[: -len("." + base)]
        # Only the leftmost label is the tenant; ignore deeper nesting/www.
        label = label.split(".")[0]
        return label or None

    # Dev convenience: *.localhost resolves to 127.0.0.1 in modern browsers.
    if host.endswith(".localhost"):
        return host[: -len(".localhost")].split(".")[0] or None

    return None


def resolve_subdomain(request: Request) -> str | None:
    """Tenant slug for this request: explicit X-Tenant header wins, else Host."""
    explicit = request.headers.get("x-tenant")
    if explicit:
        slug = explicit.strip().lower() or None
    else:
        slug = extract_subdomain(request.headers.get("host"))
    # 'www' (and other reserved labels) map to the marketing site, not a tenant.
    if slug in _NON_TENANT_SUBDOMAINS:
        return None
    return slug


def is_admin_host(request: Request) -> bool:
    """True when the request targets the platform console (admin.myplacements.in)."""
    return resolve_subdomain(request) == settings.ADMIN_SUBDOMAIN


def get_optional_college(request: Request, db: Session = Depends(get_db)) -> College | None:
    """Resolve the College for this request's subdomain, or None when there is
    no subdomain (apex host) or it doesn't match an active college."""
    slug = resolve_subdomain(request)
    if not slug:
        return None
    return db.query(College).filter(College.code == slug, College.is_active == True).first()


def get_current_college(request: Request, db: Session = Depends(get_db)) -> College:
    """Strict variant: 404 when the subdomain is missing or unknown.

    Use for endpoints that only make sense within a tenant (login, branding).
    """
    slug = resolve_subdomain(request)
    if not slug:
        raise HTTPException(status_code=404, detail="No college subdomain in request")
    college = db.query(College).filter(College.code == slug, College.is_active == True).first()
    if not college:
        raise HTTPException(status_code=404, detail="Unknown college")
    return college
