"""Seed student_skills from the free-text column students already have.

Everything in ``Student.skills`` predates the table and has no recorded source.
It is attributed to ``officer`` - that is who could edit the field - rather than
guessed at, because inventing a provenance would defeat the point of storing one.

Students who already have rows are skipped, so this is safe to re-run.

Dry run by default::

    python backfill_student_skills.py
    python backfill_student_skills.py --apply
"""

import sys

from app.core.database import SessionLocal
from app.models.student import Student
from app.models.student_skill import StudentSkill
from app.services import skills as skills_service

APPLY = "--apply" in sys.argv


def main() -> None:
    db = SessionLocal()
    try:
        already = {
            r[0] for r in db.query(StudentSkill.student_id).distinct().all()
        }
        students = db.query(Student).filter(Student.skills.isnot(None)).all()
        seeded = total = 0
        for student in students:
            if student.id in already:
                continue
            found = skills_service.split_skills(student.skills)
            if not found:
                continue
            print(f"  {student.roll_number}: {len(found)} skill(s) -> officer")
            seeded += 1
            total += len(found)
            if not APPLY:
                # record() would write; count only.
                continue
            skills_service.backfill(db, student)

        if APPLY:
            db.commit()
            print(f"\nSeeded {total} skill(s) across {seeded} student(s).")
        else:
            print(
                f"\nDry run: {total} skill(s) across {seeded} student(s) would be seeded. "
                "Re-run with --apply to write them."
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
