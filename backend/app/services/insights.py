"""The dashboard summary: what the numbers say, in sentences.

**The rules find; the model phrases.** Every figure and every judgement below is
computed here, deterministically, from the same services the charts and reports
already use. What goes to the model is a finished list of findings, and what
comes back is those findings joined into prose. It is not asked what matters, it
is told - so a summary can never quietly disagree with the chart beside it, and
turning the model off costs presentation, not content.

That split also makes the output checkable, which is the real reason for it.
:func:`verify` extracts every digit-bearing figure from the generated text and
rejects the whole narrative if any of them is not one this module supplied. A
model that rounds a placement rate, transposes a package or invents a company
count fails the check and the rule-written findings are shown instead, flagged.
The prompt therefore asks for digits *only* when quoting a supplied figure and
words for everything else ("two areas need attention"), which keeps the check
strict without tripping over ordinary prose.

Findings are ordered by severity and capped, because a summary that mentions
everything ranks nothing.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from app.models.student import PlacementStatus, RiskCategory, Student
from app.models.user import User
from app.services import company_metrics
from app.services.followups import owed_followups

#: How many findings reach the narrative. Beyond this the summary stops being a
#: summary; the dashboard itself is the place to see everything.
MAX_FINDINGS = 6

#: Worst first. A summary that opens with good news buries the thing somebody
#: needed to act on this morning.
SEVERITY_ORDER = {"urgent": 0, "watch": 1, "good": 2}


@dataclass
class Finding:
    """One thing the numbers say, written by a rule.

    ``headline`` is publishable as-is: if the model is unavailable this is what
    the user reads, so it is a full sentence rather than a fragment the narrator
    is expected to finish.
    """

    key: str
    severity: str
    headline: str
    #: Every figure quoted in ``headline``, as it is written there. These are the
    #: only numbers the narrative is allowed to use.
    numbers: list = field(default_factory=list)


def _pct(part: int, whole: int) -> Optional[float]:
    return round(part * 100 / whole, 1) if whole else None


def _fmt(value) -> str:
    """A number as it should appear in prose: no trailing .0 on whole numbers."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _plural(count: int, singular: str, plural: Optional[str] = None) -> str:
    """"1 follow-up", "2 follow-ups". These headlines are published verbatim
    whenever the model is off, so they have to read like English rather than
    like a template that was never finished."""
    return singular if count == 1 else (plural or singular + "s")


