"""app/services/placement.py - keeping the student row in step with their offers.

`Student.placement_status` is what the dashboards and the branch-wise analytics
read; the Offer rows are the record of what actually happened. Once an offer
could be edited on its own, something had to decide what the student row should
say - and the two disagreeing is not a cosmetic bug, it is the placement rate
being wrong.

Two rules carry the weight:

* **Placed means holding a live offer.** Withdraw the last one and the student
  goes back to unplaced, rather than staying placed on the strength of history.
* **Opting out is a decision about the student, not a conclusion about their
  offers.** An old offer row must never drag somebody back to placed.
"""

import pytest

from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus
from app.services.placement import LIVE_STATUSES, sync_student_placement
from tests import factories


@pytest.fixture
def student(db, college):
    return factories.make_student(db, college=college, cgpa=8.0)


def give_offer(db, student, college, *, status=OfferStatus.ACCEPTED, ctc=None):
    company = factories.make_company(db, college=college)
    offer = Offer(student_id=student.id, company_id=company.id, status=status, ctc=ctc)
    db.add(offer)
    db.flush()
    return offer


# --- becoming placed --------------------------------------------------------


@pytest.mark.parametrize("status", LIVE_STATUSES, ids=lambda s: s.value)
def test_a_live_offer_places_the_student(db, college, student, status):
    give_offer(db, student, college, status=status)
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.PLACED


@pytest.mark.parametrize(
    "status",
    [s for s in OfferStatus if s not in LIVE_STATUSES],
    ids=lambda s: s.value,
)
def test_an_offer_that_is_not_live_does_not_place_anyone(db, college, student, status):
    """An issued offer is a piece of paper, not a job; a rejected or dropped one
    is the opposite of placement."""
    give_offer(db, student, college, status=status)
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.UNPLACED


def test_the_recorded_package_is_the_best_live_offer(db, college, student):
    """A student holding three offers is placed at the best one - that is the
    figure a college reports."""
    give_offer(db, student, college, ctc=8.0)
    give_offer(db, student, college, ctc=14.0)
    give_offer(db, student, college, ctc=11.0)
    sync_student_placement(db, student)
    assert student.placement_ctc == 14.0


def test_a_rejected_offer_does_not_set_the_package(db, college, student):
    """Otherwise a student's headline number comes from a job they did not get."""
    give_offer(db, student, college, ctc=8.0)
    give_offer(db, student, college, status=OfferStatus.REJECTED, ctc=30.0)
    sync_student_placement(db, student)
    assert student.placement_ctc == 8.0


def test_an_offer_with_no_package_leaves_an_existing_figure_alone(db, college, student):
    """Rather than blanking a number somebody typed on the Students page."""
    student.placement_ctc = 9.5
    give_offer(db, student, college, ctc=None)
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.PLACED
    assert student.placement_ctc == 9.5


# --- going back to unplaced -------------------------------------------------


def test_withdrawing_the_last_live_offer_unplaces_the_student(db, college, student):
    offer = give_offer(db, student, college, ctc=12.0)
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.PLACED

    offer.status = OfferStatus.REJECTED
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.UNPLACED


def test_becoming_unplaced_clears_the_package(db, college, student):
    """Leaving the CTC behind would keep the student in the salary analytics
    with no offer to back the figure."""
    offer = give_offer(db, student, college, ctc=12.0)
    sync_student_placement(db, student)
    offer.status = OfferStatus.DROPOUT
    sync_student_placement(db, student)
    assert student.placement_ctc is None


def test_one_live_offer_among_several_keeps_the_student_placed(db, college, student):
    live = give_offer(db, student, college, ctc=10.0)
    other = give_offer(db, student, college, ctc=20.0)
    sync_student_placement(db, student)

    other.status = OfferStatus.REJECTED
    sync_student_placement(db, student)

    assert student.placement_status == PlacementStatus.PLACED
    assert student.placement_ctc == live.ctc


# --- the decisions that are not about offers --------------------------------


@pytest.mark.parametrize(
    "decision", [PlacementStatus.OPTED_OUT, PlacementStatus.HIGHER_STUDIES]
)
def test_a_student_who_stepped_back_is_left_alone(db, college, student, decision):
    """These are decisions about the student. An old offer row must not drag
    them back to placed, and their absence must not mark them unplaced."""
    student.placement_status = decision
    give_offer(db, student, college, ctc=12.0)

    sync_student_placement(db, student)

    assert student.placement_status == decision


def test_a_student_who_stepped_back_keeps_their_recorded_package(db, college, student):
    student.placement_status = PlacementStatus.HIGHER_STUDIES
    student.placement_ctc = 7.0
    sync_student_placement(db, student)
    assert student.placement_ctc == 7.0


# --- shape ------------------------------------------------------------------


def test_no_student_is_not_an_error(db):
    """Callers pass whatever an offer's student_id resolved to, which can be
    nothing after a deletion."""
    sync_student_placement(db, None)


def test_a_student_with_no_offers_at_all_is_unplaced(db, student):
    sync_student_placement(db, student)
    assert student.placement_status == PlacementStatus.UNPLACED
    assert student.placement_ctc is None


def test_syncing_refreshes_the_readiness_score(db, college, student):
    """The score folds placement status in, so it has to move with it or the
    Students page shows a risk band that contradicts the row beside it."""
    student.readiness_score = None
    give_offer(db, student, college, ctc=12.0)
    sync_student_placement(db, student)
    assert student.readiness_score is not None
    assert student.risk_category is not None


def test_syncing_is_idempotent(db, college, student):
    give_offer(db, student, college, ctc=12.0)
    sync_student_placement(db, student)
    first = (student.placement_status, student.placement_ctc, student.readiness_score)
    sync_student_placement(db, student)
    assert (student.placement_status, student.placement_ctc, student.readiness_score) == first


def test_live_statuses_agree_with_the_analytics_definition(db):
    """Imported rather than restated in analytics. If the two ever diverge, the
    Students page and the placement rate count different people."""
    from app.routers.analytics import WON_OFFER_STATUSES

    assert set(LIVE_STATUSES) == set(WON_OFFER_STATUSES)
