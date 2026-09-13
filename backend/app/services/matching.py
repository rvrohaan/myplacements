"""Module 6 — matching students to a company's role.

The split here is the whole design:

* **Eligibility is a rule, not a judgement.** Branch, CGPA, backlogs and batch
  come off the role (or the company) as recorded by staff, and are applied in
  SQL-shaped Python. A student is in or out for a stated reason, and the reason
  is reported.
* **The ranking is deterministic and auditable.** Every candidate's score is a
  weighted sum of components that are each shown. A placement head has to be
  able to answer "why is this student third?", and "the model said so" is not an
  answer when a parent asks.
* **AI shapes the inputs, never the order.** Where it is used, it produces a
  *weighted skill profile* — which skills matter for this role and how much —
  and that profile is shown to the user before it changes any number. The
  arithmetic that consumes it is the code below, the same with or without it.

Everything except the skill profile works with no API key at all.
"""

import re
import statistics
from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.company import Company, CompanyRole
from app.models.offer import Offer, OfferStatus
from app.models.student import PlacementStatus, Student
from app.models.training import StudentTraining, TrainingModule

# Offer states that mean a student actually landed the job. Mirrors
# analytics.WON_OFFER_STATUSES.
WON = (OfferStatus.ACCEPTED, OfferStatus.JOINED)

# How much each component contributes to the fit score. Exposed in the response
# because a weighting nobody can see is a weighting nobody can argue with.
DEFAULT_WEIGHTS = {
    "skills": 0.35,
    "academics": 0.20,
    "clean_record": 0.10,
    "readiness": 0.15,
    "training": 0.10,
    "affinity": 0.10,
}


# Defined in services.skills, which owns the skills tables, and re-exported here
# because callers have always imported them from the matcher. One definition: a
# second spelling of "normalise" would let a skill match in one place and miss in
# the other.
from app.services.skills import normalise, split_skills  # noqa: E402,F401


def split_branches(raw: Optional[str]) -> list[str]:
    return [normalise(b) for b in (raw or "").split(",") if normalise(b)]


@dataclass
class Criteria:
    """The bar a student has to clear, and where each part of it came from."""

    branches: list[str] = field(default_factory=list)
    min_cgpa: Optional[float] = None
    max_backlogs: Optional[int] = None
    skills: list[str] = field(default_factory=list)
    batch_year: Optional[int] = None
    #: Which record supplied each value — "role", "company" or "none". Shown in
    #: the UI so an empty shortlist can be traced to the criterion that caused it.
    source: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "branches": self.branches,
            "min_cgpa": self.min_cgpa,
            "max_backlogs": self.max_backlogs,
            "skills": self.skills,
            "batch_year": self.batch_year,
            "source": self.source,
        }


def resolve_criteria(
    company: Company, role: Optional[CompanyRole], batch_year: Optional[int]
) -> Criteria:
    """The role's own bar wins; anything it leaves blank falls back to the
    company's. A blank in both means the criterion simply isn't applied — it is
    not silently treated as zero."""
    c = Criteria(batch_year=batch_year)

    role_branches = split_branches(role.eligible_branches) if role else []
    company_branches = split_branches(company.preferred_branches)
    if role_branches:
        c.branches, c.source["branches"] = role_branches, "role"
    elif company_branches:
        c.branches, c.source["branches"] = company_branches, "company"
    else:
        c.source["branches"] = "none"

    if role and role.min_cgpa is not None:
        c.min_cgpa, c.source["min_cgpa"] = role.min_cgpa, "role"
    elif company.min_cgpa is not None:
        c.min_cgpa, c.source["min_cgpa"] = company.min_cgpa, "company"
    else:
        c.source["min_cgpa"] = "none"

    if role and role.max_backlogs is not None:
        c.max_backlogs, c.source["max_backlogs"] = role.max_backlogs, "role"
    else:
        c.source["max_backlogs"] = "none"

    role_skills = split_skills(role.skills) if role else []
    if role_skills:
        c.skills, c.source["skills"] = role_skills, "role"
    else:
        c.source["skills"] = "none"

    return c


