import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.routers.companies import COMPANY_COLUMNS
from app.routers.students import STUDENT_IMPORT_COLUMNS
from app.services.excel_io import parse_rows

cases = [
    ("companies", os.path.join(ROOT, "test_data", "companies_test_import.xlsx"), COMPANY_COLUMNS),
    ("students", os.path.join(ROOT, "test_data", "students_test_import.xlsx"), STUDENT_IMPORT_COLUMNS),
]
for label, path, cols in cases:
    with open(path, "rb") as f:
        rows = parse_rows(f.read(), cols)
    errs = [r for r in rows if r["errors"]]
    print(f"{label}: {len(rows)} rows parsed, {len(errs)} with errors")
    for e in errs[:5]:
        print("   row", e["row"], e["errors"])
