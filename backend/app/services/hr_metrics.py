"""Aggregate HR outreach figures.

Shared by the HR Analytics tab and the HR Communication report for the same
reason company_metrics is: "answered" and "overdue" must mean one thing.
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.core.timeutil import overdue_before, to_local
from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.user import User
from app.services.hr_engagement import BANDS, NO_RESPONSE, RESPONDED, score_many

# Follow-up buckets, matching the HR directory's filters exactly.
DUE_SOON_DAYS = 7


def channel_stats(db: Session, user: User) -> list[dict]:
    """Outreach by channel, with the share that earned a reply.

    Entries still awaiting a reply are left out of the rate's denominator rather
    than counted as refusals: an unanswered mail from this morning is not
    evidence of anything yet, and counting it would make every fresh log
    temporarily depress the channel it was sent on.
    """
    q = db.query(Communication.comm_type, Communication.response_received)
    if user.college_id:
        q = q.join(Company, Communication.company_id == Company.id).filter(
            Company.college_id == user.college_id
        )
    buckets: dict[str, dict] = defaultdict(lambda: {"logged": 0, "replied": 0, "ignored": 0})
    for comm_type, response in q.all():
        bucket = buckets[comm_type.value if comm_type else "—"]
        bucket["logged"] += 1
        if (response or "") == RESPONDED:
            bucket["replied"] += 1
        elif (response or "") == NO_RESPONSE:
            bucket["ignored"] += 1

    out = []
    for name, v in buckets.items():
        decided = v["replied"] + v["ignored"]
        out.append({
            "channel": name,
            "logged": v["logged"],
            "replied": v["replied"],
            "no_response": v["ignored"],
            "awaiting": v["logged"] - decided,
            "reply_rate": round(v["replied"] * 100 / decided, 1) if decided else None,
        })
    out.sort(key=lambda r: -r["logged"])
    return out


def contact_scores(db: Session, user: User) -> tuple[list[HRContact], dict[int, dict], dict[int, str]]:
    """Every contact the caller can see, their engagement scores, and the company
    each belongs to."""
    pairs = (
        db.query(HRContact, Company.name)
        .join(Company, HRContact.company_id == Company.id)
        .filter(Company.college_id == user.college_id)
        .all()
        if user.college_id
        else db.query(HRContact, Company.name).join(Company, HRContact.company_id == Company.id).all()
    )
    contacts = [c for c, _ in pairs]
    company_of = {c.id: name for c, name in pairs}
    if not contacts:
        return [], {}, {}

    comms = (
        db.query(Communication)
        .filter(Communication.hr_contact_id.in_([c.id for c in contacts]))
        .all()
    )
    by_contact: dict[int, list] = defaultdict(list)
    for c in comms:
        by_contact[c.hr_contact_id].append(c)
    return contacts, score_many(dict(by_contact)), company_of


def followup_buckets(contacts: list[HRContact], now: Optional[datetime] = None) -> list[dict]:
    """Follow-ups grouped by how overdue they are. The same four buckets the HR
    directory filters on, so a count here matches what clicking through shows."""
    now = now or datetime.utcnow()
    # The same boundary the HR directory's filters use, so a count here matches
    # what clicking through shows.
    late_before = overdue_before(to_local(now).date())
    soon = late_before + timedelta(days=DUE_SOON_DAYS)
    overdue = due = upcoming = none = 0
    for c in contacts:
        if c.next_followup_date is None:
            none += 1
        elif c.next_followup_date < late_before:
            overdue += 1
        elif c.next_followup_date < soon:
            due += 1
        else:
            upcoming += 1
    return [
        {"bucket": "Overdue", "contacts": overdue},
        {"bucket": f"Due in {DUE_SOON_DAYS} days", "contacts": due},
        {"bucket": "Later", "contacts": upcoming},
        {"bucket": "No follow-up set", "contacts": none},
    ]


def engagement_mix(scores: dict[int, dict], total_contacts: int) -> list[dict]:
    """How many contacts sit in each engagement band.

    Contacts with nothing logged are their own group — "no history" is not a
    score of zero, and lumping them into the lowest band would invent a
    judgement the data does not support.
    """
    bands: dict[str, int] = defaultdict(int)
    for result in scores.values():
        if result:
            bands[result["band"]] += 1
    scored = sum(bands.values())
    # Fixed order, strongest first, matching hr_engagement.BANDS — never sorted
    # by count, or the chart would reshuffle as the data changes.
    out = [{"band": band, "contacts": bands.get(band, 0)}
           for _, band in BANDS if bands.get(band)]
    if total_contacts - scored > 0:
        out.append({"band": "no history", "contacts": total_contacts - scored})
    return out
