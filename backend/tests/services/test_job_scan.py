"""app/services/job_scan.py - the daily web scan, which costs real money.

One national scan a day is shared by every tenant. That makes this the only
service in the codebase where a bug is billed: a claim that fails to lock lets
an hourly cron burn twenty-four web searches instead of one, and a dedupe key
that stops matching files the same HARMAN internship four times, which is four
cards a chancellor has to read to discover they are one job.

So the tests are mostly about *not* doing work: claiming once, storing only
what is new, reusing an answer that is minutes old, and picking a stranded run
back up rather than paying for a replacement.

Nothing here reaches the network. `execute_scan` is the boundary; everything
tested below is the bookkeeping around it.
"""

from datetime import date, datetime, timedelta

import pytest

from app.models.job_lead import JobLead, JobLeadScan, JobPosting
from app.services import job_scan
from tests import factories

TODAY = date(2026, 9, 14)


def posting(company="HARMAN", role="Software Intern", url="https://harman.com/1", **kw):
    return {"company_name": company, "role_title": role, "source_url": url, **kw}


@pytest.fixture
def scan(db):
    row = JobLeadScan(scan_date=TODAY, started_at=datetime.utcnow(), status="ok")
    db.add(row)
    db.flush()
    return row


# --- storing what is new ----------------------------------------------------


def test_a_new_posting_is_stored(db, scan):
    assert job_scan.store_postings(db, scan, [posting()]) == 1
    assert db.query(JobPosting).count() == 1


def test_the_same_opening_from_another_source_is_not_stored_twice(db, scan):
    """One opening is routinely listed on the employer's careers page and on
    three aggregators. Four cards for one job is the failure this prevents."""
    job_scan.store_postings(db, scan, [posting(url="https://harman.com/1")])
    stored = job_scan.store_postings(
        db, scan, [posting(url="https://naukri.com/99", company="Harman ", role="software  intern")]
    )
    assert stored == 0
    assert db.query(JobPosting).count() == 1


def test_two_genuinely_different_roles_are_both_stored(db, scan):
    job_scan.store_postings(
        db, scan, [posting(role="Software Intern"), posting(role="Mechanical Intern")]
    )
    assert db.query(JobPosting).count() == 2


def test_a_duplicate_inside_one_batch_is_collapsed(db, scan):
    """The model itself returns the same opening twice often enough."""
    assert job_scan.store_postings(db, scan, [posting(), posting()]) == 1


def test_one_duplicate_does_not_throw_away_the_rest_of_the_batch(db, scan):
    """Each row lands inside its own savepoint, so a collision on one posting
    must not lose the other twenty-four."""
    job_scan.store_postings(db, scan, [posting(role="Software Intern")])
    stored = job_scan.store_postings(
        db,
        scan,
        [posting(role="Software Intern"), posting(role="Data Intern"), posting(role="QA Intern")],
    )
    assert stored == 2


def test_the_dedupe_key_is_recomputed_rather_than_trusted(db, scan):
    """Read off the columns, not off the stored key - so a change to how a key
    is built can never silently start duplicating rows written under the old
    rule."""
    job_scan.store_postings(db, scan, [posting()])
    row = db.query(JobPosting).one()
    row.dedupe_key = "something-stale"
    db.flush()

    assert job_scan.store_postings(db, scan, [posting()]) == 0


def test_an_old_posting_still_blocks_a_duplicate_until_it_is_pruned(db, scan):
    """Two mechanisms overlap here, and it is worth being explicit about which
    one wins.

    `store_postings` only *looks* at postings inside the retention window, so an
    older one drops out of that check. But `dedupe_key` carries a plain unique
    index with no time bound, so the insert is still refused while the old row
    exists. The two windows are the same length, so in practice the row has been
    pruned by the time it stops being checked - the overlap is harmless, not a
    contradiction.
    """
    job_scan.store_postings(db, scan, [posting()])
    old = db.query(JobPosting).one()
    old.discovered_at = datetime.utcnow() - timedelta(days=job_scan.POSTING_RETENTION_DAYS + 1)
    db.flush()

    assert job_scan.store_postings(db, scan, [posting()]) == 0


