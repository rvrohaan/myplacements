from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel


class DailyUpdateCreate(BaseModel):
    # Defaults to the local today when omitted; leadership can file a correction
    # for an earlier date.
    report_date: Optional[date] = None
    work_mode: Optional[str] = None
    highlights: Optional[str] = None
    blockers: Optional[str] = None
    support_needed: Optional[str] = None
    plan_tomorrow: Optional[str] = None
    needs_escalation: bool = False
    escalation_note: Optional[str] = None
    manual_visits: int = 0
    manual_meetings: int = 0
    # kind, college_id, submitted_by_id, officer_id, status and the metrics
    # snapshot are all derived server-side, so an update can neither be filed
    # under someone else's name nor carry numbers the client made up.


class DailyUpdateUpdate(BaseModel):
    work_mode: Optional[str] = None
    highlights: Optional[str] = None
    blockers: Optional[str] = None
    support_needed: Optional[str] = None
    plan_tomorrow: Optional[str] = None
    needs_escalation: Optional[bool] = None
    escalation_note: Optional[str] = None
    manual_visits: Optional[int] = None
    manual_meetings: Optional[int] = None


class DailyUpdateReview(BaseModel):
    """Leadership acknowledging an update, optionally with a remark the filer
    sees on their own page."""

    note: Optional[str] = None


class DailyUpdateSettings(BaseModel):
    daily_update_cutoff: Optional[str] = None  # local "HH:MM"
    daily_update_enabled: Optional[bool] = None


class DailyUpdateOut(BaseModel):
    id: int
    college_id: Optional[int] = None
    report_date: date
    kind: str
    submitted_by_id: int
    officer_id: Optional[int] = None
    work_mode: Optional[str] = None
    highlights: Optional[str] = None
    blockers: Optional[str] = None
    support_needed: Optional[str] = None
    plan_tomorrow: Optional[str] = None
    needs_escalation: bool = False
    escalation_note: Optional[str] = None
    manual_visits: int = 0
    manual_meetings: int = 0
    # The derived counts as they stood when this was filed.
    metrics: Optional[dict[str, Any]] = None
    submitted_at: Optional[datetime] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    reviewed_by_id: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None

    # Denormalised so the digest and the officer's history read without lookups.
    submitted_by_name: Optional[str] = None
    submitted_by_role: Optional[str] = None
    officer_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    # True when nothing countable happened that day - the digest surfaces these
    # separately from days that were simply not reported.
    no_activity: bool = False

    # Whether the caller may edit this entry, and whether they may review it.
    can_edit: bool = False
    can_review: bool = False

    class Config:
        from_attributes = True
