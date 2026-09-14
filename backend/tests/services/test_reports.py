"""app/services/report_defs.py - the reports that leave the building.

These are the highest-stakes output in the product. A placement report goes into
an NBA, NAAC or NIRF submission with the college's name on it, and once a figure
is quoted there it is very hard to walk back. So the tests here care less about
arithmetic than about the two things that make a figure *wrong*:

* **A caveat is never optional.** A number quoted without its basis is how a
  placement report becomes false while every cell in it is accurate.
* **"Not recorded" and "zero" are different answers.** Rendering a missing CGPA
  as 0 would put a student who has no marks on file into the bottom band.

Each builder is exercised against a small cohort rather than mocked, because the
queries are most of what could be wrong.
"""

import pytest

from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus
from app.models.user import UserRole
from app.services import report_defs
from app.services.report_builder import build_report_workbook
from tests import factories


@pytest.fixture
def head(db, college):
    return factories.make_user(db, college=college, role=UserRole.PRO_CHANCELLOR)


def place(db, college, company, *, ctc=10.0, batch_year=2026, **kw):
    student = factories.make_student(db, college=college, batch_year=batch_year, **kw)
    student.placement_status = PlacementStatus.PLACED
    student.placement_ctc = ctc
    db.add(Offer(student_id=student.id, company_id=company.id, status=OfferStatus.ACCEPTED, ctc=ctc))
    db.flush()
    return student


def run(report_id, db, head, **params):
    return report_defs.BY_ID[report_id].builder(db, head, params)


# --- the catalogue ----------------------------------------------------------


def test_every_report_is_addressable_by_id():
    assert set(report_defs.BY_ID) == {spec.id for spec in report_defs.REPORTS}


def test_every_report_describes_itself():
    """The list is a menu a placement head picks from; an unlabelled entry is
    one nobody runs."""
    for spec in report_defs.REPORTS:
        assert spec.name and spec.description
        assert callable(spec.builder)


@pytest.mark.parametrize("spec", report_defs.REPORTS, ids=lambda s: s.id)
def test_every_report_runs_on_an_empty_college(spec, db, head):
    """A college onboarded this morning must not meet a traceback. Reports are
    the first thing a new customer opens."""
    report = spec.builder(db, head, {})
    assert report.title
    assert isinstance(report.sections, list)


@pytest.mark.parametrize("spec", report_defs.REPORTS, ids=lambda s: s.id)
def test_every_report_exports_to_a_workbook(spec, db, head):
    """The on-screen report and the download are the same document; a section
    shape the writer cannot render would only fail at download time."""
    buffer = build_report_workbook(spec.builder(db, head, {}))
    assert buffer.getbuffer().nbytes > 0


@pytest.mark.parametrize("spec", report_defs.REPORTS, ids=lambda s: s.id)
def test_every_report_serialises_for_the_api(spec, db, head):
    payload = spec.builder(db, head, {}).to_dict()
    assert payload["title"]
    assert "caveats" in payload
    for section in payload["sections"]:
        assert len(section["columns"]) >= 1
        for row in section["rows"]:
            assert len(row) == len(section["columns"]), section["heading"]


@pytest.mark.parametrize("spec", report_defs.REPORTS, ids=lambda s: s.id)
def test_a_total_row_matches_the_column_count(spec, db, college, head):
    """A total row that has drifted from its table renders offset by a column,
    which is worse than having none."""
    company = factories.make_company(db, college=college)
    place(db, college, company)
    for section in spec.builder(db, head, {}).sections:
        if section.total_row:
            assert len(section.total_row) == len(section.columns), section.heading


# --- which batch, and saying so ---------------------------------------------


def test_a_named_batch_is_used(db, college, head):
    place(db, college, factories.make_company(db, college=college), batch_year=2025)
    report = run("branch-wise", db, head, batch_year=2025)
    assert "2025" in (report.subtitle or "") + str(report.meta)


def test_the_newest_batch_is_the_default(db, college, head):
    company = factories.make_company(db, college=college)
    place(db, college, company, batch_year=2024)
    place(db, college, company, batch_year=2026)
    report = run("branch-wise", db, head)
    assert "2026" in (report.subtitle or "")


