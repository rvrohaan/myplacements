"""The two things that report on themselves.

`monthly.gather` turns a month into findings a model then writes up, and
`risk.calibration` asks whether the risk score predicts anything at all. Both
are unusual in this codebase: their job is to be honest about what the numbers
do *not* say, so the tests are mostly about the cases where a naive reading
would flatter the college.

The two worth naming:

* A month with offers but no placements reads like a good month if you only
  count offers. `gather` names it as urgent instead.
* A risk model whose "high risk" students place as often as its "low risk" ones
  is not measuring risk. `calibration` exists to discover that before anybody
  acts on it, which is why it reports a separation number rather than a chart.
"""

from datetime import datetime, timedelta

import pytest

from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus
from app.models.user import UserRole
from app.services import insights, monthly, risk
from tests import factories

KEY = "2026-08"
IN_MONTH = datetime(2026, 8, 15, 10, 0)
MONTH_BEFORE = datetime(2026, 7, 15, 10, 0)


@pytest.fixture
def head(db, college):
    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


def offer(db, college, *, when, status=OfferStatus.ACCEPTED, ctc=10.0, company=None, branch="CSE"):
    company = company or factories.make_company(db, college=college, created_at=when)
    student = factories.make_student(db, college=college, branch=branch)
    row = Offer(
        student_id=student.id, company_id=company.id, status=status, ctc=ctc, created_at=when
    )
    db.add(row)
    db.flush()
    return row


def headlines(findings) -> str:
    return " ".join(f.headline for f in findings)


# --- the month's facts ------------------------------------------------------


def test_a_month_reports_what_happened_in_it(db, college, head):
    offer(db, college, when=IN_MONTH, ctc=14.0)
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["placements"] == 1
    assert facts["highest_package"] == 14.0
    assert facts["label"] == "August 2026"


def test_the_previous_month_travels_with_it(db, college, head):
    """Every headline is a comparison, so the month before is part of the answer
    rather than a second query the caller has to remember."""
    offer(db, college, when=IN_MONTH)
    offer(db, college, when=MONTH_BEFORE)
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["placements"] == 1
    assert facts["previous"]["placements"] == 1


def test_an_offer_from_another_month_is_not_counted(db, college, head):
    offer(db, college, when=datetime(2026, 6, 15))
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["placements"] == 0


def test_an_offer_nobody_took_up_is_not_a_placement(db, college, head):
    offer(db, college, when=IN_MONTH, status=OfferStatus.REJECTED)
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["offers"] == 1
    assert facts["placements"] == 0


def test_one_student_with_two_offers_is_one_placement(db, college, head):
    """Otherwise a student holding three offers triples the month."""
    company = factories.make_company(db, college=college)
    student = factories.make_student(db, college=college)
    for _ in range(2):
        db.add(
            Offer(student_id=student.id, company_id=company.id,
                  status=OfferStatus.ACCEPTED, ctc=9.0, created_at=IN_MONTH)
        )
    db.flush()
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["offers"] == 2
    assert facts["placements"] == 1


def test_another_colleges_month_is_not_in_this_one(db, college, other_college, head):
    offer(db, other_college, when=IN_MONTH)
    facts, _, _ = monthly.gather(db, head, KEY)
    assert facts["placements"] == 0


# --- the findings -----------------------------------------------------------


def test_a_better_month_reads_as_good(db, college, head):
    for _ in range(3):
        offer(db, college, when=IN_MONTH)
    offer(db, college, when=MONTH_BEFORE)

    _, findings, _ = monthly.gather(db, head, KEY)
    placements = next(f for f in findings if f.key == "placements")
    assert placements.severity == "good"
    assert "up from 1" in placements.headline


def test_a_worse_month_reads_as_urgent(db, college, head):
    offer(db, college, when=IN_MONTH)
    for _ in range(3):
        offer(db, college, when=MONTH_BEFORE)

    _, findings, _ = monthly.gather(db, head, KEY)
    placements = next(f for f in findings if f.key == "placements")
    assert placements.severity == "urgent"
    assert "down from 3" in placements.headline


def test_two_empty_months_in_a_row_are_named_as_such(db, college, head):
    """"0 placements, unchanged" understates it."""
    _, findings, _ = monthly.gather(db, head, KEY)
    placements = next(f for f in findings if f.key == "placements")
    assert placements.severity == "urgent"
    assert "none the month before" in placements.headline


def test_offers_with_nothing_taken_up_is_called_out(db, college, head):
    """The case the module exists to catch: counting offers alone, this reads
    like a good month."""
    for _ in range(4):
        offer(db, college, when=IN_MONTH, status=OfferStatus.ISSUED)

    _, findings, _ = monthly.gather(db, head, KEY)
    flagged = next(f for f in findings if f.key == "offers_not_taken")
    assert flagged.severity == "urgent"
    assert "none has been accepted" in flagged.headline


def test_a_month_with_placements_is_not_flagged_that_way(db, college, head):
    offer(db, college, when=IN_MONTH)
    _, findings, _ = monthly.gather(db, head, KEY)
    assert not any(f.key == "offers_not_taken" for f in findings)


