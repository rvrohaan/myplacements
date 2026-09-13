"""Per-company engagement and conversion figures.

Shared deliberately: the Company Analytics tab and the Company Conversion report
answer the same question in two presentations, and two copies of "what counts as
contacted" would drift apart the first time either was tuned.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.communication import Communication
from app.models.company import Company, CompanyStatus, HRContact
from app.models.drive import Drive
from app.models.offer import Offer
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.student import Student
from app.models.user import User
from app.services.hr_engagement import RESPONDED, score_many

# Offer states that mean a student actually landed the job. Mirrors
# analytics.WON_OFFER_STATUSES.
from app.routers.analytics import STALE_AFTER_DAYS, WON_OFFER_STATUSES
from app.routers.companies import _STATUS_ORDER as STATUS_ATTENTION_ORDER


@dataclass
class CompanyRow:
    id: int
    name: str
    status: str
    owner: str
    logged: int = 0
    replied: int = 0
    drives: int = 0
    offers: int = 0
    placed: set = field(default_factory=set)
    packages: list = field(default_factory=list)
    last_contact: Optional[datetime] = None
    contacts: int = 0

    @property
    def reply_rate(self) -> Optional[float]:
        return round(self.replied * 100 / self.logged, 1) if self.logged else None

    @property
    def days_since_contact(self) -> Optional[int]:
        if self.last_contact is None:
            return None
        return max(0, (datetime.utcnow() - self.last_contact).days)

    @property
    def stale(self) -> bool:
        """No logged contact inside the window — the same threshold the officer
        dashboard uses to call a company stale."""
        return self.days_since_contact is None or self.days_since_contact > STALE_AFTER_DAYS


def company_rows(db: Session, user: User) -> list[CompanyRow]:
    """Every company the caller can see, with its outreach, drives and outcomes."""
    companies_q = db.query(Company)
    if user.college_id:
        companies_q = companies_q.filter(Company.college_id == user.college_id)
    companies = companies_q.all()
    company_ids = [c.id for c in companies]
    if not company_ids:
        return []

    owner_rows = (
        db.query(CompanyAssignment.company_id, User.full_name)
        .join(PlacementOfficer, CompanyAssignment.officer_id == PlacementOfficer.id)
        .outerjoin(User, PlacementOfficer.user_id == User.id)
        .filter(CompanyAssignment.company_id.in_(company_ids))
        .all()
    )
    owner = {r[0]: (r[1] or "—") for r in owner_rows}

    rows = {
        c.id: CompanyRow(
            id=c.id,
            name=c.name,
            status=c.status.value if c.status else "—",
            owner=owner.get(c.id, "Unassigned"),
        )
        for c in companies
    }

    for company_id, when, response in db.query(
        Communication.company_id, Communication.communicated_at, Communication.response_received
    ).filter(Communication.company_id.in_(company_ids)).all():
        row = rows.get(company_id)
        if row is None:
            continue
        row.logged += 1
        if (response or "") == RESPONDED:
            row.replied += 1
        if when and (row.last_contact is None or when > row.last_contact):
            row.last_contact = when

    drives = db.query(Drive.id, Drive.company_id).filter(Drive.company_id.in_(company_ids)).all()
    drive_company = {d.id: d.company_id for d in drives}
    for d in drives:
        if d.company_id in rows:
            rows[d.company_id].drives += 1

    offers = (
        db.query(Offer.company_id, Offer.drive_id, Offer.status, Offer.student_id, Offer.ctc)
        .filter(or_(Offer.company_id.in_(company_ids),
                    Offer.drive_id.in_(list(drive_company.keys()) or [0])))
        .all()
    )
    for o in offers:
        cid = o.company_id or drive_company.get(o.drive_id)
        row = rows.get(cid)
        if row is None:
            continue
        row.offers += 1
        if o.status in WON_OFFER_STATUSES:
            row.placed.add(o.student_id)
            if o.ctc is not None:
                row.packages.append(o.ctc)

    for (company_id,) in db.query(HRContact.company_id).filter(
        HRContact.company_id.in_(company_ids)
    ).all():
        if company_id in rows:
            rows[company_id].contacts += 1

    return list(rows.values())


def funnel(rows: list[CompanyRow]) -> list[tuple[str, int]]:
    """Each stage a strict subset of the one above it, so it reads as a funnel
    rather than four counts drawn side by side."""
    return [
        ("Companies on file", len(rows)),
        ("Contacted at least once", sum(1 for r in rows if r.logged)),
        ("Ran a drive", sum(1 for r in rows if r.drives)),
        ("Made an offer", sum(1 for r in rows if r.offers)),
        ("Placed at least one student", sum(1 for r in rows if r.placed)),
    ]


def status_mix(rows: list[CompanyRow]) -> list[tuple[str, int]]:
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r.status] += 1
    # Fixed order, so the chart doesn't reshuffle when a count changes — and the
    # same attention order companies._STATUS_ORDER sorts the Companies list by,
    # rather than the order the enum members happen to be declared in.
    order = [s.value for s in STATUS_ATTENTION_ORDER]
    return [(s, counts.get(s, 0)) for s in order if counts.get(s, 0)]


def engagement_by_company(db: Session, user: User) -> dict[int, dict]:
    """Average engagement band per company, from its HR contacts' scores.

    Built on the same scorer the HR directory uses, so a company's engagement
    can never disagree with the contacts it is made of.
    """
    contacts_q = db.query(HRContact.id, HRContact.company_id).join(
        Company, HRContact.company_id == Company.id
    )
    if user.college_id:
        contacts_q = contacts_q.filter(Company.college_id == user.college_id)
    pairs = contacts_q.all()
    if not pairs:
        return {}
    contact_company = {cid: company_id for cid, company_id in pairs}

    comms = (
        db.query(Communication)
        .filter(Communication.hr_contact_id.in_(list(contact_company.keys())))
        .all()
    )
    by_contact: dict[int, list] = defaultdict(list)
    for c in comms:
        by_contact[c.hr_contact_id].append(c)

    scores = score_many(dict(by_contact))
    per_company: dict[int, list[int]] = defaultdict(list)
    for contact_id, result in scores.items():
        company_id = contact_company.get(contact_id)
        if company_id is not None and result:
            per_company[company_id].append(result["score"])

    return {
        company_id: {
            "score": round(sum(vals) / len(vals)),
            "contacts_scored": len(vals),
        }
        for company_id, vals in per_company.items()
    }
