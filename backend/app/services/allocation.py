"""Rule-based allocation of unassigned companies to placement officers.

This replaces an earlier pass that handed every unassigned company to Claude in
one prompt. That worked at demo scale and collapsed at real scale: a college
with ~9,000 companies produced an ~800K-token prompt asking for ~263K tokens of
JSON back under a 4,096-token ceiling, so the reply was always a truncated array
and the modal only ever showed "Failed to generate allocations".

Every factor that prompt asked the model to weigh - region, sector, relationship
warmth, visit history, MOU, follow-up urgency, officer workload against target -
is a comparison we can make directly, so we make it here. It runs in
milliseconds over the whole database, costs nothing per click, and gives the
same answer twice.

Two scores drive the result:

* **Importance** ranks companies against each other. It decides which companies
  a head sees first when the database holds far more of them than anyone can
  review in one sitting, and it sets each allocation's high/normal/low priority.
* **Fit** ranks officers against each other for one company - region and sector
  match - offset by a workload penalty, so a well-matched officer stops
  absorbing work once they have taken their share of the batch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Mapping, Optional, Sequence

from app.core.timeutil import local_today, to_local
from app.models.company import Company, CompanyStatus
from app.models.officer import PlacementOfficer

# --- weights ----------------------------------------------------------------
# Fit tops out at REGION + SECTOR = 55. LOAD_WEIGHT is deliberately larger, so
# an officer who has already taken their full share of the batch is outbid even
# by a rival with no region or sector signal at all - that is what makes
# target_companies behave like the soft ceiling the feature promises.
REGION_WEIGHT = 30
SECTOR_WEIGHT = 25
LOAD_WEIGHT = 60
# Applied to officers already carrying more than the team average, so an
# imbalance left by earlier rounds gets worked off rather than compounded.
BACKLOG_WEIGHT = 20
BACKLOG_CAP = 2.0

HIGH_PRIORITY_AT = 45
NORMAL_PRIORITY_AT = 18


# --- text matching ----------------------------------------------------------

_WORD = re.compile(r"[a-z0-9]+")

# Terms that show up in so many locations and sector labels that matching on
# them is noise, not signal - every company in the database is "India Pvt Ltd".
_NOISE = frozenset(
    {
        "and", "the", "of", "for", "india", "indian", "region", "zone", "area",
        "city", "district", "state", "pvt", "private", "ltd", "limited", "inc",
        "llp", "co", "company", "corp", "corporation", "group", "general",
        "other", "others", "services", "service", "solutions", "solution",
        "sector", "industry", "industries",
    }
)

# Officers write their expertise loosely ("IT", "core", "BFSI") while sectors
# are recorded formally ("Information Technology"). A short alias table closes
# the gap for the handful of sectors a placement cell actually tracks.
_ALIASES: Mapping[str, frozenset] = {
    "it": frozenset({"information", "technology", "software", "ites", "computing"}),
    "ites": frozenset({"bpo", "kpo", "outsourcing"}),
    "bfsi": frozenset({"banking", "finance", "financial", "insurance", "fintech"}),
    "core": frozenset({"mechanical", "civil", "electrical", "manufacturing", "production"}),
    "edtech": frozenset({"education", "learning", "training"}),
    "healthtech": frozenset({"health", "healthcare", "pharma", "medical"}),
    "ecommerce": frozenset({"retail", "commerce", "marketplace"}),
    "auto": frozenset({"automobile", "automotive", "mobility"}),
}

# mou_status is free text, and half its vocabulary records the *absence* of a
# relationship. Treating any non-empty value as "has an MOU" credits "Not
# started" and "Terminated" as though they were signed, so both ends of the
# scale are listed explicitly. The router imports NO_MOU too, so the query that
# decides who is in the pipeline and the score that ranks them agree.
NO_MOU = frozenset(
    {
        "", "none", "no", "nil", "na", "n/a", "not signed", "not started",
        "expired", "lapsed", "terminated", "cancelled", "canceled", "rejected",
        "declined",
    }
)
# A live agreement, as opposed to one still being negotiated.
_MOU_SIGNED = frozenset({"signed", "active", "renewed", "executed", "in force"})


def _tokens(*values: Optional[str]) -> set:
    out: set = set()
    for value in values:
        if not value:
            continue
        out.update(t for t in _WORD.findall(value.lower()) if len(t) > 1 and t not in _NOISE)
    return out


def _expand(tokens: set) -> set:
    expanded = set(tokens)
    for token in tokens:
        expanded |= _ALIASES.get(token, frozenset())
    return expanded


def _shared_term(left: set, right: set) -> Optional[str]:
    """The term two token sets have in common, for the reasoning line. Sorted so
    a company with several matches always reports the same one."""
    shared = _expand(left) & _expand(right)
    return sorted(shared)[0] if shared else None


# --- importance: which companies matter most --------------------------------


@dataclass(frozen=True)
class Importance:
    score: int
    reasons: tuple

    @property
    def priority(self) -> str:
        if self.score >= HIGH_PRIORITY_AT:
            return "high"
        if self.score >= NORMAL_PRIORITY_AT:
            return "normal"
        return "low"


def _followup_date(company: Company) -> Optional[date]:
    """The soonest follow-up any HR contact at this company is waiting on, read
    on the college's clock rather than UTC's."""
    dates = [to_local(c.next_followup_date) for c in company.hr_contacts if c.next_followup_date]
    dates = [d for d in dates if d]
    return min(d.date() for d in dates) if dates else None


def score_importance(company: Company, today: date) -> Importance:
    """How much this company deserves an owner right now."""
    score = 0
    reasons: list = []

    if company.status == CompanyStatus.PRIORITY:
        score += 40
        reasons.append("flagged priority")
    elif company.status == CompanyStatus.ACTIVE:
        score += 10

    mou = (company.mou_status or "").strip().lower()
    if mou in _MOU_SIGNED:
        score += 15
        reasons.append("MOU " + mou)
    elif mou not in NO_MOU:
        # Still being negotiated - worth an owner, worth less than a signature.
        score += 8
        reasons.append("MOU " + mou)

    visits = company.previous_visit_count or 0
    if visits > 0:
        score += min(visits, 5) * 4
        reasons.append("%d previous visit%s" % (visits, "" if visits == 1 else "s"))

    strengths = [c.relationship_strength for c in company.hr_contacts if c.relationship_strength]
    if strengths:
        best = max(strengths)
        if best >= 4:
            score += 10
            reasons.append("warm HR contact (%d/5)" % best)
        elif best >= 3:
            score += 4

    due = _followup_date(company)
    if due is not None:
        days = (due - today).days
        if days < 0:
            score += 30
            reasons.append("follow-up %dd overdue" % abs(days))
        elif days <= 7:
            score += 20
            reasons.append("follow-up due this week")
        elif days <= 30:
            score += 10
            reasons.append("follow-up due this month")

    if company.hr_contacts:
        score += 5

    return Importance(score=score, reasons=tuple(reasons))


# --- fit: which officer suits one company -----------------------------------


def score_fit(company: Company, officer: PlacementOfficer) -> tuple:
    """Region and sector match between a company and one officer."""
    score = 0
    reasons: list = []

    region = _shared_term(_tokens(officer.region), _tokens(company.location))
    if region:
        score += REGION_WEIGHT
        reasons.append("region match (%s)" % region.title())

    sector = _shared_term(
        _tokens(officer.sector_expertise), _tokens(company.sector, company.domain)
    )
    if sector:
        score += SECTOR_WEIGHT
        reasons.append("sector fit (%s)" % sector.title())

    return score, reasons


# --- the allocation pass ----------------------------------------------------


@dataclass(frozen=True)
class Proposal:
    company: Company
    officer: PlacementOfficer
    priority: str
    reasoning: str


def _batch_shares(officers: Sequence, batch_size: int) -> dict:
    """How many of this batch each officer should end up with.

    Split in proportion to target_companies, which defaults to 0 and therefore
    usually means "nobody has set one" rather than "give this officer no work".
    An officer without a target is treated as carrying the average of the
    targets that *are* set, so a head who fills in one officer's target and
    leaves the rest blank still gets an even split instead of watching one
    person receive the entire batch.
    """
    targets = {o.id: max(o.target_companies or 0, 0) for o in officers}
    stated = [t for t in targets.values() if t > 0]
    if not stated:
        weights = {oid: 1.0 for oid in targets}
    else:
        unset = sum(stated) / len(stated)
        weights = {oid: float(t) if t > 0 else unset for oid, t in targets.items()}
    total = sum(weights.values())
    return {oid: max(batch_size * w / total, 1.0) for oid, w in weights.items()}


def propose_allocations(
    companies: Iterable[Company],
    officers: Sequence[PlacementOfficer],
    active_counts: Mapping,
    limit: int,
    today: Optional[date] = None,
) -> tuple:
    """Rank ``companies`` by importance, keep the top ``limit``, and give each
    one an owner.

    ``active_counts`` maps officer id to the number of companies they are
    already working, so a run picks up where the last one left off instead of
    allocating against a blank slate.

    Returns the proposals alongside the number of companies considered, so the
    caller can tell the head what the cut left out.
    """
    today = today or local_today()
    scored = [(c, score_importance(c, today)) for c in companies]
    considered = len(scored)
    if not officers or not scored:
        return [], considered

    # Most important first; company id keeps the order stable between runs when
    # scores tie, which they often do across thousands of untouched companies.
    scored.sort(key=lambda pair: (-pair[1].score, pair[0].id))
    batch = scored[: max(limit, 0)]

    shares = _batch_shares(officers, len(batch))
    taken = {o.id: 0 for o in officers}

    # An officer already carrying more than the team average starts at a
    # disadvantage, so an imbalance from earlier rounds gets worked off.
    existing = {o.id: max(active_counts.get(o.id, 0), 0) for o in officers}
    average = sum(existing.values()) / len(officers)
    backlog = {
        oid: min(max(count / average - 1, 0.0), BACKLOG_CAP) if average > 0 else 0.0
        for oid, count in existing.items()
    }

    proposals: list = []
    for company, importance in batch:
        best = None
        for officer in officers:
            fit, fit_reasons = score_fit(company, officer)
            penalty = (
                LOAD_WEIGHT * (taken[officer.id] / shares[officer.id])
                + BACKLOG_WEIGHT * backlog[officer.id]
            )
            # Officer id is the tie-break, so an unchanged database proposes an
            # unchanged allocation.
            candidate = (fit - penalty, -officer.id, officer, fit_reasons)
            if best is None or candidate[:2] > best[:2]:
                best = candidate

        _, _, officer, fit_reasons = best
        taken[officer.id] += 1

        reasons = fit_reasons + list(importance.reasons)
        if not reasons:
            reasons = ["balanced by workload - no region or sector signal"]
        # Upper-case the first letter only; str.capitalize() would lower-case
        # the rest and turn "Bengaluru" into "bengaluru".
        sentence = "; ".join(reasons[:3])
        proposals.append(
            Proposal(
                company=company,
                officer=officer,
                priority=importance.priority,
                reasoning=sentence[:1].upper() + sentence[1:] + ".",
            )
        )

    return proposals, considered
