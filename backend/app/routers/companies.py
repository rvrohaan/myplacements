from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.company import Company, CompanyStatus, HRContact
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User, UserRole

# Roles that manage the company database (bulk import, approving leads).
MANAGE_ROLES = (UserRole.SUPER_ADMIN, UserRole.PRINCIPAL, UserRole.PRO_CHANCELLOR, UserRole.DEPUTY_PRO_CHANCELLOR)
from app.schemas.company import (
    CompanyCreate,
    CompanyOut,
    CompanyUpdate,
    DraftEmailRequest,
    DraftEmailResponse,
    ExamQuestionsRequest,
    ExamQuestionsResponse,
    HRContactBase,
    HRContactOut,
    InterviewQuestionsRequest,
    InterviewQuestionsResponse,
)
from app.services.ai_service import (
    draft_hr_email,
    generate_company_profile,
    generate_exam_questions,
    generate_interview_questions,
)
from app.services.excel_io import XLSX_MEDIA_TYPE, Column, build_workbook, parse_rows

router = APIRouter(prefix="/companies", tags=["companies"])


def _officer_company_ids(db: Session, user: User) -> list[int]:
    """Company ids allocated to the placement officer behind this user. Drives the
    officer-scoped company views — officers only see companies assigned to them."""
    officer = db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()
    if not officer:
        return []
    rows = (
        db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.officer_id == officer.id)
        .all()
    )
    return [r[0] for r in rows]

# Column spec driving Excel export, the import template, and import parsing.
COMPANY_COLUMNS = [
    Column("name", "name", required=True),
    Column("sector", "sector"),
    Column("domain", "domain"),
    Column("location", "location"),
    Column("size", "size"),
    Column("website", "website"),
    Column("products_services", "products_services"),
    Column("status", "status", kind="enum", choices=[s.value for s in CompanyStatus]),
    Column("mou_status", "mou_status"),
    Column("hiring_pattern", "hiring_pattern"),
    Column("preferred_branches", "preferred_branches"),
    Column("min_cgpa", "min_cgpa", kind="float"),
    Column("salary_min", "salary_min", kind="float"),
    Column("salary_max", "salary_max", kind="float"),
    Column("notes", "notes"),
]


@router.get("", response_model=list[CompanyOut])
def list_companies(
    status: Optional[CompanyStatus] = None,
    sector: Optional[str] = None,
    search: Optional[str] = None,
    unassigned: bool = False,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Company)
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    # Placement officers only see companies allocated to them.
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        ids = _officer_company_ids(db, current_user)
        if not ids:
            return []
        q = q.filter(Company.id.in_(ids))
    # Allocatable companies only — drives the manual "assign a company" picker:
    # exclude any company already owned (single-owner rule) and blacklisted /
    # dormant companies, which aren't worth an officer's effort.
    if unassigned:
        assigned_ids = [r[0] for r in db.query(CompanyAssignment.company_id).all()]
        if assigned_ids:
            q = q.filter(~Company.id.in_(assigned_ids))
        q = q.filter(Company.status.notin_([CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT]))
    if status:
        q = q.filter(Company.status == status)
    if sector:
        q = q.filter(Company.sector.ilike(f"%{sector}%"))
    if search:
        q = q.filter(Company.name.ilike(f"%{search}%"))
    return q.offset(skip).limit(limit).all()


