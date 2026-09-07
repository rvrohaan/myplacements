"""Merge duplicate companies within one college, keeping the earliest of each name.

Duplicates arise when two imports of the same data run concurrently: neither
transaction can see the other's uncommitted rows, so both create every company.
The app-level "skip existing names" check cannot prevent that on its own.

For each group of same-named companies (case-insensitive) in the college, the
lowest id is kept and the rest are merged into it:

  * HR contacts move to the keeper, skipping ones it already has (matched on
    email, falling back to name — the same identity rule the importer uses).
  * Drives and communications are repointed at the keeper.
  * Officer allocations move only if the keeper has none, preserving the
    one-owner-per-company invariant; otherwise the duplicate's is dropped.
  * The duplicate row is then deleted.

Dry run by default — it reports what it would do and changes nothing. Set
APPLY=1 to commit.

    COLLEGE_CODE=test \\
    DATABASE_URL="postgresql://...neon.tech/db" \\
    python dedupe_companies.py            # report only

    COLLEGE_CODE=test APPLY=1 \\
    DATABASE_URL="postgresql://...neon.tech/db" \\
    python dedupe_companies.py            # actually merge
"""

import os
import sys
from collections import defaultdict

from app.core.database import SessionLocal
from app.models.college import College
from app.models.communication import Communication
from app.models.company import Company, HRContact
from app.models.drive import Drive
from app.models.officer import CompanyAssignment


def contact_key(name, email) -> str:
    """Identity of an HR contact within a company — mirrors the importer."""
    if email and email.strip():
        return f"email:{email.strip().lower()}"
    return f"name:{(name or '').strip().lower()}"


def main() -> int:
    code = os.environ.get("COLLEGE_CODE", "").strip().lower()
    apply_changes = os.environ.get("APPLY") == "1"
    if not code:
        print("ERROR: set COLLEGE_CODE to the tenant's code, e.g. COLLEGE_CODE=test", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        college = db.query(College).filter(College.code == code).first()
        if college is None:
            existing = ", ".join(c.code for c in db.query(College).all()) or "none"
            print(f"ERROR: no college with code '{code}'. Codes present: {existing}", file=sys.stderr)
            return 1

        companies = (
            db.query(Company)
            .filter(Company.college_id == college.id)
            .order_by(Company.id)
            .all()
        )
        groups: dict[str, list[Company]] = defaultdict(list)
        for company in companies:
            groups[(company.name or "").strip().lower()].append(company)
        dupes = {name: rows for name, rows in groups.items() if len(rows) > 1}

        print(f"college          : {college.name} (code={college.code}, id={college.id})")
        print(f"companies        : {len(companies)}")
        print(f"distinct names   : {len(groups)}")
        print(f"duplicated names : {len(dupes)}")
        print(f"rows to remove   : {sum(len(r) - 1 for r in dupes.values())}")
        print(f"mode             : {'APPLY (will commit)' if apply_changes else 'DRY RUN (no changes)'}\n")

        if not dupes:
            print("Nothing to do.")
            return 0

        moved_contacts = dropped_contacts = 0
        moved_drives = moved_comms = moved_assignments = dropped_assignments = 0
        removed = 0

        # Everything below runs as bulk UPDATE/DELETE rather than through ORM
        # instances. Deleting a Company through the ORM de-associates its loaded
        # children by nulling their company_id — which would undo the repointing
        # done moments earlier and fail the NOT NULL constraint.
        for name, rows in dupes.items():
            keeper, extras = rows[0], rows[1:]
            keeper_keys = {
                contact_key(c.name, c.email)
                for c in db.query(HRContact).filter(HRContact.company_id == keeper.id)
            }

            for dup in extras:
                for contact in db.query(HRContact).filter(HRContact.company_id == dup.id).all():
                    key = contact_key(contact.name, contact.email)
                    if key in keeper_keys:
                        db.query(HRContact).filter(HRContact.id == contact.id).delete(
                            synchronize_session=False
                        )
                        dropped_contacts += 1
                    else:
                        db.query(HRContact).filter(HRContact.id == contact.id).update(
                            {HRContact.company_id: keeper.id}, synchronize_session=False
                        )
                        keeper_keys.add(key)
                        moved_contacts += 1

                moved_drives += (
                    db.query(Drive).filter(Drive.company_id == dup.id)
                    .update({Drive.company_id: keeper.id}, synchronize_session=False)
                )
                moved_comms += (
                    db.query(Communication).filter(Communication.company_id == dup.id)
                    .update({Communication.company_id: keeper.id}, synchronize_session=False)
                )

                keeper_owned = (
                    db.query(CompanyAssignment)
                    .filter(CompanyAssignment.company_id == keeper.id)
                    .count()
                )
                for assignment in db.query(CompanyAssignment).filter(
                    CompanyAssignment.company_id == dup.id
                ).all():
                    if keeper_owned:
                        db.query(CompanyAssignment).filter(
                            CompanyAssignment.id == assignment.id
                        ).delete(synchronize_session=False)
                        dropped_assignments += 1
                    else:
                        db.query(CompanyAssignment).filter(
                            CompanyAssignment.id == assignment.id
                        ).update({CompanyAssignment.company_id: keeper.id}, synchronize_session=False)
                        keeper_owned = 1
                        moved_assignments += 1

                db.query(Company).filter(Company.id == dup.id).delete(synchronize_session=False)
                removed += 1

        print(f"companies removed    : {removed}")
        print(f"HR contacts moved    : {moved_contacts}")
        print(f"HR contacts dropped  : {dropped_contacts} (keeper already had them)")
        print(f"drives repointed     : {moved_drives}")
        print(f"communications moved : {moved_comms}")
        print(f"allocations moved    : {moved_assignments}")
        print(f"allocations dropped  : {dropped_assignments} (keeper already owned)")

        if apply_changes:
            db.commit()
            remaining = db.query(Company).filter(Company.college_id == college.id).count()
            print(f"\nCOMMITTED. Companies now in {college.code}: {remaining}")
        else:
            db.rollback()
            print("\nDRY RUN — nothing was written. Re-run with APPLY=1 to commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