# Order matters: a student is attributed to the *first* rule they fail, so the
# tally sums to the number excluded rather than double-counting someone who
# misses on two counts.
EXCLUSION_ORDER = [
    ("not_seeking", "Opted out or going for higher studies"),
    ("already_placed", "Already placed"),
    ("batch", "Different batch"),
    ("branch", "Branch not eligible"),
    ("cgpa_missing", "No CGPA on record"),
    ("cgpa", "Below the CGPA bar"),
    ("backlogs", "Too many backlogs"),
]


def _first_failure(
    student: Student, c: Criteria, include_placed: bool
) -> Optional[str]:
    if student.placement_status in (PlacementStatus.OPTED_OUT, PlacementStatus.HIGHER_STUDIES):
        return "not_seeking"
    if not include_placed and student.placement_status == PlacementStatus.PLACED:
        return "already_placed"
    if c.batch_year and student.batch_year != c.batch_year:
        return "batch"
    if c.branches and normalise(student.branch or "") not in c.branches:
        return "branch"
    if c.min_cgpa is not None:
        # A student with no CGPA recorded cannot be shown to clear a CGPA bar.
        # Counted separately rather than lumped in with those who missed it —
        # one is a data gap to fix, the other is a fact about the student.
        if student.cgpa is None:
            return "cgpa_missing"
        if student.cgpa < c.min_cgpa:
            return "cgpa"
    if c.max_backlogs is not None and (student.backlogs or 0) > c.max_backlogs:
        return "backlogs"
    return None


@dataclass
class PastPattern:
    """What this company has actually done here before — the only evidence that
    beats a stated preference."""

    hires: int = 0
    branches: list[tuple[str, int]] = field(default_factory=list)
    median_cgpa: Optional[float] = None
    min_cgpa: Optional[float] = None
    common_skills: list[tuple[str, int]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "hires": self.hires,
            "branches": [{"branch": b, "students": n} for b, n in self.branches],
            "median_cgpa": self.median_cgpa,
            "min_cgpa": self.min_cgpa,
            "common_skills": [{"skill": s, "students": n} for s, n in self.common_skills],
        }


def past_pattern(db: Session, company: Company) -> PastPattern:
    rows = (
        db.query(Student)
        .join(Offer, Offer.student_id == Student.id)
        .filter(Offer.company_id == company.id, Offer.status.in_(WON))
        .all()
    )
    students = {s.id: s for s in rows}.values()  # one row per student
    if not students:
        return PastPattern()

    branches: dict[str, int] = {}
    skills: dict[str, int] = {}
    cgpas: list[float] = []
    for s in students:
        label = (s.branch or "Unrecorded").strip() or "Unrecorded"
        branches[label] = branches.get(label, 0) + 1
        for skill in split_skills(s.skills):
            skills[skill] = skills.get(skill, 0) + 1
        if s.cgpa is not None:
            cgpas.append(s.cgpa)

    return PastPattern(
        hires=len(students),
        branches=sorted(branches.items(), key=lambda kv: -kv[1]),
        median_cgpa=round(statistics.median(cgpas), 2) if cgpas else None,
        min_cgpa=round(min(cgpas), 2) if cgpas else None,
        common_skills=sorted(skills.items(), key=lambda kv: -kv[1])[:8],
    )


# Where the evidence for a skill came from, strongest first. A skill the college
# itself taught and marked complete is better evidence than one a student typed
# into a form, and the shortlist says which it had — without that, "verified" and
# "claimed" are indistinguishable and can never be weighted differently later.
SOURCE_ORDER = ("training", "certification", "declared")


def _cert_mentions(certifications: Optional[str], skill: str) -> bool:
    """Whether a certification line names this skill.

    Certifications are a sentence, not a list — "AWS Certified Solutions
    Architect – Associate" is one entry naming one skill. So this is a
    whole-word search rather than an exact match, with lookarounds instead of
    \\b so that "c++" and "node.js" still work.
    """
    if not certifications:
        return False
    haystack = normalise(certifications)
    return re.search(rf"(?<!\w){re.escape(skill)}(?!\w)", haystack) is not None


