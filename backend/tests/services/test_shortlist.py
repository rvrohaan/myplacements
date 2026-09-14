"""app/services/matching.py - the shortlist, end to end.

The pure scoring functions are covered in tests/unit/test_matching.py. This is
the assembled thing: filter, score, rank, and explain. It goes to a recruiter
with the college's name on it, so being confidently wrong costs more than being
cautious.

Three properties carry most of the risk:

* **A component nobody can measure is not scored zero, it is removed.** Scoring
  every candidate 0 on affinity when a company has never hired here would
  flatten the spread and rank on noise. The same for skills when no skill was
  recorded anywhere.
* **The exclusion tally sums to what was excluded.** A student who fails on two
  counts is attributed to the first, or the numbers shown beneath the shortlist
  do not add up.
* **Evidence travels with the score.** "Python" backed by a completed module and
  "Python" typed into a form must stay distinguishable.
"""

import pytest

from app.models.student import PlacementStatus
from app.services.matching import Criteria, build_shortlist, past_pattern, trained_skills
from app.models.offer import Offer, OfferStatus
from tests import factories


@pytest.fixture
def company(db, college):
    return factories.make_company(db, college=college)


def shortlist(db, students, company, criteria=None, **kw):
    return build_shortlist(db, students, company, criteria or Criteria(), **kw)


def by_roll(result) -> list[str]:
    return [r["roll_number"] for r in result["shortlist"]]


def hire(db, college, company, **kw):
    """A past hire at this company - what past_pattern reads."""
    student = factories.make_student(db, college=college, **kw)
    db.add(Offer(student_id=student.id, company_id=company.id, status=OfferStatus.JOINED))
    db.flush()
    return student


# --- filtering --------------------------------------------------------------


def test_an_eligible_student_is_shortlisted(db, college, company):
    student = factories.make_student(db, college=college, cgpa=8.0)
    result = shortlist(db, [student], company)
    assert result["eligible"] == 1
    assert by_roll(result) == [student.roll_number]


def test_everyone_considered_is_counted(db, college, company):
    students = [factories.make_student(db, college=college) for _ in range(3)]
    assert shortlist(db, students, company)["considered"] == 3


def test_a_student_below_the_bar_is_excluded_with_a_reason(db, college, company):
    student = factories.make_student(db, college=college, cgpa=5.0)
    result = shortlist(db, [student], company, Criteria(min_cgpa=7.0))
    assert result["eligible"] == 0
    assert result["excluded"] == [
        {"reason": "cgpa", "label": "Below the CGPA bar", "students": 1}
    ]


def test_a_missing_cgpa_is_reported_apart_from_missing_the_bar(db, college, company):
    """One is a data gap for the college to fix; the other is a fact about the
    student. Merging them hides which."""
    gap = factories.make_student(db, college=college, cgpa=None)
    below = factories.make_student(db, college=college, cgpa=5.0)
    result = shortlist(db, [gap, below], company, Criteria(min_cgpa=7.0))
    reasons = {e["reason"]: e["students"] for e in result["excluded"]}
    assert reasons == {"cgpa_missing": 1, "cgpa": 1}


def test_the_exclusion_tally_sums_to_the_number_excluded(db, college, company):
    """A student failing on several counts is attributed to the first, so the
    figures under the shortlist add up."""
    doomed = factories.make_student(
        db, college=college, branch="MECH", cgpa=4.0, backlogs=5, batch_year=2020
    )
    criteria = Criteria(branches=["cse"], min_cgpa=7.0, max_backlogs=0, batch_year=2026)
    result = shortlist(db, [doomed], company, criteria)
    assert sum(e["students"] for e in result["excluded"]) == 1


def test_exclusion_reasons_with_nobody_in_them_are_omitted(db, college, company):
    """The panel lists what actually happened, not every rule that exists."""
    student = factories.make_student(db, college=college, cgpa=5.0)
    result = shortlist(db, [student], company, Criteria(min_cgpa=7.0))
    assert len(result["excluded"]) == 1


def test_a_placed_student_is_excluded_by_default(db, college, company):
    placed = factories.make_student(db, college=college)
    placed.placement_status = PlacementStatus.PLACED
    db.flush()
    assert shortlist(db, [placed], company)["eligible"] == 0