def test_the_best_package_is_reported_with_who_hired(db, college, head):
    offer(db, college, when=IN_MONTH, ctc=18.5)
    _, findings, _ = monthly.gather(db, head, KEY)
    top = next(f for f in findings if f.key == "top_package")
    assert "18.5 LPA" in top.headline
    assert "1 recruiter" in top.headline


def test_findings_lead_with_what_needs_acting_on(db, college, head):
    """They are read in order and the top one carries the most weight."""
    for _ in range(4):
        offer(db, college, when=IN_MONTH, status=OfferStatus.ISSUED)

    _, findings, _ = monthly.gather(db, head, KEY)
    assert findings[0].severity == "urgent"


def test_every_finding_declares_the_figures_it_prints(db, college, head):
    """The contract insights.verify enforces: a headline quoting a figure it did
    not declare would make an honest write-up look invented and get the whole
    thing discarded."""
    for _ in range(3):
        offer(db, college, when=IN_MONTH, ctc=12.0)
    offer(db, college, when=MONTH_BEFORE)

    _, findings, _ = monthly.gather(db, head, KEY)
    allowed = insights.allowed_numbers(findings)
    for finding in findings:
        assert insights._numbers(finding.headline) <= allowed, finding.headline


def test_a_narrative_quoting_the_findings_survives_the_guard(db, college, head):
    """End to end through the real check, since that is where it matters."""
    offer(db, college, when=IN_MONTH, ctc=12.0)
    _, findings, _ = monthly.gather(db, head, KEY)
    headline = findings[0].headline
    assert insights.verify([f"In short: {headline}"], findings) == (True, set())


def test_the_prompt_names_the_college_and_the_month(db, college, head):
    _, findings, _ = monthly.gather(db, head, KEY)
    prompt = monthly.build_prompt("RIT", KEY, findings)
    assert "RIT" in prompt
    assert "August 2026" in prompt


# --- the tables -------------------------------------------------------------


def test_the_month_breaks_down_by_company(db, college, head):
    acme = factories.make_company(db, college=college, name="Acme Corp")
    offer(db, college, when=IN_MONTH, company=acme, ctc=11.0)
    offer(db, college, when=IN_MONTH, company=acme, ctc=15.0)

    _, _, tables = monthly.gather(db, head, KEY)
    assert tables["by_company"][0] == ["Acme Corp", 2, 15.0]


def test_the_month_breaks_down_by_branch(db, college, head):
    offer(db, college, when=IN_MONTH, branch="CSE")
    offer(db, college, when=IN_MONTH, branch="CSE")
    offer(db, college, when=IN_MONTH, branch="ECE")

    _, _, tables = monthly.gather(db, head, KEY)
    assert tables["by_branch"][0][:2] == ["CSE", 2]


def test_a_branch_nobody_recorded_is_labelled_rather_than_dropped(db, college, head):
    offer(db, college, when=IN_MONTH, branch="")
    _, _, tables = monthly.gather(db, head, KEY)
    assert tables["by_branch"][0][0] == "Unrecorded"


def test_a_placement_with_no_package_shows_none_rather_than_zero(db, college, head):
    """Not recorded and zero are different answers."""
    offer(db, college, when=IN_MONTH, ctc=None)
    _, _, tables = monthly.gather(db, head, KEY)
    assert tables["by_company"][0][2] is None


def test_an_empty_month_produces_empty_tables_not_a_crash(db, college, head):
    facts, findings, tables = monthly.gather(db, head, KEY)
    assert tables == {"by_company": [], "by_branch": []}
    assert findings


# --- does the risk score predict anything? ----------------------------------


def seeking(db, college, *, placed: bool, **kw):
    student = factories.make_student(db, college=college, **kw)
    student.placement_status = PlacementStatus.PLACED if placed else PlacementStatus.UNPLACED
    db.flush()
    return student


def test_calibration_counts_the_cohort_it_scored(db, college, head):
    seeking(db, college, placed=True, cgpa=9.0)
    seeking(db, college, placed=False, cgpa=5.0)

    result = risk.calibration(db, head)
    assert result["students"] == 2
    assert result["placed"] == 1
    assert result["placement_rate"] == 50.0


def test_a_student_who_never_sought_placement_is_excluded(db, college, head):
    """Counting somebody who opted out as an unplaced high-risk student would
    make every model look worse than it is."""
    seeking(db, college, placed=True, cgpa=9.0)
    opted_out = factories.make_student(db, college=college)
    opted_out.placement_status = PlacementStatus.OPTED_OUT
    db.flush()

    result = risk.calibration(db, head)
    assert result["students"] == 1
    assert result["excluded_not_seeking"] == 1


def test_both_models_are_calibrated_side_by_side(db, college, head):
    """The point is comparing the rule the app stores against the richer one, so
    a college can see whether swapping is worth it."""
    seeking(db, college, placed=True, cgpa=9.0)
    result = risk.calibration(db, head)
    assert {m["key"] for m in result["models"]} == {"baseline", "evidence"}


