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
    # Authorship on communication logs, so leadership can see who logged what.
    "ALTER TABLE communications ADD COLUMN IF NOT EXISTS logged_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE communications ADD COLUMN IF NOT EXISTS officer_attribution VARCHAR",
    "ALTER TABLE communications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "CREATE INDEX IF NOT EXISTS ix_communications_logged_by_id ON communications (logged_by_id)",
    "CREATE INDEX IF NOT EXISTS ix_communications_officer_id ON communications (officer_id)",
    "UPDATE communications SET updated_at = created_at WHERE updated_at IS NULL",
    # Mark anything that already carried an officer as recorded, *before* the
    # backfill below, so the two can be told apart afterwards.
    "UPDATE communications SET officer_attribution = 'recorded' "
    "WHERE officer_id IS NOT NULL AND officer_attribution IS NULL",
    # Rows logged before authorship existed have no author to recover. Attribute
    # them to the officer who owns the company (the only signal available) and
    # flag them inferred, so the officer comparison keeps its history instead of
    # dropping to zero. Only companies with exactly one owner are touched.
    # `logged_by_id IS NULL` confines this to those legacy rows: a head's log
    # written after this ships has an author, and must stay credited to nobody.
    "UPDATE communications c SET officer_id = a.officer_id, officer_attribution = 'inferred' "
    "FROM company_assignments a WHERE a.company_id = c.company_id "
    "AND c.officer_id IS NULL AND c.logged_by_id IS NULL "
    "AND (SELECT COUNT(*) FROM company_assignments x WHERE x.company_id = c.company_id) = 1",
    # Daily updates: per-college filing deadline and an on/off switch.
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS daily_update_cutoff VARCHAR",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS daily_update_enabled BOOLEAN NOT NULL DEFAULT TRUE",
    "UPDATE colleges SET daily_update_cutoff = '19:00' WHERE daily_update_cutoff IS NULL",
    # One update per person per day, and one scheduler run per college/day/job.
    # These indexes live here rather than only on the model because create_all
    # will not add them to a table that already exists on a redeployed database.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_updates_person_date "
    "ON daily_updates (college_id, submitted_by_id, report_date)",
    "CREATE INDEX IF NOT EXISTS ix_daily_updates_college_date "
    "ON daily_updates (college_id, report_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_update_runs "
    "ON daily_update_runs (college_id, report_date, kind)",
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
