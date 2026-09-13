"""Offers and joinings — the end of the placement lifecycle.

Drives record that a student was *selected*, and the Students page records that
they are *placed*. Neither answers the questions a placement cell is asked at
the end of a season: how many of those offers were actually taken up, who is
still holding three of them, what the median package was, and who dropped out
after accepting. Those live on the offer row, which until now was written by the
drive flow and never read back.

Scoping matches the rest of the app: leadership sees the whole college, a
placement officer sees offers from the companies allocated to them. Enforced
here rather than in the UI, for the same reason companies.py does it.
"""

import statistics
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import String, case, cast, func
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import require_roles
from app.core.roles import STAFF_ROLES
from app.models.company import Company
from app.models.offer import Offer, OfferStatus
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import Student
from app.models.user import User, UserRole
from app.schemas.offer import (
    OfferCompanyOption,
    OfferCreate,
    OfferFilterOptions,
    OfferOut,
    OfferSummary,
    OfferUpdate,
)
from app.services.placement import LIVE_STATUSES, sync_student_placement

router = APIRouter(prefix="/offers", tags=["offers"])

# Students never reach the staff app; everything here is staff-only.
StaffUser = Depends(require_roles(*STAFF_ROLES))

SortKey = Literal[
    "student_name",
    "roll_number",
    "branch",
    "batch_year",
    "company",
    "role",
    "ctc",
    "status",
    "joining_date",
    "created_at",
]

# Ordering by the stored enum would follow the order the members were declared.
# Rank by where the offer sits in its lifecycle instead, so sorting by status
# walks an offer from made to taken up to fallen through.
_STATUS_ORDER = (
    OfferStatus.ISSUED,
    OfferStatus.ACCEPTED,
    OfferStatus.JOINED,
    OfferStatus.REJECTED,
    OfferStatus.DROPOUT,
)

# The column is a Postgres enum holding the member *names*, so the comparison
# casts to text — matching on the members sends their lowercase values, which
# the enum type rejects. Same trick as companies._STATUS_RANK.
_STATUS_RANK = case(
    {status.name: rank for rank, status in enumerate(_STATUS_ORDER)},
    value=cast(Offer.status, String),
    else_=len(_STATUS_ORDER),
)

_SORT_COLUMNS = {
    "student_name": func.lower(User.full_name),
    "roll_number": func.lower(Student.roll_number),
    "branch": func.lower(Student.branch),
    "batch_year": Student.batch_year,
    "company": func.lower(Company.name),
    "role": func.lower(Offer.role),
    "ctc": Offer.ctc,
    "status": _STATUS_RANK,
    "joining_date": Offer.joining_date,
    "created_at": Offer.created_at,
}


def _officer_company_ids(db: Session, user: User) -> list[int]:
    """Company ids allocated to the officer behind this user.

    (Fourth copy of this helper — companies, communications and hr_contacts each
    keep their own. Consolidating them is its own change, per the note in
    core/roles.py, rather than noise inside this feature.)
    """
    officer = db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()
    if not officer:
        return []
    rows = (
        db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.officer_id == officer.id)
        .all()
    )
    return [r[0] for r in rows]


def _base_query(db: Session, user: User):
    """Offers this user may see, joined to everything a row needs to render.

    The join to users is what makes the student's name available: it lives on
    the backing account, not the student row. Company is an *outer* join — the
    "mark as placed" placeholder has no company, and dropping those rows would
    make a manually-placed student look like they hold no offer at all.
    """
    return (
        db.query(Offer)
        .join(Student, Offer.student_id == Student.id)
        .join(User, Student.user_id == User.id)
        .outerjoin(Company, Offer.company_id == Company.id)
    )


def _visible(db: Session, user: User, q, response: Optional[Response] = None):
    """Apply the tenant and officer boundaries. Returns None when the officer has
    no companies at all, so the caller can answer with an empty page."""
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    if user.role == UserRole.PLACEMENT_OFFICER:
        allowed = _officer_company_ids(db, user)
        if not allowed:
            return None
        # Placeholders carry no company, so they stay with leadership: an officer
        # has no basis to act on an offer nobody attributed to a company.
        q = q.filter(Offer.company_id.in_(allowed))
    return q


def _apply_filters(
    q,
    *,
    status: Optional[OfferStatus],
    company_id: Optional[int],
    student_id: Optional[int],
    branch: Optional[str],
    batch_year: Optional[int],
    awaiting_joining: Optional[bool],
    search: Optional[str],
):
    if status:
        q = q.filter(Offer.status == status)
    if company_id:
        q = q.filter(Offer.company_id == company_id)
    if student_id:
        q = q.filter(Offer.student_id == student_id)
    if branch:
        # Exact (case-insensitive), matching the Students page: a substring match
        # would fold "CSE" into "CSE (AI & ML)" as well.
        q = q.filter(func.lower(Student.branch) == branch.strip().lower())
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)
    if awaiting_joining is not None:
        # A live offer with no joining date on it — the working list at the end
        # of a season, when the cell is chasing who actually starts.
        undated = Offer.status.in_(LIVE_STATUSES) & Offer.joining_date.is_(None)
        q = q.filter(undated) if awaiting_joining else q.filter(~undated)
    if search:
        like = f"%{search}%"
        q = q.filter(
            User.full_name.ilike(like)
            | Student.roll_number.ilike(like)
            | Company.name.ilike(like)
            | Offer.role.ilike(like)
        )
    return q


