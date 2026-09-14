"""app/services/matching.py - shortlisting students for a company.

The output of this goes to a recruiter with the college's name on it, so being
confidently wrong is worse than being cautious. Three rules encode that, and
they are what the tests below are mostly about:

* A blank criterion is **not applied**, never silently treated as zero. A
  company that recorded no CGPA bar has not set a bar of 0.0.
* A student with no CGPA on record cannot be shown to clear a CGPA bar, and is
  counted apart from those who genuinely missed it - one is a data gap to fix,
  the other is a fact about the student.
* Evidence is ranked by how it was earned. Completing a Python module is
  stronger than claiming Python, and being *enrolled* on one is not evidence at
  all.

Only the pure functions are covered here; the query-driven parts of
build_shortlist belong to the service tier.
"""

from types import SimpleNamespace

import pytest

from app.models.student import PlacementStatus
from app.services import matching
from app.services.matching import (
    Criteria,
    PastPattern,
    _academic_score,
    _affinity_score,
    _cert_mentions,
    _first_failure,
    _skill_score,
    resolve_criteria,
    skill_evidence,
    split_branches,
)


def student(**kw):
    return SimpleNamespace(
        id=kw.pop("id", 1),
        branch=kw.pop("branch", "CSE"),
        batch_year=kw.pop("batch_year", 2026),
        cgpa=kw.pop("cgpa", 8.0),
        backlogs=kw.pop("backlogs", 0),
        skills=kw.pop("skills", None),
        certifications=kw.pop("certifications", None),
        placement_status=kw.pop("placement_status", PlacementStatus.UNPLACED),
        **kw,
    )


def company(**kw):
    return SimpleNamespace(
        preferred_branches=kw.pop("preferred_branches", None),
        min_cgpa=kw.pop("min_cgpa", None),
        **kw,
    )


def role(**kw):
    return SimpleNamespace(
        eligible_branches=kw.pop("eligible_branches", None),
        min_cgpa=kw.pop("min_cgpa", None),
        max_backlogs=kw.pop("max_backlogs", None),
        skills=kw.pop("skills", None),
        **kw,
    )


# --- split_branches ---------------------------------------------------------


def test_branches_are_normalised_and_split():
    assert split_branches("CSE, ECE , ise") == ["cse", "ece", "ise"]


@pytest.mark.parametrize("raw", [None, "", "  ", ",", ", ,"])
def test_an_empty_branch_list_is_empty(raw):
    assert split_branches(raw) == []


# --- resolve_criteria -------------------------------------------------------


def test_the_role_bar_wins_over_the_company_bar():
    c = resolve_criteria(company(min_cgpa=6.0), role(min_cgpa=7.5), 2026)
    assert c.min_cgpa == 7.5
    assert c.source["min_cgpa"] == "role"


def test_the_company_bar_fills_in_what_the_role_leaves_blank():
    c = resolve_criteria(company(min_cgpa=6.0), role(min_cgpa=None), 2026)
    assert c.min_cgpa == 6.0
    assert c.source["min_cgpa"] == "company"


def test_a_criterion_blank_in_both_is_not_applied():
    """The rule that matters: not recorded is not the same as a bar of zero."""
    c = resolve_criteria(company(), role(), 2026)
    assert c.min_cgpa is None
    assert c.source["min_cgpa"] == "none"


def test_a_company_cgpa_of_zero_is_still_a_stated_bar():
    """Guards the `is not None` check against becoming a truthiness test."""
    c = resolve_criteria(company(min_cgpa=0.0), role(), 2026)
    assert c.min_cgpa == 0.0
    assert c.source["min_cgpa"] == "company"


def test_branches_fall_back_from_role_to_company():
    assert resolve_criteria(
        company(preferred_branches="CSE,ECE"), role(eligible_branches="ISE"), 2026
    ).branches == ["ise"]
    assert resolve_criteria(
        company(preferred_branches="CSE,ECE"), role(eligible_branches=None), 2026
    ).branches == ["cse", "ece"]


def test_backlogs_come_only_from_the_role():
    """Company has no such column, so there is nothing to fall back to."""
    assert resolve_criteria(company(), role(max_backlogs=1), 2026).max_backlogs == 1
    assert resolve_criteria(company(), role(), 2026).source["max_backlogs"] == "none"


