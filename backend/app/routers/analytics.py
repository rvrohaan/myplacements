from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.company import Company, CompanyStatus
from app.models.drive import Drive, DriveParticipant, ParticipantStatus
from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, Student
from app.models.user import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _college_filter(q, model, college_id):
    if college_id:
        q = q.filter(model.college_id == college_id)
    return q


@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cid = current_user.college_id

    total_students = _college_filter(db.query(func.count(Student.id)), Student, cid).scalar()
    placed = _college_filter(db.query(func.count(Student.id)), Student, cid).filter(Student.placement_status == PlacementStatus.PLACED).scalar()
    total_companies = _college_filter(db.query(func.count(Company.id)), Company, cid).scalar()
    active_companies = _college_filter(db.query(func.count(Company.id)), Company, cid).filter(Company.status == CompanyStatus.ACTIVE).scalar()
    total_drives = _college_filter(db.query(func.count(Drive.id)), Drive, cid).scalar()
    total_offers = _college_filter(
        db.query(func.count(Offer.id)).join(Student, Offer.student_id == Student.id), Student, cid
    ).scalar()
    accepted_offers = (
        _college_filter(
            db.query(func.count(Offer.id)).join(Student, Offer.student_id == Student.id), Student, cid
        )
        .filter(Offer.status == OfferStatus.ACCEPTED)
        .scalar()
    )
    avg_ctc = (
        _college_filter(db.query(func.avg(Student.placement_ctc)), Student, cid)
        .filter(
            Student.placement_status == PlacementStatus.PLACED,
            Student.placement_ctc.isnot(None),
        )
        .scalar()
    )

    return {
        "students": {
            "total": total_students,
            "placed": placed,
            "placement_rate": round((placed / total_students * 100) if total_students else 0, 1),
        },
        "companies": {
            "total": total_companies,
            "active": active_companies,
        },
        "drives": {
            "total": total_drives,
        },
        "offers": {
            "total": total_offers,
            "accepted": accepted_offers,
            "avg_ctc": round(float(avg_ctc), 2) if avg_ctc else 0,
        },
    }


@router.get("/branch-wise")
def get_branch_wise(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(
        Student.branch,
        func.count(Student.id),
        func.sum(case((Student.placement_status == PlacementStatus.PLACED, 1), else_=0)),
    ).group_by(Student.branch)
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    rows = q.all()
    return [{"branch": r[0], "total": r[1], "placed": int(r[2] or 0)} for r in rows]


@router.get("/ctc-distribution")
def get_ctc_distribution(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        _college_filter(db.query(Student.placement_ctc), Student, current_user.college_id)
        .filter(
            Student.placement_status == PlacementStatus.PLACED,
            Student.placement_ctc.isnot(None),
        )
        .all()
    )
    ctc_values = [r[0] for r in rows]
    if not ctc_values:
        return {"distribution": [], "min": 0, "max": 0, "avg": 0, "median": 0}

    ctc_values.sort()
    n = len(ctc_values)
    median = ctc_values[n // 2] if n % 2 else (ctc_values[n // 2 - 1] + ctc_values[n // 2]) / 2

    buckets: dict = {}
    for v in ctc_values:
        bucket = f"{int(v // 5) * 5}-{int(v // 5) * 5 + 5} LPA"
        buckets[bucket] = buckets.get(bucket, 0) + 1

    return {
        "distribution": [{"range": k, "count": v} for k, v in sorted(buckets.items())],
        "min": min(ctc_values),
        "max": max(ctc_values),
        "avg": round(sum(ctc_values) / n, 2),
        "median": round(median, 2),
    }


@router.get("/drive-funnel/{drive_id}")
def get_drive_funnel(drive_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    counts = {}
    for status in ParticipantStatus:
        counts[status.value] = (
            db.query(func.count(DriveParticipant.id))
            .filter(DriveParticipant.drive_id == drive_id, DriveParticipant.status == status)
            .scalar()
        )
    return counts
