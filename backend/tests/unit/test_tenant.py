"""app/core/tenant.py - which college a request belongs to.

The subdomain *is* the tenant, so this is the first half of the access-control
story (the second half is deps.get_current_user checking the token against it).
A wrong answer here either hides a college from itself or shows it someone
else's data, so the table below is deliberately exhaustive about the edges.
"""

import pytest
from starlette.requests import Request

from app.core import tenant


def make_request(**headers: str) -> Request:
    """A request carrying nothing but headers - all resolve_subdomain reads."""
    raw = [(k.replace("_", "-").lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


# --- extract_subdomain ------------------------------------------------------


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        # The real shapes, production and dev.
        ("rit.myplacements.in", "rit"),
        ("admin.myplacements.in", "admin"),
        ("rit.localhost:5173", "rit"),
        ("admin.localhost:5173", "admin"),
        # No tenant: the apex is the marketing site, bare hosts are dev.
        ("myplacements.in", None),
        ("localhost", None),
        ("localhost:8000", None),
        ("127.0.0.1:8000", None),
        ("0.0.0.0", None),
        # Only the leftmost label counts.
        ("rit.staging.myplacements.in", "rit"),
        ("a.b.c.myplacements.in", "a"),
        # Case and whitespace are not significant in a Host header.
        ("RIT.MyPlacements.IN", "rit"),
        ("  rit.myplacements.in  ", "rit"),
        ("rit.myplacements.in:443", "rit"),
        # Nothing to read.
        (None, None),
        ("", None),
        (":8000", None),
        # A domain that merely ends in similar text is not ours. Matching on a
        # bare suffix would hand evilmyplacements.in a tenant.
        ("evilmyplacements.in", None),
        ("rit.evil.com", None),
    ],
)
def test_extract_subdomain(host, expected):
    assert tenant.extract_subdomain(host) == expected


def test_a_hyphenated_college_code_survives():
    """College.code is a DNS label, so hyphens are legal and common."""
    assert tenant.extract_subdomain("st-josephs.myplacements.in") == "st-josephs"


# --- resolve_subdomain ------------------------------------------------------


def test_the_host_header_identifies_the_tenant():
    assert tenant.resolve_subdomain(make_request(host="rit.myplacements.in")) == "rit"


def test_the_x_tenant_header_wins_over_the_host():
    """The dev proxy rewrites Host to localhost, so the frontend states the
    tenant explicitly. When it does, it is the answer."""
    request = make_request(host="localhost:8000", x_tenant="rit")
    assert tenant.resolve_subdomain(request) == "rit"


def test_x_tenant_overrides_even_a_real_host():
    request = make_request(host="bmsce.myplacements.in", x_tenant="rit")
    assert tenant.resolve_subdomain(request) == "rit"


def test_x_tenant_is_normalised():
    request = make_request(host="localhost", x_tenant="  RIT  ")
    assert tenant.resolve_subdomain(request) == "rit"


def test_an_empty_x_tenant_falls_back_to_the_host():
    request = make_request(host="rit.myplacements.in", x_tenant="")
    assert tenant.resolve_subdomain(request) == "rit"


def test_no_headers_at_all_resolves_to_no_tenant():
    assert tenant.resolve_subdomain(make_request()) is None


@pytest.mark.parametrize("source", ["host", "x_tenant"])
def test_www_is_the_marketing_site_not_a_college(source):
    """The apex alias. Treating it as a tenant would send www.myplacements.in
    looking for a college whose code is www."""
    if source == "host":
        headers = {"host": "www.myplacements.in"}
    else:
        headers = {"host": "localhost", "x_tenant": "www"}
    assert tenant.resolve_subdomain(make_request(**headers)) is None


# --- is_admin_host ----------------------------------------------------------


def test_the_console_host_is_recognised():
    assert tenant.is_admin_host(make_request(host="admin.myplacements.in")) is True


def test_the_console_is_recognised_in_dev_too():
    assert tenant.is_admin_host(make_request(host="localhost", x_tenant="admin")) is True


@pytest.mark.parametrize(
    "host",
    ["rit.myplacements.in", "myplacements.in", "www.myplacements.in", "localhost"],
)
def test_everything_else_is_not_the_console(host):
    """Only super_admins sign in on the console, so a false positive here would
    open that door on a college subdomain."""
    assert tenant.is_admin_host(make_request(host=host)) is False


def test_admin_resolves_as_a_slug():
    """Unlike www, admin is not filtered out - is_admin_host depends on it, and
    get_optional_college then simply finds no college with that code."""
    assert tenant.resolve_subdomain(make_request(host="admin.myplacements.in")) == "admin"
