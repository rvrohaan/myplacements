"""Shared test harness.

Three things happen here, in this order, and the order matters:

1. Environment is pinned *before* anything from ``app`` is imported, because
   ``app.core.config.settings`` and ``app.core.database.engine`` are both built
   at import time. Setting these afterwards would have no effect.
2. A SQLite engine stands in for Postgres. Every model in this project uses
   portable column types, and ``run_migrations`` is a no-op off Postgres, so a
   fresh ``create_all`` gives a complete schema with no container to start.
   Dialect-specific behaviour is covered separately by the ``postgres`` tier.
3. Outbound sockets are blocked, so a test can never reach Anthropic, Resend or
   a real database by accident.
"""

import os

# --- 1. Environment, before any app import ---------------------------------
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "test-secret-key-not-used-anywhere-real"
os.environ["ENVIRONMENT"] = "test"
os.environ["BASE_DOMAIN"] = "myplacements.in"
# Empty keys keep the AI and email paths in their "not configured" branch, which
# is the behaviour tests should see unless they explicitly patch the seam.
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["RESEND_API_KEY"] = ""
os.environ["CRON_TOKEN"] = ""
os.environ["LOCAL_TIMEZONE"] = "Asia/Kolkata"

import socket  # noqa: E402
from datetime import timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models.user import User  # noqa: E402

# Aliased: a bare `app` here would collide with the `app` package itself, and
# importing anything from it afterwards would silently rebind the name.
# Importing app.main is also what registers every model on Base.metadata.
from app.main import app as fastapi_app  # noqa: E402

from tests import factories  # noqa: E402


# --- 2. Database ------------------------------------------------------------


@pytest.fixture(scope="session")
def engine(tmp_path_factory):
    """One in-memory schema for the whole run.

    ``StaticPool`` hands out the same connection every time, which is what makes
    ``sqlite://`` (memory) usable at all: a normal pool would give each checkout
    its own empty database.
    """
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _on_connect(dbapi_conn, _record):
        # SQLite ignores foreign keys unless asked. Turning them on keeps the
        # test database honest about what Postgres enforces in production.
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
        # pysqlite emits its own BEGIN at surprising moments, which breaks
        # SAVEPOINT - and savepoints are what let the `db` fixture undo a
        # router's commit. Handing transaction control to SQLAlchemy is the
        # documented fix.
        dbapi_conn.isolation_level = None

    @event.listens_for(eng, "begin")
    def _do_begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="session")
def pg_engine():
    """A real Postgres, for the contract tier.

    Skips unless ``TEST_POSTGRES_URL`` points somewhere - so the fast tier stays
    the default locally and nobody needs a container to run the suite. CI sets
    it for the ``postgres``-marked job.

    The schema is dropped and rebuilt each session: these tests assert on DDL
    and dialect behaviour, so they must not inherit a previous run's shape.
    """
    url = os.environ.get("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("TEST_POSTGRES_URL is not set; skipping the Postgres tier")

    # This fixture drops every table. The dev database usually lives on the same
    # Postgres as the test one (docker-compose runs a single container), so one
    # mistyped URL would wipe real work. Refuse anything not named as a test
    # database rather than trusting the caller to have got it right.
    database = url.rsplit("/", 1)[-1].split("?", 1)[0]
    if not database.endswith("_test"):
        pytest.fail(
            f"TEST_POSTGRES_URL points at {database!r}, which this fixture would "
            "DROP every table in. Name the database with a '_test' suffix."
        )

    eng = create_engine(url, pool_pre_ping=True)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture
def db(engine):
    """A session whose writes are discarded when the test ends.

    The outer transaction is never committed. ``join_transaction_mode`` turns
    the ``db.commit()`` calls that routers make into savepoint releases, so
    application code behaves normally while the test still rolls back cleanly.
    """
    conn = engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


# --- 3. HTTP client ---------------------------------------------------------


@pytest.fixture
def make_client(db):
    """Build a client bound to a specific host.

    The host is the tenant: ``make_client("rit")`` talks to
    ``rit.myplacements.in`` and exercises the real ``Host``-header resolution in
    ``app.core.tenant`` rather than stubbing the college dependency.

    Note the absence of a ``with`` block. Entering ``TestClient`` as a context
    manager would run the app's lifespan, which calls ``create_all`` against the
    application engine - a different database from the one under test.
    """

    def _make(subdomain: str | None = None) -> TestClient:
        host = f"{subdomain}.myplacements.in" if subdomain else "myplacements.in"
        return TestClient(fastapi_app, base_url=f"http://{host}")

    fastapi_app.dependency_overrides[get_db] = lambda: db
    try:
        yield _make
    finally:
        fastapi_app.dependency_overrides.clear()


@pytest.fixture
def client(make_client):
    """Apex host: no tenant. Most tests want ``make_client("rit")`` instead."""
    return make_client()


@pytest.fixture
def auth():
    """``headers=auth(user)`` - a bearer token for that user.

    Mints a real token through ``create_access_token`` so the token's own claims
    (subject, ``college_id``, expiry) stay under test rather than being faked.
    """

    def _auth(user: User, *, expires_in: timedelta | None = None) -> dict[str, str]:
        token = create_access_token(
            subject=user.id, college_id=user.college_id, expires_delta=expires_in
        )
        return {"Authorization": f"Bearer {token}"}

    return _auth


# --- 4. Network guard -------------------------------------------------------

# Addresses the guard below lets through.
_LOOPBACK = {"127.0.0.1", "::1", "localhost", ""}



@pytest.fixture(autouse=True)
def _no_network(request, monkeypatch):
    """Fail loudly instead of reaching the internet.

    TestClient speaks ASGI in-process and SQLite needs no socket, so nothing in
    a correct test opens one. An AI or email call that slipped past its mock
    would otherwise hang on a real request.
    """
    if "allow_network" in request.keywords:
        return

    def _guard(real):
        def _connect(self, address, *args, **kwargs):
            host = address[0] if isinstance(address, tuple) else address
            # Loopback stays open: asyncio builds its event loop out of a
            # socketpair to 127.0.0.1 on Windows, and TestClient needs a loop.
            if host in _LOOPBACK:
                return real(self, address, *args, **kwargs)
            raise RuntimeError(
                f"This test tried to reach {host!r}. Mock the seam "
                "(ai_service._get_client or notifications.send_email), or mark "
                "the test @pytest.mark.allow_network if the call is the point."
            )

        return _connect

    monkeypatch.setattr(socket.socket, "connect", _guard(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", _guard(socket.socket.connect_ex))


# --- 5. Factories -----------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_factory_counter():
    factories.reset_sequence()


@pytest.fixture
def college(db):
    """The default tenant. Reachable at rit.myplacements.in."""
    return factories.make_college(db, code="rit", name="RIT")


@pytest.fixture
def other_college(db):
    """A second tenant, for proving the boundary holds."""
    return factories.make_college(db, code="bmsce", name="BMSCE")