def test_an_opening_readvertised_after_pruning_is_news_again(db, scan):
    """Which is the behaviour the retention window is actually for."""
    job_scan.store_postings(db, scan, [posting()])
    old = db.query(JobPosting).one()
    old.discovered_at = datetime.utcnow() - timedelta(days=job_scan.POSTING_RETENTION_DAYS + 1)
    db.flush()
    job_scan.prune_old_postings(db)

    assert job_scan.store_postings(db, scan, [posting()]) == 1


def test_storing_nothing_is_a_normal_result(db, scan):
    """A scan that found nothing is a quiet day, not an error."""
    assert job_scan.store_postings(db, scan, []) == 0


def test_a_stored_posting_records_which_scan_found_it(db, scan):
    job_scan.store_postings(db, scan, [posting()])
    assert db.query(JobPosting).one().scan_id == scan.id


# --- claiming the day's scan ------------------------------------------------


def test_the_first_claim_of_the_day_succeeds(db):
    assert job_scan.claim_scan(db, day=TODAY) is not None


def test_the_scan_lock_is_not_enforceable_on_sqlite():
    """The lock that stops an hourly cron burning a web search every hour is a
    *partial* unique index - `ON job_lead_scans (scan_date) WHERE
    triggered_by_id IS NULL` - and it is created by run_migrations, not by the
    model. So it exists only on Postgres, and only after migrations have run.

    Two consequences worth stating rather than discovering:

    * This tier cannot test it. The behavioural test lives in
      tests/test_postgres_contract.py, where the index is real.
    * A database built by create_all alone has no lock at all. In production
      run_migrations runs on boot, so this is sound - but the guarantee rests
      on that, not on the schema the model declares.
    """
    import inspect

    from app.core import migrations

    source = inspect.getsource(migrations)
    assert "uq_job_lead_scans_daily" in source
    assert "WHERE triggered_by_id IS NULL" in source


def test_the_next_day_can_be_claimed(db):
    assert job_scan.claim_scan(db, day=TODAY) is not None
    assert job_scan.claim_scan(db, day=TODAY + timedelta(days=1)) is not None


def test_a_claim_records_who_asked_for_it(db, college):
    user = factories.make_user(db, college=college)
    claimed = job_scan.claim_scan(db, day=TODAY, triggered_by_id=user.id, college_id=college.id)
    assert claimed.triggered_by_id == user.id
    assert claimed.college_id == college.id


# --- reusing an answer that still stands ------------------------------------


def test_a_scan_that_finished_minutes_ago_is_reused(db):
    """The list is shared, so a second college asking right after the first
    would pay again for the same openings."""
    done = JobLeadScan(
        scan_date=TODAY, started_at=datetime.utcnow(), finished_at=datetime.utcnow(), status="ok"
    )
    db.add(done)
    db.flush()
    assert job_scan.recent_scan(db) is not None


def test_an_old_scan_is_not_reused(db):
    stale = datetime.utcnow() - timedelta(minutes=job_scan.RECENT_SCAN_MINUTES + 5)
    db.add(JobLeadScan(scan_date=TODAY, started_at=stale, finished_at=stale, status="ok"))
    db.flush()
    assert job_scan.recent_scan(db) is None


def test_a_failed_scan_is_not_reused(db):
    """Its answer is an error, and repeating it would strand the feature."""
    now = datetime.utcnow()
    db.add(JobLeadScan(scan_date=TODAY, started_at=now, finished_at=now, status="failed"))
    db.flush()
    assert job_scan.recent_scan(db) is None


def test_a_scan_still_running_is_visible(db):
    """So a second request waits for it rather than starting another."""
    db.add(JobLeadScan(scan_date=TODAY, started_at=datetime.utcnow(), status="ok"))
    db.flush()
    assert job_scan.running_scan(db) is not None


