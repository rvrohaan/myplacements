"""The dashboard summary, in two endpoints that cost different things.

``GET`` never calls the model. It returns whatever was last generated for this
college, or the rule-written findings if nothing has been. Opening the dashboard
is therefore free however many people do it, however often.

``POST`` generates. It is the only path that spends credit, it happens because
somebody pressed a button, and the result is shared: the next person to open the
dashboard reads the same summary rather than paying for their own. ``refresh``
forces a new run when the cached one has gone stale mid-day.

Leadership-only, matching Reports. The summary pools the whole college, and an
officer's view of the college is deliberately narrower than that.
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_roles
from app.core.roles import LEADERSHIP_ROLES
from app.core.timeutil import local_today
from app.models.college import College
from app.models.insight import DashboardInsight
from app.models.user import User
from app.services import insights, monthly
from app.services.ai_service import NarrationUnavailable, INSIGHT_MODEL, narrate_dashboard

router = APIRouter(prefix="/insights", tags=["insights"])

Leadership = Depends(require_roles(*LEADERSHIP_ROLES))

SCOPE = "college"


def _period() -> str:
    """The cache key's day. Local, not UTC: a summary is "this morning's" to the
    college reading it, and a UTC rollover mid-afternoon in IST would hand them
    a new day's cache while they were still working."""
    return local_today().isoformat()


def _payload(
    facts: dict,
    findings: list[insights.Finding],
    *,
    narrative: list[str] | None,
    narrated: bool,
    generated_at: datetime | None,
    generated_by: str | None,
    model: str | None,
    note: str | None = None,
) -> dict:
    return {
        "narrative": narrative or [],
        "narrated": narrated,
        "findings": [
            {"key": f.key, "severity": f.severity, "headline": f.headline}
            for f in findings
        ],
        "facts": facts,
        "generated_at": generated_at.isoformat() if generated_at else None,
        "generated_by": generated_by,
        "model": model,
        # Why there is no narrative, when there isn't one. Shown rather than
        # swallowed: a summary nobody wrote should say so.
        "note": note,
    }


def _cached(db: Session, college_id: int | None) -> DashboardInsight | None:
    if not college_id:
        return None
    return (
        db.query(DashboardInsight)
        .filter(
            DashboardInsight.college_id == college_id,
            DashboardInsight.scope == SCOPE,
            DashboardInsight.period == _period(),
        )
        .first()
    )