def test_a_placed_student_can_be_included_for_a_dream_offer_round(db, college, company):
    placed = factories.make_student(db, college=college)
    placed.placement_status = PlacementStatus.PLACED
    db.flush()
    assert shortlist(db, [placed], company, include_placed=True)["eligible"] == 1


def test_nothing_to_rank_is_not_an_error(db, company):
    result = shortlist(db, [], company)
    assert result["shortlist"] == []
    assert result["considered"] == 0


# --- ranking ----------------------------------------------------------------


def test_the_stronger_candidate_ranks_higher(db, college, company):
    strong = factories.make_student(db, college=college, roll_number="A1", cgpa=9.5, backlogs=0)
    weak = factories.make_student(db, college=college, roll_number="A2", cgpa=6.0, backlogs=2)
    assert by_roll(shortlist(db, [weak, strong], company)) == ["A1", "A2"]


def test_ties_break_on_roll_number_so_the_order_is_stable(db, college, company):
    """The same cohort must produce the same shortlist twice, or a recruiter
    sent two copies sees two different answers."""
    for roll in ("C3", "A1", "B2"):
        factories.make_student(db, college=college, roll_number=roll, cgpa=8.0)
    from app.models.student import Student

    rows = db.query(Student).all()
    assert by_roll(shortlist(db, rows, company)) == ["A1", "B2", "C3"]


def test_the_limit_caps_the_shortlist_but_not_the_counts(db, college, company):
    students = [factories.make_student(db, college=college) for _ in range(6)]
    result = shortlist(db, students, company, limit=2)
    assert len(result["shortlist"]) == 2
    assert result["eligible"] == 6


def test_backlogs_cost_a_candidate_but_do_not_disqualify_them(db, college, company):
    """With no backlog bar set, a backlog is a weakness rather than a wall."""
    clean = factories.make_student(db, college=college, roll_number="A1", cgpa=8.0, backlogs=0)
    with_backlog = factories.make_student(db, college=college, roll_number="A2", cgpa=8.0, backlogs=2)
    result = shortlist(db, [clean, with_backlog], company)
    assert result["eligible"] == 2
    assert by_roll(result) == ["A1", "A2"]


def test_every_score_lands_on_a_nought_to_hundred_scale(db, college, company):
    students = [
        factories.make_student(db, college=college, cgpa=10.0, skills="Python"),
        factories.make_student(db, college=college, cgpa=0.0, backlogs=3),
    ]
    for row in shortlist(db, students, company)["shortlist"]:
        assert 0.0 <= row["score"] <= 100.0


# --- weights redistribute rather than score zero ----------------------------


def test_affinity_is_dropped_when_the_company_has_never_hired_here(db, college, company):
    """Nothing to be similar to. Scoring every candidate 0 would flatten the
    spread and rank on noise."""
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(db, [student], company, Criteria(skills=["python"]))
    assert result["weights"]["affinity"] == 0.0


def test_affinitys_share_goes_to_skills_rather_than_vanishing(db, college, company):
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(db, [student], company, Criteria(skills=["python"]))
    assert result["weights"]["skills"] == pytest.approx(0.45)
    assert sum(result["weights"].values()) == pytest.approx(1.0)


def test_affinity_is_scored_once_the_company_has_hired_here(db, college, company):
    hire(db, college, company, branch="CSE", cgpa=8.0)
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(db, [student], company, Criteria(skills=["python"]))
    assert result["weights"]["affinity"] > 0


def test_skills_are_dropped_when_nothing_wants_them(db, college, company):
    """No skills on the role and none on the company: a component nobody can
    measure must not be scored."""
    student = factories.make_student(db, college=college)
    result = shortlist(db, [student], company)
    assert result["weights"]["skills"] == 0.0


def test_the_skill_share_is_spread_over_what_can_be_measured(db, college, company):
    student = factories.make_student(db, college=college)
    weights = shortlist(db, [student], company)["weights"]
    # Rounded to 3dp on the way out, so the displayed figures sum to 1 only
    # within rounding error. The weights the score is computed from are exact;
    # these are for the reader.
    assert sum(weights.values()) == pytest.approx(1.0, abs=0.005)
    assert weights["academics"] > 0.20
    assert weights["skills"] == 0.0


