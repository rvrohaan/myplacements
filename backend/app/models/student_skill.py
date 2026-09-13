"""Skills with their provenance, so a verified skill stays distinguishable.

``Student.skills`` is one free-text column. Everything in it looks identical: a
skill an officer typed, one the student claimed, and one they demonstrably
earned by completing a training module all read the same. Once merged they can
never be told apart again, and can never be weighted differently - which is the
whole reason the matcher's shortlist labels its evidence.

This table keeps them apart. One row per (student, skill, source), because the
same skill genuinely can have more than one backing, and that is worth knowing:
"Python, trained and self-declared" is a stronger answer than either alone.

``Student.skills`` survives as a **derived cache** of the union - roughly a
dozen places read it (scoring, risk, the AI prompts, exports, search) and it is
what a human reads on the Students page. It has exactly one writer,
``services.skills.resync``, and must never be assigned directly. That is
denormalisation with a single author, not a second source of truth.

Certifications are deliberately **not** stored here. Evidence from a
certification is a text search against the skills a particular role asks for
("AWS Certified Developer" backs "aws"), and the set of skills to look for is
not known ahead of time - so the matcher derives it per shortlist, as it always
has. Rows here are the sources that *are* enumerable.
"""

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.core.database import Base

#: Where a skill came from. Plain strings rather than a native Postgres enum,
#: matching DailyUpdate and CompanyAssignment: adding a value to a native enum
#: needs an autocommit migration, and this list will grow (an assessment score,
#: a verified project, an employer's own confirmation).
OFFICER = "officer"
STUDENT = "student"
TRAINING = "training"
SOURCES = (TRAINING, OFFICER, STUDENT)

#: How much a source is worth, strongest first. The matcher already ranks its
#: evidence training > certification > declared; this extends that ordering
#: downwards rather than inventing a second one. A student's own claim sits
#: below an officer's entry because nobody checked it.
TRUST = {TRAINING: 0, OFFICER: 1, STUDENT: 2}


class StudentSkill(Base):
    __tablename__ = "student_skills"
    __table_args__ = (
        UniqueConstraint("student_id", "skill", "source", name="uq_student_skill_source"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(
        Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: Normalised: lowercased, trimmed, inner whitespace collapsed. The unique
    #: constraint is only meaningful if the same skill always spells the same.
    skill = Column(String(120), nullable=False)
    #: As it was typed, for display. "React Native" reads better than "react native".
    label = Column(String(120), nullable=True)

    source = Column(String(32), nullable=False, default=OFFICER)
    #: What backs it, in words - the module completed, or who entered it. Shown
    #: to whoever is deciding whether to trust the row.
    evidence = Column(Text, nullable=True)
    #: When a source that can be checked confirmed it. NULL for anything merely
    #: asserted, which is the difference this table exists to keep.
    verified_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    student = relationship("Student", backref="skill_rows")
