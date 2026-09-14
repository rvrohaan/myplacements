"""app/services/skills.py - skills and where they came from.

`Student.skills` is a free-text column in which a skill an officer typed, one a
student claimed, and one they demonstrably earned all read identically. This
module keeps them apart in `student_skills` and treats the column as a derived
cache with exactly one writer.

Three invariants carry the design, and each has a real failure behind it:

* **The cache can only ever gain.** A student listing "Java, SQL, C++" was once
  reduced to "Python" the first time anybody marked a training module complete,
  because resync rebuilt the column from rows that did not exist yet. Every
  write path seeds from the free text first.
* **A source owns only its own rows.** An officer deleting a skill they added
  must not remove the training row behind the same skill - that was earned, not
  asserted, and is not theirs to delete.
* **Training rows are derived, not appended.** Un-completing a module withdraws
  the skills it granted.
"""

import pytest

from app.models.student_skill import OFFICER, STUDENT, TRAINING, StudentSkill
from app.services import skills
from tests import factories


@pytest.fixture
def student(db, college):
    return factories.make_student(db, college=college)


def rows(db, student, source=None):
    q = db.query(StudentSkill).filter(StudentSkill.student_id == student.id)
    if source:
        q = q.filter(StudentSkill.source == source)
    return {r.skill for r in q}


def cached(student) -> list[str]:
    return [s.strip() for s in (student.skills or "").split(",") if s.strip()]


# --- recording a source -----------------------------------------------------


def test_recording_skills_writes_rows_and_refreshes_the_cache(db, student):
    skills.record(db, student, "Python, SQL", source=OFFICER)
    assert rows(db, student) == {"python", "sql"}
    assert cached(student) == ["Python", "SQL"]


def test_the_cache_keeps_the_spelling_that_was_typed(db, student):
    """Rows are normalised for comparison; the column is read by people and by
    the AI prompts, so it carries the label."""
    skills.record(db, student, "React Native, Machine Learning", source=OFFICER)
    assert set(cached(student)) == {"React Native", "Machine Learning"}


def test_the_cache_is_ordered_by_trust_then_alphabetically(db, student):
    """Not by the order they were typed. Within one source the ordering is the
    skill name, which keeps the column stable across re-saves instead of
    churning every time somebody reorders the form field."""
    skills.record(db, student, "React Native, Machine Learning", source=OFFICER)
    assert cached(student) == ["Machine Learning", "React Native"]


def test_recording_replaces_that_source_wholesale(db, student):
    """An officer editing the field means "these are the skills I say they
    have", so one they removed has to disappear."""
    skills.record(db, student, "Python, SQL", source=OFFICER)
    skills.record(db, student, "Python", source=OFFICER)
    assert rows(db, student, OFFICER) == {"python"}


def test_recording_an_empty_value_clears_the_source(db, student):
    skills.record(db, student, "", source=OFFICER)
    assert rows(db, student, OFFICER) == set()


def test_two_sources_can_back_the_same_skill(db, student):
    """"Python, trained and self-declared" is a stronger answer than either
    alone, so the rows coexist rather than collapsing."""
    skills.record(db, student, "Python", source=OFFICER)
    skills.record(db, student, "Python", source=STUDENT)
    assert db.query(StudentSkill).filter(StudentSkill.skill == "python").count() == 2


def test_the_cache_lists_a_doubly_backed_skill_once(db, student):
    skills.record(db, student, "Python", source=OFFICER)
    skills.record(db, student, "Python", source=STUDENT)
    assert cached(student) == ["Python"]


def test_an_unknown_source_is_refused(db, student):
    """Provenance is the point; an unrecognised source would record a claim
    nobody can weigh."""
    with pytest.raises(ValueError, match="Unknown skill source"):
        skills.record(db, student, "Python", source="hearsay")


