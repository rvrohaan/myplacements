"""Reports (spec §7).

Thin by design: the catalogue and two renderings of whatever
``services.report_defs`` produced. A report is built once and shown on screen or
downloaded as .xlsx from that same object, so the file and the screen cannot
disagree.

Leadership-only. A report is a management and accreditation artefact covering
the whole college, and a placement officer's view of the college is deliberately
partial everywhere else in the app — a report that silently showed them a slice
would be quoted as if it covered everything.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_staff, require_roles
from app.core.roles import LEADERSHIP_ROLES
from app.models.student import Student
from app.models.user import User
from app.services.report_builder import XLSX_MEDIA_TYPE, build_report_workbook
from app.services import monthly
from app.services.report_defs import BY_ID, REPORTS

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(get_current_staff)])

Leadership = Depends(require_roles(*LEADERSHIP_ROLES))


def _spec(report_id: str):
    spec = BY_ID.get(report_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="No such report")
    return spec


def _params(
    batch_year: Optional[int],
    years: Optional[int],
    months: Optional[int],
    all_batches: bool = False,
    month: Optional[str] = None,
) -> dict:
    """Every parameter any report takes. A report ignores the ones it doesn't
    declare, and the UI only offers the ones it does.

    ``all_batches`` is a separate flag rather than a magic ``batch_year`` value
    because the three states are genuinely distinct: a named year, every year
    pooled, and "whatever the latest batch is" — which is what no parameter at
    all has always meant and must keep meaning.
    """
    return {
        "batch_year": batch_year,
        "years": years,
        "months": months,
        "all_batches": all_batches,
        "month": month,
    }


@router.get("")
def list_reports(
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """The catalogue, plus the batch years the pickers should offer."""
    q = db.query(Student.batch_year).distinct()
    if current_user.college_id:
        q = q.filter(Student.college_id == current_user.college_id)
    batch_years = sorted({r[0] for r in q.all() if r[0]}, reverse=True)
    return {
        "batch_years": batch_years,
        "months": monthly.recent_months(),
        "reports": [
            {"id": s.id, "name": s.name, "description": s.description, "params": s.params}
            for s in REPORTS
        ],
    }


@router.get("/{report_id}")
def get_report(
    report_id: str,
    batch_year: Optional[int] = None,
    all_batches: bool = False,
    years: Optional[int] = Query(default=None, ge=1, le=10),
    months: Optional[int] = Query(default=None, ge=1, le=24),
    # A YYYY-MM key for the reports that cover one calendar month. Validated by
    # the pattern rather than parsed here, so a junk value is a 422 and not a
    # silent fallback to some other month.
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """The report as JSON, for the preview on screen."""
    spec = _spec(report_id)
    return spec.builder(db, current_user, _params(batch_year, years, months, all_batches, month)).to_dict()


@router.get("/{report_id}/export")
def export_report(
    report_id: str,
    batch_year: Optional[int] = None,
    all_batches: bool = False,
    years: Optional[int] = Query(default=None, ge=1, le=10),
    months: Optional[int] = Query(default=None, ge=1, le=24),
    # A YYYY-MM key for the reports that cover one calendar month. Validated by
    # the pattern rather than parsed here, so a junk value is a 422 and not a
    # silent fallback to some other month.
    month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    db: Session = Depends(get_db),
    current_user: User = Leadership,
):
    """The same report, as the .xlsx somebody files or emails."""
    spec = _spec(report_id)
    report = spec.builder(db, current_user, _params(batch_year, years, months, all_batches, month))
    buffer = build_report_workbook(report)
    stamp = report.generated_at.strftime("%Y-%m-%d")
    filename = f"{spec.id}-{stamp}.xlsx"
    return StreamingResponse(
        buffer,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
