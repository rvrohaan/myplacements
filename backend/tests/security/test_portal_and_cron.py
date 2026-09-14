"""The two surfaces that sit outside the staff gate, and must keep working.

Adding `get_current_staff` at the router level closed the staff app to students.
That is only correct if the two things deliberately left outside it still
function: the student portal, and the tokenless scheduler ticks. A security fix
that quietly breaks the portal for every student is not a fix.

So this file is the other half of the change - it asserts what must still be
reachable, not only what must not.
"""

import pytest

from app.core.config import settings
from tests import factories

PORTAL_READS = ["/api/portal/me", "/api/portal/me/skills", "/api/portal/companies", "/api/portal/me/drives"]


# --- the student portal still belongs to students ---------------------------


@pytest.mark.parametrize("path", PORTAL_READS)
def test_a_student_still_reaches_their_portal(make_client, auth, rit, path):
    response = make_client("rit").get(path, headers=auth(rit.student.user))
    assert response.status_code == 200, f"{path} -> {response.text}"


def test_the_portal_returns_the_signed_in_student(make_client, auth, rit):
    response = make_client("rit").get("/api/portal/me", headers=auth(rit.student.user))
    assert response.json()["roll_number"] == "rit-001"


def test_a_student_still_reaches_their_notifications(make_client, auth, rit):
    """User-scoped rather than staff-scoped, so it sits outside the gate by
    design - a student is notified about their own drives."""
    response = make_client("rit").get("/api/notifications", headers=auth(rit.student.user))
    assert response.status_code == 200


def test_a_student_still_reaches_auth_me(make_client, auth, rit):
    """The frontend calls this to decide whether to render the portal at all.
    Gating it would log every student out."""
    response = make_client("rit").get("/api/auth/me", headers=auth(rit.student.user))
    assert response.status_code == 200
    assert response.json()["role"] == "student"


def test_the_login_screen_branding_is_still_public(make_client, rit):
    """No token at all: this renders before anyone signs in."""
    response = make_client("rit").get("/api/colleges/current")
    assert response.status_code == 200
    assert response.json()["code"] == "rit"


# --- and staff do not belong in the portal ----------------------------------


@pytest.mark.parametrize("path", PORTAL_READS)
def test_staff_are_refused_the_student_portal(make_client, auth, rit, path):
    """The mirror of the staff gate. /portal/me is "my record"; for an officer
    there is no such record, and the route must say so rather than guessing."""
    response = make_client("rit").get(path, headers=auth(rit.officer_user))
    assert response.status_code in (403, 404)


def test_a_student_sees_only_their_own_record_in_the_portal(make_client, auth, db, rit):
    """The portal keys off the token, never off an id in the URL, so there is
    no id for one student to substitute for another's."""
    classmate = factories.make_student(db, college=rit.college, roll_number="rit-002")
    response = make_client("rit").get("/api/portal/me", headers=auth(rit.student.user))
    assert response.json()["roll_number"] == "rit-001"
    assert response.json()["id"] != classmate.id


def test_a_student_of_another_college_is_refused(make_client, auth, rit, bmsce):
    """The tenant boundary applies to students too."""
    response = make_client("rit").get("/api/portal/me", headers=auth(bmsce.student.user))
    assert response.status_code == 401


# --- the scheduler ticks ----------------------------------------------------
# Public in the dependency sense: cron sends no bearer token. Their guard is the
# CRON_TOKEN shared secret, checked inside the handler.

CRON_PATHS = ["/api/daily-updates/cron/run", "/api/job-leads/cron/run"]


@pytest.mark.parametrize("path", CRON_PATHS)
def test_a_cron_tick_is_refused_without_the_secret(make_client, path):
    response = make_client("rit").post(path)
    assert response.status_code == 404


@pytest.mark.parametrize("path", CRON_PATHS)
def test_a_cron_tick_is_refused_with_the_wrong_secret(make_client, monkeypatch, path):
    monkeypatch.setattr(settings, "CRON_TOKEN", "the-real-secret")
    response = make_client("rit").post(path, headers={"X-Cron-Token": "a-guess"})
    assert response.status_code == 404


@pytest.mark.parametrize("path", CRON_PATHS)
def test_a_cron_tick_is_disabled_while_no_secret_is_configured(make_client, monkeypatch, path):
    """Fails closed. CRON_TOKEN ships blank, and an unconfigured scheduler
    endpoint must not be an open one."""
    monkeypatch.setattr(settings, "CRON_TOKEN", "")
    response = make_client("rit").post(path, headers={"X-Cron-Token": ""})
    assert response.status_code == 404


@pytest.mark.parametrize("path", CRON_PATHS)
def test_the_refusal_is_a_404_so_the_endpoint_stays_unadvertised(make_client, path):
    """403 would confirm a scheduler endpoint is there to be attacked."""
    response = make_client("rit").post(path, headers={"X-Cron-Token": "wrong"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Not Found"


@pytest.mark.parametrize("path", CRON_PATHS)
def test_a_cron_tick_runs_with_the_right_secret(make_client, monkeypatch, rit, path):
    """The half that proves the split routers still work. Without this, moving
    cron off the staff-gated router could have broken the scheduler silently -
    it has no user to complain."""
    monkeypatch.setattr(settings, "CRON_TOKEN", "the-real-secret")
    response = make_client("rit").post(path, headers={"X-Cron-Token": "the-real-secret"})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("path", CRON_PATHS)
def test_a_staff_token_does_not_substitute_for_the_cron_secret(make_client, auth, rit, path):
    """Being signed in, even as the head, is not the same authority as being
    the scheduler."""
    response = make_client("rit").post(path, headers=auth(rit.head))
    assert response.status_code == 404
