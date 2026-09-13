"""Placement risk: scoring students on their inputs, and checking it works.

Two things live here.

**An input-only score.** ``student_scoring.assess`` folds placement status into
its answer — a placed student is 100/low by definition. That is right for the
stored field (it answers "does this student still need attention?") but makes
the score impossible to validate: asking whether it predicts placement when it
is *derived* from placement is circular. The scores below read only the things
that were true *before* an outcome: marks, backlogs, skills, certifications,
training and how far the student got in drives.

**Calibration.** Nobody currently knows whether the risk band predicts anything.
For a batch whose outcomes are settled, score every student on inputs alone and
compare the bands against what actually happened. A model whose "high risk"
students are placed as often as its "low risk" ones is not measuring risk, and
that is worth discovering before anyone acts on it.

Deliberately not a language model. This runs on structured features, needs to be
reproducible for a student who asks why they were flagged, and the stored score
is recomputed on every save — a per-save network call would be wrong on cost,
latency and auditability alike.
"""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.models.drive import DriveParticipant, ParticipantStatus
from app.models.student import PlacementStatus, RiskCategory, Student
from app.models.training import StudentTraining, TrainingModule
from app.models.user import User

# Participant states that mean the student got past the first hurdle. Reaching a
# later round is evidence a company engaged with them, which nothing in the
# baseline score can see.
PROGRESSED = (
    ParticipantStatus.SHORTLISTED,
    ParticipantStatus.IN_PROCESS,
    ParticipantStatus.APTITUDE_CLEARED,
    ParticipantStatus.TECHNICAL_CLEARED,
    ParticipantStatus.HR_CLEARED,
    ParticipantStatus.SELECTED,
)


@dataclass
class Evidence:
    """What was known about a student independently of the outcome."""

    student_id: int
    cgpa: Optional[float] = None
    backlogs: int = 0
    skills: int = 0
    certifications: int = 0
    modules_completed: int = 0
    avg_mock: Optional[float] = None
    applications: int = 0
    progressed: int = 0


def _count_items(raw: Optional[str]) -> int:
    return len([p for p in (raw or "").split(",") if p.strip()])


def gather(db: Session, students: list[Student]) -> dict[int, Evidence]:
    """Evidence for a whole cohort in three queries, never one per student."""
    ids = [s.id for s in students]
    out = {
        s.id: Evidence(
            student_id=s.id,
            cgpa=s.cgpa,
            backlogs=s.backlogs or 0,
            skills=_count_items(s.skills),
            certifications=_count_items(s.certifications),
        )
        for s in students
    }
    if not ids:
        return out

    for student_id, status, mock in (
        db.query(StudentTraining.student_id, StudentTraining.status,
                 StudentTraining.mock_test_score)
        .join(TrainingModule, StudentTraining.module_id == TrainingModule.id)
        .filter(StudentTraining.student_id.in_(ids))
        .all()
    ):
        entry = out.get(student_id)
        if entry is None:
            continue
        if status == "completed":
            entry.modules_completed += 1
        if mock is not None:
            entry.avg_mock = mock if entry.avg_mock is None else (entry.avg_mock + mock) / 2

    for student_id, status in (
        db.query(DriveParticipant.student_id, DriveParticipant.status)
        .filter(DriveParticipant.student_id.in_(ids))
        .all()
    ):
        entry = out.get(student_id)
        if entry is None:
            continue
        entry.applications += 1
        if status in PROGRESSED:
            entry.progressed += 1

    return out


def score_baseline(e: Evidence) -> float:
    """The rule shipped in student_scoring, with placement status removed.

    Kept verbatim otherwise, so calibrating it tells you about the score the app
    has actually been storing rather than about a lookalike.
    """
    score = (max(0.0, min(e.cgpa, 10.0)) / 10.0 * 50.0) if e.cgpa is not None else 25.0
    score += max(0.0, 30.0 - e.backlogs * 10.0)
    score += min(e.skills * 5.0, 20.0)
    return round(min(max(score, 0.0), 100.0), 1)


def _steps(count: int, ladder: list[float]) -> float:
    """A gentle 0-1 curve: the first one counts for most of it."""
    if count <= 0:
        return 0.0
    return ladder[min(count, len(ladder)) - 1]


