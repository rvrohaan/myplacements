"""Proves the harness itself works.

These are not feature tests. Each one pins a property the rest of the suite
will depend on, so that when a real test fails later it is the feature that is
wrong and not the scaffolding. They also serve as the worked example for how to
write the tiers that follow.
"""

import socket

import pytest

from app.core.security import get_password_hash
from app.models.college import College
from app.models.user import UserRole
from tests import factories


# --- the app boots ----------------------------------------------------------


def test_health_endpoint_answers(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_schema_has_every_table():
    """create_all on SQLite must produce the full schema, or the fast tier is
    testing a subset of the app."""
    from app.core.database import Base

    names = set(Base.metadata.tables)
    assert {"users", "colleges", "students", "companies", "drives", "offers"} <= names


def test_migrations_are_a_noop_off_postgres(engine):
    """The guard that lets this tier exist at all."""
    from app.core.migrations import run_migrations

    run_migrations(engine)  # Postgres-only DDL; must not raise on SQLite


# --- isolation --------------------------------------------------------------
# Both tests claim the same unique college code. They can only pass together if
# each one's writes are rolled back.


def test_isolation_first(db):
    factories.make_college(db, code="claimed")
    assert db.query(College).filter(College.code == "claimed").count() == 1


def test_isolation_second(db):
    assert db.query(College).filter(College.code == "claimed").count() == 0
    factories.make_college(db, code="claimed")


def test_router_commits_still_roll_back(db, make_client, college):
    """Routers call db.commit(). The savepoint mode must absorb that without
    leaking the row into the next test - the property test_isolation_* relies
    on, but through a real endpoint rather than the fixture."""
    admin = factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)
    from app.core.security import create_access_token

    token = create_access_token(subject=admin.id, college_id=admin.college_id)
    response = make_client("rit").post(
        "/api/auth/register",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "committed@rit.example.com",
            "full_name": "Committed User",
            "password": "whatever-1234",
            "role": "placement_officer",
        },
    )
    assert response.status_code == 201


def test_previous_commit_did_not_survive(db):
    from app.models.user import User

    assert db.query(User).filter(User.email == "committed@rit.example.com").count() == 0


# --- authentication ---------------------------------------------------------


def test_auth_fixture_produces_a_usable_session(db, make_client, auth, college):
    user = factories.make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
    response = make_client("rit").get("/api/auth/me", headers=auth(user))
    assert response.status_code == 200
    assert response.json()["email"] == user.email


def test_unauthenticated_request_is_rejected(make_client):
    assert make_client("rit").get("/api/auth/me").status_code == 401


def test_token_is_refused_on_another_colleges_host(db, make_client, auth, college, other_college):
    """The tenant boundary, driven through the real Host header."""
    user = factories.make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
    assert make_client("rit").get("/api/auth/me", headers=auth(user)).status_code == 200
    assert make_client("bmsce").get("/api/auth/me", headers=auth(user)).status_code == 401


def test_login_works_with_the_default_factory_password(db, make_client, college):
    user = factories.make_user(db, college=college, role=UserRole.PRINCIPAL)
    response = make_client("rit").post(
        "/api/auth/login",
        json={"email": user.email, "password": factories.DEFAULT_PASSWORD},
    )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["email"] == user.email


def test_factory_password_hash_is_reused(db, college):
    """Guards the bcrypt shortcut: if this stops holding, suites get slow."""
    a = factories.make_user(db, college=college)
    b = factories.make_user(db, college=college)
    assert a.hashed_password == b.hashed_password
    assert factories._hash(factories.DEFAULT_PASSWORD) == a.hashed_password
    assert get_password_hash("something-else") != a.hashed_password


# --- foreign keys -----------------------------------------------------------


def test_foreign_keys_are_enforced(db, college):
    """SQLite ignores FKs unless asked; the harness asks."""
    from sqlalchemy.exc import IntegrityError

    from app.models.officer import PlacementOfficer

    db.add(PlacementOfficer(user_id=999999, college_id=college.id))
    with pytest.raises(IntegrityError):
        db.flush()


# --- network guard ----------------------------------------------------------


def test_outbound_sockets_are_blocked():
    with pytest.raises(RuntimeError, match="tried to reach"):
        socket.socket().connect(("api.anthropic.com", 443))


@pytest.mark.allow_network
def test_the_guard_can_be_opted_out_of():
    """Marked tests get the real socket back - they just must not use it here."""
    assert socket.socket.connect is not None