@router.get("/dashboard")
def get_dashboard_insights(
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """The current summary. Never calls the model - see the module docstring."""
    facts, findings = insights.gather(db, current_user)

    row = _cached(db, current_user.college_id)
    if row is None:
        return _payload(
            facts, findings, narrative=None, narrated=False, generated_at=None,
            generated_by=None, model=None,
            note="Not written up yet - these are the findings the numbers give.",
        )

    # The findings are recomputed above rather than read from the row, so the
    # bullets always match the database as it is now. The narrative is the
    # cached one, and generated_at says how old it is.
    return _payload(
        facts, findings,
        narrative=json.loads(row.narrative) if row.narrative else None,
        narrated=row.narrated,
        generated_at=row.generated_at,
        generated_by=row.generated_by.full_name if row.generated_by else None,
        model=row.model,
        note=None if row.narrated else "The model could not be reached last time.",
    )


@router.post("/dashboard")
def generate_dashboard_insights(
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """Write up the current findings. This one spends credit."""
    if not current_user.college_id:
        raise HTTPException(
            status_code=400,
            detail="A dashboard summary is per college; this account is not attached to one.",
        )

    facts, findings = insights.gather(db, current_user)
    if not findings:
        raise HTTPException(
            status_code=400,
            detail="There is nothing to summarise yet - no students or companies on file.",
        )

    row = _cached(db, current_user.college_id)
    if row is not None and row.narrated and not refresh:
        # Somebody already paid for today's. Hand it over rather than billing
        # again for the same morning's numbers.
        return _payload(
            facts, findings, narrative=json.loads(row.narrative) if row.narrative else None,
            narrated=True, generated_at=row.generated_at,
            generated_by=row.generated_by.full_name if row.generated_by else None,
            model=row.model,
        )

    college = db.query(College).filter(College.id == current_user.college_id).first()
    prompt = insights.build_prompt(college.name if college else "this college", findings)

    narrative: list[str] | None = None
    note: str | None = None
    narrated = False
    try:
        candidate = narrate_dashboard(prompt)
    except NarrationUnavailable as exc:
        note = f"Could not reach the model ({exc}). These are the findings as the rules wrote them."
    else:
        ok, offending = insights.verify(candidate, findings)
        if ok:
            narrative, narrated = candidate, True
        else:
            # Not shown, not patched up. A summary that quotes a figure nobody
            # computed is worse than no summary, because it reads exactly as
            # confident as a correct one.
            note = (
                "The written summary quoted figures that are not in the data ("
                + ", ".join(sorted(offending)[:5])
                + "), so it was discarded. These are the findings as the rules wrote them."
            )

    if row is None:
        row = DashboardInsight(
            college_id=current_user.college_id, scope=SCOPE, period=_period(),
        )
        db.add(row)
    row.narrative = json.dumps(narrative) if narrative else None
    row.facts = json.dumps(facts, default=str)
    row.findings = json.dumps(
        [{"key": f.key, "severity": f.severity, "headline": f.headline} for f in findings]
    )
    row.narrated = narrated
    row.model = INSIGHT_MODEL if narrated else None
    row.generated_at = datetime.utcnow()
    row.generated_by_id = current_user.id
    db.commit()
    db.refresh(row)

    return _payload(
        facts, findings, narrative=narrative, narrated=narrated,
        generated_at=row.generated_at,
        generated_by=current_user.full_name, model=row.model, note=note,
    )


# --- the monthly report's covering note ---------------------------------------

MONTHLY_SCOPE = "monthly"


@router.post("/monthly")
def generate_monthly_narrative(
    month: str | None = None,
    refresh: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """Write up one month. The report itself never calls the model - this does.

    Cached against the month rather than the day: a month that has closed does
    not change, so a second reader gets the first one's write-up and a rerun is
    something you ask for explicitly.
    """
    if not current_user.college_id:
        raise HTTPException(
            status_code=400,
            detail="A monthly report is per college; this account is not attached to one.",
        )
    key = (month or "").strip() or monthly.last_complete_month()
    try:
        monthly.bounds(key)
    except ValueError:
        raise HTTPException(status_code=422, detail="Month must be written as YYYY-MM.")

    facts, findings, _ = monthly.gather(db, current_user, key)
    if not findings:
        raise HTTPException(
            status_code=400, detail=f"Nothing was recorded in {monthly.label(key)}.",
        )

    row = (
        db.query(DashboardInsight)
        .filter(
            DashboardInsight.college_id == current_user.college_id,
            DashboardInsight.scope == MONTHLY_SCOPE,
            DashboardInsight.period == key,
        )
        .first()
    )
    if row is not None and row.narrated and not refresh:
        return _payload(
            facts, findings, narrative=json.loads(row.narrative) if row.narrative else None,
            narrated=True, generated_at=row.generated_at,
            generated_by=row.generated_by.full_name if row.generated_by else None,
            model=row.model,
        )

    college = db.query(College).filter(College.id == current_user.college_id).first()
    prompt = monthly.build_prompt(
        college.name if college else "this college", key, findings
    )

    narrative: list[str] | None = None
    note: str | None = None
    narrated = False
    try:
        candidate = narrate_dashboard(prompt)
    except NarrationUnavailable as exc:
        note = f"Could not reach the model ({exc}). The report shows the findings instead."
    else:
        ok, offending = insights.verify(candidate, findings)
        if ok:
            narrative, narrated = candidate, True
        else:
            note = (
                "The write-up quoted figures that are not in the data ("
                + ", ".join(sorted(offending)[:5])
                + "), so it was discarded. The report shows the findings instead."
            )

    if row is None:
        row = DashboardInsight(
            college_id=current_user.college_id, scope=MONTHLY_SCOPE, period=key,
        )
        db.add(row)
    row.narrative = json.dumps(narrative) if narrative else None
    row.facts = json.dumps(facts, default=str)
    row.findings = json.dumps(
        [{"key": f.key, "severity": f.severity, "headline": f.headline} for f in findings]
    )
    row.narrated = narrated
    row.model = INSIGHT_MODEL if narrated else None
    row.generated_at = datetime.utcnow()
    row.generated_by_id = current_user.id
    db.commit()
    db.refresh(row)

    return _payload(
        facts, findings, narrative=narrative, narrated=narrated,
        generated_at=row.generated_at, generated_by=current_user.full_name,
        model=row.model, note=note,
    )
