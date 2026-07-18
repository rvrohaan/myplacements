from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.student import Student
from app.models.training import StudentTraining, TrainingModule
from app.models.user import User, UserRole
from app.schemas.training import (
    ModuleCreate,
    ModuleOut,
    ModuleUpdate,
    TrainingRecordCreate,
    TrainingRecordOut,
    TrainingRecordUpdate,
)

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
