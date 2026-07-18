"""Rule-based placement readiness & risk scoring.

Derives a 0-100 readiness score and a low/medium/high risk band from a student's
academics and placement status. Intentionally simple and deterministic so it can
run on every create/update; can be swapped for an AI-driven assessment later.
"""

from typing import Optional, Tuple

from app.models.student import PlacementStatus, RiskCategory


def assess(
    cgpa: Optional[float],
    backlogs: Optional[int],
    skills: Optional[str],
    placement_status: PlacementStatus,
) -> Tuple[Optional[float], RiskCategory]:
    # Already placed → fully ready, no risk.
    if placement_status == PlacementStatus.PLACED:
        return 100.0, RiskCategory.LOW
    # Not actively seeking placement → not "at risk" of being unplaced.
    if placement_status in (PlacementStatus.HIGHER_STUDIES, PlacementStatus.OPTED_OUT):
        return None, RiskCategory.LOW

    # Unplaced & seeking → score the profile.
    score = 0.0
    # CGPA: up to 50 points (unknown CGPA assumed mid-range).
    score += (max(0.0, min(cgpa, 10.0)) / 10.0 * 50.0) if cgpa is not None else 25.0
    # Backlogs: up to 30 points, each backlog costs 10.
    score += max(0.0, 30.0 - (backlogs or 0) * 10.0)
    # Skills: up to 20 points, 5 per listed skill.
    if skills and skills.strip():
        skill_count = len([s for s in skills.split(",") if s.strip()])
        score += min(skill_count * 5.0, 20.0)

    score = round(min(max(score, 0.0), 100.0), 1)

    if score >= 70:
        risk = RiskCategory.LOW
    elif score >= 40:
        risk = RiskCategory.MEDIUM
    else:
        risk = RiskCategory.HIGH

    return score, risk
