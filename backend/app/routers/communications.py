from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.user import User
from app.schemas.communication import (
    CommunicationCreate,
    CommunicationOut,
    CommunicationUpdate,
)

router = APIRouter(prefix="/communications", tags=["communications"])


def _serialize(comm: Communication, db: Session) -> CommunicationOut:
    out = CommunicationOut.model_validate(comm)
    if comm.company:
        out.company_name = comm.company.name
    if comm.hr_contact_id:
        contact = db.query(HRContact).filter(HRContact.id == comm.hr_contact_id).first()
        if contact:
            out.hr_contact_name = contact.name
    return out


def _scoped(db: Session, current_user: User):
    q = db.query(Communication)
    if current_user.college_id:
        q = q.filter(Communication.college_id == current_user.college_id)
    return q


@router.get("", response_model=list[CommunicationOut])
def list_communications(
    company_id: Optional[int] = None,
    hr_contact_id: Optional[int] = None,
    comm_type: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(default=100, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = _scoped(db, current_user)
    if company_id:
        q = q.filter(Communication.company_id == company_id)
    if hr_contact_id:
        q = q.filter(Communication.hr_contact_id == hr_contact_id)
    if comm_type:
        q = q.filter(Communication.comm_type == comm_type)
    rows = q.order_by(Communication.communicated_at.desc()).offset(skip).limit(limit).all()
    return [_serialize(c, db) for c in rows]


@router.get("/followups", response_model=list[CommunicationOut])
def pending_followups(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Communications with a scheduled follow-up where no response has come in yet,
    soonest first. Drives the reminders / pending-reply panel."""
    q = _scoped(db, current_user).filter(
        Communication.next_followup_date.isnot(None),
        (Communication.response_received.is_(None))
        | (Communication.response_received != "received"),
    )
    rows = q.order_by(Communication.next_followup_date.asc()).all()
    return [_serialize(c, db) for c in rows]


@router.post("", response_model=CommunicationOut, status_code=201)
def log_communication(
    payload: CommunicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    company = db.query(Company).filter(Company.id == payload.company_id).first()
    if not company or (current_user.college_id and company.college_id != current_user.college_id):
        raise HTTPException(status_code=404, detail="Company not found")
    data = payload.model_dump(exclude_none=True)
    comm = Communication(**data, college_id=current_user.college_id)
    db.add(comm)

    # Keep the HR contact's last-contacted / next-follow-up in sync so the
    # Company view and HR analytics stay accurate.
    if payload.hr_contact_id:
        contact = db.query(HRContact).filter(HRContact.id == payload.hr_contact_id).first()
        if contact:
            contact.last_contacted_at = comm.communicated_at or datetime.utcnow()
            if payload.next_followup_date:
                contact.next_followup_date = payload.next_followup_date

    db.commit()
    db.refresh(comm)
    return _serialize(comm, db)


def _get(comm_id: int, db: Session, current_user: User) -> Communication:
    comm = _scoped(db, current_user).filter(Communication.id == comm_id).first()
    if not comm:
        raise HTTPException(status_code=404, detail="Communication not found")
    return comm


@router.put("/{comm_id}", response_model=CommunicationOut)
def update_communication(
    comm_id: int,
    payload: CommunicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comm = _get(comm_id, db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(comm, field, value)
    db.commit()
    db.refresh(comm)
    return _serialize(comm, db)


@router.delete("/{comm_id}", status_code=204)
def delete_communication(
    comm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comm = _get(comm_id, db, current_user)
    db.delete(comm)
    db.commit()