def test_a_scan_running_for_too_long_is_no_longer_counted_as_running(db):
    """Otherwise a crashed run blocks the feature until somebody notices."""
    long_ago = datetime.utcnow() - timedelta(minutes=job_scan.STALE_SCAN_MINUTES + 5)
    db.add(JobLeadScan(scan_date=TODAY, started_at=long_ago, status="ok"))
    db.flush()
    assert job_scan.running_scan(db) is None


# --- picking up a stranded run ----------------------------------------------


def test_a_scheduled_scan_stranded_by_a_restart_is_found(db):
    """The claim row blocks a fresh one - that is its job - so the run has to be
    resumed or the platform loses the whole day."""
    long_ago = datetime.utcnow() - timedelta(minutes=job_scan.STALE_SCAN_MINUTES + 5)
    db.add(JobLeadScan(scan_date=TODAY, started_at=long_ago, status="ok"))
    db.flush()
    assert len(job_scan.stale_scans(db, TODAY)) == 1


def test_a_scan_somebody_asked_for_by_hand_is_not_resumed(db, college):
    """They are sitting in front of it and can ask again; an automatic retry
    would spend money nobody is waiting on."""
    user = factories.make_user(db, college=college)
    long_ago = datetime.utcnow() - timedelta(minutes=job_scan.STALE_SCAN_MINUTES + 5)
    db.add(JobLeadScan(scan_date=TODAY, started_at=long_ago, status="ok", triggered_by_id=user.id))
    db.flush()
    assert job_scan.stale_scans(db, TODAY) == []


def test_a_scan_that_finished_is_not_resumed(db):
    long_ago = datetime.utcnow() - timedelta(minutes=job_scan.STALE_SCAN_MINUTES + 5)
    db.add(JobLeadScan(scan_date=TODAY, started_at=long_ago, finished_at=datetime.utcnow()))
    db.flush()
    assert job_scan.stale_scans(db, TODAY) == []


def test_a_scan_that_only_just_started_is_left_alone(db):
    db.add(JobLeadScan(scan_date=TODAY, started_at=datetime.utcnow(), status="ok"))
    db.flush()
    assert job_scan.stale_scans(db, TODAY) == []


def test_reopening_puts_a_stranded_scan_back_at_the_start_line(db):
    long_ago = datetime.utcnow() - timedelta(minutes=60)
    stranded = JobLeadScan(scan_date=TODAY, started_at=long_ago, status="failed", error="boom")
    db.add(stranded)
    db.flush()

    reopened = job_scan.reopen_scan(db, stranded)

    assert reopened.status == "ok"
    assert reopened.error is None
    assert reopened.started_at > long_ago


# --- shelf life -------------------------------------------------------------


def test_an_old_posting_nobody_acted_on_is_pruned(db, scan):
    job_scan.store_postings(db, scan, [posting()])
    row = db.query(JobPosting).one()
    row.discovered_at = datetime.utcnow() - timedelta(days=60)
    db.flush()

    assert job_scan.prune_old_postings(db) == 1
    assert db.query(JobPosting).count() == 0


def test_a_posting_a_college_acted_on_is_kept(db, college, scan):
    """Adding it is history; dismissing it is what stops it resurfacing on that
    college's list."""
    job_scan.store_postings(db, scan, [posting()])
    row = db.query(JobPosting).one()
    row.discovered_at = datetime.utcnow() - timedelta(days=60)
    db.add(JobLead(posting_id=row.id, college_id=college.id, status="dismissed"))
    db.flush()

    assert job_scan.prune_old_postings(db) == 0
    assert db.query(JobPosting).count() == 1


def test_a_recent_posting_is_kept(db, scan):
    job_scan.store_postings(db, scan, [posting()])
    assert job_scan.prune_old_postings(db) == 0


# --- the settings that cost money -------------------------------------------


def test_the_scan_asks_for_a_bounded_number_of_results(db):
    """An unbounded scan is an unbounded bill."""
    assert 0 < job_scan.SCAN_LIMIT <= 100


def test_the_reuse_window_is_shorter_than_the_stale_window(db):
    """Otherwise a run could be declared dead while its answer is still being
    handed out as fresh."""
    assert job_scan.RECENT_SCAN_MINUTES <= job_scan.STALE_SCAN_MINUTES
