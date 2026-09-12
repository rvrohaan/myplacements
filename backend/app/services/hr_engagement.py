"""Engagement scoring for HR contacts.

``HRContact.relationship_strength`` is the officer's own read on a relationship,
1-5, typed by hand. This module computes the other half: what the logged
evidence actually says. The two are deliberately kept apart and shown side by
side - a contact an officer rates 5 who has not replied in four months is
exactly the disagreement a placement head wants to see, and averaging the two
into one number would hide it.

The score answers one question: *if we write to this person tomorrow, how likely
are they to write back?* It is built only from things already recorded by the
communication log, so it costs no new data entry:

  responsiveness  how much of our outreach earned a reply
  recency         how long since we last got a reply
  consistency     whether the relationship is maintained or one big flurry
  reliability     whether follow-ups we promised were actually kept

A contact with no logged communications scores ``None`` rather than 0. Zero
would rank a brand-new contact below one who has ignored us for a year, which is
both wrong and demoralising; ``None`` renders as "no history yet" instead.
"""

from datetime import datetime, timedelta
from typing import Iterable, Optional

# Response vocabulary written by routers.communications; mirrored in
# schemas/communication.py. Anything else counts as "no answer either way".
RESPONDED = "received"
NO_RESPONSE = "no_response"

# Band thresholds, used for the label next to the number.
BANDS = (
    (75, "responsive"),
    (50, "warm"),
    (25, "slow"),
    (0, "cold"),
)

# How the four signals add up. Responsiveness dominates because it is the only
# one that measures the contact rather than us: recency and consistency mostly
# reflect how often *we* wrote.
WEIGHTS = {
    "responsiveness": 45,
    "recency": 25,
    "consistency": 15,
    "reliability": 15,
}

# A reply older than this is treated as no signal at all. Six months is about
# one full placement cycle - the point where last year's contact has to be
# re-established rather than resumed.
STALE_DAYS = 180


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _recency_factor(days: Optional[float]) -> float:
    """1.0 for a reply today, decaying to 0 at STALE_DAYS."""
    if days is None:
        return 0.0
    return _clamp(1.0 - (days / STALE_DAYS))


def score_contact(communications: Iterable, *, now: Optional[datetime] = None) -> Optional[dict]:
    """Score one contact from the communications logged against them.

    ``communications`` is every ``Communication`` row for this contact, in any
    order. Returns None when there are none - see the module docstring.
    """
    now = now or datetime.utcnow()
    comms = list(communications)
    if not comms:
        return None

    total = len(comms)
    replied = sum(1 for c in comms if (c.response_received or "") == RESPONDED)
    ignored = sum(1 for c in comms if (c.response_received or "") == NO_RESPONSE)

    # --- responsiveness ---------------------------------------------------
    # Share of outreach that earned a reply. Entries still marked "awaited" are
    # left out of the denominator: an unanswered mail from this morning is not
    # evidence of anything yet, and counting it would make every fresh log
    # temporarily drop the score of a contact who has done nothing wrong.
    decided = replied + ignored
    responsiveness = (replied / decided) if decided else 0.0
    if not decided:
        # Nothing has resolved yet. Score the half we do know - that contact was
        # made at all - rather than reading silence as refusal.
        responsiveness = 0.5

    # --- recency ----------------------------------------------------------
    reply_dates = [
        c.communicated_at
        for c in comms
        if (c.response_received or "") == RESPONDED and c.communicated_at
    ]
    last_reply = max(reply_dates) if reply_dates else None
    days_since_reply = (now - last_reply).total_seconds() / 86400 if last_reply else None
    recency = _recency_factor(days_since_reply)

    # --- consistency ------------------------------------------------------
    # Distinct months touched over the last six. A relationship worked every
    # month reads very differently from six mails sent in one week, even though
    # both total six.
    cutoff = now - timedelta(days=STALE_DAYS)
    months = {
        (c.communicated_at.year, c.communicated_at.month)
        for c in comms
        if c.communicated_at and c.communicated_at >= cutoff
    }
    consistency = _clamp(len(months) / 6)

    # --- reliability ------------------------------------------------------
    # Follow-ups we committed to and then let lapse. This one scores *us*, not
    # them, and it belongs here because a contact who stopped replying after
    # three missed follow-ups is a process failure, not a cold lead.
    promised = [c for c in comms if c.next_followup_date]
    overdue = [
        c
        for c in promised
        if c.next_followup_date < now and (c.response_received or "") != RESPONDED
    ]
    reliability = 1.0 - _clamp(len(overdue) / len(promised)) if promised else 1.0

    parts = {
        "responsiveness": responsiveness,
        "recency": recency,
        "consistency": consistency,
        "reliability": reliability,
    }
    score = round(sum(WEIGHTS[k] * v for k, v in parts.items()))

    # --- staleness cap ----------------------------------------------------
    # Without this, a contact who answered everything and then heard nothing
    # from us for a year still scores "warm" on the strength of that history:
    # responsiveness is a ratio with no sense of time, and losing the 25 recency
    # points alone isn't enough to move the band. But the score is a prediction,
    # not a commendation - and there is no recent evidence either way about
    # somebody nobody has spoken to since last placement season. So a
    # relationship with no contact at all inside the window is capped below
    # "warm" however good its history: it has to be re-established, not resumed.
    last_touch = max((c.communicated_at for c in comms if c.communicated_at), default=None)
    days_since_touch = (now - last_touch).total_seconds() / 86400 if last_touch else None
    stale = days_since_touch is None or days_since_touch > STALE_DAYS
    if stale:
        warm_floor = next(floor for floor, name in BANDS if name == "warm")
        score = min(score, warm_floor - 1)

    label = next(name for floor, name in BANDS if score >= floor)

    return {
        "score": score,
        "band": label,
        # True when the whole relationship predates the window - the UI says
        # "no contact in 6 months" rather than implying the number is current.
        "stale": stale,
        "days_since_contact": round(days_since_touch) if days_since_touch is not None else None,
        "total_logged": total,
        "replied": replied,
        "awaited": total - decided,
        "last_contacted_at": last_touch,
        "last_replied_at": last_reply,
        "days_since_reply": round(days_since_reply) if days_since_reply is not None else None,
        "overdue_followups": len(overdue),
        # Kept so the UI can explain the number instead of just asserting it.
        "components": {k: round(v * 100) for k, v in parts.items()},
    }


def score_many(comms_by_contact: dict[int, list], *, now: Optional[datetime] = None) -> dict[int, dict]:
    """``score_contact`` across a whole directory page, in one pass."""
    now = now or datetime.utcnow()
    return {
        contact_id: result
        for contact_id, rows in comms_by_contact.items()
        if (result := score_contact(rows, now=now)) is not None
    }
