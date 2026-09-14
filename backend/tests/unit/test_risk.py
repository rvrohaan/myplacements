"""app/services/risk.py - scoring a student on inputs alone.

Deliberately not a model: it is a fixed rule that must be reproducible for a
student who asks why they were flagged. That makes the arithmetic itself the
contract, and these tests pin it.

The interesting property is the one score_evidence's docstring claims: optional
evidence can only help. A college that has not adopted Training must not see
every student drop a band.
"""

import pytest

from app.models.student import RiskCategory
from app.services import risk
from app.services.risk import Evidence


def ev(**kw) -> Evidence:
    """Evidence with nothing recorded, plus whatever the test is about."""
    return Evidence(student_id=1, **kw)


# --- _count_items -----------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, 0),
        ("", 0),
        ("   ", 0),
        (",,,", 0),
        ("Python", 1),
        ("Python,Java", 2),
        ("Python, Java, SQL", 3),
        ("Python,,Java", 2),
        ("Python, ,Java", 2),
        (" Python , Java ", 2),
    ],
)
def test_count_items(raw, expected):
    """Skills and certifications are comma-separated free text, so blanks and
    stray commas are routine rather than exceptional."""
    assert risk._count_items(raw) == expected


# --- score_baseline ---------------------------------------------------------


def test_baseline_is_the_sum_of_its_three_parts():
    # 8.0 cgpa -> 40, no backlogs -> 30, 3 skills -> 15.
    assert risk.score_baseline(ev(cgpa=8.0, backlogs=0, skills=3)) == 85.0


def test_baseline_gives_a_missing_cgpa_the_midpoint():
    """25 of the 50 academic points - neither rewarded nor punished for a gap
    in the college records."""
    assert risk.score_baseline(ev(cgpa=None, backlogs=0, skills=0)) == 55.0


def test_baseline_caps_the_skills_contribution():
    """Listing twenty skills must not outweigh marks and backlogs together."""
    assert risk.score_baseline(ev(cgpa=0.0, backlogs=3, skills=4)) == 20.0
    assert risk.score_baseline(ev(cgpa=0.0, backlogs=3, skills=40)) == 20.0


def test_baseline_backlog_penalty_stops_at_zero():
    """Four backlogs must not start subtracting from the other components."""
    assert risk.score_baseline(ev(cgpa=0.0, backlogs=3, skills=0)) == 0.0
    assert risk.score_baseline(ev(cgpa=0.0, backlogs=10, skills=0)) == 0.0


def test_baseline_clamps_an_impossible_cgpa():
    """A 10-point scale, but imports are not always clean."""
    assert risk.score_baseline(ev(cgpa=25.0, backlogs=0)) == risk.score_baseline(
        ev(cgpa=10.0, backlogs=0)
    )
    assert risk.score_baseline(ev(cgpa=-5.0, backlogs=0)) == risk.score_baseline(
        ev(cgpa=0.0, backlogs=0)
    )


@pytest.mark.parametrize(
    "evidence",
    [
        ev(cgpa=10.0, backlogs=0, skills=10),
        ev(cgpa=0.0, backlogs=99, skills=0),
        ev(cgpa=None),
        ev(cgpa=5.5, backlogs=1, skills=2),
    ],
)
def test_baseline_always_lands_in_range(evidence):
    assert 0.0 <= risk.score_baseline(evidence) <= 100.0


# --- _steps -----------------------------------------------------------------


def test_steps_is_zero_with_nothing_to_count():
    assert risk._steps(0, [0.7, 1.0]) == 0.0
    assert risk._steps(-3, [0.7, 1.0]) == 0.0


def test_the_first_item_counts_for_most_of_the_step():
    """One certification is worth 70% of what two are - the curve the docstring
    describes."""
    assert risk._steps(1, [0.7, 1.0]) == 0.7
    assert risk._steps(2, [0.7, 1.0]) == 1.0


def test_steps_saturates_rather_than_running_off_the_ladder():
    assert risk._steps(99, [0.7, 1.0]) == 1.0


# --- score_evidence ---------------------------------------------------------


