from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User, UserRole
from app.schemas.communication import (
    CommunicationCreate,
    CommunicationOut,
    CommunicationUpdate,
)

router = APIRouter(prefix="/communications", tags=["communications"])

# Leadership: sees every log in the college and may correct or remove any of them.
HEAD_ROLES = (
    UserRole.SUPER_ADMIN,
    UserRole.PRINCIPAL,
    UserRole.PRO_CHANCELLOR,
    UserRole.DEPUTY_PRO_CHANCELLOR,
)


def _officer_profile(db: Session, user: User) -> Optional[PlacementOfficer]:
    return db.query(PlacementOfficer).filter(PlacementOfficer.user_id == user.id).first()


def _officer_company_ids(db: Session, officer: PlacementOfficer) -> list[int]:
    rows = (
        db.query(CompanyAssignment.company_id)
        .filter(CompanyAssignment.officer_id == officer.id)
        .all()
    )
    return [r[0] for r in rows]


def _can_edit(comm: Communication, current_user: User) -> bool:
    """Authors edit their own log; leadership may correct or remove any of them."""
    return current_user.role in HEAD_ROLES or comm.logged_by_id == current_user.id


def _serialize(comm: Communication, db: Session, current_user: User) -> CommunicationOut:
    out = CommunicationOut.model_validate(comm)
    if comm.company:
        out.company_name = comm.company.name
    if comm.hr_contact_id:
        contact = db.query(HRContact).filter(HRContact.id == comm.hr_contact_id).first()
        if contact:
            out.hr_contact_name = contact.name
    if comm.logged_by:
        out.logged_by_name = comm.logged_by.full_name
        out.logged_by_role = comm.logged_by.role.value if comm.logged_by.role else None
    if comm.officer and comm.officer.user:
        out.officer_name = comm.officer.user.full_name
    out.can_edit = _can_edit(comm, current_user)
    return out


def _scoped(db: Session, current_user: User):
    """The communications this user is allowed to see.

    Leadership sees the whole college. A placement officer sees only their own
    outreach -- one officer's log is never visible to another -- plus unattributed
    logs on companies allocated to them, so a head's call on their company still
    shows as context and nobody calls the same HR twice.
    """
    q = db.query(Communication)
    if current_user.college_id:
        q = q.filter(Communication.college_id == current_user.college_id)
    if current_user.role == UserRole.PLACEMENT_OFFICER:
        clauses = [Communication.logged_by_id == current_user.id]
        officer = _officer_profile(db, current_user)
        if officer:
            clauses.append(Communication.officer_id == officer.id)
            company_ids = _officer_company_ids(db, officer)
            if company_ids:
                clauses.append(
                    (Communication.officer_id.is_(None))
                    & (Communication.company_id.in_(company_ids))
                )
        q = q.filter(or_(*clauses))
    return q


@router.get("", response_model=list[CommunicationOut])
def list_communications(
    company_id: Optional[int] = None,
    hr_contact_id: Optional[int] = None,
    comm_type: Optional[str] = None,
    officer_id: Optional[int] = None,
    logged_by_id: Optional[int] = None,
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
    # "What has officer X been doing?" -- the head's view of the timeline.
    if officer_id:
        q = q.filter(Communication.officer_id == officer_id)
    if logged_by_id:
        q = q.filter(Communication.logged_by_id == logged_by_id)
    rows = q.order_by(Communication.communicated_at.desc()).offset(skip).limit(limit).all()
    return [_serialize(c, db, current_user) for c in rows]


@router.get("/followups", response_model=list[CommunicationOut])
def pending_followups(
    officer_id: Optional[int] = None,
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
    if officer_id:
        q = q.filter(Communication.officer_id == officer_id)
    rows = q.order_by(Communication.next_followup_date.asc()).all()
    return [_serialize(c, db, current_user) for c in rows]


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

    # Stamp the author from the session. When an officer logs it the outreach
    # also counts towards their targets; a head's own log counts towards nobody,
    # so it can't inflate the officer whose company it was logged against.
    officer = _officer_profile(db, current_user)
    comm = Communication(
        **data,
        college_id=current_user.college_id,
        logged_by_id=current_user.id,
        officer_id=officer.id if officer else None,
        officer_attribution="recorded" if officer else None,
    )
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
    return _serialize(comm, db, current_user)


def _get(comm_id: int, db: Session, current_user: User) -> Communication:
    comm = _scoped(db, current_user).filter(Communication.id == comm_id).first()
    if not comm:
        raise HTTPException(status_code=404, detail="Communication not found")
    return comm


def _get_for_write(comm_id: int, db: Session, current_user: User) -> Communication:
    """A log is only editable by its author or a placement head -- an officer
    can't quietly amend or delete somebody else's entry."""
    comm = _get(comm_id, db, current_user)
    if not _can_edit(comm, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only the person who logged this, or a placement head, can change it",
        )
    return comm


@router.put("/{comm_id}", response_model=CommunicationOut)
def update_communication(
    comm_id: int,
    payload: CommunicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comm = _get_for_write(comm_id, db, current_user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(comm, field, value)
    db.commit()
    db.refresh(comm)
    return _serialize(comm, db, current_user)


@router.delete("/{comm_id}", status_code=204)
def delete_communication(
    comm_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comm = _get_for_write(comm_id, db, current_user)
    db.delete(comm)
    db.commit()