@router.post("", response_model=CompanyOut, status_code=201)
def create_company(payload: CompanyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    is_officer = current_user.role == UserRole.PLACEMENT_OFFICER
    company = Company(
        **payload.model_dump(),
        college_id=current_user.college_id,
        created_by_id=current_user.id,
        # Officer leads start pending a placement head's review.
        source="officer_lead" if is_officer else None,
        review_status="pending" if is_officer else None,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    # Auto-allocate an officer's own lead to them so it shows in their scoped view.
    if is_officer:
        officer = db.query(PlacementOfficer).filter(PlacementOfficer.user_id == current_user.id).first()
        if officer:
            db.add(CompanyAssignment(officer_id=officer.id, company_id=company.id, status="active"))
            db.commit()
            db.refresh(company)
    return company


@router.get("/export")
def export_companies(
    status: Optional[CompanyStatus] = None,
    sector: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the (optionally filtered) company list as an .xlsx file."""
    q = db.query(Company)
    if current_user.college_id:
        q = q.filter(Company.college_id == current_user.college_id)
    # Placement officers only export companies allocated to them.
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        ids = _officer_company_ids(db, current_user)
        if not ids:
            return _companies_workbook_response([])
        q = q.filter(Company.id.in_(ids))
    if status:
        q = q.filter(Company.status == status)
    if sector:
        q = q.filter(Company.sector.ilike(f"%{sector}%"))
    if search:
        q = q.filter(Company.name.ilike(f"%{search}%"))

    return _companies_workbook_response(q.all())


def _companies_workbook_response(companies: list[Company]) -> StreamingResponse:
    buffer = build_workbook(COMPANY_COLUMNS, companies, "Companies")
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=companies.xlsx"},
    )


@router.get("/import-template")
def company_import_template(_: User = Depends(get_current_user)):
    """Download a header-only workbook to fill in for bulk import."""
    columns = [c for c in COMPANY_COLUMNS if c.importable]
    buffer = build_workbook(columns, [], "Companies")
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=companies_template.xlsx"},
    )


@router.post("/import")
def import_companies(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Bulk-create companies from an uploaded .xlsx. Existing names are skipped.
    Bulk import is a management task; officers add leads one at a time instead."""
    try:
        rows = parse_rows(file.file.read(), COMPANY_COLUMNS)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    created = 0
    skipped = 0
    errors: list[dict] = []
    seen_names: set[str] = set()

    for entry in rows:
        if entry["errors"]:
            errors.append({"row": entry["row"], "errors": entry["errors"]})
            continue
        data = entry["data"]
        name_key = data["name"].lower()
        existing = (
            db.query(Company)
            .filter(Company.name == data["name"], Company.college_id == current_user.college_id)
            .first()
        )
        if name_key in seen_names or existing:
            skipped += 1
            continue
        seen_names.add(name_key)
        db.add(Company(**data, college_id=current_user.college_id))
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/{company_id}", response_model=CompanyOut)
def get_company(company_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    # Placement officers may only open companies allocated to them.
    if current_user.role == UserRole.PLACEMENT_OFFICER and company.id not in _officer_company_ids(db, current_user):
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _get_reviewable_company(company_id: int, db: Session, current_user: User) -> Company:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company or (current_user.college_id and company.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.post("/{company_id}/approve", response_model=CompanyOut)
def approve_company(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Approve an officer-sourced lead so it becomes an official company."""
    company = _get_reviewable_company(company_id, db, current_user)
    company.review_status = "approved"
    db.commit()
    db.refresh(company)
    return company


@router.post("/{company_id}/decline", response_model=CompanyOut)
def decline_company(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Decline an officer-sourced lead. Allocations are removed so the officer can
    no longer work on it; the record is kept for the head's reference."""
    company = _get_reviewable_company(company_id, db, current_user)
    company.review_status = "declined"
    db.query(CompanyAssignment).filter(CompanyAssignment.company_id == company.id).delete()
    db.commit()
    db.refresh(company)
    return company


@router.put("/{company_id}", response_model=CompanyOut)
def update_company(
    company_id: int, payload: CompanyUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    data = payload.model_dump(exclude_none=True)
    # Company status is a management decision; officers can't change it.
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        data.pop("status", None)
    for field, value in data.items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()


@router.post("/{company_id}/generate-profile", response_model=CompanyOut)
async def generate_ai_profile(company_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    profile = await generate_company_profile(company)
    company.ai_profile = profile
    db.commit()
    db.refresh(company)
    return company


@router.get("/{company_id}/hr-contacts", response_model=list[HRContactOut])
def list_hr_contacts(company_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(HRContact).filter(HRContact.company_id == company_id).all()


@router.post("/{company_id}/hr-contacts", response_model=HRContactOut, status_code=201)
def add_hr_contact(
    company_id: int, payload: HRContactBase, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    if not db.query(Company).filter(Company.id == company_id).first():
        raise HTTPException(status_code=404, detail="Company not found")
    contact = HRContact(**payload.model_dump(), company_id=company_id)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.post("/{company_id}/hr-contacts/{hr_id}/draft-email", response_model=DraftEmailResponse)
async def draft_hr_contact_email(
    company_id: int,
    hr_id: int,
    payload: DraftEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    contact = (
        db.query(HRContact)
        .filter(HRContact.id == hr_id, HRContact.company_id == company_id)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="HR contact not found")
    email = await draft_hr_email(company.name, contact.name, payload.purpose, current_user.full_name)
    return {"email": email}


@router.post("/{company_id}/interview-questions", response_model=InterviewQuestionsResponse)
async def company_interview_questions(
    company_id: int,
    payload: InterviewQuestionsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    questions = await generate_interview_questions(payload.job_role, company.name, company.domain or "N/A")
    return {"questions": questions}


@router.post("/{company_id}/exam-questions", response_model=ExamQuestionsResponse)
async def company_exam_questions(
    company_id: int,
    payload: ExamQuestionsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    questions = await generate_exam_questions(payload.job_role, company.name, company.domain or "N/A")
    return {"questions": questions}
