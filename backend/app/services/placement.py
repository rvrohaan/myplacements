"""Keeping a student's placement state in step with the offers they hold.

The Student row is what the dashboards and branch-wise analytics read; the Offer
rows are the record of what actually happened. Before offers were editable in
their own right, those two could only diverge through the drive flow, which
maintained them together. Now that an offer can be recorded, re-priced, joined
or dropped on its own, one place has to decide what the student row should say.
"""

from sqlalchemy.orm import Session

from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, Student
from app.services.student_scoring import assess

# Offer states that mean the student actually has the job. Mirrors
# analytics.WON_OFFER_STATUSES — the two must agree, or the Students page and
# the placement rate would count different people.
LIVE_STATUSES = (OfferStatus.ACCEPTED, OfferStatus.JOINED)


def sync_student_placement(db: Session, student: Student | None) -> None:
    """Recompute ``placement_status`` / ``placement_ctc`` from the student's offers.

    A student is placed while they hold at least one accepted or joined offer,
    and their recorded package is the **highest** of those — a student holding
    three offers is placed at the best one, which is the figure a college
    reports. With no live offer left they go back to unplaced, the same way
    reverting a drive selection already does.

    Students who opted out or went for higher studies are left alone: those are
    decisions about the student, not conclusions about their offers, and an old
    offer row must not drag them back to "placed".
    """
    if student is None:
        return
    if student.placement_status in (PlacementStatus.OPTED_OUT, PlacementStatus.HIGHER_STUDIES):
        return

    # flush() so offers written earlier in this request are visible to the query.
    db.flush()
    live = (
        db.query(Offer)
        .filter(Offer.student_id == student.id, Offer.status.in_(LIVE_STATUSES))
        .all()
    )

    if live:
        student.placement_status = PlacementStatus.PLACED
        packages = [o.ctc for o in live if o.ctc is not None]
        # No CTC on any live offer leaves the existing figure alone rather than
        # blanking a number somebody typed on the Students page.
        if packages:
            student.placement_ctc = max(packages)
    else:
        student.placement_status = PlacementStatus.UNPLACED
        student.placement_ctc = None

    student.readiness_score, student.risk_category = assess(
        student.cgpa, student.backlogs, student.skills, student.placement_status
    )
