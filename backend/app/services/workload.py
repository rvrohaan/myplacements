"""Is the work spread fairly across the placement team?

A different question from the one the officer-performance table answers. That
one ranks officers by what they have landed, which is *output*. This measures
what each of them is currently carrying - open companies, drives about to run,
promises owed to HR contacts - because an officer who lands fewer offers while
holding twice the companies is not underperforming, and a table sorted by offers
won says the opposite.

Each officer's share of the team's total load, next to an equal share. The
spread between the busiest and the lightest is the one number that says whether
the allocation is even.

**Deliberately no comparison against ``target_companies``.** An earlier version
showed companies held as a percentage of that target, reading it as capacity.
It is not: ``assigned / target_companies`` is already rendered as *Target
attainment* on the officer progress table, where it means progress toward a goal.
The same ratio cannot mean "how much they have achieved" in one panel and "how
overloaded they are" in another on the same page - and a reader did take
"25x their target" to mean the officer had done twenty-five times their job.
There is no field in the schema that states an officer's capacity, so this panel
does not pretend to measure it.

The weights below are **reasoned, not fitted** - the same caveat as the risk
model and the dashboard findings. They say an overdue promise is heavier than an
open company because it has a deadline attached, not because anything measured
it. A college that disagrees should change them; they are in one place for that
reason.

This diagnoses, it does not act. Moving companies between officers is
AI auto-allocation's job, which already exists and already shows its proposal
before applying it.
"""

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from app.models.company import Company, CompanyStatus
from app.models.drive import Drive, DriveStatus
from app.models.officer import CompanyAssignment, PlacementOfficer
from app.models.user import User
from app.services.followups import owed_followups

#: Imported rather than restated, so "open" means the same here as on the
#: officer dashboard and in the performance table.
from app.routers.analytics import OPEN_ASSIGNMENT_STATUSES

#: What one unit of each kind of open work counts for. An upcoming drive is a
#: fixed date with a room and a panel behind it, so it outweighs an open company
#: that is merely being talked to. An overdue follow-up outweighs a pending one
#: because it is already late.
WEIGHTS = {
    "open_companies": 1.0,
    "upcoming_drives": 3.0,
    "followups_due": 0.5,
    "followups_overdue": 1.5,
}

#: Below this the question is meaningless - one officer always carries 100%.
MIN_OFFICERS = 2

#: Spread, in percentage points between the busiest and lightest officer's share,
#: at which the split stops being reasonable. Reasoned, not fitted: with four
#: officers an equal share is 25 points each, so a 20-point gap means somebody is
#: holding roughly double somebody else.
EVEN_WITHIN = 10.0
UNEVEN_BEYOND = 20.0


@dataclass
class Load:
    officer_id: int
    name: str
    user_id: Optional[int] = None
    open_companies: int = 0
    upcoming_drives: int = 0
    followups_due: int = 0
    followups_overdue: int = 0

    @property
    def load(self) -> float:
        return round(
            self.open_companies * WEIGHTS["open_companies"]
            + self.upcoming_drives * WEIGHTS["upcoming_drives"]
            + self.followups_due * WEIGHTS["followups_due"]
            + self.followups_overdue * WEIGHTS["followups_overdue"],
            2,
        )


def compute(db: Session, user: User) -> dict:
    """The team's current load, per officer and as one spread figure."""
    cid = user.college_id

    officer_q = db.query(PlacementOfficer)
    if cid:
        officer_q = officer_q.filter(PlacementOfficer.college_id == cid)
    officers = officer_q.all()

    loads: dict[int, Load] = {
        o.id: Load(
            officer_id=o.id,
            user_id=o.user_id,
            name=(o.user.full_name if o.user else None) or f"Officer #{o.id}",
        )
        for o in officers
    }
    by_user = {o.user_id: o.id for o in officers if o.user_id}

    if loads:
        rows = (
            db.query(CompanyAssignment.officer_id, CompanyAssignment.company_id,
                     CompanyAssignment.status)
            .filter(CompanyAssignment.officer_id.in_(list(loads)))
            .all()
        )
        owner: dict[int, int] = {}
        for officer_id, company_id, status in rows:
            owner[company_id] = officer_id
            if (status or "active") in OPEN_ASSIGNMENT_STATUSES:
                loads[officer_id].open_companies += 1

        if owner:
            for company_id, in_status in (
                db.query(Drive.company_id, Drive.status)
                .filter(Drive.company_id.in_(list(owner)),
                        Drive.status == DriveStatus.UPCOMING)
                .all()
            ):
                officer_id = owner.get(company_id)
                if officer_id is not None:
                    loads[officer_id].upcoming_drives += 1

    # Follow-ups come from the shared service, keyed by the person who owes them,
    # so "owed" means exactly what the reminder and the officer report mean.
    for user_id, owed in owed_followups(db, cid).items():
        officer_id = by_user.get(user_id)
        if officer_id is not None:
            loads[officer_id].followups_due += owed.due_today
            loads[officer_id].followups_overdue += owed.overdue

    entries = sorted(loads.values(), key=lambda l: (-l.load, l.name))
    total = round(sum(e.load for e in entries), 2)

    def share(entry: Load) -> Optional[float]:
        return round(entry.load * 100 / total, 1) if total else None

    rows_out = [
        {
            "officer_id": e.officer_id,
            "user_id": e.user_id,
            "name": e.name,
            "open_companies": e.open_companies,
            "upcoming_drives": e.upcoming_drives,
            "followups_due": e.followups_due,
            "followups_overdue": e.followups_overdue,
            "load": e.load,
            "share": share(e),
        }
        for e in entries
    ]

    spread = None
    if len(entries) >= MIN_OFFICERS and total:
        spread = round((share(entries[0]) or 0) - (share(entries[-1]) or 0), 1)

    # Work nobody owns. Balance across officers says nothing useful while a pile
    # of companies has no owner at all, so it is reported beside the spread
    # rather than left to the allocation screen.
    unassigned_q = db.query(Company).filter(
        Company.status.notin_((CompanyStatus.BLACKLISTED, CompanyStatus.DORMANT))
    )
    if cid:
        unassigned_q = unassigned_q.filter(Company.college_id == cid)
    assigned_ids = [r[0] for r in db.query(CompanyAssignment.company_id).all()]
    if assigned_ids:
        unassigned_q = unassigned_q.filter(Company.id.notin_(assigned_ids))

    return {
        "officers": rows_out,
        "total_load": total,
        #: What each officer would hold if the work were split evenly.
        "fair_share": round(100 / len(entries), 1) if entries else None,
        #: Busiest minus lightest, in points of share. None when there are too
        #: few officers for the question to mean anything.
        "spread": spread,
        "idle_officers": sum(1 for e in entries if e.load == 0),
        "unassigned_companies": unassigned_q.count(),
        "weights": WEIGHTS,
    }