def trained_skills(db: Session, student_ids: list[int]) -> dict[int, set[str]]:
    """Skills each student earned by **completing** a module that declares them.

    Only completed records count. Being enrolled on a Python course is not
    evidence of Python, and crediting it would make the shortlist confidently
    wrong about the one thing it weights most.
    """
    if not student_ids:
        return {}
    rows = (
        db.query(StudentTraining.student_id, TrainingModule.skills)
        .join(TrainingModule, StudentTraining.module_id == TrainingModule.id)
        .filter(
            StudentTraining.student_id.in_(student_ids),
            StudentTraining.status == "completed",
            TrainingModule.skills.isnot(None),
        )
        .all()
    )
    out: dict[int, set[str]] = {}
    for student_id, skills in rows:
        out.setdefault(student_id, set()).update(split_skills(skills))
    return out


def skill_evidence(
    student: Student, wanted: Iterable[str], earned: set[str]
) -> dict[str, str]:
    """For each wanted skill the student can show, the strongest source for it."""
    declared = set(split_skills(student.skills))
    found: dict[str, str] = {}
    for skill in wanted:
        if skill in earned:
            found[skill] = "training"
        elif _cert_mentions(student.certifications, skill):
            found[skill] = "certification"
        elif skill in declared:
            found[skill] = "declared"
    return found


def _skill_score(evidence: dict[str, str], wanted: dict[str, float]) -> tuple[float, list, list]:
    """Share of the wanted skills this student can show, weighted. Returns the
    score with the matched and missing lists, so the number can be checked
    against the evidence rather than taken on trust."""
    if not wanted:
        return 0.0, [], []
    matched = [s for s in wanted if s in evidence]
    missing = [s for s in wanted if s not in evidence]
    total = sum(wanted.values())
    got = sum(w for s, w in wanted.items() if s in evidence)
    return (got / total if total else 0.0), matched, missing


def _academic_score(cgpa: Optional[float], bar: Optional[float]) -> float:
    """Headroom above the bar, not raw CGPA: clearing a 6.0 bar with 9.0 is a
    stronger signal than clearing an 8.5 bar with 9.0."""
    if cgpa is None:
        return 0.0
    if bar is None:
        return max(0.0, min(cgpa / 10.0, 1.0))
    headroom = (cgpa - bar) / max(10.0 - bar, 0.1)
    return max(0.0, min(headroom, 1.0))


def _affinity_score(student: Student, pattern: PastPattern) -> float:
    """How much this student looks like the people the company took before."""
    if not pattern.hires:
        return 0.0
    parts: list[float] = []
    branch_names = {b for b, _ in pattern.branches}
    parts.append(1.0 if normalise(student.branch or "") in
                 {normalise(b) for b in branch_names} else 0.0)
    if pattern.median_cgpa is not None and student.cgpa is not None:
        # Within half a point of their median reads as a match, decaying after.
        gap = abs(student.cgpa - pattern.median_cgpa)
        parts.append(max(0.0, min(1.0, 1.0 - (gap - 0.5) / 2.0)) if gap > 0.5 else 1.0)
    if pattern.common_skills:
        # Declared skills only here: this compares like with like, since the
        # past hires' skills are themselves read off their declared lists.
        wanted = {s for s, _ in pattern.common_skills}
        have = set(split_skills(student.skills))
        parts.append(len(wanted & have) / len(wanted))
    return sum(parts) / len(parts) if parts else 0.0


