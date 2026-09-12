from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, exists, func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.company import Company, CompanyStatus, HRContact
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User, UserRole
from app.schemas.officer import (
    AllocationApplyIn,
    AllocationApplyOut,
    AllocationPreviewOut,
    AllocationProposal,
    AssignmentCreate,
    AssignmentOut,
    AssignmentUpdate,
    OfficerCreate,
    OfficerOut,
    OfficerUpdate,
)
from app.services.allocation import NO_MOU, propose_allocations

router = APIRouter(prefix="/officers", tags=["officers"])

# Roles allowed to allocate work to officers.
MANAGE_ROLES = (UserRole.SUPER_ADMIN, UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR)

# Assignment workflow states. "active" = freshly assigned, "accepted" = officer
# owns it, "escalated" = needs a manager, "completed" = done.
ASSIGNMENT_STATUSES = {"active", "accepted", "escalated", "completed"}


# Assignment states that count as work an officer is currently carrying.
ACTIVE_STATUSES = ("active", "accepted")


def _assignment_counts(db: Session, officer_ids: list[int]) -> dict[int, tuple[int, int]]:
    """(total, active) assignment counts per officer, in one grouped query.

    Counting these off the ``assignments`` relationship loads every assignment
    row into memory - fine for a demo college, ruinous once three officers own
    thousands of companies between them.
    """
    if not officer_ids:
        return {}
    rows = (
        db.query(
            CompanyAssignment.officer_id,
            func.count(CompanyAssignment.id),
            func.count(CompanyAssignment.id).filter(
                CompanyAssignment.status.in_(ACTIVE_STATUSES)
            ),
        )
        .filter(CompanyAssignment.officer_id.in_(officer_ids))
        .group_by(CompanyAssignment.officer_id)
        .all()
    )
    return {officer_id: (total, active) for officer_id, total, active in rows}


def _serialize_officer(
    officer: PlacementOfficer, counts: Optional[tuple[int, int]] = None
) -> OfficerOut:
    out = OfficerOut.model_validate(officer)
    if officer.user:
        out.officer_name = officer.user.full_name
        out.email = officer.user.email
        out.department = officer.user.department
    if counts is None:
        counts = (
            len(officer.assignments),
            sum(1 for a in officer.assignments if a.status in ACTIVE_STATUSES),
        )
    out.assignment_count, out.active_count = counts
    return out


