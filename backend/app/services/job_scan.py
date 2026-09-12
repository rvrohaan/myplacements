"""Running the opportunity scan and storing what it found.

The AI half lives in ``app.services.ai_service.discover_job_leads``; this module
owns everything around it - the context handed to the search, the run log, and
the deduplication that makes a second scan the same morning cost nothing new.

One scan serves the whole platform. Campus hiring in India is national - a TCS
opening in Kolkata still recruits from a Bangalore campus - so there is nothing
college-specific to discover, and scanning per tenant would buy N copies of the
same answer. What *is* per-tenant is what each college does with a posting, and
that lives in ``JobLead`` (see app/models/job_lead.py).

The scan row is written and committed *before* the search runs. That is what
makes it a lock rather than a receipt: an hourly cron that fires while the last
tick is still searching finds the day's row already there and does nothing.

That split is also why claiming and executing are separate functions. A search
takes three to five minutes - far too long to hold an HTTP request open on a
scheduler tick - so the cron claims the row, answers immediately, and does the
searching in the background. The on-demand path, where somebody is watching a
spinner, still does both in one call.
"""

import logging
import re
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.timeutil import local_today
from app.models.college import College
from app.models.job_lead import JobLead, JobLeadScan, JobPosting
from app.models.student import Student
from app.services.ai_service import ScanUnavailable, discover_job_leads

logger = logging.getLogger(__name__)

# How many openings one scan may return. Higher than a per-college scan needed,
# because this one list is what every tenant reads.
SCAN_LIMIT = 25

# Postings nobody acted on are noise after a few weeks; the openings behind them
# have closed. Pruned by the scheduler, not on read.
POSTING_RETENTION_DAYS = 30

# A scheduled scan "running" for longer than this was almost certainly killed
# mid-search - a deploy or a container restart takes its background task with it.
# Comfortably longer than a real scan, which runs three to five minutes.
STALE_SCAN_MINUTES = 30

# How recently a scan must have finished for another on-demand one to be refused.
# Stops two chancellors on two tenants paying twice for the same answer minutes
# apart.
RECENT_SCAN_MINUTES = 30


def _norm(value: Optional[str]) -> str:
    """Loose normalisation for identity comparisons - case, punctuation and
    spacing differences must not make the same posting look new."""
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


# A bracketed chunk containing a digit is a requisition number, not part of the
# role: "(Job 32817 / R-55817-2026)", "(REQ-10087679)". One source prints it and
# the next does not, which would otherwise make one opening look like two.
# Brackets *without* a digit are left alone - "(Backend)" really is the role.
_REQ_BRACKET = re.compile(r"[\(\[][^)\]]*\d[^)\]]*[\)\]]")

# The same identifiers written without brackets.
_ID_WORDS = frozenset({"job", "jobid", "req", "reqid", "requisition", "id", "ref", "code"})


def _norm_role(value: Optional[str]) -> str:
    """The role, stripped of the bookkeeping that varies between sources."""
    words = _norm(_REQ_BRACKET.sub(" ", value or "")).split()
    return " ".join(w for w in words if not w.isdigit() and w not in _ID_WORDS)


def posting_key(company_name: str, role_title: Optional[str], source_url: Optional[str]) -> str:
    """Identity of one opening, platform-wide: normalised employer and role.

    The URL is deliberately *not* part of this. One opening is routinely listed
    on the employer's careers page and on three aggregators, and a key that
    included the link would file the same HARMAN internship four times - which is
    four cards the chancellor has to read to discover they are one job. Two
    postings that agree on employer and role title are the same opening; where
    they disagree on which city it sits in, that is one drive hiring in two
    places, which is still one thing to chase.

    A posting with no role title has nothing to match on, so that one falls back
    to the link. Kept readable rather than hashed - a key you can eyeball is
    worth more here than a few bytes saved.
    """
    company = _norm(company_name)
    role = _norm_role(role_title)
    if role:
        return f"{company}|{role}"
    return f"{company}|url:{(source_url or '').strip().lower()}"


def _top_values(rows, limit: int) -> list:
    """Distinct non-empty values from a list of one-column rows."""
    seen = []
    for (value,) in rows:
        text = (value or "").strip()
        if text and text not in seen:
            seen.append(text)
        if len(seen) >= limit:
            break
    return seen