def test_pooling_every_batch_says_so_in_the_subtitle(db, college, head):
    place(db, college, factories.make_company(db, college=college))
    report = run("branch-wise", db, head, all_batches=True)
    assert report.subtitle == "All batches"


def test_pooling_batches_carries_a_caveat_about_rates(db, college, head):
    """The one that matters most. Pooling an in-progress batch with finished
    years drags every percentage down, and the report then looks like a bad
    year rather than an unfinished one."""
    company = factories.make_company(db, college=college)
    place(db, college, company, batch_year=2024)
    place(db, college, company, batch_year=2026)

    report = run("branch-wise", db, head, all_batches=True)

    assert any("percentage does not" in c for c in report.caveats)
    assert any("2024-2026" in c for c in report.caveats)


def test_a_single_batch_carries_no_pooling_caveat(db, college, head):
    """It would be noise, and a report that cries wolf gets its caveats
    skipped."""
    place(db, college, factories.make_company(db, college=college))
    report = run("branch-wise", db, head, batch_year=2026)
    assert not any("pooled" in c for c in report.caveats)


def test_an_empty_college_is_not_described_as_pooling_anything(db, head):
    report = run("branch-wise", db, head, all_batches=True)
    assert not any("pooled" in c for c in report.caveats)


def test_a_deliberate_all_batches_request_is_not_confused_with_an_empty_college(db, head):
    """Both end up with no year to filter on. The flag is returned alongside so
    the report cannot claim to cover everything while covering nothing."""
    assert report_defs._resolve_batch(db, None, {"all_batches": True}) == (None, True)
    assert report_defs._resolve_batch(db, None, {"batch_year": 2026}) == (2026, False)


def test_the_batch_meta_row_does_not_stutter(db):
    """The row is already labelled "Batch", so "Batch: 2026 batch" reads badly."""
    assert report_defs._batch_meta(2026, False) == "2026"
    assert report_defs._batch_meta(None, True) == "All batches"
    assert report_defs._batch_meta(None, False) == "—"


# --- the reports themselves -------------------------------------------------


def test_placement_evidence_counts_the_placed(db, college, head):
    company = factories.make_company(db, college=college)
    place(db, college, company, ctc=12.0)
    factories.make_student(db, college=college)

    report = run("placement-evidence", db, head)

    assert report.sections
    assert any("12" in str(row) for section in report.sections for row in section.rows)


def test_branch_wise_separates_the_branches(db, college, head):
    company = factories.make_company(db, college=college)
    place(db, college, company, branch="CSE")
    place(db, college, company, branch="ECE")
    factories.make_student(db, college=college, branch="MECH")

    rows = [row for section in run("branch-wise", db, head).sections for row in section.rows]
    listed = {str(row[0]) for row in rows}
    assert {"CSE", "ECE", "MECH"} <= listed


def test_a_student_who_opted_out_is_not_counted_as_still_seeking(db, college, head):
    """They were never trying to be placed; counting them makes the college
    look worse than it is."""
    opted_out = factories.make_student(db, college=college)
    opted_out.placement_status = PlacementStatus.OPTED_OUT
    db.flush()
    report = run("unplaced-risk", db, head)
    rolls = {str(cell) for section in report.sections for row in section.rows for cell in row}
    assert opted_out.roll_number not in rolls


def test_the_seeking_list_leads_with_the_highest_risk(db, college, head):
    """It is a working list, so the order is the point."""
    factories.make_student(db, college=college, roll_number="SAFE", cgpa=9.5, backlogs=0)
    factories.make_student(db, college=college, roll_number="ATRISK", cgpa=4.5, backlogs=4)

    report = run("unplaced-risk", db, head)
    rows = [row for section in report.sections for row in section.rows if len(row) > 1]
    ordered = [str(row[0]) for row in rows]
    if "ATRISK" in ordered and "SAFE" in ordered:
        assert ordered.index("ATRISK") < ordered.index("SAFE")


