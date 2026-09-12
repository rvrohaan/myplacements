"""Openings found on the web, and what each college does with them.

The daily digest reports on a cell's own activity. This is its outward-facing
counterpart: one scan a day finds openings posted in the last 24 hours, and every
college reviews the same pool.

One pool, because campus hiring in India is national - a TCS opening in Kolkata
still recruits from a Bangalore campus - so there is nothing college-specific to
discover and scanning per tenant would buy N copies of one answer. What is
per-tenant is the *handling*: an opening is "new" to a college until somebody
there adds or dismisses it, and that decision is the only row this module writes
per college.

Nothing reaches the companies table until someone with manage rights clicks Add,
which is also where the opening can be handed to an officer. Officers read the
list for market awareness; every mutating route is leadership's.
"""

import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_roles
from app.core.tenant import get_optional_college
from app.core.timeutil import local_now
from app.models.college import College
from app.models.company import Company, CompanyStatus
from app.models.job_lead import JobLead, JobLeadScan, JobPosting
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.platform_setting import get_platform_settings
from app.models.user import User, UserRole
from app.routers.companies import MANAGE_ROLES
from app.schemas.job_lead import (
    JobLeadAddCompany,
    JobLeadDismiss,
    JobLeadOut,
    JobLeadSummary,
    JobScanOut,
    JobScanResult,
    JobScanSettings,
    PlatformScanStatus,
    PlatformScanUpdate,
)
from app.services import job_scan
from app.services.ai_service import ScanUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/job-leads", tags=["job-leads"])

# Everyone on the placement side can read the radar - an officer knowing that a
# company opened fresher hiring this morning is the point. Acting on an opening
# is leadership's call, so every write below takes MANAGE_ROLES.
VIEW_ROLES = MANAGE_ROLES + (UserRole.PLACEMENT_OFFICER, UserRole.DEPARTMENT_COORDINATOR)

# The local hour after which the scheduler runs the day's scan. Early enough that
# the chancellor finds the list waiting, late enough that "the last 24 hours"
# covers a working day.
SCAN_HOUR = 7

# Words that carry no identity, so a host matching only these proves nothing.
GENERIC_NAME_WORDS = frozenset(
    {
        "the", "and", "inc", "ltd", "llp", "llc", "plc", "pvt", "private", "limited",
        "company", "corp", "corporation", "group", "holdings", "india", "global",
        "technologies", "technology", "tech", "systems", "solutions", "services",
        "software", "labs", "laboratories", "consulting", "consultancy", "industries",
        "international", "enterprises", "ventures", "digital", "innovations",
    }
)


def _resolve_college(db: Session, current_user: User, tenant: College | None) -> Optional[College]:
    """The college this request is about.

    Everyone except a super_admin carries their own college_id. A super_admin has
    none, so fall back to the tenant the request arrived on - otherwise their view
    would have no owner for the added/dismissed state.
    """
    if current_user.college_id:
        return db.query(College).filter(College.id == current_user.college_id).first()
    return tenant


def _require_college(db: Session, current_user: User, tenant: College | None) -> College:
    college = _resolve_college(db, current_user, tenant)
    if not college:
        raise HTTPException(status_code=404, detail="No college for this request")
    return college


def _company_website(url: Optional[str], company_name: Optional[str]) -> Optional[str]:
    """The employer's site - but only when the posting was on the employer's own site.

    Most of these come off job boards, whose origin is emphatically not the
    company's website, and a wrong URL here outlives the posting on a company
    record nobody re-checks. A blocklist of boards cannot keep up with how many of
    them there are, so the test is the other way round: the host has to actually
    name the company. careers.zohocorp.com passes for Zoho; freshershunt.in does
    not pass for FreightTiger. When in doubt the field stays empty, which is the
    honest answer and one an officer can fill in later.
    """
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    host = (parsed.netloc or "").lower()
    if not host:
        return None

    flat = re.sub(r"[^a-z0-9]", "", host)
    words = [w for w in re.split(r"[^a-z0-9]+", (company_name or "").lower()) if w]
    meaningful = [w for w in words if len(w) >= 3 and w not in GENERIC_NAME_WORDS]
    if not meaningful:
        return None
    # The whole name run together (freighttiger), or any one distinctive word.
    candidates = ["".join(meaningful), *meaningful]
    if not any(c in flat for c in candidates):
        return None
    return f"{parsed.scheme or 'https'}://{parsed.netloc}"