def test_skills_come_only_from_the_role():
    c = resolve_criteria(company(), role(skills="Python, SQL"), 2026)
    assert c.skills == ["python", "sql"]
    assert c.source["skills"] == "role"


def test_matching_with_no_role_at_all_uses_the_company():
    c = resolve_criteria(company(preferred_branches="CSE", min_cgpa=7.0), None, 2026)
    assert c.branches == ["cse"]
    assert c.min_cgpa == 7.0
    assert c.skills == []


def test_every_criterion_records_where_it_came_from():
    """Shown in the UI so an empty shortlist can be traced to the criterion
    that emptied it."""
    c = resolve_criteria(company(), role(), 2026)
    assert set(c.source) == {"branches", "min_cgpa", "max_backlogs", "skills"}


def test_criteria_serialise_for_the_api():
    c = resolve_criteria(company(min_cgpa=7.0), role(skills="Python"), 2026)
    assert c.to_dict()["min_cgpa"] == 7.0
    assert c.to_dict()["skills"] == ["python"]


# --- _first_failure ---------------------------------------------------------


def test_an_eligible_student_fails_nothing():
    assert _first_failure(student(), Criteria(), False) is None


def test_a_student_who_opted_out_is_excluded():
    assert _first_failure(
        student(placement_status=PlacementStatus.OPTED_OUT), Criteria(), False
    ) == "not_seeking"


def test_a_student_going_for_higher_studies_is_excluded():
    assert _first_failure(
        student(placement_status=PlacementStatus.HIGHER_STUDIES), Criteria(), False
    ) == "not_seeking"


def test_a_placed_student_is_excluded_by_default():
    assert _first_failure(
        student(placement_status=PlacementStatus.PLACED), Criteria(), False
    ) == "already_placed"


def test_a_placed_student_can_be_included_deliberately():
    """For a company running a dream-offer round."""
    assert _first_failure(student(placement_status=PlacementStatus.PLACED), Criteria(), True) is None


def test_the_wrong_batch_is_excluded():
    assert _first_failure(student(batch_year=2025), Criteria(batch_year=2026), False) == "batch"


def test_an_ineligible_branch_is_excluded():
    assert _first_failure(student(branch="MECH"), Criteria(branches=["cse"]), False) == "branch"


def test_branch_matching_ignores_case_and_spacing():
    assert _first_failure(student(branch="  cse "), Criteria(branches=["cse"]), False) is None


def test_a_missing_cgpa_is_counted_apart_from_missing_the_bar():
    """One is a data gap for the college to fix, the other is a fact about the
    student, and merging them hides which."""
    assert _first_failure(student(cgpa=None), Criteria(min_cgpa=7.0), False) == "cgpa_missing"
    assert _first_failure(student(cgpa=6.0), Criteria(min_cgpa=7.0), False) == "cgpa"


def test_a_missing_cgpa_passes_when_no_bar_is_set():
    """No bar means the criterion is not applied, so an unrecorded CGPA is not
    itself a reason to exclude anyone."""
    assert _first_failure(student(cgpa=None), Criteria(), False) is None


def test_exactly_meeting_the_bar_passes():
    assert _first_failure(student(cgpa=7.0), Criteria(min_cgpa=7.0), False) is None


def test_too_many_backlogs_is_excluded():
    assert _first_failure(student(backlogs=3), Criteria(max_backlogs=1), False) == "backlogs"


def test_exactly_the_permitted_backlogs_passes():
    assert _first_failure(student(backlogs=1), Criteria(max_backlogs=1), False) is None


def test_a_backlog_bar_of_zero_is_enforced():
    assert _first_failure(student(backlogs=1), Criteria(max_backlogs=0), False) == "backlogs"
    assert _first_failure(student(backlogs=0), Criteria(max_backlogs=0), False) is None


def test_a_student_failing_several_rules_is_attributed_to_the_first():
    """So the exclusion tally sums to the number excluded rather than
    double-counting one person across two reasons."""
    failing = student(branch="MECH", cgpa=4.0, backlogs=5, batch_year=2020)
    criteria = Criteria(branches=["cse"], min_cgpa=7.0, max_backlogs=0, batch_year=2026)
    assert _first_failure(failing, criteria, False) == "batch"


