import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.student import Student
from app.models.training import StudentTraining, TrainingModule
from app.models.user import User, UserRole
from app.schemas.training import (
    AttendanceImportResult,
    ModuleCreate,
    ModuleOut,
    ModuleUpdate,
    TrainingRecordCreate,
    TrainingRecordOut,
    TrainingRecordUpdate,
)
from app.services import skills
from app.services.excel_io import XLSX_MEDIA_TYPE
from app.services.training_roster import TEMPLATE_HEADERS, extract_attendance

router = APIRouter(prefix="/training", tags=["training"])

MANAGE_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.PRINCIPAL,
    UserRole.PRO_CHANCELLOR,
    UserRole.DEPUTY_PRO_CHANCELLOR,
    UserRole.DEPARTMENT_COORDINATOR,
)


def _serialize_module(module: TrainingModule) -> ModuleOut:
    out = ModuleOut.model_validate(module)
    records = module.student_records
    out.enrolled_count = len(records)
    out.completed_count = sum(1 for r in records if r.status == "completed")
    scores = [r.score for r in records if r.score is not None]
    attendance = [r.attendance_percent for r in records if r.attendance_percent is not None]
    out.avg_score = round(sum(scores) / len(scores), 1) if scores else None
    out.avg_attendance = round(sum(attendance) / len(attendance), 1) if attendance else None
    return out