def _focus_filter(query, college: College):
    """Narrow the queue to a college's stated interest, if it has one.

    The search itself is shared and deliberately broad, so this is where a college
    that only wants (say) core mechanical keeps its queue readable. Applied to the
    queue only - something already added or dismissed stays visible in its own tab
    whatever the filter says.
    """
    focus = (college.job_scan_focus or "").strip()
    if not focus:
        return query
    terms = [t.strip() for t in re.split(r"[,\n]+", focus) if t.strip()]
    if not terms:
        return query
    clauses = []
    for term in terms[:10]:
        like = f"%{term}%"
        clauses.extend(
            [
                JobPosting.company_name.ilike(like),
                JobPosting.role_title.ilike(like),
                JobPosting.summary.ilike(like),
                JobPosting.eligibility.ilike(like),
                JobPosting.location.ilike(like),
            ]
        )
    return query.filter(or_(*clauses))


def _queue(db: Session, college: College):
    """Postings this college has not acted on - the "new" tab.

    New is the absence of a decision, not a stored status, which is what lets a
    college that joins tomorrow see the pool that is already there.
    """
    handled = db.query(JobLead.posting_id).filter(JobLead.college_id == college.id)
    return _focus_filter(db.query(JobPosting).filter(~JobPosting.id.in_(handled)), college)


def _existing_company_map(db: Session, college_id: Optional[int]) -> dict:
    """lower(name) -> (id, name) for the college, so a posting can say "you already
    have this one" instead of offering a button that makes a duplicate."""
    rows = db.query(Company.id, Company.name).filter(Company.college_id == college_id).all()
    return {(name or "").strip().lower(): (cid, name) for cid, name in rows if name}


def _serialize(posting: JobPosting, lead: Optional[JobLead], companies: dict) -> dict:
    existing_id, existing_name = companies.get(
        (posting.company_name or "").strip().lower(), (None, None)
    )
    return {
        "id": posting.id,
        "company_name": posting.company_name,
        "role_title": posting.role_title,
        "lead_type": posting.lead_type,
        "location": posting.location,
        "work_mode": posting.work_mode,
        "eligibility": posting.eligibility,
        "compensation": posting.compensation,
        "posted_at": posting.posted_at,
        "posted_label": posting.posted_label,
        "source_name": posting.source_name,
        "source_url": posting.source_url,
        "summary": posting.summary,
        "confidence": posting.confidence,
        "verified": bool(posting.verified),
        "discovered_at": posting.discovered_at,
        "status": lead.status if lead else "new",
        "company_id": lead.company_id if lead else None,
        "dismiss_reason": lead.dismiss_reason if lead else None,
        "actioned_by_name": lead.actioned_by.full_name if lead and lead.actioned_by else None,
        "actioned_at": lead.actioned_at if lead else None,
        "existing_company_id": existing_id,
        "existing_company_name": existing_name,
    }


def _serialize_scan(scan: Optional[JobLeadScan]) -> Optional[dict]:
    if not scan:
        return None
    status = scan.status
    if scan.finished_at is None and scan.started_at is not None:
        stale_after = datetime.utcnow() - timedelta(minutes=job_scan.STALE_SCAN_MINUTES)
        if scan.started_at < stale_after:
            # Claimed but never finished, and long past when it should have been:
            # a restart took its background task with it. The scheduler picks
            # these up on its next tick, but while the schedule is stopped nothing
            # will - so say so rather than showing "running" for ever.
            status = "stalled"
    return {
        "id": scan.id,
        "scan_date": scan.scan_date,
        "started_at": scan.started_at,
        "finished_at": scan.finished_at,
        "status": status,
        "found": scan.found or 0,
        "new_count": scan.new_count or 0,
        "error": scan.error,
        "triggered_by_name": scan.triggered_by.full_name if scan.triggered_by else None,
    }


