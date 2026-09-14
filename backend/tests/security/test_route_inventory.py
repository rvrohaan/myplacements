"""Every endpoint is authenticated unless it is on the list below.

The rest of this directory checks that endpoints scope their answers correctly.
This one checks the cheaper, more absolute property first: that an endpoint has
any authentication at all. A route added without it is not a subtle bug - it is
the whole database, open.

The allowlist is the point. Adding a public endpoint means editing this file,
which puts the decision in a diff someone reviews, rather than letting it follow
silently from a forgotten dependency.
"""

import pytest
from fastapi.routing import APIRoute

from app.core.deps import get_current_user
from app.main import app

# Endpoints that are deliberately reachable with no token, and why.
PUBLIC_ENDPOINTS = {
    ("GET", "/api/health"): "Liveness probe for the platform.",
    ("POST", "/api/auth/login"): "Issues the token; cannot require one.",
    ("POST", "/api/auth/student/login"): "Same, for roll-number sign-in.",
    ("GET", "/api/colleges/current"): (
        "Branding for the login screen, before anyone has signed in. Returns "
        "only the public identity of a college that is already named by the "
        "subdomain the caller used."
    ),
    ("POST", "/api/auth/find-portal"): (
        "The apex marketing page's 'find your college' lookup. Deliberately "
        "trades a little enumeration resistance for UX; super_admin accounts "
        "are excluded so the console is never surfaced."
    ),
    ("GET", "/api/auth/invite/{token}"): "The token in the URL is the credential.",
    ("POST", "/api/auth/invite/{token}/accept"): "Same; this is where a password is first set.",
    ("POST", "/api/daily-updates/cron/run"): "Unattended scheduler; guarded by CRON_TOKEN.",
    ("POST", "/api/job-leads/cron/run"): "Unattended scheduler; guarded by CRON_TOKEN.",
}


def _authenticated(dependant) -> bool:
    """Whether get_current_user appears anywhere in a route's dependency tree.

    Recursive because the guard is usually reached indirectly: require_roles
    returns a closure that depends on it, and so does get_current_student.
    """
    return any(
        sub.call is get_current_user or _authenticated(sub) for sub in dependant.dependencies
    )


def api_endpoints() -> list[tuple[str, str, APIRoute]]:
    out = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            out.append((method, route.path, route))
    return sorted(out, key=lambda r: (r[1], r[0]))


ENDPOINTS = api_endpoints()


def test_the_inventory_is_not_empty():
    """A refactor that stopped registering routers would otherwise make every
    test below pass by vacuum."""
    assert len(ENDPOINTS) > 100


@pytest.mark.parametrize(
    ("method", "path", "route"),
    ENDPOINTS,
    ids=[f"{m} {p}" for m, p, _ in ENDPOINTS],
)
def test_every_endpoint_is_authenticated_or_listed(method, path, route):
    if (method, path) in PUBLIC_ENDPOINTS:
        pytest.skip("deliberately public: " + PUBLIC_ENDPOINTS[(method, path)])
    assert _authenticated(route.dependant), (
        f"{method} {path} has no authentication dependency. Add one, or if it is "
        f"genuinely public, add it to PUBLIC_ENDPOINTS with the reason."
    )


def test_the_allowlist_has_no_stale_entries():
    """An entry left behind after an endpoint was secured or removed would
    silently excuse a future endpoint that reused the path."""
    live = {(m, p) for m, p, _ in ENDPOINTS}
    assert set(PUBLIC_ENDPOINTS) <= live, set(PUBLIC_ENDPOINTS) - live


def test_no_listed_endpoint_has_quietly_become_authenticated():
    """The reverse drift: if one of these gained a guard, the entry should go,
    so the list keeps meaning what it says."""
    still_public = {
        (m, p) for m, p, route in ENDPOINTS if not _authenticated(route.dependant)
    }
    assert set(PUBLIC_ENDPOINTS) == still_public


def test_both_scheduler_endpoints_are_guarded_by_a_shared_secret():
    """They are public in the dependency sense, so their guard is inside the
    handler. Proven behaviourally in test_cron_endpoints.py; asserted here so
    the allowlist entry cannot outlive the check it refers to."""
    import inspect

    from app.routers import daily_updates, job_leads

    for module in (daily_updates, job_leads):
        source = inspect.getsource(module.cron_run)
        assert "CRON_TOKEN" in source
        assert "compare_digest" in source