def _get_officer(officer_id: int, db: Session, current_user: User) -> PlacementOfficer:
    officer = db.query(PlacementOfficer).filter(PlacementOfficer.id == officer_id).first()
    if not officer or (current_user.college_id and officer.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Officer not found")
    # Officers may only access their own profile/assignments; managers see all.
    if current_user.role not in MANAGE_ROLES and officer.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Officer not found")
    return officer


@router.get("", response_model=list[OfficerOut])
def list_officers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(PlacementOfficer).options(selectinload(PlacementOfficer.user))
    if current_user.college_id:
        q = q.filter(PlacementOfficer.college_id == current_user.college_id)
    # Officers only see their own card; managers see the whole team.
    if current_user.role not in MANAGE_ROLES:
        q = q.filter(PlacementOfficer.user_id == current_user.id)
    officers = q.all()
    counts = _assignment_counts(db, [o.id for o in officers])
    return [_serialize_officer(o, counts.get(o.id, (0, 0))) for o in officers]


@router.get("/assignable-users", response_model=list[dict])
def assignable_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Staff who can be promoted to placement officers (officer role, no officer
    profile yet)."""
    existing = {o.user_id for o in db.query(PlacementOfficer.user_id).all()}
    q = db.query(User).filter(User.role == UserRole.PLACEMENT_OFFICER, User.is_active == True)
    if current_user.college_id:
        q = q.filter(User.college_id == current_user.college_id)
    return [
        {"id": u.id, "full_name": u.full_name, "email": u.email, "department": u.department}
        for u in q.all()
        if u.id not in existing
    ]


# --- auto-allocation --------------------------------------------------------

# Statuses that should never receive an officer: blacklisted (don't engage) and
# dormant (inactive). Applied both when proposing and on the apply commit.
NON_ALLOCATABLE_STATUSES = (CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT)

# How many proposals one run returns. A head reviews these row by row, so the
# ceiling is what a person can actually read in a sitting - not what the
# database holds. Applying a batch and re-running picks up where it left off.
DEFAULT_PREVIEW_LIMIT = 200
MAX_PREVIEW_LIMIT = 1000

# "pipeline" is the set of companies somebody is actually working: priority or
# active, or carrying an HR contact, a past visit, or an MOU. "all" adds the
# long tail of untouched imported companies, which for a large database is most
# of them.
PREVIEW_SCOPES = ("pipeline", "all")


def _college_officers(db: Session, current_user: User) -> list[PlacementOfficer]:
    q = db.query(PlacementOfficer).options(selectinload(PlacementOfficer.user))
    if current_user.college_id:
        q = q.filter(PlacementOfficer.college_id == current_user.college_id)
    return q.all()


def _unassigned_query(db: Session, current_user: User):
    """Companies in the college with no officer yet, excluding blacklisted and
    dormant companies and declined officer leads.

    Filtering happens in SQL rather than by walking every row in Python - the
    whole point of this rewrite is that the query has to survive a database with
    thousands of companies in it.
    """
    q = db.query(Company).filter(
        ~db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.company_id == Company.id)
        .exists()
    )
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    q = q.filter(
        or_(Company.status.is_(None), Company.status.notin_(NON_ALLOCATABLE_STATUSES))
    )
    # review_status is nullable and NULL means "no review needed", so a plain
    # != would silently drop every company that was never reviewed.
    return q.filter(or_(Company.review_status.is_(None), Company.review_status != "declined"))


def _pipeline_filter(q):
    """Narrow to companies somebody is actually working.

    The MOU test uses the same NO_MOU vocabulary the importance score does, so
    a company marked "Not started" or "Terminated" is not pulled into the
    pipeline on the strength of a field that records the absence of a deal.
    """
    return q.filter(
        or_(
            Company.status.in_((CompanyStatus.PRIORITY, CompanyStatus.ACTIVE)),
            exists().where(HRContact.company_id == Company.id),
            Company.previous_visit_count > 0,
            and_(
                Company.mou_status.isnot(None),
                func.lower(func.trim(Company.mou_status)).notin_(sorted(NO_MOU)),
            ),
        )
    )


@router.post("/auto-allocate/preview", response_model=AllocationPreviewOut)
def auto_allocate_preview(
    scope: str = Query("pipeline"),
    limit: int = Query(DEFAULT_PREVIEW_LIMIT, ge=1, le=MAX_PREVIEW_LIMIT),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Propose an owner for the unassigned companies most worth owning.

    Read-only - nothing is written; the placement head reviews, edits and
    applies the result. Companies are ranked by importance and the top ``limit``
    are returned, so a database with thousands of untouched imports produces a
    reviewable shortlist instead of an unusable dump.
    """
    if scope not in PREVIEW_SCOPES:
        raise HTTPException(
            status_code=400, detail=f"Invalid scope. Allowed: {list(PREVIEW_SCOPES)}"
        )

    officers = _college_officers(db, current_user)
    if not officers:
        raise HTTPException(status_code=400, detail="No placement officers to allocate to")

    base = _unassigned_query(db, current_user)
    unassigned_count = base.with_entities(func.count(Company.id)).scalar() or 0

    scoped = _pipeline_filter(base) if scope == "pipeline" else base
    # hr_contacts feeds relationship strength and follow-up urgency for every
    # company scored, so load them in one extra query instead of one per row.
    companies = scoped.options(selectinload(Company.hr_contacts)).all()

    active_counts = {
        officer_id: active
        for officer_id, (_total, active) in _assignment_counts(
            db, [o.id for o in officers]
        ).items()
    }

    proposals, considered = propose_allocations(companies, officers, active_counts, limit)

    return AllocationPreviewOut(
        proposals=[
            AllocationProposal(
                company_id=p.company.id,
                company_name=p.company.name,
                company_sector=p.company.sector,
                company_location=p.company.location,
                company_status=p.company.status.value if p.company.status else None,
                officer_id=p.officer.id,
                officer_name=(
                    p.officer.user.full_name if p.officer.user else f"Officer #{p.officer.id}"
                ),
                priority=p.priority,
                reasoning=p.reasoning,
            )
            for p in proposals
        ],
        unassigned_count=unassigned_count,
        officer_count=len(officers),
        considered_count=considered,
        scope=scope,
        limit=limit,
    )


@router.post("/auto-allocate/apply", response_model=AllocationApplyOut)
def auto_allocate_apply(
    payload: AllocationApplyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Commit the (possibly head-edited) allocations as CompanyAssignments. Each
    is validated against the tenant and skipped if it already exists."""
    company_ids = {item.company_id for item in payload.allocations}
    officer_ids = {item.officer_id for item in payload.allocations}

    # Three queries for the whole batch rather than three per row - a head can
    # apply a couple of hundred allocations at once, and a per-row round-trip to
    # a hosted database turns that into a minute of waiting.
    companies = {
        c.id: c for c in db.query(Company).filter(Company.id.in_(company_ids)).all()
    }
    officers = {
        o.id: o
        for o in db.query(PlacementOfficer).filter(PlacementOfficer.id.in_(officer_ids)).all()
    }
    already_assigned = {
        row[0]
        for row in db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.company_id.in_(company_ids))
        .all()
    }

    created = 0
    skipped = 0
    for item in payload.allocations:
        company = companies.get(item.company_id)
        if not company or (current_user.college_id and company.college_id != current_user.college_id):
            skipped += 1
            continue
        # Never commit a blacklisted/dormant company even if it reaches apply
        # (e.g. its status changed after the preview was generated).
        if company.status in NON_ALLOCATABLE_STATUSES:
            skipped += 1
            continue
        officer = officers.get(item.officer_id)
        if not officer or (current_user.college_id and officer.college_id != current_user.college_id):
            skipped += 1
            continue
        # Single-owner invariant: skip any company already assigned to anyone
        # (guards against a company allocated since the preview was generated,
        # and against the same company appearing twice in one payload).
        if item.company_id in already_assigned:
            skipped += 1
            continue
        already_assigned.add(item.company_id)
        priority = item.priority if item.priority in ("low", "normal", "high") else "normal"
        db.add(
            CompanyAssignment(
                company_id=item.company_id,
                officer_id=item.officer_id,
                status="active",
                priority=priority,
                notes="Auto-allocated by AI",
            )
        )
        created += 1

    db.commit()
    return AllocationApplyOut(created=created, skipped=skipped)


@router.post("", response_model=OfficerOut, status_code=201)
def create_officer(
    payload: OfficerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user or (current_user.college_id and user.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="User not found")
    if db.query(PlacementOfficer).filter(PlacementOfficer.user_id == payload.user_id).first():
        raise HTTPException(status_code=400, detail="This user is already a placement officer")
    officer = PlacementOfficer(**payload.model_dump(), college_id=user.college_id)
    db.add(officer)
    db.commit()
    db.refresh(officer)
    return _serialize_officer(officer)


@router.get("/{officer_id}", response_model=OfficerOut)
def get_officer(officer_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _serialize_officer(_get_officer(officer_id, db, current_user))


@router.put("/{officer_id}", response_model=OfficerOut)
def update_officer(
    officer_id: int,
    payload: OfficerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    officer = _get_officer(officer_id, db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(officer, field, value)
    db.commit()
    db.refresh(officer)
    return _serialize_officer(officer)


@router.delete("/{officer_id}", status_code=204)
def delete_officer(
    officer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    officer = _get_officer(officer_id, db, current_user)
    db.query(CompanyAssignment).filter(CompanyAssignment.officer_id == officer.id).delete()
    db.delete(officer)
    db.commit()


def _serialize_assignment(assignment: CompanyAssignment) -> AssignmentOut:
    out = AssignmentOut.model_validate(assignment)
    if assignment.company:
        out.company_name = assignment.company.name
        out.company_status = assignment.company.status.value if assignment.company.status else None
        out.company_sector = assignment.company.sector
    return out


@router.get("/{officer_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(
    officer_id: int,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_officer(officer_id, db, current_user)
    q = db.query(CompanyAssignment).filter(CompanyAssignment.officer_id == officer_id)
    if status:
        q = q.filter(CompanyAssignment.status == status)
    return [_serialize_assignment(a) for a in q.order_by(CompanyAssignment.assigned_at.desc()).all()]


@router.post("/{officer_id}/assignments", response_model=AssignmentOut, status_code=201)
def assign_company(
    officer_id: int,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    _get_officer(officer_id, db, current_user)
    company = db.query(Company).filter(Company.id == payload.company_id).first()
    if not company or (current_user.college_id and company.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Company not found")
    # A company has a single owner — block if it's already assigned to anyone so
    # two officers never work the same company. Reassigning means removing the
    # other officer's allocation first.
    existing = (
        db.query(CompanyAssignment)
        .filter(CompanyAssignment.company_id == payload.company_id)
        .first()
    )
    if existing:
        if existing.officer_id == officer_id:
            raise HTTPException(status_code=400, detail="Company already assigned to this officer")
        other = db.query(PlacementOfficer).filter(PlacementOfficer.id == existing.officer_id).first()
        other_name = other.user.full_name if other and other.user else f"officer #{existing.officer_id}"
        raise HTTPException(
            status_code=400,
            detail=f"Company already assigned to {other_name}. Remove that allocation first.",
        )
    assignment = CompanyAssignment(officer_id=officer_id, **payload.model_dump())
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _serialize_assignment(assignment)


@router.put("/{officer_id}/assignments/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    officer_id: int,
    assignment_id: int,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_officer(officer_id, db, current_user)
    assignment = (
        db.query(CompanyAssignment)
        .filter(CompanyAssignment.id == assignment_id, CompanyAssignment.officer_id == officer_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if payload.status is not None and payload.status not in ASSIGNMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {sorted(ASSIGNMENT_STATUSES)}")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(assignment, field, value)
    db.commit()
    db.refresh(assignment)
    return _serialize_assignment(assignment)


@router.delete("/{officer_id}/assignments/{assignment_id}", status_code=204)
def delete_assignment(
    officer_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    _get_officer(officer_id, db, current_user)
    assignment = (
        db.query(CompanyAssignment)
        .filter(CompanyAssignment.id == assignment_id, CompanyAssignment.officer_id == officer_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.commit()
