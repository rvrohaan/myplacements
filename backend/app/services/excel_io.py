"""Shared helpers for importing/exporting domain records as .xlsx workbooks.

A list of :class:`Column` specs drives three things consistently: the export
sheet, the blank import template, and parsing/validating an uploaded file.
"""
import io
from typing import Any, Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_TRUTHY = {"true", "yes", "y", "1"}
_FALSY = {"false", "no", "n", "0", ""}


class Column:
    """Describes one spreadsheet column and how it maps to a model attribute."""

    def __init__(
        self,
        header: str,
        attr: str,
        kind: str = "str",
        required: bool = False,
        importable: bool = True,
        choices: Optional[list[str]] = None,
    ):
        self.header = header
        self.attr = attr
        self.kind = kind  # str | int | float | bool | enum
        self.required = required
        self.importable = importable  # False => export/template only
        self.choices = choices  # allowed lowercased values for kind == "enum"


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _parse_value(raw: Any, col: Column) -> Any:
    if _is_blank(raw):
        return None
    if col.kind == "str":
        return str(raw).strip()
    if col.kind == "int":
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            raise ValueError(f"expected a whole number, got '{raw}'")
    if col.kind == "float":
        try:
            return float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"expected a number, got '{raw}'")
    if col.kind == "bool":
        if isinstance(raw, bool):
            return raw
        token = str(raw).strip().lower()
        if token in _TRUTHY:
            return True
        if token in _FALSY:
            return False
        raise ValueError(f"expected yes/no, got '{raw}'")
    if col.kind == "enum":
        token = str(raw).strip().lower()
        if col.choices and token not in col.choices:
            raise ValueError(f"'{raw}' is not one of {', '.join(col.choices)}")
        return token
    return raw


def build_workbook(columns: list[Column], rows: list[Any], sheet_title: str) -> io.BytesIO:
    """Render ``rows`` (model instances) into an in-memory .xlsx using ``columns``."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="4F46E5")
    for i, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=i, value=col.header)
        cell.font = header_font
        cell.fill = header_fill
        ws.column_dimensions[get_column_letter(i)].width = max(14, len(col.header) + 2)

    for r, obj in enumerate(rows, start=2):
        for c, col in enumerate(columns, start=1):
            value = getattr(obj, col.attr, None)
            if hasattr(value, "value"):  # unwrap enum members
                value = value.value
            ws.cell(row=r, column=c, value=value)

    ws.freeze_panes = "A2"
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer


def parse_rows(file_bytes: bytes, columns: list[Column]) -> list[dict]:
    """Parse an uploaded workbook into ``[{"row", "data", "errors"}, ...]``.

    Headers are matched case-insensitively; unknown columns are ignored and
    fully blank rows are skipped. Per-cell validation problems are collected
    into ``errors`` rather than raised, so one bad row never aborts the batch.
    """
    try:
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    except Exception as exc:  # noqa: BLE001 - surface a friendly message to the API caller
        raise ValueError(f"Could not read file as .xlsx: {exc}") from exc

    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    if not all_rows:
        return []

    headers = [str(h).strip().lower() if h is not None else "" for h in all_rows[0]]
    importable = {c.header.lower(): c for c in columns if c.importable}
    # attr -> (column index, Column)
    indexed = {col.attr: (i, col) for i, h in enumerate(headers) if (col := importable.get(h))}

    parsed: list[dict] = []
    for row_number, raw_row in enumerate(all_rows[1:], start=2):
        if all(_is_blank(v) for v in raw_row):
            continue
        data: dict[str, Any] = {}
        errors: list[str] = []
        for attr, (i, col) in indexed.items():
            raw = raw_row[i] if i < len(raw_row) else None
            try:
                value = _parse_value(raw, col)
            except ValueError as exc:
                errors.append(f"{col.header}: {exc}")
                continue
            if value is None and col.required:
                errors.append(f"{col.header} is required")
                continue
            data[attr] = value
        parsed.append({"row": row_number, "data": data, "errors": errors})
    return parsed
