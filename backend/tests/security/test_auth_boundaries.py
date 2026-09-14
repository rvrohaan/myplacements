"""Where you may sign in, and what a setup link is worth.

Two rules with a shared theme: the host decides who may authenticate, and a
failure says as little as possible. Both exist so that holding a credential is
not the same as being able to use it anywhere.

The uniform-error rule is the one worth stating plainly. Login returns the same
401 for a wrong password, an unknown email and the right credentials on the
wrong subdomain - because a different answer to any of those turns the endpoint
into an oracle for discovering which emails exist and which college they belong
to. The one exception, a disabled account, is documented below rather than
asserted away: it takes a correct password to reach, so it tells an outsider
holding nothing nothing at all.
"""

from datetime import datetime, timedelta

import pytest

from app.models.invite import InvitePurpose, UserInvite
from app.models.user import UserRole
from app.services.invites import issue_invite
from tests import factories
from tests.factories import DEFAULT_PASSWORD


def login(client, email, password=DEFAULT_PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


# --- where staff may sign in ------------------------------------------------


def test_a_head_signs_in_on_their_own_subdomain(make_client, rit):
    response = login(make_client("rit"), rit.head.email)
    assert response.status_code == 200
    assert response.json()["user"]["email"] == rit.head.email


def test_a_head_cannot_sign_in_on_another_colleges_subdomain(make_client, rit, bmsce):
    """The credential is right; the door is not theirs."""
    assert login(make_client("bmsce"), rit.head.email).status_code == 401


def test_nobody_signs_in_on_the_apex(make_client, rit):
    """The apex is the public marketing site and carries no tenant."""
    assert login(make_client(), rit.head.email).status_code == 401


def test_nobody_signs_in_on_an_unknown_subdomain(make_client, rit):
    assert login(make_client("nosuchcollege"), rit.head.email).status_code == 401


def test_a_college_head_cannot_sign_in_on_the_platform_console(make_client, rit):
    """The console is the platform owner's door, not a college's."""
    assert login(make_client("admin"), rit.head.email).status_code == 401


def test_the_platform_owner_signs_in_on_the_console(make_client, platform_admin):
    assert login(make_client("admin"), platform_admin.email).status_code == 200


def test_the_platform_owner_cannot_sign_in_on_a_college_subdomain(make_client, rit, platform_admin):
    """super_admin crosses tenants once signed in, but still has exactly one
    place to sign in - so a stolen console password is not usable from a college
    subdomain a customer might be able to reach."""
    assert login(make_client("rit"), platform_admin.email).status_code == 401


# --- failures say nothing ---------------------------------------------------


def test_every_login_failure_without_a_valid_password_looks_identical(make_client, rit, bmsce):
    """A wrong password, an unknown email, and a right credential on the wrong
    host are indistinguishable. Any difference here would let someone holding no
    password at all enumerate who has an account and at which college."""
    client = make_client("rit")
    failures = [
        login(client, rit.head.email, "the-wrong-password"),
        login(client, "nobody@example.com"),
        login(client, bmsce.head.email),
    ]
    assert {r.status_code for r in failures} == {401}
    assert len({r.json()["detail"] for r in failures}) == 1


def test_a_disabled_account_cannot_sign_in(make_client, db, rit):
    disabled = factories.make_user(db, college=rit.college, role=UserRole.PRINCIPAL, is_active=False)
    assert login(make_client("rit"), disabled.email).status_code == 403


def test_a_disabled_account_is_told_so_rather_than_given_the_generic_401(make_client, db, rit):
    """Recorded as the deliberate trade it is, not asserted away.

    Reaching this answer needs the *correct* password, so it is not an
    enumeration oracle for an outsider - and telling a real user "your account
    is disabled" instead of "invalid credentials" saves them a support call they
    would otherwise have to make. The cost is that somebody who already holds a
    leaked password learns the account exists.
    """
    disabled = factories.make_user(db, college=rit.college, role=UserRole.PRINCIPAL, is_active=False)
    response = login(make_client("rit"), disabled.email)
    assert response.status_code == 403
    assert "disabled" in response.json()["detail"].lower()

    # Without the password it is indistinguishable from any other failure.
    wrong = login(make_client("rit"), disabled.email, "not-the-password")
    assert wrong.status_code == 401


def test_the_disabled_check_currently_runs_before_the_host_check(make_client, db, rit, bmsce):
    """A consequence of the ordering in auth.login, pinned so a change to it is
    visible: correct credentials for a *disabled* account answer 403 on any
    tenant's subdomain, including one the account has nothing to do with. So the
    account's existence is disclosed off its own host - to someone who already
    has its password.

    Moving the is_active check below the host check would close that at no cost
    to the message a legitimate user sees on their own subdomain. Left as-is
    because login semantics are a product decision, not a test's to make.
    """
    disabled = factories.make_user(db, college=rit.college, role=UserRole.PRINCIPAL, is_active=False)
    on_another_tenant = login(make_client("bmsce"), disabled.email)
    assert on_another_tenant.status_code == 403


def test_a_disabled_account_token_stops_working(make_client, auth, db, rit):
    """Deactivating somebody has to take effect now, not when their week-long
    token happens to expire."""
    user = factories.make_user(db, college=rit.college, role=UserRole.PRINCIPAL)
    headers = auth(user)
    assert make_client("rit").get("/api/auth/me", headers=headers).status_code == 200

    user.is_active = False
    db.flush()
    assert make_client("rit").get("/api/auth/me", headers=headers).status_code == 401


# --- students sign in by roll number ----------------------------------------


def test_a_student_signs_in_with_their_roll_number(make_client, rit):
    response = make_client("rit").post(
        "/api/auth/student/login",
        json={"roll_number": "rit-001", "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 200


def test_the_subdomain_disambiguates_a_roll_number(make_client, db, rit, bmsce):
    """Roll numbers are unique per college, not globally, so the host is what
    says which college's 1RV001 is being asked for."""
    factories.make_student(db, college=bmsce.college, roll_number="shared-001")
    factories.make_student(db, college=rit.college, roll_number="shared-001")

    on_rit = make_client("rit").post(
        "/api/auth/student/login", json={"roll_number": "shared-001", "password": DEFAULT_PASSWORD}
    )
    assert on_rit.status_code == 200
    assert on_rit.json()["user"]["college_id"] == rit.college.id


def test_a_student_cannot_sign_in_on_another_college_subdomain(make_client, rit, bmsce):
    response = make_client("bmsce").post(
        "/api/auth/student/login",
        json={"roll_number": "rit-001", "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 401


def test_a_student_with_login_disabled_is_refused(make_client, db, rit):
    """Most student rows exist for records only and have no usable login."""
    no_login = factories.make_student(
        db, college=rit.college, roll_number="rit-900", login_enabled=False
    )
    response = make_client("rit").post(
        "/api/auth/student/login",
        json={"roll_number": no_login.roll_number, "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 401


def test_student_login_failures_are_also_uniform(make_client, db, rit):
    """Otherwise the endpoint enumerates which roll numbers exist."""
    no_login = factories.make_student(
        db, college=rit.college, roll_number="rit-901", login_enabled=False
    )
    client = make_client("rit")
    failures = [
        client.post("/api/auth/student/login", json={"roll_number": "rit-001", "password": "wrong"}),
        client.post("/api/auth/student/login", json={"roll_number": "no-such", "password": DEFAULT_PASSWORD}),
        client.post("/api/auth/student/login", json={"roll_number": no_login.roll_number, "password": DEFAULT_PASSWORD}),
    ]
    assert {r.status_code for r in failures} == {401}
    assert len({r.json()["detail"] for r in failures}) == 1


# --- setup links ------------------------------------------------------------
# The token in the URL is the credential, so these are password-equivalent.


def make_invite(db, user, **kw):
    invite, raw = issue_invite(db, user, **kw)
    db.flush()
    return invite, raw


def test_a_live_link_names_its_owner(make_client, db, rit):
    """So the page can greet them before any password is typed."""
    _, raw = make_invite(db, rit.head)
    response = make_client("rit").get(f"/api/auth/invite/{raw}")
    assert response.status_code == 200
    assert response.json()["full_name"] == rit.head.full_name


def test_a_link_sets_the_password_and_signs_you_in(make_client, db, rit):
    _, raw = make_invite(db, rit.head)
    response = make_client("rit").post(
        f"/api/auth/invite/{raw}/accept", json={"new_password": "a-brand-new-password"}
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_a_link_cannot_be_spent_twice(make_client, db, rit):
    """It is password-equivalent, so a reusable link is a password that cannot
    be changed."""
    _, raw = make_invite(db, rit.head)
    client = make_client("rit")
    first = client.post(f"/api/auth/invite/{raw}/accept", json={"new_password": "first-password-1"})
    second = client.post(f"/api/auth/invite/{raw}/accept", json={"new_password": "second-password-2"})
    assert first.status_code == 200
    assert second.status_code == 404


def test_issuing_a_new_link_revokes_the_older_one(make_client, db, rit):
    """Otherwise revoking access means chasing every message ever sent."""
    _, old = make_invite(db, rit.head)
    _, new = make_invite(db, rit.head)
    client = make_client("rit")
    assert client.get(f"/api/auth/invite/{old}").status_code == 404
    assert client.get(f"/api/auth/invite/{new}").status_code == 200


def test_an_expired_link_is_refused(make_client, db, rit):
    invite, raw = make_invite(db, rit.head)
    invite.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.flush()
    assert make_client("rit").get(f"/api/auth/invite/{raw}").status_code == 404


def test_a_link_cannot_be_redeemed_on_another_colleges_host(make_client, db, rit, bmsce):
    """The same tenant boundary login enforces - a link minted for one college
    is not spendable on another."""
    _, raw = make_invite(db, rit.head)
    assert make_client("bmsce").get(f"/api/auth/invite/{raw}").status_code == 404


def test_a_disabled_account_cannot_be_walked_back_in_through_an_old_link(make_client, db, rit):
    """Re-enabling somebody should mean sending them a fresh link, not having
    an old one quietly still work."""
    user = factories.make_user(db, college=rit.college, role=UserRole.PLACEMENT_OFFICER)
    _, raw = make_invite(db, user)
    user.is_active = False
    db.flush()
    assert make_client("rit").get(f"/api/auth/invite/{raw}").status_code == 404


@pytest.mark.parametrize(
    "bad", ["unknown-token", "", "../../etc/passwd", "a" * 500], ids=["unknown", "empty", "traversal", "long"]
)
def test_a_junk_token_is_refused(make_client, bad):
    response = make_client("rit").get(f"/api/auth/invite/{bad}")
    assert response.status_code in (404, 405)


def test_every_bad_link_gives_the_same_answer(make_client, db, rit):
    """Unknown, expired, used and superseded must be one message. Distinguishing
    them turns the endpoint into an oracle for guessing tokens."""
    _, unknown = "x", "never-existed"
    expired_invite, expired = make_invite(db, rit.head)
    expired_invite.expires_at = datetime.utcnow() - timedelta(minutes=1)

    spent_user = factories.make_user(db, college=rit.college, role=UserRole.PRINCIPAL)
    spent_invite, spent = make_invite(db, spent_user)
    spent_invite.used_at = datetime.utcnow()
    db.flush()

    client = make_client("rit")
    answers = [client.get(f"/api/auth/invite/{t}") for t in (unknown, expired, spent)]
    assert {r.status_code for r in answers} == {404}
    assert len({r.json()["detail"] for r in answers}) == 1


def test_only_the_hash_of_a_token_is_stored(db, rit):
    """A database leak must not hand over live links."""
    _, raw = make_invite(db, rit.head)
    stored = db.query(UserInvite).filter(UserInvite.user_id == rit.head.id).first()
    assert stored.token_hash != raw
    assert raw not in stored.token_hash


def test_a_reset_link_is_marked_as_one(make_client, db, rit):
    """The page says "choose a new password" rather than "welcome"."""
    _, raw = make_invite(db, rit.head, purpose=InvitePurpose.RESET)
    assert make_client("rit").get(f"/api/auth/invite/{raw}").json()["is_reset"] is True


# --- the public portal finder -----------------------------------------------


def test_find_portal_never_surfaces_the_platform_console(make_client, platform_admin):
    """It would tell the internet where the owner signs in."""
    response = make_client().post("/api/auth/find-portal", json={"query": platform_admin.email})
    assert response.status_code == 200
    assert response.json()["colleges"] == []


def test_find_portal_finds_a_college_by_name(make_client, rit):
    response = make_client().post("/api/auth/find-portal", json={"query": "RIT"})
    assert [c["code"] for c in response.json()["colleges"]] == ["rit"]


def test_find_portal_ignores_a_too_short_query(make_client, rit):
    """Otherwise a single letter enumerates the customer list."""
    assert make_client().post("/api/auth/find-portal", json={"query": "r"}).json()["colleges"] == []


def test_find_portal_does_not_reveal_a_role_or_account_type(make_client, rit):
    response = make_client().post("/api/auth/find-portal", json={"query": rit.head.email})
    for college in response.json()["colleges"]:
        assert set(college) == {"name", "code", "city"}
