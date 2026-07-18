"""Read an uploaded round roster (.xlsx) into normalized student rows.

A roster is one sheet listing the students for a single interview round. We first
try to map its columns deterministically by header name; if we can't even find a
roll-number column, we fall back to Claude to interpret the layout.

Each returned row is ``{"roll_number", "name", "status", "ctc"}`` where ``status``
is ``"passed"``, ``"failed"`` or ``None`` (appeared only, no outcome column).
"""
import io

from openpyxl import load_workbook

from app.services.ai_service import parse_roster_sheet

# Header aliases (compared lowercased/stripped) for the columns we care about.
_ROLL_ALIASES = {
    "roll number", "roll no", "rollno", "roll", "roll_number", "registration number",
    "registration no", "reg no", "regno", "registration_number", "enrolment number",
    "enrollment number", "enrolment no", "enrollment no", "usn", "hall ticket",
}
_NAME_ALIASES = {"name", "full name", "student name", "student", "full_name", "candidate"}
_STATUS_ALIASES = {"status", "result", "outcome", "pass/fail", "pass or fail", "remarks", "remark"}
_CTC_ALIASES = {"ctc", "package", "salary", "ctc (lpa)", "package (lpa)", "ctc lpa", "ctc offered", "offered ctc", "lpa"}

_PASS_TOKENS = {"pass", "passed", "cleared", "clear", "selected", "select", "qualified", "shortlisted", "yes", "y", "true", "1", "p"}
_FAIL_TOKENS = {"fail", "failed", "rejected", "reject", "not cleared", "not qualified", "no", "n", "false", "0", "f"}
# "Absent" is a no-show, not a failure: the student didn't turn up. Handled
# separately so it leads to a withdrawal, never a rejection.
_ABSENT_TOKENS = {"absent", "a", "no show", "no-show", "noshow", "did not appear", "dna", "not appeared", "withdrew", "withdrawn"}

TEMPLATE_HEADERS = ["Roll Number", "Name", "Status", "CTC (LPA)"]


def normalize_status(raw) -> str | None:
    """Map a free-text status cell to 'passed', 'failed', 'absent', or None."""
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return None
    token = str(raw).strip().lower()
    if token in _PASS_TOKENS:
        return "passed"
    if token in _ABSENT_TOKENS:
        return "absent"
    if token in _FAIL_TOKENS:
        return "failed"
    return None


def _to_float(raw) -> float | None:
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _find(headers: list[str], aliases: set[str]) -> int | None:
    for i, h in enumerate(headers):
        if h in aliases:
            return i
    return None


async def extract_roster(file_bytes: bytes) -> tuple[list[dict], bool]:
    """Return ``(rows, used_ai)``. Tries deterministic header mapping first and
    only calls Claude when no roll-number column can be identified."""
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as exc:  # noqa: BLE001 - friendly message for the API caller
        raise ValueError(f"Could not read file as .xlsx: {exc}") from exc

    ws = wb.active
    all_rows = [list(r) for r in ws.iter_rows(values_only=True)]
    if not all_rows:
        return [], False

    headers = [str(h).strip().lower() if h is not None else "" for h in all_rows[0]]
    roll_i = _find(headers, _ROLL_ALIASES)

    if roll_i is None:
        # Couldn't recognise the layout — let Claude interpret the raw grid.
        rows = await parse_roster_sheet(all_rows)
        return rows, True

    name_i = _find(headers, _NAME_ALIASES)
    status_i = _find(headers, _STATUS_ALIASES)
    ctc_i = _find(headers, _CTC_ALIASES)

    def cell(row: list, i: int | None):
        return row[i] if i is not None and i < len(row) else None

    rows: list[dict] = []
    for raw in all_rows[1:]:
        roll = cell(raw, roll_i)
        if roll is None or str(roll).strip() == "":
            continue
        name = cell(raw, name_i)
        rows.append(
            {
                "roll_number": str(roll).strip(),
                "name": str(name).strip() if name not in (None, "") else None,
                "status": normalize_status(cell(raw, status_i)),
                "ctc": _to_float(cell(raw, ctc_i)),
            }
        )
    return rows, False