def build_shortlist(
    db: Session,
    students: Iterable[Student],
    company: Company,
    criteria: Criteria,
    *,
    skill_weights: Optional[dict[str, float]] = None,
    include_placed: bool = False,
    limit: int = 25,
) -> dict:
    """Filter, score and rank. Pure arithmetic over rows already fetched."""
    pattern = past_pattern(db, company)

    eligible: list[Student] = []
    excluded: dict[str, int] = {key: 0 for key, _ in EXCLUSION_ORDER}
    considered = 0
    for student in students:
        considered += 1
        failure = _first_failure(student, criteria, include_placed)
        if failure:
            excluded[failure] += 1
        else:
            eligible.append(student)

    # The skills that count, and how much. An AI profile supplies the weights
    # when one was asked for; otherwise every stated skill counts equally.
    wanted: dict[str, float] = (
        {normalise(k): float(v) for k, v in skill_weights.items() if normalise(k)}
        if skill_weights
        else {s: 1.0 for s in criteria.skills}
    )

    weights = dict(DEFAULT_WEIGHTS)
    if not pattern.hires:
        # Nothing to be similar to. Fold affinity's share into skills rather
        # than scoring every candidate 0 on it and flattening the spread.
        weights["skills"] += weights.pop("affinity")
        weights["affinity"] = 0.0
    if not wanted:
        # No skills recorded anywhere: don't score a component we cannot
        # measure — spread it over the ones we can.
        share = weights["skills"] / 4
        weights["skills"] = 0.0
        for key in ("academics", "clean_record", "readiness", "training"):
            weights[key] += share

    eligible_ids = [s.id for s in eligible]
    trained = _training_lookup(db, eligible_ids)
    earned = trained_skills(db, eligible_ids)

    ranked = []
    for student in eligible:
        evidence = skill_evidence(student, wanted, earned.get(student.id, set()))
        skill_score, matched, missing = _skill_score(evidence, wanted)
        academics = _academic_score(student.cgpa, criteria.min_cgpa)
        clean = 1.0 if not (student.backlogs or 0) else max(0.0, 1.0 - (student.backlogs or 0) / 4)
        readiness = (student.readiness_score or 0) / 100.0
        training = trained.get(student.id, 0.0)
        affinity = _affinity_score(student, pattern)

        components = {
            "skills": skill_score,
            "academics": academics,
            "clean_record": clean,
            "readiness": readiness,
            "training": training,
            "affinity": affinity,
        }
        score = sum(components[k] * weights[k] for k in weights)
        ranked.append({
            "student_id": student.id,
            "roll_number": student.roll_number,
            "name": student.full_name,
            "branch": student.branch,
            "batch_year": student.batch_year,
            "cgpa": student.cgpa,
            "backlogs": student.backlogs or 0,
            "readiness_score": student.readiness_score,
            "placement_status": student.placement_status.value if student.placement_status else None,
            "score": round(score * 100, 1),
            "components": {k: round(v * 100, 1) for k, v in components.items()},
            "matched_skills": matched,
            "missing_skills": missing,
            # What backs each matched skill: "training" (a completed module that
            # teaches it), "certification" or "declared".
            "skill_evidence": evidence,
        })

    ranked.sort(key=lambda r: (-r["score"], r["roll_number"]))

    # Where the shortlist is weakest: the wanted skills the most candidates lack.
    gaps = []
    if wanted and eligible:
        for skill in wanted:
            lacking = sum(1 for r in ranked if skill in r["missing_skills"])
            if lacking:
                gaps.append({
                    "skill": skill,
                    "students_missing": lacking,
                    "share_missing": round(lacking * 100 / len(ranked), 1),
                })
        gaps.sort(key=lambda g: -g["students_missing"])

    return {
        "considered": considered,
        "eligible": len(eligible),
        "excluded": [
            {"reason": key, "label": label, "students": excluded[key]}
            for key, label in EXCLUSION_ORDER
            if excluded[key]
        ],
        "weights": {k: round(v, 3) for k, v in weights.items()},
        "skills_used": [{"skill": s, "weight": round(w, 2)} for s, w in
                        sorted(wanted.items(), key=lambda kv: -kv[1])],
        "shortlist": ranked[:limit],
        "training_gaps": gaps[:8],
        "past_pattern": pattern.to_dict(),
    }


def _training_lookup(db: Session, student_ids: list[int]) -> dict[int, float]:
    """A 0-1 training signal per student: mock scores where recorded, otherwise
    credit for having turned up at all. A student with no training record scores
    0 here, which is the absence of evidence, not evidence of weakness — it is
    only ever a tenth of the total."""
    if not student_ids:
        return {}
    rows = (
        db.query(StudentTraining.student_id, StudentTraining.mock_test_score,
                 StudentTraining.attendance_percent)
        .filter(StudentTraining.student_id.in_(student_ids))
        .all()
    )
    by_student: dict[int, list] = {}
    for r in rows:
        by_student.setdefault(r.student_id, []).append(r)
    out: dict[int, float] = {}
    for sid, records in by_student.items():
        mocks = [r.mock_test_score for r in records if r.mock_test_score is not None]
        attendance = [r.attendance_percent for r in records if r.attendance_percent is not None]
        if mocks:
            out[sid] = max(0.0, min(sum(mocks) / len(mocks) / 100.0, 1.0))
        elif attendance:
            out[sid] = max(0.0, min(sum(attendance) / len(attendance) / 100.0, 1.0)) * 0.6
        else:
            out[sid] = 0.4  # enrolled, nothing measured yet
    return out