def gather(db: Session, user: User) -> tuple[dict, list[Finding]]:
    """The fact pack and the findings drawn from it.

    Scoped to the user's college throughout. Nothing here is officer-scoped: the
    summary is a leadership view, and the endpoint restricts it to those roles.
    """
    cid = user.college_id
    q = db.query(Student)
    if cid:
        q = q.filter(Student.college_id == cid)
    rows = q.with_entities(
        Student.batch_year, Student.placement_status, Student.placement_ctc,
        Student.risk_category,
    ).all()

    years = sorted({r.batch_year for r in rows if r.batch_year}, reverse=True)
    latest = years[0] if years else None
    previous = years[1] if len(years) > 1 else None

    facts: dict = {"batch_years": years, "latest_batch": latest}
    findings: list[Finding] = []

    def cohort(year):
        return [r for r in rows if r.batch_year == year]

    # --- placement rate, and whether it moved -------------------------------
    if latest is not None:
        now = cohort(latest)
        placed = [r for r in now if r.placement_status == PlacementStatus.PLACED]
        seeking = [r for r in now if r.placement_status == PlacementStatus.UNPLACED]
        rate = _pct(len(placed), len(now))
        facts["latest"] = {
            "batch": latest, "students": len(now), "placed": len(placed),
            "seeking": len(seeking), "placement_rate": rate,
        }
        if rate is not None:
            nums = [_fmt(latest), _fmt(len(placed)), _fmt(len(now)), _fmt(rate)]
            head = (f"The {latest} batch is {_fmt(rate)}% placed - {len(placed)} of "
                    f"{len(now)} students.")
            sev = "good" if rate >= 70 else "watch" if rate >= 40 else "urgent"

            if previous is not None:
                before = cohort(previous)
                before_rate = _pct(
                    sum(1 for r in before if r.placement_status == PlacementStatus.PLACED),
                    len(before),
                )
                facts["previous"] = {"batch": previous, "placement_rate": before_rate}
                if before_rate is not None:
                    delta = round(rate - before_rate, 1)
                    facts["latest"]["change_vs_previous"] = delta
                    direction = "ahead of" if delta > 0 else "behind" if delta < 0 else "level with"
                    head += (
                        f" That is {_fmt(abs(delta))} points {direction} the {previous} batch"
                        f" at {_fmt(before_rate)}%."
                    )
                    nums += [_fmt(abs(delta)), _fmt(previous), _fmt(before_rate)]
                    # A batch mid-cycle is *expected* to trail a finished one, so a
                    # drop only raises the severity once it is large.
                    if delta <= -10:
                        sev = "urgent"
            findings.append(Finding("placement_rate", sev, head, nums))

        # --- who is still waiting, and how exposed they are -----------------
        if seeking:
            high = sum(1 for r in seeking if r.risk_category == RiskCategory.HIGH)
            facts["latest"]["seeking_high_risk"] = high
            if high:
                findings.append(Finding(
                    "at_risk", "urgent",
                    f"{len(seeking)} {_plural(len(seeking), 'student is', 'students are')} "
                    f"still seeking, and {high} of them "
                    f"{_plural(high, 'is', 'are')} scored high risk.",
                    [_fmt(len(seeking)), _fmt(high)],
                ))
            else:
                findings.append(Finding(
                    "seeking", "watch",
                    f"{len(seeking)} {_plural(len(seeking), 'student is', 'students are')} "
                    f"still seeking placement.",
                    [_fmt(len(seeking))],
                ))

        packages = [r.placement_ctc for r in placed if r.placement_ctc is not None]
        if packages:
            facts["latest"]["highest_package"] = round(max(packages), 2)
            facts["latest"]["packages_recorded"] = len(packages)
            missing = len(placed) - len(packages)
            facts["latest"]["packages_missing"] = missing
            if missing:
                findings.append(Finding(
                    "missing_packages", "watch",
                    f"{missing} placed {_plural(missing, 'student has', 'students have')} no "
                    f"package recorded, so every package figure is drawn from "
                    f"{len(packages)} of {len(placed)}.",
                    [_fmt(missing), _fmt(len(packages)), _fmt(len(placed))],
                ))

    # --- the company pipeline ----------------------------------------------
    company_rows = company_metrics.company_rows(db, user)
    stages = company_metrics.funnel(company_rows)
    facts["companies"] = {label: count for label, count in stages}
    if company_rows:
        # The stage that loses the most, which is where effort actually goes.
        drops = [
            (stages[i][1] - stages[i + 1][1], stages[i], stages[i + 1])
            for i in range(len(stages) - 1)
        ]
        lost, frm, to = max(drops, key=lambda d: d[0])
        if lost:
            facts["biggest_dropoff"] = {"from": frm[0], "to": to[0], "lost": lost}
            findings.append(Finding(
                "pipeline", "watch",
                f"The pipeline loses most companies between '{frm[0]}' and '{to[0]}': "
                f"{frm[1]} down to {to[1]}.",
                [_fmt(lost), _fmt(frm[1]), _fmt(to[1])],
            ))

        stale = [r for r in company_rows if r.stale]
        facts["companies"]["stale"] = len(stale)
        if stale:
            findings.append(Finding(
                "stale_companies", "watch" if len(stale) < len(company_rows) else "urgent",
                f"{len(stale)} of {len(company_rows)} companies "
                f"{_plural(len(stale), 'has', 'have')} had no contact logged recently.",
                [_fmt(len(stale)), _fmt(len(company_rows))],
            ))

    # --- promises made to HR contacts --------------------------------------
    owed = owed_followups(db, cid)
    overdue = sum(o.overdue for o in owed.values())
    due_today = sum(o.due_today for o in owed.values())
    oldest = max((o.oldest_overdue_days or 0 for o in owed.values()), default=0)
    facts["followups"] = {
        "overdue": overdue, "due_today": due_today, "oldest_overdue_days": oldest,
        "people_owing": len(owed),
    }
    if overdue:
        findings.append(Finding(
            "followups", "urgent" if oldest >= 7 else "watch",
            f"{overdue} {_plural(overdue, 'follow-up is', 'follow-ups are')} overdue across "
            f"{len(owed)} {_plural(len(owed), 'person', 'people')}; the oldest has been waiting "
            f"{oldest} {_plural(oldest, 'day')}.",
            [_fmt(overdue), _fmt(len(owed)), _fmt(oldest)],
        ))

    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 1))
    return facts, findings[:MAX_FINDINGS]


