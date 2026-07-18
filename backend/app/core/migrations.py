"""Lightweight idempotent schema migrations.

The project uses ``Base.metadata.create_all`` which creates missing tables but
never alters existing ones. These statements bridge that gap for columns added
after a table already exists in a running database. Each is safe to run on every
startup (Postgres ``IF NOT EXISTS``), so they act as a minimal stand-in for a
full migration tool until one is introduced.
"""

from sqlalchemy import text
from sqlalchemy.engine import Engine

# Statements must be idempotent — they run on every app startup.
_MIGRATIONS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password "
    "BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS placement_ctc DOUBLE PRECISION",
    # Offers from the "mark as placed" flow are not tied to a drive.
    "ALTER TABLE offers ALTER COLUMN drive_id DROP NOT NULL",
    # Roll numbers are unique per-college, not globally (multi-tenant). The old
    # `unique=True, index=True` produced a UNIQUE index on roll_number alone;
    # drop it (and the constraint form, in case an older DB had that instead),
    # rebuild a plain index for lookups, and add the composite unique.
    "ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_number_key",
    "DROP INDEX IF EXISTS ix_students_roll_number",
    "CREATE INDEX IF NOT EXISTS ix_students_roll_number ON students (roll_number)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_college_roll "
    "ON students (college_id, roll_number)",
    # Resume snapshot submitted with a drive application.
    "ALTER TABLE drive_participants ADD COLUMN IF NOT EXISTS resume_url VARCHAR",
    # Planned interview-round count. (The drive_rounds table, which holds the
    # per-round appeared/passed counts, is created by create_all.)
    "ALTER TABLE drives ADD COLUMN IF NOT EXISTS total_rounds INTEGER",
    # Tenant scoping for the Phase 2 modules (officers, communications, training)
    # whose tables predate the college_id column.
    "ALTER TABLE placement_officers ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES colleges(id)",
    "ALTER TABLE communications ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES colleges(id)",
    "ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES colleges(id)",
    # Officer-sourced company leads: provenance, head-review state, and submitter.
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS source VARCHAR",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id)",
    # review_status supersedes the pending_review flag (pending/approved/declined).
    "ALTER TABLE companies ADD COLUMN IF NOT EXISTS review_status VARCHAR",
    # One-time backfill from the old boolean; the IS NULL guard makes it a no-op
    # on later startups.
    "UPDATE companies SET review_status = 'pending' WHERE pending_review = TRUE AND review_status IS NULL",
]

# New values for existing native enum types. Stored labels are the enum *member
# names* (uppercase). `ADD VALUE` can't run inside a transaction block on older
# Postgres, so these run on an autocommit connection. `IF NOT EXISTS` makes them
# idempotent across restarts.
_ENUM_VALUES = [
    ("participantstatus", "WITHDRAWN"),
    # Rollup status for a student mid-way through the interview rounds.
    ("participantstatus", "IN_PROCESS"),
]


def run_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        for statement in _MIGRATIONS:
            conn.execute(text(statement))

    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        for type_name, value in _ENUM_VALUES:
            conn.execute(text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'"))