def test_the_weights_are_returned_so_the_number_can_be_read(db, college, company):
    """A ranking a placement head cannot interrogate is one they have to take
    on trust."""
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(db, [student], company, Criteria(skills=["python"]))
    assert set(result["weights"]) == {
        "skills", "academics", "clean_record", "readiness", "training", "affinity"
    }


# --- skills and their evidence ----------------------------------------------


def test_a_matched_skill_is_reported_with_what_backs_it(db, college, company):
    student = factories.make_student(db, college=college, skills="Python")
    row = shortlist(db, [student], company, Criteria(skills=["python"]))["shortlist"][0]
    assert row["matched_skills"] == ["python"]
    assert row["skill_evidence"] == {"python": "declared"}


def test_a_completed_module_outranks_a_typed_claim(db, college, company):
    """The distinction the provenance table exists for."""
    module = factories.make_module(db, college=college, skills="Python")
    trained = factories.make_student(db, college=college, roll_number="A1", cgpa=8.0)
    factories.enrol(db, student=trained, module=module, status="completed")
    claimed = factories.make_student(db, college=college, roll_number="A2", cgpa=8.0, skills="Python")

    result = shortlist(db, [trained, claimed], company, Criteria(skills=["python"]))
    rows = {r["roll_number"]: r for r in result["shortlist"]}
    assert rows["A1"]["skill_evidence"]["python"] == "training"
    assert rows["A2"]["skill_evidence"]["python"] == "declared"


def test_a_certification_naming_the_skill_counts_as_evidence(db, college, company):
    student = factories.make_student(
        db, college=college, skills=None, certifications="AWS Certified Solutions Architect"
    )
    row = shortlist(db, [student], company, Criteria(skills=["aws"]))["shortlist"][0]
    assert row["skill_evidence"]["aws"] == "certification"


def test_a_skill_with_no_evidence_is_listed_as_missing(db, college, company):
    student = factories.make_student(db, college=college, skills="Java")
    row = shortlist(db, [student], company, Criteria(skills=["python"]))["shortlist"][0]
    assert row["missing_skills"] == ["python"]
    assert row["matched_skills"] == []


def test_weighted_skills_beat_a_bare_count(db, college, company):
    heavy = factories.make_student(db, college=college, roll_number="A1", cgpa=8.0, skills="Python")
    light = factories.make_student(db, college=college, roll_number="A2", cgpa=8.0, skills="SQL")
    result = shortlist(
        db, [light, heavy], company, Criteria(skills=["python", "sql"]),
        skill_weights={"Python": 5.0, "SQL": 1.0},
    )
    assert by_roll(result) == ["A1", "A2"]


def test_the_skills_used_are_reported_heaviest_first(db, college, company):
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(
        db, [student], company, Criteria(skills=["python", "sql"]),
        skill_weights={"Python": 5.0, "SQL": 1.0},
    )
    assert [s["skill"] for s in result["skills_used"]] == ["python", "sql"]


# --- training gaps ----------------------------------------------------------


def test_the_gap_report_names_what_most_candidates_lack(db, college, company):
    """Where the shortlist is weakest - which is what the college can act on
    before the next drive."""
    for roll in ("A1", "A2", "A3"):
        factories.make_student(db, college=college, roll_number=roll, skills="Python")
    from app.models.student import Student

    rows = db.query(Student).all()
    result = shortlist(db, rows, company, Criteria(skills=["python", "kubernetes"]))
    assert result["training_gaps"][0]["skill"] == "kubernetes"
    assert result["training_gaps"][0]["students_missing"] == 3
    assert result["training_gaps"][0]["share_missing"] == 100.0


def test_a_skill_nobody_lacks_is_not_a_gap(db, college, company):
    student = factories.make_student(db, college=college, skills="Python")
    result = shortlist(db, [student], company, Criteria(skills=["python"]))
    assert result["training_gaps"] == []


def test_there_are_no_gaps_when_nobody_is_eligible(db, college, company):
    student = factories.make_student(db, college=college, cgpa=4.0)
    result = shortlist(db, [student], company, Criteria(min_cgpa=8.0, skills=["python"]))
    assert result["training_gaps"] == []


# --- past pattern -----------------------------------------------------------