def score_evidence(e: Evidence) -> float:
    """The same academics, plus what the college has since started recording:
    certifications, completed training, mock performance, and whether any company
    has engaged with the student.

    **Optional evidence can only help.** Each component is scored only when there
    is something to score, and the weights of the rest are renormalised — so a
    college that has not adopted Training yet does not see every student drop a
    band, and a student is never marked riskier for a record nobody kept. The
    same reasoning the matcher applies to its training component.

    The weights are reasoned, not fitted, which is exactly why
    :func:`calibration` exists. Put this in place of the baseline only once it
    separates better on your own past batches.
    """
    parts: list[tuple[float, float]] = []  # (weight, 0-1 value)

    if e.cgpa is not None:
        parts.append((35.0, max(0.0, min(e.cgpa, 10.0)) / 10.0))
    # Always scored: every student record has a backlog count and a skills field,
    # so a blank one is a real answer rather than a gap in the college's process.
    parts.append((20.0, max(0.0, 1.0 - e.backlogs / 3.0)))
    parts.append((15.0, min(e.skills / 5.0, 1.0)))

    # Scored only when present — see the docstring.
    if e.certifications:
        parts.append((8.0, _steps(e.certifications, [0.7, 1.0])))
    if e.modules_completed:
        parts.append((8.0, _steps(e.modules_completed, [0.7, 1.0])))
    if e.avg_mock is not None:
        parts.append((6.0, max(0.0, min(e.avg_mock, 100.0)) / 100.0))
    if e.applications:
        parts.append((4.0, _steps(e.applications, [0.5, 0.75, 1.0])))
    if e.progressed:
        # Reaching a later round means a company engaged with this student —
        # the strongest signal here, and one nothing in the baseline can see.
        parts.append((4.0, 1.0))

    total_weight = sum(w for w, _ in parts)
    if not total_weight:
        return 0.0
    return round(sum(w * v for w, v in parts) / total_weight * 100, 1)


MODELS = {
    "baseline": ("Current rule (marks, backlogs, skills)", score_baseline),
    "evidence": ("With training, certifications and drive progress", score_evidence),
}

# Same thresholds student_scoring uses, so a band means the same thing.
def band(score: float) -> str:
    if score >= 70:
        return RiskCategory.LOW.value
    if score >= 40:
        return RiskCategory.MEDIUM.value
    return RiskCategory.HIGH.value


BAND_ORDER = [RiskCategory.HIGH.value, RiskCategory.MEDIUM.value, RiskCategory.LOW.value]


def calibration(db: Session, user: User, batch_year: Optional[int] = None) -> dict:
    """Does the score predict placement? Run both models over a settled batch.

    Only students who were *seeking* count: someone who opted out or went for
    higher studies was never trying to be placed, and counting them as an
    unplaced high-risk student would make any model look worse than it is.
    """
    q = db.query(Student)
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)
    q = q.filter(Student.placement_status.in_(
        (PlacementStatus.PLACED, PlacementStatus.UNPLACED)
    ))
    students = q.all()
    evidence = gather(db, students)
    placed = {s.id for s in students if s.placement_status == PlacementStatus.PLACED}

    models = []
    for key, (label, fn) in MODELS.items():
        bands: dict[str, dict] = {b: {"students": 0, "placed": 0} for b in BAND_ORDER}
        for s in students:
            b = band(fn(evidence[s.id]))
            bands[b]["students"] += 1
            if s.id in placed:
                bands[b]["placed"] += 1
        rows = [
            {
                "band": b,
                "students": bands[b]["students"],
                "placed": bands[b]["placed"],
                "placement_rate": (
                    round(bands[b]["placed"] * 100 / bands[b]["students"], 1)
                    if bands[b]["students"] else None
                ),
            }
            for b in BAND_ORDER
        ]
        low = next((r["placement_rate"] for r in rows if r["band"] == "low"), None)
        high = next((r["placement_rate"] for r in rows if r["band"] == "high"), None)
        models.append({
            "key": key,
            "label": label,
            "bands": rows,
            # The whole question in one number: how much better the students it
            # called safe did than the ones it called at risk. Near zero means
            # the bands carry no information, whatever else the chart shows.
            "separation": (
                round(low - high, 1) if low is not None and high is not None else None
            ),
        })

    return {
        "batch_year": batch_year,
        "students": len(students),
        "placed": len(placed),
        "placement_rate": (
            round(len(placed) * 100 / len(students), 1) if students else None
        ),
        "models": models,
        "excluded_not_seeking": _not_seeking(db, user, batch_year),
    }


def _not_seeking(db: Session, user: User, batch_year: Optional[int]) -> int:
    q = db.query(Student).filter(Student.placement_status.in_(
        (PlacementStatus.OPTED_OUT, PlacementStatus.HIGHER_STUDIES)
    ))
    if user.college_id:
        q = q.filter(Student.college_id == user.college_id)
    if batch_year:
        q = q.filter(Student.batch_year == batch_year)
    return q.count()