def test_only_a_checkable_source_stamps_a_verification_time(db, student):
    """An officer typing a skill has not verified it, they have asserted it."""
    skills.record(db, student, "Python", source=OFFICER)
    unverified = db.query(StudentSkill).filter(StudentSkill.source == OFFICER).one()
    assert unverified.verified_at is None

    skills.record(db, student, "SQL", source=OFFICER, verified=True)
    verified = db.query(StudentSkill).filter(StudentSkill.skill == "sql").one()
    assert verified.verified_at is not None


def test_duplicates_within_one_submission_collapse(db, student):
    skills.record(db, student, "Python, python, PYTHON", source=OFFICER)
    assert db.query(StudentSkill).count() == 1


# --- one source does not delete another's rows ------------------------------


def test_an_officer_clearing_their_skills_leaves_the_training_row(db, college, student):
    """The invariant stated most plainly. Training was earned; the officer has
    no standing to withdraw it."""
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    skills.record(db, student, "Python", source=OFFICER)

    skills.record(db, student, "", source=OFFICER)

    assert rows(db, student, OFFICER) == set()
    assert rows(db, student, TRAINING) == {"python"}
    assert cached(student) == ["Python"]


def test_a_student_claim_does_not_disturb_an_officer_row(db, student):
    skills.record(db, student, "Python", source=OFFICER)
    skills.record(db, student, "Rust", source=STUDENT)
    skills.record(db, student, "", source=STUDENT)
    assert rows(db, student, OFFICER) == {"python"}


# --- training rows are derived ----------------------------------------------


def test_completing_a_module_grants_the_skills_it_teaches(db, college, student):
    module = factories.make_module(db, college=college, skills="Python, SQL")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    assert rows(db, student, TRAINING) == {"python", "sql"}


def test_merely_enrolling_grants_nothing(db, college, student):
    """Being on a Python course is not evidence of Python, and crediting it
    would make the shortlist confidently wrong about what it weights most."""
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="enrolled")
    skills.sync_training_skills(db, student)
    assert rows(db, student, TRAINING) == set()


def test_un_completing_a_module_withdraws_its_skills(db, college, student):
    """Derived, not appended."""
    module = factories.make_module(db, college=college, skills="Python")
    record = factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    assert rows(db, student, TRAINING) == {"python"}

    record.status = "enrolled"
    db.flush()
    skills.sync_training_skills(db, student)
    assert rows(db, student, TRAINING) == set()


def test_a_module_that_declares_no_skills_grants_none(db, college, student):
    """A completion without a skills list says somebody attended something."""
    module = factories.make_module(db, college=college, skills=None)
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    assert rows(db, student, TRAINING) == set()


def test_the_evidence_names_the_modules(db, college, student):
    """"Python (trained)" is only useful if you can ask where."""
    module = factories.make_module(db, college=college, name="Python Bootcamp", skills="Python")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    row = db.query(StudentSkill).filter(StudentSkill.source == TRAINING).one()
    assert "Python Bootcamp" in row.evidence


def test_two_modules_teaching_one_skill_are_both_named(db, college, student):
    for name in ("Python Basics", "Advanced Python"):
        module = factories.make_module(db, college=college, name=name, skills="Python")
        factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)
    row = db.query(StudentSkill).filter(StudentSkill.source == TRAINING).one()
    assert "Python Basics" in row.evidence and "Advanced Python" in row.evidence


# --- the free-text seed -----------------------------------------------------


def test_a_pre_table_students_skills_are_captured_before_anything_is_written(db, college):
    """The regression this exists for: a student listing Java, SQL and C++ was
    reduced to Python the first time a module was marked complete."""
    legacy = factories.make_student(db, college=college, skills="Java, SQL, C++")
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=legacy, module=module, status="completed")

    skills.sync_training_skills(db, legacy)

    assert {"java", "sql", "c++"} <= rows(db, legacy)
    assert set(cached(legacy)) == {"Java", "SQL", "C++", "Python"}


