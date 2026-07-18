from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.company import Company, CompanyStatus
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
from app.services.ai_service import suggest_company_allocations

router = APIRouter(prefix="/officers", tags=["officers"])

# Roles allowed to allocate work to officers.
MANAGE_ROLES = (UserRole.SUPER_ADMIN, UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR)

# Assignment workflow states. "active" = freshly assigned, "accepted" = officer
# owns it, "escalated" = needs a manager, "completed" = done.
ASSIGNMENT_STATUSES = {"active", "accepted", "escalated", "completed"}


def _serialize_officer(officer: PlacementOfficer) -> OfficerOut:
    out = OfficerOut.model_validate(officer)
    if officer.user:
        out.officer_name = officer.user.full_name
        out.email = officer.user.email
        out.department = officer.user.department
    out.assignment_count = len(officer.assignments)
    out.active_count = sum(1 for a in officer.assignments if a.status in ("active", "accepted"))
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
    q = db.query(PlacementOfficer)
    if current_user.college_id:
        q = q.filter(PlacementOfficer.college_id == current_user.college_id)
    # Officers only see their own card; managers see the whole team.
    if current_user.role not in MANAGE_ROLES:
        q = q.filter(PlacementOfficer.user_id == current_user.id)
    return [_serialize_officer(o) for o in q.all()]


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


# --- AI auto-allocation -----------------------------------------------------

# Statuses that should never receive an officer: blacklisted (don't engage) and
# dormant (inactive). Applied on both the AI input and the apply commit.
NON_ALLOCATABLE_STATUSES = (CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT)


def _college_officers(db: Session, current_user: User) -> list[PlacementOfficer]:
    q = db.query(PlacementOfficer)
    if current_user.college_id:
        q = q.filter(PlacementOfficer.college_id == current_user.college_id)
    return q.all()


def _unassigned_companies(db: Session, current_user: User) -> list[Company]:
    """Companies in the college with no officer yet, excluding blacklisted/dormant
    companies and declined officer leads (none of which should be allocated)."""
    assigned_ids = {r[0] for r in db.query(CompanyAssignment.company_id).all()}
    q = db.query(Company)
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    return [
        c
        for c in q.all()
        if c.id not in assigned_ids
        and c.status not in NON_ALLOCATABLE_STATUSES
        and c.review_status != "declined"
    ]


def _company_ai_payload(c: Company) -> dict:
    strengths = [h.relationship_strength for h in c.hr_contacts if h.relationship_strength]
    followups = [h.next_followup_date for h in c.hr_contacts if h.next_followup_date]
    return {
        "company_id": c.id,
        "name": c.name,
        "sector": c.sector,
        "domain": c.domain,
        "location": c.location,
        "status": c.status.value if c.status else None,
        "mou_status": c.mou_status,
        "previous_visit_count": c.previous_visit_count or 0,
        "hr_relationship_strength": max(strengths) if strengths else None,
        "next_followup_date": min(followups).isoformat() if followups else None,
        "preferred_branches": c.preferred_branches,
    }


def _officer_ai_payload(o: PlacementOfficer) -> dict:
    active = sum(1 for a in o.assignments if a.status in ("active", "accepted"))
    return {
        "officer_id": o.id,
        "name": o.user.full_name if o.user else f"Officer #{o.id}",
        "region": o.region,
        "sector_expertise": o.sector_expertise,
        "target_companies": o.target_companies or 0,
        "current_active_companies": active,
        "total_assigned": len(o.assignments),
    }


@router.post("/auto-allocate/preview", response_model=AllocationPreviewOut)
async def auto_allocate_preview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Ask the AI to propose an owner for every unassigned company. Read-only —
    nothing is written; the placement head reviews and applies the result."""
    officers = _college_officers(db, current_user)
    if not officers:
        raise HTTPException(status_code=400, detail="No placement officers to allocate to")

    companies = _unassigned_companies(db, current_user)
    if not companies:
        return AllocationPreviewOut(proposals=[], unassigned_count=0, officer_count=len(officers))

    raw = await suggest_company_allocations(
        [_company_ai_payload(c) for c in companies],
        [_officer_ai_payload(o) for o in officers],
    )

    company_map = {c.id: c for c in companies}
    officer_map = {o.id: o for o in officers}
    proposals: list[AllocationProposal] = []
    seen: set[int] = set()
    for item in raw:
        company = company_map.get(item["company_id"])
        officer = officer_map.get(item["officer_id"])
        # Drop hallucinated ids and any duplicate company suggestion.
        if not company or not officer or company.id in seen:
            continue
        seen.add(company.id)
        proposals.append(
            AllocationProposal(
                company_id=company.id,
                company_name=company.name,
                company_sector=company.sector,
                company_location=company.location,
                company_status=company.status.value if company.status else None,
                officer_id=officer.id,
                officer_name=officer.user.full_name if officer.user else f"Officer #{officer.id}",
                priority=item["priority"],
                reasoning=item["reasoning"],
            )
        )

    return AllocationPreviewOut(
        proposals=proposals,
        unassigned_count=len(companies),
        officer_count=len(officers),
    )


@router.post("/auto-allocate/apply", response_model=AllocationApplyOut)
def auto_allocate_apply(
    payload: AllocationApplyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Commit the (possibly head-edited) allocations as CompanyAssignments. Each
    is validated against the tenant and skipped if it already exists."""
    created = 0
    skipped = 0
    for item in payload.allocations:
        company = db.query(Company).filter(Company.id == item.company_id).first()
        if not company or (current_user.college_id and company.college_id != current_user.college_id):
            skipped += 1
            continue
        # Never commit a blacklisted/dormant company even if it reaches apply
        # (e.g. its status changed after the preview was generated).
        if company.status in NON_ALLOCATABLE_STATUSES:
            skipped += 1
            continue
        officer = db.query(PlacementOfficer).filter(PlacementOfficer.id == item.officer_id).first()
        if not officer or (current_user.college_id and officer.college_id != current_user.college_id):
            skipped += 1
            continue
        # Single-owner invariant: skip any company already assigned to anyone
        # (guards against a company allocated since the preview was generated).
        exists = (
            db.query(CompanyAssignment)
            .filter(CompanyAssignment.company_id == item.company_id)
            .first()
        )
        if exists:
            skipped += 1
            continue
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
