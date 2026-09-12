"""The HR directory: every contact in the college, across all companies.

Company Detail already lists the contacts *of one company*, which is the right
shape when you are working that company. This router serves the other question,
the one the placement head actually asks on a Monday: "who owes whom a reply?"
That cuts across companies, so it cannot be answered from the company page
however many times you open it.

Scoping matches the rest of the app: leadership sees the whole college, a
placement officer sees only contacts at companies allocated to them. Enforced
here rather than in the UI, for the same reason companies.py does it.
"""

from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User, UserRole
from app.schemas.company import HRContactDirectoryOut, HRContactOut
from app.services.hr_engagement import score_many

router = APIRouter(prefix="/hr-contacts", tags=["hr-contacts"])

# Follow-up buckets the directory can filter to. "due" is the working set -
# everything already owed plus the next week - because an officer planning their
# week wants both, and making them pick twice is just friction.
FollowupFilter = Literal["all", "due", "overdue", "upcoming", "none"]
SortKey = Literal["followup", "name", "company", "engagement", "relationship", "last_contacted"]


def _officer_company_ids(db: Session, user: User) -> list[int]:
    """Company ids allocated to the officer behind this user."""
    officer = db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()
    if not officer:
        return []
    rows = (
        db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.officer_id == officer.id)
        .all()
    )
    return [r[0] for r in rows]


@router.get("", response_model=list[HRContactDirectoryOut])
def list_hr_contacts(
    response: Response,
    search: Optional[str] = None,
    company_id: Optional[int] = None,
    region: Optional[str] = None,
    followup: FollowupFilter = "all",
    min_relationship: Optional[int] = Query(default=None, ge=1, le=5),
    sort: SortKey = "followup",
    order: Literal["asc", "desc"] = "asc",
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The directory, one page at a time.

    Engagement is computed in Python rather than SQL: the scoring rules in
    services.hr_engagement are the kind of thing that gets tuned, and they read
    far better as arithmetic than as a CASE expression nobody dares touch. The
    cost is bounded - communications are fetched for the contacts on this page
    only, in one query, never per row.
    """
    q = db.query(HRContact).join(Company, HRContact.company_id == Company.id)

    # --- visibility -------------------------------------------------------
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        allowed = _officer_company_ids(db, current_user)
        if not allowed:
            response.headers["X-Total-Count"] = "0"
            return []
        q = q.filter(HRContact.company_id.in_(allowed))

    # --- filters ----------------------------------------------------------
    if company_id:
        q = q.filter(HRContact.company_id == company_id)
    if region:
        q = q.filter(HRContact.region.ilike(f"%{region}%"))
    if min_relationship:
        q = q.filter(HRContact.relationship_strength >= min_relationship)
    if search:
        like = f"%{search}%"
        q = q.filter(
            HRContact.name.ilike(like)
            | HRContact.email.ilike(like)
            | HRContact.designation.ilike(like)
            | Company.name.ilike(like)
        )

    now = datetime.utcnow()
    if followup == "overdue":
        q = q.filter(HRContact.next_followup_date.isnot(None), HRContact.next_followup_date < now)
    elif followup == "upcoming":
        q = q.filter(HRContact.next_followup_date >= now)
    elif followup == "due":
        q = q.filter(
            HRContact.next_followup_date.isnot(None),
            HRContact.next_followup_date < now + timedelta(days=7),
        )
    elif followup == "none":
        q = q.filter(HRContact.next_followup_date.is_(None))

    total = q.count()

    # --- ordering ---------------------------------------------------------
    # Engagement isn't a column, so those two sorts are applied after scoring.
    # Everything else is ordered in SQL, where the pagination is.
    db_sorts = {
        "followup": HRContact.next_followup_date,
        "name": HRContact.name,
        "company": Company.name,
        "last_contacted": HRContact.last_contacted_at,
        "relationship": HRContact.relationship_strength,
    }
    in_python = sort == "engagement"
    column = db_sorts["followup" if in_python else sort]
    direction = column.desc() if order == "desc" else column.asc()
    # Blanks last either way: a directory sorted by follow-up should open on the
    # people who are owed one, not on a screen of contacts with no date set.
    q = q.order_by(direction.nullslast(), HRContact.id.asc())

    q = q.options(selectinload(HRContact.company))
    contacts = q.offset(skip).limit(limit).all()

    # --- derived fields, in two queries for the whole page ----------------
    contact_ids = [c.id for c in contacts]
    comms_by_contact: dict[int, list] = {cid: [] for cid in contact_ids}
    latest_author: dict[int, str] = {}
    if contact_ids:
        rows = (
            db.query(Communication)
            .options(selectinload(Communication.logged_by))
            .filter(Communication.hr_contact_id.in_(contact_ids))
            .order_by(Communication.communicated_at.asc().nullsfirst())
            .all()
        )
        for row in rows:
            comms_by_contact[row.hr_contact_id].append(row)
            # Ascending order, so the last write per contact is the most recent.
            if row.logged_by:
                latest_author[row.hr_contact_id] = row.logged_by.full_name

    scores = score_many(comms_by_contact, now=now)

    out = []
    for contact in contacts:
        out.append(
            HRContactDirectoryOut(
                **HRContactOut.model_validate(contact).model_dump(),
                company_name=contact.company.name if contact.company else "",
                company_status=(
                    contact.company.status.value
                    if contact.company and contact.company.status
                    else None
                ),
                last_contacted_by=latest_author.get(contact.id),
                engagement=scores.get(contact.id),
            )
        )

    if in_python:
        # Unscored contacts (no history) sort last whichever way the column
        # points - same rule as the nullslast() above, for the same reason.
        flip = -1 if order == "desc" else 1
        out.sort(
            key=lambda c: (
                c.engagement is None,
                (c.engagement.score if c.engagement else 0) * flip,
            )
        )

    response.headers["X-Total-Count"] = str(total)
    return out


@router.get("/summary")
def hr_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Counts for the directory's header strip, on the same visibility rules as
    the list. Cheap enough to recompute on every load - one COUNT per bucket
    over a table with hundreds of rows, not millions."""
    q = db.query(HRContact).join(Company, HRContact.company_id == Company.id)
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        allowed = _officer_company_ids(db, current_user)
        if not allowed:
            return {"total": 0, "overdue": 0, "due_this_week": 0, "no_followup": 0, "never_contacted": 0}
        q = q.filter(HRContact.company_id.in_(allowed))

    now = datetime.utcnow()
    week = now + timedelta(days=7)
    return {
        "total": q.count(),
        "overdue": q.filter(
            HRContact.next_followup_date.isnot(None), HRContact.next_followup_date < now
        ).count(),
        "due_this_week": q.filter(
            HRContact.next_followup_date >= now, HRContact.next_followup_date < week
        ).count(),
        "no_followup": q.filter(HRContact.next_followup_date.is_(None)).count(),
        "never_contacted": q.filter(HRContact.last_contacted_at.is_(None)).count(),
    }
