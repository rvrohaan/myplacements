"""Who is owed an HR follow-up, and by when.

One rule, used by the reminder tick. It matches what the rest of the app already
says is owed:

* A follow-up whose contact has **already replied** is not owed, however old the
  date on it — the same rule `report_defs.officer_followup` applies.
* A follow-up that came due **yesterday** is still owed. The reminder that only
  fires on the exact due date is the one that misses everything an officer was
  on leave for.

The unit is the **obligation**, not the row. Logging a communication syncs the
contact's ``next_followup_date`` (see routers/communications.py), so the same
promise exists in two tables; counting both would tell an officer they owe twice
what they do. A contact keyed obligation absorbs the communications behind it.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User
from app.core.timeutil import overdue_before
from app.services.hr_engagement import RESPONDED


@dataclass
class Owed:
    """What one person owes, as of the run."""

    user_id: int
    due_today: int = 0
    overdue: int = 0
    #: How long the oldest unanswered follow-up has been waiting, in days.
    oldest_overdue_days: Optional[int] = None
    companies: set = field(default_factory=set)

    @property
    def total(self) -> int:
        return self.due_today + self.overdue


def _owner_by_company(db: Session, college_id: Optional[int]) -> dict[int, int]:
    """company id -> the user id of the officer it is allocated to."""
    q = (
        db.query(CompanyAssignment.company_id, PlacementOfficer.user_id)
        .join(PlacementOfficer, CompanyAssignment.officer_id == PlacementOfficer.id)
    )
    if college_id:
        q = q.filter(PlacementOfficer.college_id == college_id)
    return {company_id: user_id for company_id, user_id in q.all() if user_id}


def owed_followups(
    db: Session,
    college_id: Optional[int],
    day: Optional[date] = None,
    now: Optional[datetime] = None,
) -> dict[int, Owed]:
    """Everything due or overdue as of ``day``, grouped by the person who owes it.

    Attribution follows the same order the officer report uses: the officer
    stamped on the log, then whoever typed it, and only then the officer the
    company is allocated to. A follow-up nobody can be attributed to is left out
    rather than mailed to everyone.
    """
    now = now or datetime.utcnow()
    day = day or now.date()
    end_of_day = datetime.combine(day, time.min) + timedelta(days=1)
    # Late means the follow-up's day has passed — the one boundary every surface
    # that says "overdue" now shares. See timeutil.overdue_before.
    late_before = overdue_before()

    owner = _owner_by_company(db, college_id)
    officer_user = {
        officer_id: user_id
        for officer_id, user_id in db.query(PlacementOfficer.id, PlacementOfficer.user_id).all()
        if user_id
    }

    # An obligation: its key, when it falls due, who owes it, which company.
    obligations: dict[tuple, dict] = {}

    comm_q = db.query(
        Communication.id, Communication.company_id, Communication.hr_contact_id,
        Communication.next_followup_date, Communication.response_received,
        Communication.officer_id, Communication.logged_by_id,
    ).filter(Communication.next_followup_date.isnot(None),
             Communication.next_followup_date < end_of_day)
    if college_id:
        comm_q = comm_q.filter(Communication.college_id == college_id)

    for row in comm_q.all():
        if (row.response_received or "") == RESPONDED:
            continue  # answered — nothing is owed, whatever the date says
        key = ("contact", row.hr_contact_id) if row.hr_contact_id else ("comm", row.id)
        who = (
            officer_user.get(row.officer_id)
            or row.logged_by_id
            or owner.get(row.company_id)
        )
        existing = obligations.get(key)
        if existing is None or row.next_followup_date < existing["due"]:
            obligations[key] = {
                "due": row.next_followup_date,
                "user_id": who,
                "company_id": row.company_id,
            }
        elif existing["user_id"] is None:
            existing["user_id"] = who

    contact_q = (
        db.query(HRContact.id, HRContact.company_id, HRContact.next_followup_date)
        .join(Company, HRContact.company_id == Company.id)
        .filter(HRContact.next_followup_date.isnot(None),
                HRContact.next_followup_date < end_of_day)
    )
    if college_id:
        contact_q = contact_q.filter(Company.college_id == college_id)

    for contact_id, company_id, due in contact_q.all():
        key = ("contact", contact_id)
        if key in obligations:
            # Already counted through the communication that set this date.
            continue
        obligations[key] = {
            "due": due,
            "user_id": owner.get(company_id),
            "company_id": company_id,
        }

    active = {
        user_id
        for (user_id,) in db.query(User.id).filter(User.is_active == True).all()  # noqa: E712
    }

    owed: dict[int, Owed] = {}
    for item in obligations.values():
        user_id = item["user_id"]
        if user_id is None or user_id not in active:
            continue
        entry = owed.setdefault(user_id, Owed(user_id=user_id))
        if item["due"] >= late_before:
            entry.due_today += 1
        else:
            entry.overdue += 1
            age = (late_before - item["due"]).days
            if entry.oldest_overdue_days is None or age > entry.oldest_overdue_days:
                entry.oldest_overdue_days = age
        if item["company_id"]:
            entry.companies.add(item["company_id"])
    return owed


def summarise(entry: Owed) -> str:
    """The line that goes in the notification. Leads with the overdue count when
    there is one, because that is the part that has already slipped."""
    bits = []
    if entry.due_today:
        bits.append(f"{entry.due_today} due later today")
    if entry.overdue:
        oldest = entry.oldest_overdue_days
        age = f", oldest {oldest} day{'s' if oldest != 1 else ''} ago" if oldest else ""
        bits.append(f"{entry.overdue} overdue{age}")
    return " · ".join(bits)