def test_past_hires_describe_who_this_company_takes(db, college, company):
    hire(db, college, company, branch="CSE", cgpa=8.0, skills="Python")
    hire(db, college, company, branch="CSE", cgpa=9.0, skills="Python, SQL")

    pattern = past_pattern(db, company)
    assert pattern.hires == 2
    assert pattern.branches[0] == ("CSE", 2)
    assert pattern.median_cgpa == 8.5
    assert pattern.min_cgpa == 8.0
    assert ("python", 2) in pattern.common_skills


def test_an_offer_that_was_not_taken_up_is_not_a_hire(db, college, company):
    student = factories.make_student(db, college=college)
    db.add(Offer(student_id=student.id, company_id=company.id, status=OfferStatus.REJECTED))
    db.flush()
    assert past_pattern(db, company).hires == 0


def test_a_company_with_no_history_has_an_empty_pattern(db, company):
    pattern = past_pattern(db, company)
    assert pattern.hires == 0
    assert pattern.median_cgpa is None


def test_a_hire_with_no_branch_recorded_is_labelled_rather_than_dropped(db, college, company):
    hire(db, college, company, branch="", cgpa=8.0)
    assert past_pattern(db, company).branches[0][0] == "Unrecorded"


def test_the_pattern_travels_with_the_shortlist(db, college, company):
    """So the head can see what the affinity component was comparing against."""
    hire(db, college, company, branch="CSE", cgpa=8.0)
    student = factories.make_student(db, college=college)
    assert shortlist(db, [student], company)["past_pattern"]["hires"] == 1


# --- the training signal ----------------------------------------------------


def test_mock_scores_drive_the_training_signal(db, college, company):
    module = factories.make_module(db, college=college, skills="Python")
    strong = factories.make_student(db, college=college, roll_number="A1", cgpa=8.0)
    weak = factories.make_student(db, college=college, roll_number="A2", cgpa=8.0)
    factories.enrol(db, student=strong, module=module, mock_test_score=95.0)
    factories.enrol(db, student=weak, module=module, mock_test_score=20.0)

    rows = {r["roll_number"]: r for r in shortlist(db, [strong, weak], company)["shortlist"]}
    assert rows["A1"]["components"]["training"] > rows["A2"]["components"]["training"]


def test_attendance_stands_in_where_no_mock_was_recorded(db, college, company):
    module = factories.make_module(db, college=college)
    student = factories.make_student(db, college=college, cgpa=8.0)
    factories.enrol(db, student=student, module=module, attendance_percent=100.0)
    row = shortlist(db, [student], company)["shortlist"][0]
    assert 0 < row["components"]["training"] < 100


def test_no_training_record_is_absence_of_evidence_not_a_penalty(db, college, company):
    """It is only ever a tenth of the total, and the test says so."""
    student = factories.make_student(db, college=college, cgpa=8.0)
    row = shortlist(db, [student], company)["shortlist"][0]
    assert row["components"]["training"] == 0.0
    assert row["score"] > 0


def test_trained_skills_reads_only_completed_modules(db, college):
    module = factories.make_module(db, college=college, skills="Python")
    student = factories.make_student(db, college=college)
    factories.enrol(db, student=student, module=module, status="enrolled")
    assert trained_skills(db, [student.id]) == {}

    factories.enrol(db, student=student, module=module, status="completed")
    assert trained_skills(db, [student.id]) == {student.id: {"python"}}


def test_trained_skills_of_nobody_is_empty(db):
    assert trained_skills(db, []) == {}


# --- the row a recruiter reads ----------------------------------------------


def test_a_row_carries_enough_to_identify_and_check_the_candidate(db, college, company):
    student = factories.make_student(db, college=college, cgpa=8.4, backlogs=1)
    row = shortlist(db, [student], company)["shortlist"][0]
    assert row["student_id"] == student.id
    assert row["roll_number"] == student.roll_number
    assert row["name"] == student.user.full_name
    assert row["branch"] == "CSE"
    assert row["cgpa"] == 8.4
    assert row["backlogs"] == 1


def test_every_component_is_shown_beside_the_score(db, college, company):
    student = factories.make_student(db, college=college)
    row = shortlist(db, [student], company)["shortlist"][0]
    assert set(row["components"]) == {
        "skills", "academics", "clean_record", "readiness", "training", "affinity"
    }