def test_evidence_scores_the_always_present_components_alone():
    """With nothing optional recorded, only cgpa, backlogs and skills are
    weighed: (35*0.8 + 20*1 + 15*0.6) / 70."""
    score = risk.score_evidence(ev(cgpa=8.0, backlogs=0, skills=3))
    assert score == pytest.approx(81.4, abs=0.05)


def test_a_college_without_training_records_is_not_penalised():
    """The central claim of the docstring. Absent optional evidence renormalises
    the remaining weights instead of scoring zero - otherwise adopting the
    Training module would shift every band in the cohort."""
    without = risk.score_evidence(ev(cgpa=8.0, backlogs=0, skills=3))
    with_training = risk.score_evidence(
        ev(cgpa=8.0, backlogs=0, skills=3, modules_completed=2)
    )
    assert with_training > without


@pytest.mark.parametrize(
    "extra",
    [
        {"certifications": 2},
        {"modules_completed": 2},
        {"avg_mock": 90.0},
        {"applications": 3},
        {"progressed": 1},
    ],
    ids=["certs", "training", "mock", "applications", "progressed"],
)
def test_every_optional_component_can_only_help(extra):
    """Recording something must never make a student look riskier - that would
    punish the colleges keeping the best records."""
    base = ev(cgpa=7.0, backlogs=1, skills=2)
    enriched = ev(cgpa=7.0, backlogs=1, skills=2, **extra)
    assert risk.score_evidence(enriched) >= risk.score_evidence(base)


def test_a_poor_mock_score_still_does_not_drag_below_the_others():
    """avg_mock=0 is the one optional component that can score zero on its own
    weight. It is only 6 points of 76, so it must not flip a band by itself."""
    base = risk.score_evidence(ev(cgpa=8.0, backlogs=0, skills=3))
    with_bad_mock = risk.score_evidence(ev(cgpa=8.0, backlogs=0, skills=3, avg_mock=0.0))
    assert risk.band(base) == risk.band(with_bad_mock)


def test_evidence_with_nothing_at_all_is_not_a_crash():
    """No cgpa, no skills, no backlogs: the always-present weights still apply,
    so backlogs=0 scores full marks on that component."""
    assert risk.score_evidence(ev()) == pytest.approx(57.1, abs=0.05)


def test_a_perfect_record_scores_one_hundred():
    score = risk.score_evidence(
        ev(
            cgpa=10.0,
            backlogs=0,
            skills=5,
            certifications=2,
            modules_completed=2,
            avg_mock=100.0,
            applications=3,
            progressed=2,
        )
    )
    assert score == 100.0


def test_the_worst_record_scores_zero():
    score = risk.score_evidence(ev(cgpa=0.0, backlogs=3, skills=0))
    assert score == 0.0


def test_evidence_clamps_an_out_of_range_mock_score():
    assert risk.score_evidence(ev(cgpa=8.0, avg_mock=150.0)) == risk.score_evidence(
        ev(cgpa=8.0, avg_mock=100.0)
    )


def test_backlogs_beyond_three_do_not_go_negative():
    """max(0, 1 - backlogs/3) - without the clamp, ten backlogs would subtract
    from the academic component."""
    assert risk.score_evidence(ev(cgpa=8.0, backlogs=3)) == risk.score_evidence(
        ev(cgpa=8.0, backlogs=30)
    )


# --- band -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (100.0, RiskCategory.LOW.value),
        (70.0, RiskCategory.LOW.value),
        (69.9, RiskCategory.MEDIUM.value),
        (40.0, RiskCategory.MEDIUM.value),
        (39.9, RiskCategory.HIGH.value),
        (0.0, RiskCategory.HIGH.value),
    ],
)
def test_band_boundaries(score, expected):
    """70 and 40 are inclusive lower bounds. These thresholds are shared with
    student_scoring so a band means the same thing wherever it is shown."""
    assert risk.band(score) == expected


def test_band_order_runs_worst_to_best():
    assert risk.BAND_ORDER == ["high", "medium", "low"]


def test_both_models_are_registered():
    """The calibration UI offers whatever is in MODELS; a model missing here is
    invisible rather than broken, which is harder to notice."""
    assert set(risk.MODELS) == {"baseline", "evidence"}
    for label, fn in risk.MODELS.values():
        assert label and callable(fn)