def _last_scan(db: Session) -> Optional[JobLeadScan]:
    """The platform's most recent scan - the same one for every tenant."""
    return db.query(JobLeadScan).order_by(JobLeadScan.started_at.desc()).first()


# --- Reads ------------------------------------------------------------------
# Literal paths are declared before /{posting_id}/... so they are not swallowed
# by the path parameter.


@router.get("", response_model=list[JobLeadOut])
def list_leads(
    status: str = Query("new"),
    lead_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*VIEW_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _require_college(db, current_user, tenant)
    companies = _existing_company_map(db, college.id)

    if status == "new":
        q = _queue(db, college)
        if lead_type:
            q = q.filter(JobPosting.lead_type == lead_type)
        postings = (
            q.order_by(JobPosting.discovered_at.desc(), JobPosting.id.desc()).limit(limit).all()
        )
        return [_serialize(p, None, companies) for p in postings]

    # Added and dismissed are decisions, so they come off this college's own rows.
    q = (
        db.query(JobPosting, JobLead)
        .join(JobLead, JobLead.posting_id == JobPosting.id)
        .filter(JobLead.college_id == college.id)
    )
    if status != "all":
        q = q.filter(JobLead.status == status)
    if lead_type:
        q = q.filter(JobPosting.lead_type == lead_type)
    rows = q.order_by(JobLead.actioned_at.desc(), JobLead.id.desc()).limit(limit).all()
    return [_serialize(posting, lead, companies) for posting, lead in rows]


@router.get("/summary", response_model=JobLeadSummary)
def lead_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*VIEW_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """One call for the dashboard panel: how much is waiting, and a taste of it."""
    college = _resolve_college(db, current_user, tenant)
    scheduled = bool(get_platform_settings(db).job_scan_schedule_enabled)
    if not college:
        return {
            "enabled": False,
            "schedule_enabled": scheduled,
            "new_24h": 0,
            "new_total": 0,
            "last_scan": None,
            "top": [],
        }

    queue = _queue(db, college)
    day_ago = datetime.utcnow() - timedelta(hours=24)
    top = queue.order_by(JobPosting.discovered_at.desc(), JobPosting.id.desc()).limit(5).all()
    companies = _existing_company_map(db, college.id)
    return {
        "enabled": bool(college.job_scan_enabled),
        "schedule_enabled": scheduled,
        "new_24h": queue.filter(JobPosting.discovered_at >= day_ago).count(),
        "new_total": queue.count(),
        "last_scan": _serialize_scan(_last_scan(db)),
        "top": [_serialize(p, None, companies) for p in top],
    }


def _settings_payload(db: Session, college: College, current_user: User) -> dict:
    platform = get_platform_settings(db)
    return {
        "job_scan_enabled": bool(college.job_scan_enabled),
        "job_scan_focus": college.job_scan_focus,
        "schedule_enabled": bool(platform.job_scan_schedule_enabled),
        "can_manage_schedule": current_user.role == UserRole.SUPER_ADMIN,
    }


@router.get("/settings", response_model=JobScanSettings)
def get_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _require_college(db, current_user, tenant)
    return _settings_payload(db, college, current_user)


@router.put("/settings", response_model=JobScanSettings)
def update_settings(
    payload: JobScanSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    college = _require_college(db, current_user, tenant)
    if payload.job_scan_enabled is not None:
        college.job_scan_enabled = payload.job_scan_enabled
    if payload.job_scan_focus is not None:
        college.job_scan_focus = payload.job_scan_focus.strip() or None

    platform = get_platform_settings(db)
    if payload.schedule_enabled is not None and payload.schedule_enabled != bool(
        platform.job_scan_schedule_enabled
    ):
        # Starting the schedule commits the platform to a paid search every
        # morning, for every tenant. That is not a single college's call.
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=403,
                detail="Only a platform administrator can start or stop the daily scan.",
            )
        platform.job_scan_schedule_enabled = payload.schedule_enabled
        platform.updated_by_id = current_user.id
        logger.info(
            "Daily opportunity scan %s by %s",
            "started" if payload.schedule_enabled else "stopped",
            current_user.email,
        )

    db.commit()
    db.refresh(college)
    return _settings_payload(db, college, current_user)


# --- The platform console ---------------------------------------------------
# The scan is platform-wide, so its switch belongs on the platform console
# (admin.*), which has no tenant at all. These two routes are the only ones here
# that do not resolve a college.


@router.get("/platform", response_model=PlatformScanStatus)
def platform_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    platform = get_platform_settings(db)
    return {
        "schedule_enabled": bool(platform.job_scan_schedule_enabled),
        "scan_hour": SCAN_HOUR,
        "pool_size": db.query(JobPosting).count(),
        "last_scan": _serialize_scan(_last_scan(db)),
        "updated_at": platform.updated_at,
        "updated_by_name": platform.updated_by.full_name if platform.updated_by else None,
    }


@router.put("/platform", response_model=PlatformScanStatus)
def update_platform(
    payload: PlatformScanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    """Start or stop the daily scan for everybody."""
    platform = get_platform_settings(db)
    if payload.schedule_enabled != bool(platform.job_scan_schedule_enabled):
        platform.job_scan_schedule_enabled = payload.schedule_enabled
        platform.updated_by_id = current_user.id
        db.commit()
        logger.info(
            "Daily opportunity scan %s by %s",
            "started" if payload.schedule_enabled else "stopped",
            current_user.email,
        )
    return platform_status(db=db, current_user=current_user)


# --- Scanning ---------------------------------------------------------------


@router.post("/scan", response_model=JobScanResult)
def scan_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """Run a scan on demand, for the whole platform.

    Deliberately a sync ``def``: the search blocks for minutes, and FastAPI runs
    sync endpoints in a threadpool, so the event loop keeps serving everyone else
    while this one waits.

    The two guards below matter because the result is shared. Without them, two
    colleges pressing the button minutes apart would pay twice for one answer.
    """
    # The console has no tenant; a scan started from there belongs to nobody in
    # particular, which is fine - the pool it fills is shared anyway.
    college = _resolve_college(db, current_user, tenant)
    if college is None and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=404, detail="No college for this request")

    if job_scan.running_scan(db):
        raise HTTPException(
            status_code=409,
            detail="A scan is already running. Its openings will appear here when it finishes.",
        )
    if job_scan.recent_scan(db):
        raise HTTPException(
            status_code=409,
            detail=(
                "A scan finished in the last half hour, and its openings are already on this "
                "list. The next scheduled scan runs tomorrow morning."
            ),
        )

    try:
        scan = job_scan.run_scan(
            db,
            triggered_by_id=current_user.id,
            college_id=college.id if college else None,
        )
    except ScanUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if scan.status == "failed":
        # The run is on record either way; the caller gets told why.
        raise HTTPException(
            status_code=502, detail=scan.error or "The web search could not be completed"
        )
    return {
        "found": scan.found or 0,
        "new_count": scan.new_count or 0,
        "scan": _serialize_scan(scan),
    }


@router.post("/cron/run")
def cron_run(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Unattended scheduler tick. Called hourly by ``backend/run_cron.py``.

    Answers in milliseconds. A search takes three to five minutes, so holding the
    request open for one would outlive the caller's timeout and the platform's,
    and report a failed cron run for work that actually succeeded. Instead the
    tick claims the day's scan row, hands the searching to a background task, and
    returns what it queued.

    One scan a day covers every tenant, and the partial unique index on
    ``scan_date`` is what makes the other twenty-three ticks free: the day's row
    is already there. Scans stranded by a restart are resumed first.

    Does nothing at all while the platform's schedule switch is off, which is how
    it ships.
    """
    expected_token = settings.CRON_TOKEN.strip()
    provided = request.headers.get("x-cron-token", "")
    # 404 rather than 403: an unconfigured or wrongly-called scheduler endpoint
    # should not advertise that it exists.
    if not expected_token or not secrets.compare_digest(provided, expected_token):
        raise HTTPException(status_code=404, detail="Not Found")

    now = local_now()
    day = now.date()
    summary: dict = {
        "date": day.isoformat(),
        "scheduled": False,
        "queued": None,
        "resumed": [],
        "pruned": 0,
    }

    # The switch. Off by default, and off is the whole point: an unattended scan
    # bills the platform every morning whether or not anyone is reading the
    # results, so it stays stopped until a super_admin starts it. "Scan now" is
    # unaffected - a person pressing a button is by definition watching.
    if not get_platform_settings(db).job_scan_schedule_enabled:
        # Housekeeping still runs; it is free and keeps the pool from ageing.
        summary["pruned"] = job_scan.prune_old_postings(db)
        return summary

    summary["scheduled"] = True
    if now.hour < SCAN_HOUR:
        return summary

    # A restart during the scan window takes its background task with it and
    # leaves the claim row stranded. That run is picked up again - the claim is
    # what blocks a fresh one, so nothing else would ever rescue it.
    for scan in job_scan.stale_scans(db, day):
        job_scan.reopen_scan(db, scan)
        background.add_task(job_scan.execute_claimed_scan, scan.id)
        summary["resumed"].append(scan.id)

    if not summary["resumed"]:
        # Nobody has any use for the radar until at least one college is switched
        # on for it.
        wanted = (
            db.query(College.id)
            .filter(College.is_active == True, College.job_scan_enabled == True)  # noqa: E712
            .first()
        )
        if wanted:
            scan = job_scan.claim_scan(db, day=day)
            if scan is not None:
                background.add_task(job_scan.execute_claimed_scan, scan.id)
                summary["queued"] = scan.id

    summary["pruned"] = job_scan.prune_old_postings(db)
    return summary


@router.get("/scans", response_model=list[JobScanOut])
def list_scans(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    scans = db.query(JobLeadScan).order_by(JobLeadScan.started_at.desc()).limit(limit).all()
    return [_serialize_scan(scan) for scan in scans]


# --- Acting on an opening ---------------------------------------------------


def _get_posting(posting_id: int, db: Session) -> JobPosting:
    posting = db.query(JobPosting).filter(JobPosting.id == posting_id).first()
    if not posting:
        raise HTTPException(status_code=404, detail="Opening not found")
    return posting


def _lead_for(db: Session, college_id: int, posting_id: int) -> Optional[JobLead]:
    return (
        db.query(JobLead)
        .filter(JobLead.college_id == college_id, JobLead.posting_id == posting_id)
        .first()
    )


def _record(
    db: Session, college: College, posting: JobPosting, current_user: User, **fields
) -> JobLead:
    """Write this college's decision about a posting, creating the row if needed."""
    lead = _lead_for(db, college.id, posting.id)
    if lead is None:
        lead = JobLead(college_id=college.id, posting_id=posting.id)
        db.add(lead)
    lead.actioned_by_id = current_user.id
    lead.actioned_at = datetime.utcnow()
    for key, value in fields.items():
        setattr(lead, key, value)
    db.commit()
    db.refresh(lead)
    return lead


@router.post("/{posting_id}/add-company", response_model=JobLeadOut)
def add_company(
    posting_id: int,
    payload: JobLeadAddCompany,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """Promote an opening into this college's companies, optionally allocating it."""
    college = _require_college(db, current_user, tenant)
    posting = _get_posting(posting_id, db)

    existing_lead = _lead_for(db, college.id, posting.id)
    if existing_lead and existing_lead.status == "added" and existing_lead.company_id:
        raise HTTPException(status_code=400, detail="This opening has already been added")

    companies = _existing_company_map(db, college.id)
    existing_id, existing_name = companies.get(
        (posting.company_name or "").strip().lower(), (None, None)
    )
    if existing_id:
        raise HTTPException(
            status_code=409, detail=f"{existing_name} is already in your companies list."
        )

    officer = None
    if payload.officer_id:
        officer = (
            db.query(PlacementOfficer).filter(PlacementOfficer.id == payload.officer_id).first()
        )
        if not officer or officer.college_id != college.id:
            raise HTTPException(status_code=404, detail="Officer not found")

    posted = (
        posting.posted_at.isoformat() if posting.posted_at else (posting.posted_label or "recently")
    )
    note_lines = [
        f"Found by the opportunity scan on {posting.discovered_at:%Y-%m-%d}."
        if posting.discovered_at
        else "Found by the opportunity scan.",
        f"{'Internship' if posting.lead_type == 'internship' else 'Role'}: "
        f"{posting.role_title or 'not stated'} ({posted})",
    ]
    if posting.location:
        note_lines.append(f"Location as posted: {posting.location}")
    if posting.eligibility:
        note_lines.append(f"Eligibility as posted: {posting.eligibility}")
    if posting.compensation:
        note_lines.append(f"Compensation as posted: {posting.compensation}")
    if posting.source_url:
        note_lines.append(f"Source: {posting.source_name or 'web'} - {posting.source_url}")

    company = Company(
        name=posting.company_name,
        sector=payload.sector or None,
        location=posting.location,
        website=_company_website(posting.source_url, posting.company_name),
        status=CompanyStatus.NEW,
        hiring_pattern=posting.role_title,
        notes="\n".join(note_lines),
        college_id=college.id,
        created_by_id=current_user.id,
        # Provenance, the same way an officer's own lead is marked.
        source="web_discovery",
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    if officer:
        # A brand-new company cannot be allocated yet, so the single-owner rule
        # enforced in officers.assign_company holds here by construction.
        db.add(
            CompanyAssignment(
                officer_id=officer.id,
                company_id=company.id,
                status="active",
                notes="Allocated from a discovered opening",
            )
        )
        db.commit()

    lead = _record(db, college, posting, current_user, status="added", company_id=company.id)
    return _serialize(posting, lead, _existing_company_map(db, college.id))


@router.post("/{posting_id}/dismiss", response_model=JobLeadOut)
def dismiss_lead(
    posting_id: int,
    payload: JobLeadDismiss,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """Take an opening off this college's queue.

    Off *this* college's queue only: the posting stays in the shared pool for
    everyone else. The row is what stops a later scan resurfacing it here.
    """
    college = _require_college(db, current_user, tenant)
    posting = _get_posting(posting_id, db)
    lead = _lead_for(db, college.id, posting.id)
    if lead and lead.status == "added":
        raise HTTPException(status_code=400, detail="This opening is already a company")
    lead = _record(
        db,
        college,
        posting,
        current_user,
        status="dismissed",
        company_id=None,
        dismiss_reason=(payload.reason or "").strip()[:200] or None,
    )
    return _serialize(posting, lead, _existing_company_map(db, college.id))


@router.post("/{posting_id}/restore", response_model=JobLeadOut)
def restore_lead(
    posting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
    tenant: College | None = Depends(get_optional_college),
):
    """Undo a dismissal - the one action people always want back.

    Dropping the row is the undo: with no decision recorded, the opening is back
    in the queue exactly as it arrived.
    """
    college = _require_college(db, current_user, tenant)
    posting = _get_posting(posting_id, db)
    lead = _lead_for(db, college.id, posting.id)
    if not lead or lead.status != "dismissed":
        raise HTTPException(status_code=400, detail="Only a dismissed opening can be restored")
    db.delete(lead)
    db.commit()
    return _serialize(posting, None, _existing_company_map(db, college.id))
