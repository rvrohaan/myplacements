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
    # Opportunity scan: the per-college switch and the free-text filter.
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS job_scan_enabled BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS job_scan_focus VARCHAR",
    # Discovery moved from per-college leads to platform-wide postings: campus
    # hiring is national, so one scan serves every tenant. These statements lift
    # any leads written by the first shape into job_postings and leave job_leads
    # holding only what a college decided. All no-ops once that has happened.
    "ALTER TABLE job_leads ADD COLUMN IF NOT EXISTS posting_id INTEGER REFERENCES job_postings(id)",
    # Guarded on the old shape still being there, because the statements below
    # drop the very columns this reads - without the guard the second startup
    # would fail on a table that had already been migrated.
    """DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'job_leads' AND column_name = 'dedupe_key'
        ) THEN
            INSERT INTO job_postings (
                company_name, role_title, lead_type, location, work_mode, eligibility,
                compensation, posted_at, posted_label, source_name, source_url, summary,
                confidence, verified, dedupe_key, discovered_at, scan_id)
            SELECT DISTINCT ON (dedupe_key)
                company_name, role_title, lead_type, location, work_mode, eligibility,
                compensation, posted_at, posted_label, source_name, source_url, summary,
                confidence, COALESCE(verified, TRUE), dedupe_key, discovered_at, scan_id
            FROM job_leads
            WHERE dedupe_key IS NOT NULL
            ORDER BY dedupe_key, id
            ON CONFLICT (dedupe_key) DO NOTHING;

            UPDATE job_leads l SET posting_id = p.id
            FROM job_postings p
            WHERE p.dedupe_key = l.dedupe_key AND l.posting_id IS NULL;

            -- An untouched lead is now expressed by having no row at all.
            DELETE FROM job_leads WHERE status = 'new';
        END IF;
    END $$;""",
    "DELETE FROM job_leads WHERE posting_id IS NULL",
    "ALTER TABLE job_leads ALTER COLUMN posting_id SET NOT NULL",
    # The posting's own fields now live on job_postings only.
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS company_name",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS role_title",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS lead_type",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS location",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS work_mode",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS eligibility",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS compensation",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS posted_at",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS posted_label",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS source_name",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS source_url",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS summary",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS confidence",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS verified",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS discovered_at",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS scan_id",
    "ALTER TABLE job_leads DROP COLUMN IF EXISTS dedupe_key",
    "DROP INDEX IF EXISTS uq_job_leads_key",
    "DROP INDEX IF EXISTS ix_job_leads_college_status",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_job_leads_college_posting "
    "ON job_leads (college_id, posting_id)",
    # The dedupe key stopped including the source URL: the same opening listed on
    # a careers page and on three aggregators was four rows, and four cards to
    # read before you worked out they were one job. Collapse those, keeping the
    # earliest row, then rewrite every key to the new employer|role form. Both
    # halves are no-ops once they have run.
    r"""DO $$
    BEGIN
        -- Mirrors app.services.job_scan.posting_key: employer + role, with the
        -- requisition numbers that vary between sources stripped out. It only
        -- has to be close enough to merge what is already stored - from here on
        -- the Python side recomputes keys from the columns when it dedupes.
        CREATE TEMP TABLE _pk ON COMMIT DROP AS
        WITH cleaned AS (
            SELECT id,
                   trim(regexp_replace(lower(coalesce(company_name, '')), '[^a-z0-9]+', ' ', 'g')) AS c,
                   trim(regexp_replace(
                       regexp_replace(
                           regexp_replace(lower(coalesce(role_title, '')),
                                          '[([][^)\]]*[0-9][^)\]]*[)\]]', ' ', 'g'),
                           '[^a-z0-9]+', ' ', 'g'),
                       '(^| )([0-9]+|job|jobid|req|reqid|requisition|id|ref|code)( |$)', ' ', 'g')) AS r,
                   lower(coalesce(source_url, '')) AS u
            FROM job_postings
        ), tidied AS (
            SELECT id, c, u,
                   trim(regexp_replace(
                       regexp_replace(r, '(^| )([0-9]+|job|jobid|req|reqid|requisition|id|ref|code)( |$)', ' ', 'g'),
                       ' +', ' ', 'g')) AS r
            FROM cleaned
        )
        SELECT id, c || '|' || CASE WHEN r = '' THEN 'url:' || u ELSE r END AS k
        FROM tidied;

        CREATE TEMP TABLE _keep ON COMMIT DROP AS
        SELECT k, MIN(id) AS keep_id FROM _pk GROUP BY k;

        -- A college that decided on both copies keeps its decision on the survivor.
        DELETE FROM job_leads l
        USING _pk p, _keep s
        WHERE l.posting_id = p.id AND s.k = p.k AND p.id <> s.keep_id
          AND EXISTS (
            SELECT 1 FROM job_leads o
            WHERE o.college_id = l.college_id AND o.posting_id = s.keep_id
          );

        UPDATE job_leads l SET posting_id = s.keep_id
        FROM _pk p, _keep s
        WHERE l.posting_id = p.id AND s.k = p.k AND p.id <> s.keep_id;

        DELETE FROM job_postings d
        USING _pk p, _keep s
        WHERE d.id = p.id AND s.k = p.k AND p.id <> s.keep_id;

        UPDATE job_postings d SET dedupe_key = p.k
        FROM _pk p
        WHERE d.id = p.id AND d.dedupe_key IS DISTINCT FROM p.k;
    END $$;""",
    # One *scheduled* scan per day for the whole platform. Partial on purpose: a
    # person clicking Scan now (triggered_by_id set) is outside it.
    "DROP INDEX IF EXISTS uq_job_lead_scans_cron",
    "ALTER TABLE job_lead_scans ALTER COLUMN college_id DROP NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_job_lead_scans_daily "
    "ON job_lead_scans (scan_date) WHERE triggered_by_id IS NULL",
    # Drive.college_id has been on the model for a while but never had a
    # statement here, so databases predating it never grew the column. Without it
    # every tenant-scoped drive query fails, and drives created before the column
    # was stamped are invisible to their own college - hence the backfill, which
    # takes the tenant from the drive's company and is a no-op once applied.
    "ALTER TABLE drives ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES colleges(id)",
    "UPDATE drives d SET college_id = c.college_id FROM companies c "
    "WHERE d.company_id = c.id AND d.college_id IS NULL AND c.college_id IS NOT NULL",
    # Notifications. The table itself comes from create_all; these indexes are
    # repeated here because create_all will not add an index to a table that
    # already exists on a redeployed database (see the daily-update note above).
    "CREATE INDEX IF NOT EXISTS ix_notifications_user_created "
    "ON notifications (user_id, created_at DESC)",
    # The badge query. Partial, so it stays small however much history builds up.
    "CREATE INDEX IF NOT EXISTS ix_notifications_user_unread "
    "ON notifications (user_id) WHERE read_at IS NULL",
    "CREATE INDEX IF NOT EXISTS ix_notifications_group ON notifications (user_id, group_key)",
    # Digest notifications used to link at the page rather than at the entry they
    # were about. A row's link is written once, at emit time, and deliberately
    # never recomputed on read - so rows already in someone's bell keep pointing
    # at the top of today's digest until they are rewritten here. Both statements
    # only match the old literal, which makes them no-ops once applied.
    #
    # A row standing for several people gets the day alone; pointing it at one of
    # them would be wrong.
    """
    UPDATE notifications n
    SET link = '/daily-digest?date=' || to_char(d.report_date, 'YYYY-MM-DD')
    FROM daily_updates d
    WHERE n.link = '/daily-digest'
      AND n.entity_type = 'daily_update'
      AND n.entity_id = d.id
      AND COALESCE((n.meta ->> 'count')::int, 1) > 1
    """,
    """
    UPDATE notifications n
    SET link = '/daily-digest?date=' || to_char(d.report_date, 'YYYY-MM-DD')
               || '&update=' || n.entity_id
    FROM daily_updates d
    WHERE n.link = '/daily-digest'
      AND n.entity_type = 'daily_update'
      AND n.entity_id = d.id
    """,
    # HR contact management. `next_action` records what we owe the contact next;
    # `updated_at` was missing from the table entirely, so an edited contact
    # looked untouched next to every other record in the schema.
    "ALTER TABLE hr_contacts ADD COLUMN IF NOT EXISTS next_action VARCHAR",
    "ALTER TABLE hr_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP",
    "UPDATE hr_contacts SET updated_at = created_at WHERE updated_at IS NULL",
    # Rows written before the column default landed sit at NULL, which a 1-5
    # rating has no sensible way to render. 3 is the column default - the
    # "no strong opinion either way" rung.
    "UPDATE hr_contacts SET relationship_strength = 3 WHERE relationship_strength IS NULL",
    # The HR directory scores engagement by walking each contact's
    # communications. hr_contact_id was a plain FK column with no index, so that
    # join was a sequential scan per contact.
    "CREATE INDEX IF NOT EXISTS ix_communications_hr_contact "
    "ON communications (hr_contact_id) WHERE hr_contact_id IS NOT NULL",
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
