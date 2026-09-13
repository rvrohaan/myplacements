"""Reading and writing a student's skills, with their provenance.

The one place that writes ``student_skills`` rows and the **only** place that
assigns ``Student.skills``. Everything else goes through :func:`record`, which
replaces a single source's rows and then refreshes the cache, so the free-text
column and the provenance rows cannot drift apart.

Sources are replaced wholesale per source rather than merged: an officer editing
the skills field means "these are the skills I say they have", so a skill they
removed has to disappear. Removing an officer's row never removes the training
row behind the same skill - that was earned, not asserted, and is not the
officer's to delete.
"""

from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.student import Student
from app.models.student_skill import OFFICER, SOURCES, STUDENT, TRAINING, TRUST, StudentSkill
from app.models.training import StudentTraining, TrainingModule


def normalise(skill: str) -> str:
    """Skills are free text, so the same one arrives as "Python", "python " and
    "PYTHON". Compared lowercased and trimmed throughout."""
    return " ".join(skill.strip().lower().split())


def split_skills(raw: Optional[str]) -> list[str]:
    """A comma-separated field as a de-duplicated list of normalised skills."""
    if not raw:
        return []
    seen: list[str] = []
    for part in raw.split(","):
        s = normalise(part)
        if s and s not in seen:
            seen.append(s)
    return seen


def _labels(raw: Optional[str]) -> dict[str, str]:
    """normalised -> as typed, for the display label."""
    out: dict[str, str] = {}
    for part in (raw or "").split(","):
        text = part.strip()
        if text:
            out.setdefault(normalise(text), text)
    return out


def rows_for(db: Session, student_id: int) -> list[StudentSkill]:
    """Every recorded skill for one student, strongest source first."""
    rows = db.query(StudentSkill).filter(StudentSkill.student_id == student_id).all()
    return sorted(rows, key=lambda r: (TRUST.get(r.source, 9), r.skill))


def grouped(db: Session, student_id: int) -> list[dict]:
    """One entry per distinct skill, carrying every source that backs it.

    The strongest source leads, because that is the one that should decide how
    the skill is treated - but the rest travel with it rather than being
    collapsed away, so "trained and self-declared" stays visible.
    """
    out: dict[str, dict] = {}
    for r in rows_for(db, student_id):
        entry = out.setdefault(r.skill, {
            "skill": r.skill, "label": r.label or r.skill, "sources": [],
        })
        entry["sources"].append({
            "source": r.source,
            "evidence": r.evidence,
            "verified_at": r.verified_at.isoformat() if r.verified_at else None,
        })
    # rows_for is already trust-ordered, so the first source of each entry is the
    # strongest and this ordering carries that through to the list itself.
    return sorted(out.values(), key=lambda e: (TRUST.get(e["sources"][0]["source"], 9), e["skill"]))


def resync(db: Session, student: Student) -> None:
    """Rewrite ``Student.skills`` from the rows. The only writer of that column.

    Ordered strongest source first so the free-text field a human skims leads
    with what is actually backed. Uses the display label, not the normalised
    form - the cache is read by people and by the AI prompts.
    """
    db.flush()  # rows written earlier in this request must be visible
    seen: list[str] = []
    for r in rows_for(db, student.id):
        label = (r.label or r.skill).strip()
        if label and label.lower() not in {s.lower() for s in seen}:
            seen.append(label)
    student.skills = ", ".join(seen) if seen else None


