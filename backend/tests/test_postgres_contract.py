"""The contract tier: things only a real Postgres can answer.

Everything else runs on SQLite for speed. These tests exist because three
behaviours differ between the two and the difference is not cosmetic:

* ``app/core/migrations.py`` is Postgres-only DDL that never executes on SQLite,
  so nothing else covers it at all.
* ``Column(Enum(...))`` becomes a native enum type here and a VARCHAR + CHECK
  there, which changes what happens when a new member is added.
* ``ilike`` is a real operator here and an emulation there.

Run with ``pytest -m postgres`` and ``TEST_POSTGRES_URL`` set; skipped otherwise.
"""

import pytest
from sqlalchemy import inspect, text

from app.core.migrations import run_migrations

pytestmark = pytest.mark.postgres


def test_migrations_run_on_a_real_postgres(pg_engine):
    """The statements are Postgres syntax and are never exercised elsewhere."""
    run_migrations(pg_engine)


def test_migrations_are_idempotent(pg_engine):
    """They execute on every boot, so running twice must be a no-op, not an
    error. This is the property the whole `IF NOT EXISTS` style is buying."""
    run_migrations(pg_engine)
    run_migrations(pg_engine)


def test_migrations_produce_the_composite_roll_number_index(pg_engine):
    """Roll numbers are unique per college, not globally. The migration drops
    the old global unique index and builds the composite one; if that stopped
    working, two colleges could not reuse a roll number."""
    run_migrations(pg_engine)
    indexes = {ix["name"] for ix in inspect(pg_engine).get_indexes("students")}
    assert "uq_students_college_roll" in indexes


def test_enum_values_added_by_migration_are_accepted(pg_engine):
    """`ALTER TYPE ... ADD VALUE` is the one statement that cannot run inside a
    transaction. If the autocommit handling regressed, these labels would be
    missing and writing them would fail."""
    run_migrations(pg_engine)
    with pg_engine.connect() as conn:
        labels = set(
            conn.execute(
                text(
                    "SELECT e.enumlabel FROM pg_enum e "
                    "JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = 'participantstatus'"
                )
            ).scalars()
        )
    assert {"WITHDRAWN", "IN_PROCESS"} <= labels


def test_ilike_is_case_insensitive(pg_engine):
    """`find-portal` and the company search both rely on ilike. SQLite emulates
    it; this proves the real operator behaves as those endpoints assume."""
    with pg_engine.connect() as conn:
        assert conn.execute(text("SELECT 'RIT College' ILIKE '%rit%'")).scalar() is True


def test_the_daily_scan_lock_actually_locks(pg_engine):
    """The one invariant in the product that is billed if it breaks.

    One national web scan a day is shared by every tenant. The lock is a
    *partial* unique index - unique on scan_date only where triggered_by_id is
    NULL - so the scheduler can claim a day once while a person can still press
    "Scan now" alongside it. Partial indexes are Postgres-only and this one is
    created by run_migrations rather than by the model, so nothing outside this
    tier can test it: on SQLite an hourly cron would claim twenty-four times.
    """
    from datetime import date, datetime

    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    from app.models.job_lead import JobLeadScan

    run_migrations(pg_engine)
    day = date(2026, 9, 14)

    with Session(pg_engine) as session:
        session.query(JobLeadScan).filter(JobLeadScan.scan_date == day).delete()
        session.commit()

        session.add(JobLeadScan(scan_date=day, started_at=datetime.utcnow(), status="ok"))
        session.commit()

        # The scheduler's second attempt that day must be refused.
        session.add(JobLeadScan(scan_date=day, started_at=datetime.utcnow(), status="ok"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        # A person pressing "Scan now" is not the scheduler, so it still works.
        # A real user row, because triggered_by_id carries a foreign key.
        from app.models.user import User, UserRole

        person = User(
            email="scan-lock-probe@example.com",
            full_name="Scan Lock Probe",
            hashed_password="x",
            role=UserRole.SUPER_ADMIN,
        )
        session.add(person)
        session.commit()

        session.add(
            JobLeadScan(
                scan_date=day,
                started_at=datetime.utcnow(),
                status="ok",
                triggered_by_id=person.id,
            )
        )
        session.commit()

        session.query(JobLeadScan).filter(JobLeadScan.scan_date == day).delete()
        session.delete(person)
        session.commit()