def _order_by(sort: SortKey, order: str):
    """ORDER BY for the offers list. Blanks sort last whichever way the column
    points, and id breaks ties so paging can't repeat or skip a row."""
    column = _SORT_COLUMNS[sort]
    direction = column.desc() if order == "desc" else column.asc()
    return [direction.nullslast(), Offer.id.asc()]


def _owned_student(db: Session, student_id: int, user: User) -> Student:
    """The student, restricted to the caller's college. 404 rather than 403 so
    another college's roll numbers can't be probed."""
    q = db.query(Student).filter(Student.id == student_id)
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    student = q.first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


def _owned_company(db: Session, company_id: int, user: User) -> Company:
    """The company, restricted to the caller's college and — for an officer — to
    their own allocations, so an offer can't be filed against someone else's."""
    q = db.query(Company).filter(Company.id == company_id)
    if user.college_id:
        q = q.filter(Company.college_id == user.college_id)
    company = q.first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if user.role == UserRole.PLACEMENT_OFFICER and company.id not in _officer_company_ids(db, user):
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _accessible_offer(db: Session, offer_id: int, user: User) -> Offer:
    q = _base_query(db, user).filter(Offer.id == offer_id)
    q = _visible(db, user, q)
    offer = q.first() if q is not None else None
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    return offer


def _serialise(db: Session, offers: list[Offer]) -> list[OfferOut]:
    """Attach each student's total offer count. One grouped query for the page,
    not one per row — and it is what makes a student holding three offers
    legible on a list that shows one row per offer."""
    rows: list[OfferOut] = []
    student_ids = {o.student_id for o in offers}
    counts = (
        dict(
            db.query(Offer.student_id, func.count(Offer.id))
            .filter(Offer.student_id.in_(student_ids))
            .group_by(Offer.student_id)
            .all()
        )
        if student_ids
        else {}
    )
    for offer in offers:
        out = OfferOut.model_validate(offer)
        out.offer_count = counts.get(offer.student_id, 1)
        rows.append(out)
    return rows