def test_the_seed_is_attributed_to_the_officer(db, college):
    """That is who could edit the field. Claiming a provenance nobody recorded
    would defeat the purpose of recording provenance."""
    legacy = factories.make_student(db, college=college, skills="Java")
    skills.backfill(db, legacy)
    row = db.query(StudentSkill).filter(StudentSkill.student_id == legacy.id).one()
    assert row.source == OFFICER
    assert "before skill sources were tracked" in row.evidence


def test_the_seed_protects_legacy_skills_from_a_different_source(db, college):
    """The seed is attributed to `officer`, so it shields the free text from
    every *other* source's write - which is the case the regression was about,
    a training completion wiping a hand-entered list."""
    legacy = factories.make_student(db, college=college, skills="Java")
    skills.record(db, legacy, "Rust", source=STUDENT)
    assert rows(db, legacy) == {"java", "rust"}


def test_an_officers_own_write_replaces_the_legacy_rows_it_inherited(db, college):
    """The other side of that attribution, and correct: the seeded rows are
    officer rows, and an officer submitting the field means "these are the
    skills". In the app the form arrives pre-filled with the current value, so
    a genuine edit adds to the list rather than truncating it."""
    legacy = factories.make_student(db, college=college, skills="Java")
    skills.record(db, legacy, "Python", source=OFFICER)
    assert rows(db, legacy) == {"python"}


def test_the_seed_runs_only_once(db, college):
    """Keyed on there being no rows at all, so a student who later has every
    skill removed must not have the old free text resurrected."""
    legacy = factories.make_student(db, college=college, skills="Java")
    skills.record(db, legacy, "", source=STUDENT)  # seeds java, writes nothing
    assert rows(db, legacy) == {"java"}

    skills.record(db, legacy, "", source=OFFICER)  # clears the seeded rows
    assert rows(db, legacy) == set()

    skills.record(db, legacy, "", source=STUDENT)  # must not bring java back
    assert rows(db, legacy) == set()


def test_backfill_reports_what_it_seeded(db, college):
    legacy = factories.make_student(db, college=college, skills="Java, SQL")
    assert skills.backfill(db, legacy) == 2
    assert skills.backfill(db, legacy) == 0


def test_backfilling_a_student_with_no_skills_does_nothing(db, college):
    blank = factories.make_student(db, college=college, skills=None)
    assert skills.backfill(db, blank) == 0
    assert blank.skills is None


# --- reading back -----------------------------------------------------------


def test_rows_come_back_strongest_source_first(db, college, student):
    skills.record(db, student, "Rust", source=STUDENT)
    skills.record(db, student, "Go", source=OFFICER)
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)

    assert [r.source for r in skills.rows_for(db, student.id)] == [TRAINING, OFFICER, STUDENT]


def test_grouped_keeps_every_source_behind_a_skill(db, student):
    skills.record(db, student, "Python", source=OFFICER)
    skills.record(db, student, "Python", source=STUDENT)
    entry = skills.grouped(db, student.id)[0]
    assert entry["skill"] == "python"
    assert {s["source"] for s in entry["sources"]} == {OFFICER, STUDENT}


def test_grouped_leads_with_the_strongest_source(db, college, student):
    """That is the one that should decide how the skill is treated."""
    skills.record(db, student, "Python", source=STUDENT)
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)

    entry = skills.grouped(db, student.id)[0]
    assert entry["sources"][0]["source"] == TRAINING


def test_the_cache_leads_with_what_is_actually_backed(db, college, student):
    """The free-text field a human skims should open with the trained skill."""
    skills.record(db, student, "Rust", source=STUDENT)
    module = factories.make_module(db, college=college, skills="Python")
    factories.enrol(db, student=student, module=module, status="completed")
    skills.sync_training_skills(db, student)

    assert cached(student)[0] == "Python"


def test_a_student_with_no_skills_caches_null_not_an_empty_string(db, student):
    """Roughly a dozen places read this column; "" and None must not both be
    in circulation."""
    skills.record(db, student, "Python", source=OFFICER)
    skills.record(db, student, "", source=OFFICER)
    assert student.skills is None