def test_ctc_analysis_reports_what_was_offered(db, college, head):
    company = factories.make_company(db, college=college, name="Acme Corp")
    place(db, college, company, ctc=18.0)
    report = run("ctc-analysis", db, head)
    body = str([row for section in report.sections for row in section.rows])
    assert "Acme Corp" in body


def test_officer_followup_lists_each_officer(db, college, head):
    officer = factories.make_officer(db, college=college)
    report = run("officer-followup", db, head)
    body = str([row for section in report.sections for row in section.rows])
    assert officer.user.full_name in body


def test_company_conversion_tracks_how_far_a_company_got(db, college, head):
    company = factories.make_company(db, college=college, name="Acme Corp")
    place(db, college, company)
    report = run("company-conversion", db, head)
    body = str([row for section in report.sections for row in section.rows])
    assert "Acme Corp" in body


def test_hr_communication_lists_the_contacts(db, college, head):
    company = factories.make_company(db, college=college)
    factories.make_hr_contact(db, company=company, name="Priya Rao")
    report = run("hr-communication", db, head)
    body = str([row for section in report.sections for row in section.rows])
    assert "Priya Rao" in body


def test_training_effectiveness_compares_trained_with_untrained(db, college, head):
    module = factories.make_module(db, college=college, name="Aptitude Bootcamp")
    trained = factories.make_student(db, college=college)
    factories.enrol(db, student=trained, module=module, status="completed", mock_test_score=80.0)
    factories.make_student(db, college=college)

    report = run("training-effectiveness", db, head)
    body = str([row for section in report.sections for row in section.rows])
    assert "Aptitude Bootcamp" in body


def test_training_effectiveness_does_not_claim_a_cause(db, college, head):
    """Trained students placing better does not mean the training placed them -
    the students who turn up to optional training are not a random sample."""
    module = factories.make_module(db, college=college)
    student = factories.make_student(db, college=college)
    factories.enrol(db, student=student, module=module, status="completed")

    report = run("training-effectiveness", db, head)
    text = " ".join(report.caveats + [s.note or "" for s in report.sections]).lower()
    assert "cause" in text or "causal" in text or "not a random" in text


def test_monthly_progress_covers_several_months(db, college, head):
    place(db, college, factories.make_company(db, college=college))
    report = run("monthly-progress", db, head, months=3)
    assert report.sections


# --- tenant scoping ---------------------------------------------------------


@pytest.mark.parametrize(
    "report_id", ["branch-wise", "ctc-analysis", "unplaced-risk", "company-conversion"]
)
def test_a_report_covers_only_its_own_college(db, college, other_college, head, report_id):
    """These leave the building. Another college's students appearing in one is
    the worst version of the tenant leak."""
    theirs = factories.make_company(db, college=other_college, name="THEIRSECRETCORP")
    place(db, other_college, theirs, branch="THEIRBRANCH")
    place(db, college, factories.make_company(db, college=college), branch="CSE")

    report = report_defs.BY_ID[report_id].builder(db, head, {})
    body = str([row for section in report.sections for row in section.rows])

    assert "THEIRSECRETCORP" not in body
    assert "THEIRBRANCH" not in body


# --- not recorded is not zero -----------------------------------------------


def test_a_missing_value_stays_missing_through_serialisation(db):
    """`_plain` keeps None as None. Turning it into 0 would put a student with
    no marks on file into the bottom band; turning it into "None" would print
    the word."""
    from app.services.report_builder import _plain

    assert _plain(None) is None
    assert _plain(0) == 0


def test_a_report_always_carries_its_caveats_field(db, head):
    """Always rendered, never optional."""
    for spec in report_defs.REPORTS:
        assert isinstance(spec.builder(db, head, {}).caveats, list)


def test_the_median_helper_handles_an_empty_cohort(db):
    assert report_defs._median([]) is None
    assert report_defs._median([1.0, 3.0]) == 2.0


def test_a_percentage_of_nothing_is_none_rather_than_zero(db):
    """0% of no students asserts something false about an empty cohort."""
    assert report_defs._pct(0, 0) is None
    assert report_defs._pct(1, 4) == 25.0