@router.get("", response_model=list[OfferOut])
def list_offers(
    response: Response,
    status: Optional[OfferStatus] = None,
    company_id: Optional[int] = None,
    student_id: Optional[int] = None,
    branch: Optional[str] = None,
    batch_year: Optional[int] = None,
    awaiting_joining: Optional[bool] = None,
    search: Optional[str] = None,
    sort: SortKey = "created_at",
    order: Literal["asc", "desc"] = "desc",
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """One page of offers, newest first by default. The total row count for the
    current filters is in ``X-Total-Count`` so callers can paginate."""
    q = _visible(db, current_user, _base_query(db, current_user), response)
    if q is None:
        response.headers["X-Total-Count"] = "0"
        return []
    q = _apply_filters(
        q,
        status=status,
        company_id=company_id,
        student_id=student_id,
        branch=branch,
        batch_year=batch_year,
        awaiting_joining=awaiting_joining,
        search=search,
    )
    response.headers["X-Total-Count"] = str(q.count())
    q = q.options(selectinload(Offer.student), selectinload(Offer.company), selectinload(Offer.drive))
    offers = q.order_by(*_order_by(sort, order)).offset(skip).limit(limit).all()
    return _serialise(db, offers)


@router.get("/summary", response_model=OfferSummary)
def offers_summary(
    company_id: Optional[int] = None,
    student_id: Optional[int] = None,
    branch: Optional[str] = None,
    batch_year: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """Counts for the summary strip.

    Deliberately takes every filter *except* status and the awaiting-joining
    bucket: those two are what the tiles themselves set, and a tile that
    recounted itself after you clicked it would always read 100%.
    """
    empty = OfferSummary(
        total=0, issued=0, accepted=0, joined=0, rejected=0, dropout=0,
        students_with_offer=0, students_with_multiple=0,
    )
    q = _visible(db, current_user, _base_query(db, current_user))
    if q is None:
        return empty
    q = _apply_filters(
        q,
        status=None,
        company_id=company_id,
        student_id=student_id,
        branch=branch,
        batch_year=batch_year,
        awaiting_joining=None,
        search=search,
    )

    # One pass over the filtered rows: the columns are narrow, and counting each
    # status with its own COUNT query would be six round trips for one strip.
    rows = q.with_entities(Offer.status, Offer.ctc, Offer.student_id, Offer.joining_date).all()
    if not rows:
        return empty

    by_status = {status: 0 for status in OfferStatus}
    per_student: dict[int, int] = {}
    packages: list[float] = []
    awaiting = 0
    for status, ctc, sid, joining_date in rows:
        by_status[status] = by_status.get(status, 0) + 1
        per_student[sid] = per_student.get(sid, 0) + 1
        if status in LIVE_STATUSES:
            if ctc is not None:
                packages.append(ctc)
            if joining_date is None:
                awaiting += 1

    accepted = by_status[OfferStatus.ACCEPTED]
    joined = by_status[OfferStatus.JOINED]
    # Of the offers a student took, the share that reached joining. An accepted
    # offer is one a student said yes to; a joined one is a student who started.
    taken = accepted + joined
    return OfferSummary(
        total=len(rows),
        issued=by_status[OfferStatus.ISSUED],
        accepted=accepted,
        joined=joined,
        rejected=by_status[OfferStatus.REJECTED],
        dropout=by_status[OfferStatus.DROPOUT],
        students_with_offer=len(per_student),
        students_with_multiple=sum(1 for n in per_student.values() if n > 1),
        # Packages are read off live offers only: a rejected offer's CTC never
        # belonged to this college's numbers.
        highest_ctc=max(packages) if packages else None,
        median_ctc=round(statistics.median(packages), 2) if packages else None,
        avg_ctc=round(sum(packages) / len(packages), 2) if packages else None,
        joining_conversion=round(joined * 100 / taken, 1) if taken else None,
        awaiting_joining_date=awaiting,
    )


@router.get("/filter-options", response_model=OfferFilterOptions)
def offer_filter_options(
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """Branch, batch and company values that actually appear on an offer, so the
    dropdowns only offer choices that can return a row."""
    q = _visible(db, current_user, _base_query(db, current_user))
    if q is None:
        return OfferFilterOptions(branches=[], batch_years=[], companies=[])

    rows = q.with_entities(
        Student.branch, Student.batch_year, Company.id, Company.name
    ).distinct().all()

    branches: dict[str, str] = {}
    batch_years: set[int] = set()
    companies: dict[int, str] = {}
    for branch, batch_year, cid, cname in rows:
        if branch and branch.strip():
            branches.setdefault(branch.strip().lower(), branch.strip())
        if batch_year:
            batch_years.add(batch_year)
        if cid and cname:
            companies[cid] = cname

    return OfferFilterOptions(
        branches=sorted(branches.values(), key=str.lower),
        batch_years=sorted(batch_years, reverse=True),
        companies=[
            OfferCompanyOption(id=cid, name=name)
            for cid, name in sorted(companies.items(), key=lambda kv: kv[1].lower())
        ],
    )


@router.post("", response_model=OfferOut, status_code=201)
def create_offer(
    payload: OfferCreate,
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """Record an offer that didn't come through a drive — an off-campus
    application, a referral, a PPO from an internship.

    A company is required. Without one the row would be indistinguishable from
    the placeholder the "mark as placed" flow maintains, and could not be read
    company-wise, which is most of the point of recording it.
    """
    if not payload.company_id:
        raise HTTPException(status_code=400, detail="Select the company making the offer")
    student = _owned_student(db, payload.student_id, current_user)
    _owned_company(db, payload.company_id, current_user)

    offer = Offer(**payload.model_dump())
    db.add(offer)
    db.flush()

    # A real offer supersedes the placeholder: keeping both would count this
    # student's placement twice in the offer totals.
    _drop_placeholder(db, student)
    sync_student_placement(db, student)
    db.commit()
    db.refresh(offer)
    return _serialise(db, [offer])[0]


@router.put("/{offer_id}", response_model=OfferOut)
def update_offer(
    offer_id: int,
    payload: OfferUpdate,
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """Move an offer along its lifecycle, or correct what was recorded.

    Whatever changes here, the student's placement is recomputed from the offers
    they hold — marking the last live one dropped puts them back on the unplaced
    list, which is where the cell needs to see them.
    """
    offer = _accessible_offer(db, offer_id, current_user)
    data = payload.model_dump(exclude_unset=True)

    if "company_id" in data and data["company_id"] is not None:
        _owned_company(db, data["company_id"], current_user)

    new_status = data.get("status")
    if new_status is not None and new_status != OfferStatus.DROPOUT and "dropout_reason" not in data:
        # Leaving a stale "joined a family business" on a re-accepted offer would
        # read as fact on every report that quotes it.
        offer.dropout_reason = None

    for field, value in data.items():
        setattr(offer, field, value)

    db.flush()
    sync_student_placement(db, offer.student)
    db.commit()
    db.refresh(offer)
    return _serialise(db, [offer])[0]


@router.delete("/{offer_id}", status_code=204)
def delete_offer(
    offer_id: int,
    db: Session = Depends(get_db),
    current_user: User = StaffUser,
):
    """Remove an offer recorded in error. The student's placement follows —
    deleting their only live offer returns them to unplaced."""
    offer = _accessible_offer(db, offer_id, current_user)
    student = offer.student
    db.delete(offer)
    db.flush()
    sync_student_placement(db, student)
    db.commit()


def _drop_placeholder(db: Session, student: Student) -> None:
    """Delete the drive-less, company-less row the "mark as placed" flow keeps,
    once a real offer exists to replace it."""
    placeholder = (
        db.query(Offer)
        .filter(
            Offer.student_id == student.id,
            Offer.drive_id.is_(None),
            Offer.company_id.is_(None),
        )
        .first()
    )
    if placeholder is not None:
        db.delete(placeholder)
        db.flush()