def record(
    db: Session,
    student: Student,
    skills: Iterable[str] | str | None,
    *,
    source: str,
    evidence: Optional[str] = None,
    verified: bool = False,
) -> None:
    """Replace everything this source says about this student, then resync.

    ``skills`` may be the raw comma-separated string the form submitted or an
    iterable of skills. Passing an empty value clears this source - which is how
    an officer deletes a skill they added, and correctly leaves a training row
    for the same skill standing.
    """
    if source not in SOURCES:
        raise ValueError(f"Unknown skill source: {source}")

    # Never lose what the free-text column already held - see _seed_from_free_text.
    _seed_from_free_text(db, student)

    raw = skills if isinstance(skills, str) else ", ".join(skills or [])
    wanted = split_skills(raw)
    labels = _labels(raw)

    existing = {
        r.skill: r
        for r in db.query(StudentSkill).filter(
            StudentSkill.student_id == student.id, StudentSkill.source == source
        )
    }
    for skill in wanted:
        row = existing.pop(skill, None)
        if row is None:
            row = StudentSkill(student_id=student.id, skill=skill, source=source)
            db.add(row)
        row.label = labels.get(skill, skill)
        row.evidence = evidence
        # Only a source that can be checked stamps a time. An officer typing a
        # skill has not verified it, they have asserted it.
        row.verified_at = datetime.utcnow() if verified else None
    for orphan in existing.values():
        db.delete(orphan)

    resync(db, student)


def sync_training_skills(db: Session, student: Student) -> None:
    """Recompute the training-backed rows from what the student has completed.

    Derived rather than appended, so un-completing a module withdraws the skills
    it granted. The evidence names the modules, because "Python (trained)" is
    only useful if you can ask *where*.
    """
    _seed_from_free_text(db, student)

    rows = (
        db.query(TrainingModule.name, TrainingModule.skills, StudentTraining.completed_at)
        .join(StudentTraining, StudentTraining.module_id == TrainingModule.id)
        .filter(
            StudentTraining.student_id == student.id,
            StudentTraining.status == "completed",
        )
        .all()
    )
    by_skill: dict[str, list[str]] = {}
    labels: dict[str, str] = {}
    for name, skills_text, _ in rows:
        for part in (skills_text or "").split(","):
            text = part.strip()
            if not text:
                continue
            key = normalise(text)
            labels.setdefault(key, text)
            by_skill.setdefault(key, []).append(name)

    existing = {
        r.skill: r
        for r in db.query(StudentSkill).filter(
            StudentSkill.student_id == student.id, StudentSkill.source == TRAINING
        )
    }
    for skill, modules in by_skill.items():
        row = existing.pop(skill, None)
        if row is None:
            row = StudentSkill(student_id=student.id, skill=skill, source=TRAINING)
            db.add(row)
        row.label = labels.get(skill, skill)
        row.evidence = "Completed " + ", ".join(sorted(set(modules)))
        row.verified_at = row.verified_at or datetime.utcnow()
    for orphan in existing.values():
        db.delete(orphan)

    resync(db, student)


def _seed_from_free_text(db: Session, student: Student) -> int:
    """Capture a pre-table student's free-text skills as officer rows.

    **Every write path calls this first, and it is not optional.** ``resync``
    rebuilds ``Student.skills`` from the rows, so a student who still has only
    the old free-text column and no rows would have it rewritten to whatever the
    current write produced - a student listing "Java, SQL, C++" was reduced to
    "Python" the first time anybody marked one training module complete. Seeding
    first means the column can only ever gain.

    Attributed to ``officer``: that is who could edit the field. Claiming a
    provenance nobody recorded would defeat the purpose of recording provenance.

    Writes rows directly rather than calling :func:`record`, which calls this -
    going through it would recurse.
    """
    if db.query(StudentSkill).filter(StudentSkill.student_id == student.id).count():
        return 0
    found = split_skills(student.skills)
    if not found:
        return 0
    labels = _labels(student.skills)
    for skill in found:
        db.add(StudentSkill(
            student_id=student.id, skill=skill, source=OFFICER,
            label=labels.get(skill, skill),
            evidence="Recorded before skill sources were tracked",
        ))
    db.flush()
    return len(found)


def backfill(db: Session, student: Student) -> int:
    """Seed one student up front, for the one-off script.

    The write paths seed lazily anyway, so this is a convenience rather than a
    prerequisite - it converts a college in one pass instead of a student at a
    time as they are touched.
    """
    seeded = _seed_from_free_text(db, student)
    if seeded:
        resync(db, student)
    return seeded