def test_the_exclusion_order_is_the_order_reasons_are_reported_in():
    keys = [key for key, _ in matching.EXCLUSION_ORDER]
    assert keys.index("not_seeking") < keys.index("already_placed") < keys.index("batch")
    assert keys.index("cgpa_missing") < keys.index("cgpa")


def test_every_exclusion_reason_has_a_human_label():
    for key, label in matching.EXCLUSION_ORDER:
        assert key and label and label[0].isupper()


# --- _cert_mentions ---------------------------------------------------------


def test_a_certification_sentence_naming_a_skill_counts():
    """Certifications are a sentence, not a list: "AWS Certified Solutions
    Architect - Associate" is one entry naming one skill."""
    assert _cert_mentions("AWS Certified Solutions Architect", "aws") is True


def test_matching_is_case_insensitive():
    assert _cert_mentions("ORACLE JAVA SE 11", "java") is True


def test_a_skill_inside_a_longer_word_does_not_count():
    """Otherwise "Java" would match "JavaScript" and credit the wrong skill."""
    assert _cert_mentions("JavaScript Developer", "java") is False


def test_punctuated_skill_names_still_match():
    """Word boundaries would break on these, which is why the check uses
    lookarounds instead."""
    assert _cert_mentions("Certified C++ Programmer", "c++") is True
    assert _cert_mentions("Node.js Services Developer", "node.js") is True


def test_no_certifications_recorded_is_not_a_match():
    assert _cert_mentions(None, "aws") is False
    assert _cert_mentions("", "aws") is False


def test_an_unrelated_certification_is_not_a_match():
    assert _cert_mentions("First Aid Level 2", "aws") is False


# --- skill_evidence ---------------------------------------------------------


def test_training_is_the_strongest_evidence():
    """A completed module beats a claim, and must be reported as such."""
    ev = skill_evidence(student(skills="Python"), ["python"], {"python"})
    assert ev == {"python": "training"}


def test_a_certification_beats_a_bare_claim():
    ev = skill_evidence(student(skills="Python", certifications="Python Institute PCEP"), ["python"], set())
    assert ev == {"python": "certification"}


def test_a_declared_skill_is_still_evidence_just_the_weakest():
    assert skill_evidence(student(skills="Python"), ["python"], set()) == {"python": "declared"}


def test_a_skill_with_no_evidence_is_absent_rather_than_scored_zero():
    """Absence is what the missing list is built from."""
    assert skill_evidence(student(skills="Java"), ["python"], set()) == {}


def test_the_source_ranking_is_ordered_strongest_first():
    assert matching.SOURCE_ORDER == ("training", "certification", "declared")


# --- _skill_score -----------------------------------------------------------


def test_showing_every_wanted_skill_scores_fully():
    score, matched, missing = _skill_score({"python": "training", "sql": "declared"},
                                           {"python": 1.0, "sql": 1.0})
    assert score == 1.0
    assert set(matched) == {"python", "sql"}
    assert missing == []


def test_showing_none_scores_zero_and_lists_them_all():
    score, matched, missing = _skill_score({}, {"python": 1.0, "sql": 1.0})
    assert score == 0.0
    assert matched == []
    assert set(missing) == {"python", "sql"}


def test_the_score_is_weighted_not_a_bare_count():
    """A role that weights Python above SQL must reward the Python match more."""
    score, _, _ = _skill_score({"python": "declared"}, {"python": 3.0, "sql": 1.0})
    assert score == 0.75


def test_wanting_no_skills_scores_zero_with_nothing_missing():
    """Not 1.0: a role that named no skills has no skill evidence to offer, and
    scoring it full marks would rank it above a genuine match."""
    assert _skill_score({"python": "training"}, {}) == (0.0, [], [])


def test_matched_and_missing_together_account_for_every_wanted_skill():
    """So the number shown can be checked against the evidence beside it."""
    wanted = {"python": 1.0, "sql": 1.0, "aws": 1.0}
    _, matched, missing = _skill_score({"python": "training"}, wanted)
    assert set(matched) | set(missing) == set(wanted)
    assert not set(matched) & set(missing)


# --- _academic_score --------------------------------------------------------


def test_headroom_above_the_bar_is_what_scores():
    """Clearing a 6.0 bar with 9.0 is a stronger signal than clearing 8.5 with
    9.0 - raw CGPA would rank those two the same."""
    assert _academic_score(9.0, 6.0) > _academic_score(9.0, 8.5)


