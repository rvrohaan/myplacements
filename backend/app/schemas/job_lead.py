from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class JobLeadOut(BaseModel):
    id: int
    company_name: str
    role_title: Optional[str] = None
    lead_type: str
    location: Optional[str] = None
    work_mode: Optional[str] = None
    eligibility: Optional[str] = None
    compensation: Optional[str] = None
    posted_at: Optional[date] = None
    posted_label: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    summary: Optional[str] = None
    confidence: Optional[str] = None
    # False when the model's link never appeared in a search result. The UI
    # warns before anyone follows it.
    verified: bool = True
    discovered_at: Optional[datetime] = None
    status: str
    company_id: Optional[int] = None
    dismiss_reason: Optional[str] = None
    actioned_by_name: Optional[str] = None
    actioned_at: Optional[datetime] = None
    # A company of the same name that is already tracked, so the UI can offer a
    # link to it instead of an Add button that would create a duplicate.
    existing_company_id: Optional[int] = None
    existing_company_name: Optional[str] = None


class JobScanOut(BaseModel):
    id: int
    scan_date: date
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    status: str
    found: int = 0
    new_count: int = 0
    error: Optional[str] = None
    triggered_by_name: Optional[str] = None


class JobLeadSummary(BaseModel):
    """What the dashboard panel needs, in one call."""

    enabled: bool
    # Whether the scan runs by itself each morning. Platform-wide, and off until
    # a super_admin starts it.
    schedule_enabled: bool = False
    new_24h: int
    new_total: int
    last_scan: Optional[JobScanOut] = None
    top: list[JobLeadOut] = []


class JobScanResult(BaseModel):
    found: int
    new_count: int
    scan: JobScanOut


class JobLeadAddCompany(BaseModel):
    """Promote a lead to a company, optionally allocating it in the same step."""

    sector: Optional[str] = None
    officer_id: Optional[int] = None


class JobLeadDismiss(BaseModel):
    reason: Optional[str] = None


class JobScanSettings(BaseModel):
    """This college's view settings, plus the platform's schedule switch.

    They travel together because they are one dialog to the person adjusting
    them, but they are not the same kind of setting: the first two belong to the
    college, the third spends the platform's credit and is a super_admin's.
    """

    job_scan_enabled: Optional[bool] = None
    job_scan_focus: Optional[str] = None
    schedule_enabled: Optional[bool] = None
    # True when the person asking is allowed to change the schedule switch, so
    # the UI can show it as a control rather than a fact.
    can_manage_schedule: Optional[bool] = None