def scan_context(db: Session) -> dict:
    """What to aim the one shared search at.

    Branches are pooled across the active colleges so the search covers the
    disciplines the platform actually places - an all-engineering roster has no
    use for MBA openings. No college's private data reaches the prompt: that
    branch list is an aggregate, and the only other context is what the scan
    itself found on previous days.
    """
    branches = _top_values(
        db.query(Student.branch)
        .join(College, College.id == Student.college_id)
        .filter(
            Student.branch.isnot(None),
            College.is_active == True,  # noqa: E712
            College.job_scan_enabled == True,  # noqa: E712
        )
        .distinct()
        .all(),
        16,
    )
    # Companies already in the pool from the last few days, so the search pushes
    # for openings that are not already on everyone's list.
    since = datetime.utcnow() - timedelta(days=3)
    known = _top_values(
        db.query(JobPosting.company_name)
        .filter(JobPosting.discovered_at >= since)
        .distinct()
        .all(),
        80,
    )
    return {"branches": branches, "known_companies": known}


def store_postings(db: Session, scan: JobLeadScan, postings: list) -> int:
    """Persist the openings that are new to the platform. Returns how many landed.

    Rows are added one at a time inside savepoints: the unique index on
    ``dedupe_key`` is the real arbiter, and a collision on one posting must not
    throw away the other twenty-four.
    """
    # Recomputed from the columns rather than read off dedupe_key, so a change to
    # how a key is built can never silently start duplicating rows written under
    # the previous rule. The pool is a few hundred rows at most.
    since = datetime.utcnow() - timedelta(days=POSTING_RETENTION_DAYS)
    known = {
        posting_key(name, role, url)
        for name, role, url in db.query(
            JobPosting.company_name, JobPosting.role_title, JobPosting.source_url
        ).filter(JobPosting.discovered_at >= since)
    }

    stored = 0
    for posting in postings:
        key = posting_key(
            posting["company_name"], posting.get("role_title"), posting.get("source_url")
        )
        if key in known:
            continue
        known.add(key)
        row = JobPosting(
            scan_id=scan.id,
            dedupe_key=key,
            discovered_at=datetime.utcnow(),
            **posting,
        )
        try:
            with db.begin_nested():
                db.add(row)
            stored += 1
        except IntegrityError:
            # A concurrent scan inserted the same opening between the check above
            # and this write. Nothing to do - it is already there.
            logger.info("Skipped a posting a concurrent scan had already stored")
    db.commit()
    return stored


def claim_scan(
    db: Session,
    *,
    triggered_by_id: Optional[int] = None,
    college_id: Optional[int] = None,
    day: Optional[date] = None,
) -> Optional[JobLeadScan]:
    """Take the day's scan, or return None if it is already taken.

    The row is written and committed *before* any searching, which is what makes
    it a lock rather than a receipt: the partial unique index on ``scan_date``
    refuses a second scheduled claim for the same day, so an hourly cron cannot
    burn a web search every hour.
    """
    scan = JobLeadScan(
        scan_date=day or local_today(),
        started_at=datetime.utcnow(),
        status="ok",
        triggered_by_id=triggered_by_id,
        college_id=college_id,
    )
    try:
        db.add(scan)
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.info("The scheduled scan for %s was already claimed", day or local_today())
        return None
    db.refresh(scan)
    return scan


def running_scan(db: Session) -> Optional[JobLeadScan]:
    """A scan that is out searching right now, if there is one."""
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_SCAN_MINUTES)
    return (
        db.query(JobLeadScan)
        .filter(JobLeadScan.finished_at.is_(None), JobLeadScan.started_at >= cutoff)
        .order_by(JobLeadScan.started_at.desc())
        .first()
    )