def test_exactly_meeting_the_bar_scores_zero_headroom():
    assert _academic_score(7.0, 7.0) == 0.0


def test_a_perfect_score_against_any_bar_is_full_marks():
    assert _academic_score(10.0, 6.0) == 1.0


def test_below_the_bar_never_goes_negative():
    """These students are excluded anyway, but a negative would corrupt the
    weighted total if the bar were ever relaxed."""
    assert _academic_score(5.0, 7.0) == 0.0


def test_with_no_bar_the_raw_cgpa_is_used():
    assert _academic_score(8.0, None) == 0.8


def test_an_out_of_range_cgpa_is_clamped():
    assert _academic_score(25.0, None) == 1.0


def test_no_cgpa_scores_zero_rather_than_raising():
    assert _academic_score(None, 7.0) == 0.0
    assert _academic_score(None, None) == 0.0


def test_a_bar_of_ten_does_not_divide_by_zero():
    """max(10 - bar, 0.1) exists for exactly this."""
    assert _academic_score(10.0, 10.0) == 0.0


# --- _affinity_score --------------------------------------------------------


def test_no_hiring_history_gives_no_affinity_signal():
    """Not a penalty - a company that has never hired here simply has no
    pattern to compare against."""
    assert _affinity_score(student(), PastPattern()) == 0.0


def test_a_student_from_a_branch_they_have_hired_scores():
    pattern = PastPattern(hires=3, branches=[("CSE", 3)])
    assert _affinity_score(student(branch="CSE"), pattern) == 1.0


def test_a_student_from_a_branch_they_have_not_hired_scores_nothing():
    pattern = PastPattern(hires=3, branches=[("CSE", 3)])
    assert _affinity_score(student(branch="MECH"), pattern) == 0.0


def test_branch_affinity_ignores_case():
    pattern = PastPattern(hires=1, branches=[("cse", 1)])
    assert _affinity_score(student(branch="CSE"), pattern) == 1.0


def test_a_cgpa_near_their_median_reads_as_a_match():
    pattern = PastPattern(hires=3, branches=[("CSE", 3)], median_cgpa=8.0)
    assert _affinity_score(student(branch="CSE", cgpa=8.3), pattern) == 1.0


def test_cgpa_affinity_decays_with_distance_from_the_median():
    pattern = PastPattern(hires=3, branches=[("CSE", 3)], median_cgpa=8.0)
    near = _affinity_score(student(branch="CSE", cgpa=8.8), pattern)
    far = _affinity_score(student(branch="CSE", cgpa=6.0), pattern)
    assert 1.0 > near > far


def test_shared_skills_with_past_hires_contribute():
    pattern = PastPattern(hires=2, branches=[("CSE", 2)], common_skills=[("python", 2), ("sql", 2)])
    both = _affinity_score(student(branch="CSE", skills="Python, SQL"), pattern)
    one = _affinity_score(student(branch="CSE", skills="Python"), pattern)
    neither = _affinity_score(student(branch="CSE", skills="COBOL"), pattern)
    assert both > one > neither


def test_affinity_stays_on_a_nought_to_one_scale():
    pattern = PastPattern(
        hires=5, branches=[("CSE", 5)], median_cgpa=8.0, common_skills=[("python", 5)]
    )
    for s in [student(branch="CSE", cgpa=8.0, skills="Python"),
              student(branch="MECH", cgpa=4.0, skills=None)]:
        assert 0.0 <= _affinity_score(s, pattern) <= 1.0


def test_a_missing_cgpa_simply_drops_that_component():
    """Rather than scoring it zero, which would penalise a student for a gap in
    the college's own records."""
    pattern = PastPattern(hires=2, branches=[("CSE", 2)], median_cgpa=8.0)
    assert _affinity_score(student(branch="CSE", cgpa=None), pattern) == 1.0


def test_the_pattern_serialises_for_the_api():
    pattern = PastPattern(hires=2, branches=[("CSE", 2)], common_skills=[("python", 2)])
    out = pattern.to_dict()
    assert out["hires"] == 2
    assert out["branches"] == [{"branch": "CSE", "students": 2}]
    assert out["common_skills"] == [{"skill": "python", "students": 2}]