# --- narration ---------------------------------------------------------------

#: Any run of digits, with an optional decimal part. Commas are stripped first so
#: "1,240" and "1240" compare equal. Years are figures like any other and must be
#: supplied rather than recalled.
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    """Figures in a string, normalised so 7.50, 7.5 and 7.500 are one value."""
    out = set()
    for raw in _NUMBER.findall(text.replace(",", "")):
        out.add(raw.rstrip("0").rstrip(".") if "." in raw else raw)
    return out


def allowed_numbers(findings: list[Finding]) -> set[str]:
    """Every figure the narrative may use, normalised the same way.

    Taken from the **headlines themselves**, not only from the ``numbers`` each
    finding declares. Anything printed in a headline is already shown to the
    reader, so quoting it back is not an invention - and deriving the set this
    way cannot drift from what the findings actually say. Maintaining the list by
    hand did drift: a monthly headline names its month, and "August 2026" put a
    year in the prose that no ``numbers`` list mentioned, so a write-up that did
    nothing worse than name the month it covered was thrown away.

    ``numbers`` is still honoured on top, for a figure a finding wants to permit
    without printing it.
    """
    out: set[str] = set()
    for f in findings:
        out |= _numbers(f.headline)
        for n in f.numbers:
            out |= _numbers(str(n))
    return out


def verify(narrative: list[str], findings: list[Finding]) -> tuple[bool, set[str]]:
    """Does the narrative quote only figures we supplied?

    Returns ``(ok, offending)``. The caller discards the whole narrative on a
    failure rather than editing it: a summary with one invented number is not a
    summary with one bad sentence, it is a summary that cannot be trusted.
    """
    allowed = allowed_numbers(findings)
    used: set[str] = set()
    for para in narrative:
        used |= _numbers(para)
    offending = used - allowed
    return (not offending), offending


def build_prompt(college: str, findings: list[Finding]) -> str:
    lines = "\n".join(f"- [{f.severity}] {f.headline}" for f in findings)
    return f"""You are writing the short summary at the top of a placement cell's dashboard
at {college}. Below are the findings, already worked out from the data. Your job is to
turn them into prose a placement head can read in twenty seconds.

Findings, most pressing first:
{lines}

Rules:
- Use ONLY the findings above. Do not add context, causes or recommendations that
  depend on anything not stated there.
- Digits are reserved for quoting a figure that appears above, exactly as written.
  For any other quantity use words ("two areas need attention"). Never round,
  re-derive or combine the figures.
- Two or three short paragraphs. Lead with what needs acting on.
- Plain English. No headings, no bullet points, no preamble, no sign-off.
- Do not claim a trend, a cause or a comparison that is not in the findings. If
  something is not there, it is not known.

Return ONLY a JSON object: {{"paragraphs": ["...", "..."]}}"""