def test_every_band_is_reported_even_when_empty(db, college, head):
    """A chart that drops an empty band changes shape as the data does."""
    seeking(db, college, placed=True, cgpa=9.0)
    for model in risk.calibration(db, head)["models"]:
        assert [row["band"] for row in model["bands"]] == risk.BAND_ORDER


def test_a_band_with_nobody_in_it_has_no_rate_rather_than_zero(db, college, head):
    """0% would assert that nobody in that band was placed, which is not what an
    empty band says."""
    seeking(db, college, placed=True, cgpa=9.0)
    for model in risk.calibration(db, head)["models"]:
        for row in model["bands"]:
            if row["students"] == 0:
                assert row["placement_rate"] is None


def test_a_model_that_separates_scores_positively(db, college, head):
    """Strong students placed, weak ones not - which is what a working model
    should look like."""
    for _ in range(4):
        seeking(db, college, placed=True, cgpa=9.5, backlogs=0, skills="Python,SQL,AWS,Go")
    for _ in range(4):
        seeking(db, college, placed=False, cgpa=4.0, backlogs=3)

    baseline = next(m for m in risk.calibration(db, head)["models"] if m["key"] == "baseline")
    assert baseline["separation"] is not None
    assert baseline["separation"] > 0


def test_a_model_that_carries_no_information_scores_near_zero(db, college, head):
    """The discovery the whole feature exists to make: if the students it calls
    safe place as often as the ones it calls at risk, the bands mean nothing,
    whatever else the chart shows."""
    for placed in (True, False):
        for _ in range(3):
            seeking(db, college, placed=placed, cgpa=9.5, backlogs=0, skills="Python,SQL,AWS,Go")
        for _ in range(3):
            seeking(db, college, placed=placed, cgpa=4.0, backlogs=3)

    baseline = next(m for m in risk.calibration(db, head)["models"] if m["key"] == "baseline")
    assert baseline["separation"] == 0.0


def test_separation_is_none_when_a_band_is_empty(db, college, head):
    """It is low-minus-high; with nobody at one end there is nothing to compare
    and a number would be invented."""
    seeking(db, college, placed=True, cgpa=9.5, backlogs=0, skills="Python,SQL,AWS,Go")
    baseline = next(m for m in risk.calibration(db, head)["models"] if m["key"] == "baseline")
    assert baseline["separation"] is None


def test_calibration_can_be_narrowed_to_one_batch(db, college, head):
    """A settled batch is the only one worth asking about - the current one is
    still in progress."""
    seeking(db, college, placed=True, batch_year=2024, cgpa=9.0)
    seeking(db, college, placed=False, batch_year=2026, cgpa=5.0)

    result = risk.calibration(db, head, batch_year=2024)
    assert result["students"] == 1
    assert result["batch_year"] == 2024


def test_another_colleges_students_are_not_calibrated(db, college, other_college, head):
    seeking(db, other_college, placed=True, cgpa=9.0)
    assert risk.calibration(db, head)["students"] == 0


def test_an_empty_cohort_has_no_rate_rather_than_zero(db, college, head):
    result = risk.calibration(db, head)
    assert result["students"] == 0
    assert result["placement_rate"] is None


def test_the_bands_of_a_model_account_for_everyone(db, college, head):
    """Every student lands in exactly one band, or the chart's parts do not sum
    to the cohort it claims to describe."""
    for cgpa in (9.5, 7.0, 4.0):
        seeking(db, college, placed=False, cgpa=cgpa)

    for model in risk.calibration(db, head)["models"]:
        assert sum(row["students"] for row in model["bands"]) == 3


def test_gather_reads_evidence_without_looking_at_the_outcome(db, college, head):
    """The scores are built only from what was true before placement - asking
    whether a score predicts placement when it is derived from placement is
    circular."""
    student = seeking(db, college, placed=True, cgpa=8.0, skills="Python, SQL")
    evidence = risk.gather(db, [student])[student.id]
    assert evidence.cgpa == 8.0
    assert evidence.skills == 2
    assert not hasattr(evidence, "placement_status")


def test_gather_counts_completed_training_and_drive_progress(db, college, head):
    from app.models.drive import DriveParticipant, ParticipantStatus

    student = seeking(db, college, placed=False, cgpa=8.0)
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="completed", mock_test_score=80.0)
    company = factories.make_company(db, college=college)
    drive = factories.make_drive(db, college=college, company=company)
    db.add(
        DriveParticipant(
            drive_id=drive.id, student_id=student.id, status=ParticipantStatus.SHORTLISTED
        )
    )
    db.flush()

    evidence = risk.gather(db, [student])[student.id]
    assert evidence.modules_completed == 1
    assert evidence.avg_mock == 80.0
    assert evidence.applications == 1
    assert evidence.progressed == 1


def test_gather_of_nobody_is_empty(db):
    assert risk.gather(db, []) == {}