def _get_module(module_id: int, db: Session, current_user: User) -> TrainingModule:
    module = db.query(TrainingModule).filter(TrainingModule.id == module_id).first()
    if not module or (current_user.college_id and module.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Training module not found")
    return module


@router.get("/modules", response_model=list[ModuleOut])
def list_modules(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TrainingModule)
    if current_user.college_id:
        q = q.filter(TrainingModule.college_id == current_user.college_id)
    if category:
        q = q.filter(TrainingModule.category == category)
    return [_serialize_module(m) for m in q.order_by(TrainingModule.created_at.desc()).all()]


@router.post("/modules", response_model=ModuleOut, status_code=201)
def create_module(
    payload: ModuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    module = TrainingModule(**payload.model_dump(), college_id=current_user.college_id)
    db.add(module)
    db.commit()
    db.refresh(module)
    return _serialize_module(module)


@router.get("/modules/{module_id}", response_model=ModuleOut)
def get_module(module_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _serialize_module(_get_module(module_id, db, current_user))


@router.put("/modules/{module_id}", response_model=ModuleOut)
def update_module(
    module_id: int,
    payload: ModuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    module = _get_module(module_id, db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(module, field, value)
    db.commit()
    db.refresh(module)
    return _serialize_module(module)


@router.delete("/modules/{module_id}", status_code=204)
def delete_module(
    module_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    module = _get_module(module_id, db, current_user)
    db.delete(module)
    db.commit()


def _serialize_record(record: StudentTraining) -> TrainingRecordOut:
    out = TrainingRecordOut.model_validate(record)
    if record.student:
        out.student_name = record.student.full_name
        out.roll_number = record.student.roll_number
        out.branch = record.student.branch
    return out


@router.get("/modules/{module_id}/students", response_model=list[TrainingRecordOut])
def list_module_students(
    module_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_module(module_id, db, current_user)
    records = (
        db.query(StudentTraining)
        .filter(StudentTraining.module_id == module_id)
        .order_by(StudentTraining.created_at.desc())
        .all()
    )
    return [_serialize_record(r) for r in records]


@router.post("/modules/{module_id}/students", response_model=TrainingRecordOut, status_code=201)
def enroll_student(
    module_id: int,
    payload: TrainingRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    _get_module(module_id, db, current_user)
    student = db.query(Student).filter(Student.id == payload.student_id).first()
    if not student or (current_user.college_id and student.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Student not found")
    existing = (
        db.query(StudentTraining)
        .filter(StudentTraining.module_id == module_id, StudentTraining.student_id == payload.student_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Student already enrolled in this module")
    record = StudentTraining(module_id=module_id, student_id=payload.student_id)
    db.add(record)
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.put("/records/{record_id}", response_model=TrainingRecordOut)
def update_record(
    record_id: int,
    payload: TrainingRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    record = db.query(StudentTraining).filter(StudentTraining.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Training record not found")
    _get_module(record.module_id, db, current_user)  # enforce tenant boundary via the module
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(record, field, value)
    if data.get("status") == "completed" and record.completed_at is None:
        record.completed_at = datetime.utcnow()
    # Completing a module grants the skills it teaches, and un-completing it
    # withdraws them: sync_training_skills recomputes from what is completed
    # now rather than appending, so "status" is the only thing to set here.
    if "status" in data:
        student = db.query(Student).filter(Student.id == record.student_id).first()
        if student:
            skills.sync_training_skills(db, student)
    db.commit()
    db.refresh(record)
    return _serialize_record(record)


@router.delete("/records/{record_id}", status_code=204)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    record = db.query(StudentTraining).filter(StudentTraining.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Training record not found")
    _get_module(record.module_id, db, current_user)
    db.delete(record)
    db.commit()


# --- attendance import -------------------------------------------------------


def _sheet_response(headers: list[str], rows: list[list], filename: str, title: str):
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws.append(headers)
    for row in rows:
        ws.append(row)
    for i, header in enumerate(headers, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = max(14, len(header) + 2)
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/attendance-template")
def attendance_template(_: User = Depends(get_current_user)):
    """A blank sheet with the headers the importer recognises."""
    return _sheet_response(TEMPLATE_HEADERS, [], "training_attendance_template.xlsx", "Attendance")


@router.post("/modules/{module_id}/import", response_model=AttendanceImportResult)
async def import_attendance(
    module_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*MANAGE_ROLES)),
):
    """Enrol (or update) a whole attendance sheet at once.

    Matching is by roll number within the caller's college, case-insensitively —
    the one identifier a trainer's sheet reliably carries. A student already on
    the module is updated rather than rejected, so the same sheet can be
    re-uploaded after marks are added without anyone having to remember who was
    already on it.

    Every row comes back with what happened to it, including the ones that
    matched nobody: an import that silently drops half a batch is worse than one
    that fails.
    """
    module = _get_module(module_id, db, current_user)
    raw = await file.read()
    try:
        rows = extract_attendance(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not rows:
        raise HTTPException(status_code=400, detail="No rows with a roll number in that sheet.")

    students_q = db.query(Student)
    if current_user.college_id:
        students_q = students_q.filter(Student.college_id == current_user.college_id)
    by_roll = {s.roll_number.strip().lower(): s for s in students_q.all() if s.roll_number}

    existing = {
        r.student_id: r
        for r in db.query(StudentTraining).filter(StudentTraining.module_id == module_id).all()
    }

    results = []
    enrolled = updated = unmatched = 0
    for row in rows:
        student = by_roll.get(row["roll_number"].strip().lower())
        if student is None:
            unmatched += 1
            results.append({
                **row, "matched": False, "action": None, "student_id": None,
                "note": "No student with that roll number in this college",
            })
            continue

        record = existing.get(student.id)
        action = "unchanged"
        if record is None:
            record = StudentTraining(module_id=module_id, student_id=student.id)
            db.add(record)
            existing[student.id] = record
            action = "enrolled"
            enrolled += 1

        # Only overwrite what the sheet actually carries. A blank cell is "no
        # figure supplied", not zero, and must not wipe a mark already recorded.
        changed = False
        for field, key in (("attendance_percent", "attendance_percent"),
                           ("score", "score"),
                           ("mock_test_score", "mock_test_score")):
            if row[key] is not None and getattr(record, field) != row[key]:
                setattr(record, field, row[key])
                changed = True
        if row["status"] and record.status != row["status"]:
            record.status = row["status"]
            if row["status"] == "completed" and record.completed_at is None:
                record.completed_at = datetime.utcnow()
            # Same rule as the single-record path: what the student completed
            # decides which skills training backs for them.
            skills.sync_training_skills(db, student)
            changed = True

        if changed and action == "unchanged":
            action = "updated"
            updated += 1
        results.append({
            **row, "matched": True, "action": action, "student_id": student.id, "note": None,
        })

    db.commit()
    return {
        "module_id": module.id,
        "rows": len(rows),
        "enrolled": enrolled,
        "updated": updated,
        "unmatched": unmatched,
        # Kept in the response shape for parity with the drives roster upload,
        # which does fall back to a model. This importer never does.
        "used_ai": False,
        "results": results,
    }


@router.get("/modules/{module_id}/export")
def export_module(
    module_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This module's roster as .xlsx — the same columns the importer reads, so a
    trainer can be sent the current list, fill in the marks and send it back."""
    module = _get_module(module_id, db, current_user)
    records = (
        db.query(StudentTraining, Student)
        .join(Student, StudentTraining.student_id == Student.id)
        .filter(StudentTraining.module_id == module_id)
        .all()
    )
    rows = [
        [s.roll_number, s.full_name, r.attendance_percent, r.score, r.mock_test_score, r.status]
        for r, s in sorted(records, key=lambda pair: (pair[1].roll_number or ""))
    ]
    safe = "".join(c for c in module.name if c.isalnum() or c in " -_").strip().replace(" ", "_")
    return _sheet_response(TEMPLATE_HEADERS, rows, f"{safe or 'module'}_roster.xlsx", "Attendance")