def recent_scan(db: Session) -> Optional[JobLeadScan]:
    """A scan that finished minutes ago, whose answer still stands.

    The list is shared, so a second college asking for a fresh scan right after
    the first one would pay again for the same openings.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=RECENT_SCAN_MINUTES)
    return (
        db.query(JobLeadScan)
        .filter(
            JobLeadScan.status == "ok",
            JobLeadScan.finished_at.isnot(None),
            JobLeadScan.finished_at >= cutoff,
        )
        .order_by(JobLeadScan.finished_at.desc())
        .first()
    )


def execute_scan(db: Session, scan: JobLeadScan, limit: int = SCAN_LIMIT) -> JobLeadScan:
    """Do the searching for a claimed scan and record the outcome on its row.

    A search that fails is recorded as a failed run with its reason rather than
    raised: the caller can show what went wrong, and the next scan is simply
    tried again.
    """
    context = scan_context(db)
    try:
        postings, meta = discover_job_leads(limit=limit, today=scan.scan_date, **context)
    except ScanUnavailable as exc:
        logger.warning("Opportunity scan failed: %s", exc)
        scan.status = "failed"
        scan.error = str(exc)[:500]
        scan.finished_at = datetime.utcnow()
        db.commit()
        db.refresh(scan)
        return scan

    scan.found = len(postings)
    scan.new_count = store_postings(db, scan, postings)
    scan.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(scan)
    logger.info(
        "Opportunity scan: %d found, %d new, %d searches",
        scan.found,
        scan.new_count,
        meta.get("searches", 0),
    )
    return scan


def run_scan(
    db: Session,
    *,
    triggered_by_id: Optional[int] = None,
    college_id: Optional[int] = None,
    day: Optional[date] = None,
    limit: int = SCAN_LIMIT,
) -> JobLeadScan:
    """Claim and run a scan in one go, on the caller's session.

    This is the on-demand path, where somebody is watching a spinner and wants
    the result in the response. The scheduler uses claim + background execute
    instead, so its HTTP request does not have to stay open for minutes.
    """
    scan = claim_scan(db, triggered_by_id=triggered_by_id, college_id=college_id, day=day)
    if scan is None:
        raise ScanUnavailable("A scan for today is already under way")
    return execute_scan(db, scan, limit)


def execute_claimed_scan(scan_id: int, limit: int = SCAN_LIMIT) -> None:
    """Background entry point for a scan the scheduler already claimed.

    Opens its own session on purpose: the request-scoped session from ``get_db``
    is closed the moment the response is sent, and this runs after that. Never
    raises - a background task has nobody to report to but the log and the run
    row, both of which ``execute_scan`` writes.
    """
    db = SessionLocal()
    try:
        scan = db.query(JobLeadScan).filter(JobLeadScan.id == scan_id).first()
        if not scan:
            logger.error("Background scan %s: the run row vanished", scan_id)
            return
        execute_scan(db, scan, limit)
    except Exception:  # noqa: BLE001 - a scheduler task must not die silently mid-tick
        logger.exception("Background scan %s failed unexpectedly", scan_id)
        try:
            scan = db.query(JobLeadScan).filter(JobLeadScan.id == scan_id).first()
            if scan and scan.finished_at is None:
                scan.status = "failed"
                scan.error = "The scan stopped unexpectedly"
                scan.finished_at = datetime.utcnow()
                db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Could not mark scan %s as failed", scan_id)
    finally:
        db.close()


def stale_scans(db: Session, day: date) -> list:
    """Scheduled scans for ``day`` that were claimed but never finished.

    Without this a restart during the scan window would cost the platform its
    whole day: the claim row blocks a fresh one (that is its job), so the run has
    to be picked up again rather than replaced.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=STALE_SCAN_MINUTES)
    return (
        db.query(JobLeadScan)
        .filter(
            JobLeadScan.scan_date == day,
            JobLeadScan.triggered_by_id.is_(None),
            JobLeadScan.finished_at.is_(None),
            JobLeadScan.started_at < cutoff,
        )
        .order_by(JobLeadScan.id)
        .all()
    )


def reopen_scan(db: Session, scan: JobLeadScan) -> JobLeadScan:
    """Put a stranded scan back at the start line, ready to be executed again."""
    scan.started_at = datetime.utcnow()
    scan.status = "ok"
    scan.error = None
    db.commit()
    db.refresh(scan)
    return scan


def prune_old_postings(db: Session, days: int = POSTING_RETENTION_DAYS) -> int:
    """Drop postings past their shelf life that no college ever acted on.

    A posting some college added or dismissed stays: the first is history, the
    second is what stops it resurfacing on that college's list.
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    removed = (
        db.query(JobPosting)
        .filter(
            JobPosting.discovered_at < cutoff,
            ~JobPosting.id.in_(db.query(JobLead.posting_id)),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return removed
