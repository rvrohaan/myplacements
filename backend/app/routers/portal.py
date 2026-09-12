"""Student-facing portal API. Everything here is scoped to the signed-in
student (``get_current_student``) — students only ever see their own data and
read-only, college-scoped company/drive info."""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_student
from app.models.company import Company
from app.models.drive import Drive, DriveParticipant, DriveStatus
from app.models.student import Student
from app.schemas.student import StudentOut
from app.services.ai_service import (
    generate_exam_questions,
    generate_interview_prep,
    generate_student_gap_report,
    review_resume,
)

from app.services import notify

router = APIRouter(prefix="/portal", tags=["portal"])


class InterviewPrepRequest(BaseModel):
    job_role: str
    company_id: Optional[int] = None


class ExamPrepRequest(BaseModel):
    # No role -> the company's general screening exam (e.g. TCS NQT style).
    job_role: Optional[str] = None
    company_id: Optional[int] = None


@router.get("/me", response_model=StudentOut)
def my_profile(student: Student = Depends(get_current_student)):
    return student


@router.post("/me/gap-report")
async def my_gap_report(
    company_id: Optional[int] = None,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    report = await generate_student_gap_report(student, company_id, db)
    return {"report": report}


@router.post("/me/resume-review")
async def my_resume_review(student: Student = Depends(get_current_student)):
    review = await review_resume(student)
    return {"review": review}


@router.post("/me/resume", response_model=StudentOut)
def upload_resume(
    file: UploadFile = File(...),
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Upload/replace the student's resume (PDF). Stored under /api/uploads/resumes
    with a random filename; the served path is saved to the student's resume_url."""
    if (file.content_type or "") != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Resume must be a PDF file")

    contents = file.file.read()
    if len(contents) > settings.MAX_RESUME_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Resume must be under {settings.MAX_RESUME_MB} MB")

    resume_dir = os.path.join(settings.UPLOAD_DIR, "resumes")
    os.makedirs(resume_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    with open(os.path.join(resume_dir, filename), "wb") as out:
        out.write(contents)

    student.resume_url = f"/api/uploads/resumes/{filename}"
    db.commit()
    db.refresh(student)
    return student


@router.post("/me/interview-prep")
async def my_interview_prep(
    payload: InterviewPrepRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    company_name = "various companies"
    domain = "N/A"
    if payload.company_id:
        company = (
            db.query(Company)
            .filter(Company.id == payload.company_id, Company.college_id == student.college_id)
            .first()
        )
        if company:
            company_name = company.name
            domain = company.domain or "N/A"
    questions = await generate_interview_prep(payload.job_role, company_name, domain)
    return {"questions": questions}


@router.post("/me/exam-prep")
async def my_exam_prep(
    payload: ExamPrepRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Mock screening-exam MCQs (aptitude + technical) for the test rounds
    held before interviews. Same request shape as interview prep."""
    company_name = "various companies"
    domain = "N/A"
    if payload.company_id:
        company = (
            db.query(Company)
            .filter(Company.id == payload.company_id, Company.college_id == student.college_id)
            .first()
        )
        if company:
            company_name = company.name
            domain = company.domain or "N/A"
    questions = await generate_exam_questions(payload.job_role, company_name, domain)
    return {"questions": questions}


@router.get("/companies")
def my_companies(
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Minimal company list for the practice picker, scoped to the college."""
    companies = (
        db.query(Company)
        .filter(Company.college_id == student.college_id)
        .order_by(Company.name)
        .all()
    )
    return [{"id": c.id, "name": c.name, "domain": c.domain} for c in companies]


def _is_eligible(drive: Drive, student: Student) -> bool:
    if drive.min_cgpa is not None and (student.cgpa or 0) < drive.min_cgpa:
        return False
    if drive.max_backlogs is not None and student.backlogs > drive.max_backlogs:
        return False
    if drive.eligible_branches:
        branches = [b.strip().lower() for b in drive.eligible_branches.split(",") if b.strip()]
        if branches and student.branch.lower() not in branches:
            return False
    return True


@router.get("/me/drives")
def my_drives(
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Upcoming drives at the student's college they're eligible for, with an
    ``applied`` flag so the UI can show whether they've already registered."""
    drives = (
        db.query(Drive)
        .join(Company, Drive.company_id == Company.id)
        .filter(
            Company.college_id == student.college_id,
            Drive.status == DriveStatus.UPCOMING,
        )
        .order_by(Drive.drive_date)
        .all()
    )
    applied_ids = {
        p.drive_id
        for p in db.query(DriveParticipant).filter(DriveParticipant.student_id == student.id).all()
    }
    out = []
    for d in drives:
        if not _is_eligible(d, student):
            continue
        out.append(
            {
                "id": d.id,
                "company_id": d.company_id,
                "company_name": d.company.name if d.company else None,
                "job_role": d.job_role,
                "drive_date": d.drive_date,
                "mode": d.mode,
                "ctc_offered": d.ctc_offered,
                "location": d.location,
                "min_cgpa": d.min_cgpa,
                "eligible_branches": d.eligible_branches,
                "registration_deadline": d.registration_deadline,
                "applied": d.id in applied_ids,
            }
        )
    return out


@router.post("/me/drives/{drive_id}/apply", status_code=201)
def apply_to_drive(
    drive_id: int,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Self-register for an eligible, upcoming drive at the student's college."""
    drive = (
        db.query(Drive)
        .join(Company, Drive.company_id == Company.id)
        .filter(Drive.id == drive_id, Company.college_id == student.college_id)
        .first()
    )
    if not drive:
        raise HTTPException(status_code=404, detail="Drive not found")
    if drive.status != DriveStatus.UPCOMING:
        raise HTTPException(status_code=400, detail="Registration is closed for this drive")
    if not _is_eligible(drive, student):
        raise HTTPException(status_code=403, detail="You are not eligible for this drive")
    if not student.resume_url:
        raise HTTPException(status_code=400, detail="Add your resume before applying")
    existing = (
        db.query(DriveParticipant)
        .filter(DriveParticipant.drive_id == drive_id, DriveParticipant.student_id == student.id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Already registered for this drive")
    # Snapshot the resume sent with this application, so it's preserved even if the
    # student later updates their profile resume.
    participant = DriveParticipant(drive_id=drive_id, student_id=student.id, resume_url=student.resume_url)
    db.add(participant)
    # Tell the staff side. No actor: the student is not a staff recipient, and a
    # busy drive coalesces these into a single "N new applications" row.
    notify.drive_application(db, drive=drive, student_name=student.full_name)
    db.commit()
    return {"status": "registered", "drive_id": drive_id}
