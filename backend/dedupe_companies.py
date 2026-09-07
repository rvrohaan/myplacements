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

The whole plan is computed in memory from three SELECTs and applied as a handful
of set-based statements. Doing it row by row means tens of thousands of network
round trips, which is imperceptible against a local database and takes many
minutes against a hosted one.

Dry run by default — it reports what it would do and rolls back. Set APPLY=1 to
commit. Interrupting it at any point before the commit writes nothing.

    COLLEGE_CODE=aditya python dedupe_companies.py            # report only
    COLLEGE_CODE=aditya APPLY=1 python dedupe_companies.py    # actually merge

Point DATABASE_URL at the target database, or run it inside the deployed
container where DATABASE_URL is already set.
"""

import os
import sys
from collections import defaultdict

from sqlalchemy import text

from app.core.database import SessionLocal
from app.models.college import College

# Postgres caps a statement at 65535 bind parameters; stay well under it and
# keep each statement small enough to be readable in a slow-query log.
CHUNK = 1000


def contact_key(name, email) -> str:
    """Identity of an HR contact within a company — mirrors the importer."""
    if email and email.strip():
        return f"email:{email.strip().lower()}"
    return f"name:{(name or '').strip().lower()}"


def _chunks(seq, size=CHUNK):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def repoint(db, table, column, pairs) -> int:
    """Set ``column`` to the mapped target for every row matching a key.

    ``pairs`` is a list of ``(key, target)``; the join against a VALUES list
    rewrites them all in one statement per chunk.
    """
    changed = 0
    for chunk in _chunks(pairs):
        values = ", ".join(f"(:k{i}, :t{i})" for i in range(len(chunk)))
        params = {}
        for i, (key, target) in enumerate(chunk):
            params[f"k{i}"] = key
            params[f"t{i}"] = target
        result = db.execute(
            text(
                f"UPDATE {table} AS t SET {column} = m.target "
                f"FROM (VALUES {values}) AS m(key, target) "
                f"WHERE t.{column} = m.key"
            ),
            params,
        )
        changed += result.rowcount or 0
    return changed


def repoint_by_id(db, table, column, pairs) -> int:
    """Like :func:`repoint`, but keyed on the row's own id."""
    changed = 0
    for chunk in _chunks(pairs):
        values = ", ".join(f"(:k{i}, :t{i})" for i in range(len(chunk)))
        params = {}
        for i, (row_id, target) in enumerate(chunk):
            params[f"k{i}"] = row_id
            params[f"t{i}"] = target
        result = db.execute(
            text(
                f"UPDATE {table} AS t SET {column} = m.target "
                f"FROM (VALUES {values}) AS m(id, target) "
                f"WHERE t.id = m.id"
            ),
            params,
        )
        changed += result.rowcount or 0
    return changed


def delete_ids(db, table, ids) -> int:
    removed = 0
    for chunk in _chunks(list(ids)):
        params = {f"i{n}": v for n, v in enumerate(chunk)}
        placeholders = ", ".join(f":i{n}" for n in range(len(chunk)))
        result = db.execute(
            text(f"DELETE FROM {table} WHERE id IN ({placeholders})"), params
        )
        removed += result.rowcount or 0
    return removed


def main() -> int:
    code = os.environ.get("COLLEGE_CODE", "").strip().lower()
    apply_changes = os.environ.get("APPLY") == "1"
    if not code:
        print("ERROR: set COLLEGE_CODE to the tenant's code, e.g. COLLEGE_CODE=aditya", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        college = db.query(College).filter(College.code == code).first()
        if college is None:
            existing = ", ".join(c.code for c in db.query(College).all()) or "none"
            print(f"ERROR: no college with code '{code}'. Codes present: {existing}", file=sys.stderr)
            return 1

        # Three reads, then everything else is computed in memory.
        companies = db.execute(
            text("SELECT id, name FROM companies WHERE college_id = :cid ORDER BY id"),
            {"cid": college.id},
        ).all()
        company_ids = [row[0] for row in companies]

        groups: dict[str, list[int]] = defaultdict(list)
        for company_id, name in companies:
            groups[(name or "").strip().lower()].append(company_id)
        dupes = {name: ids for name, ids in groups.items() if len(ids) > 1}

        print(f"college          : {college.name} (code={college.code}, id={college.id})")
        print(f"companies        : {len(companies)}")
        print(f"distinct names   : {len(groups)}")
        print(f"duplicated names : {len(dupes)}")
        print(f"rows to remove   : {sum(len(ids) - 1 for ids in dupes.values())}")
        print(f"mode             : {'APPLY (will commit)' if apply_changes else 'DRY RUN (rolls back)'}\n")

        if not dupes:
            print("Nothing to do.")
            return 0

        # dup id -> keeper id, for every company being merged away.
        keeper_of: dict[int, int] = {}
        for ids in dupes.values():
            keeper = ids[0]
            for dup in ids[1:]:
                keeper_of[dup] = keeper
        dup_ids = set(keeper_of)

        contacts = db.execute(
            text(
                "SELECT id, company_id, name, email FROM hr_contacts "
                "WHERE company_id = ANY(:ids)"
            ),
            {"ids": company_ids},
        ).all()
        assignments = db.execute(
            text("SELECT id, company_id FROM company_assignments WHERE company_id = ANY(:ids)"),
            {"ids": company_ids},
        ).all()
        print(f"loaded {len(contacts)} HR contacts and {len(assignments)} allocations\n")

        # Contacts already on each keeper decide what a duplicate's contact does.
        keeper_keys: dict[int, set[str]] = defaultdict(set)
        for _cid, company_id, name, email in contacts:
            if company_id not in dup_ids:
                keeper_keys[company_id].add(contact_key(name, email))

        contact_moves: list[tuple[int, int]] = []
        contact_drops: list[int] = []
        for contact_id, company_id, name, email in contacts:
            keeper = keeper_of.get(company_id)
            if keeper is None:
                continue
            key = contact_key(name, email)
            if key in keeper_keys[keeper]:
                contact_drops.append(contact_id)
            else:
                keeper_keys[keeper].add(key)
                contact_moves.append((contact_id, keeper))

        # One owner per company: a duplicate's allocation moves only when the
        # keeper has none, otherwise it is dropped.
        owned = {company_id for _aid, company_id in assignments if company_id not in dup_ids}
        assignment_moves: list[tuple[int, int]] = []
        assignment_drops: list[int] = []
        for assignment_id, company_id in assignments:
            keeper = keeper_of.get(company_id)
            if keeper is None:
                continue
            if keeper in owned:
                assignment_drops.append(assignment_id)
            else:
                owned.add(keeper)
                assignment_moves.append((assignment_id, keeper))

        company_pairs = sorted(keeper_of.items())

        moved_contacts = repoint_by_id(db, "hr_contacts", "company_id", contact_moves)
        dropped_contacts = delete_ids(db, "hr_contacts", contact_drops)
        moved_assignments = repoint_by_id(db, "company_assignments", "company_id", assignment_moves)
        dropped_assignments = delete_ids(db, "company_assignments", assignment_drops)
        moved_drives = repoint(db, "drives", "company_id", company_pairs)
        moved_comms = repoint(db, "communications", "company_id", company_pairs)
        removed = delete_ids(db, "companies", sorted(dup_ids))

        print(f"companies removed    : {removed}")
        print(f"HR contacts moved    : {moved_contacts}")
        print(f"HR contacts dropped  : {dropped_contacts} (keeper already had them)")
        print(f"drives repointed     : {moved_drives}")
        print(f"communications moved : {moved_comms}")
        print(f"allocations moved    : {moved_assignments}")
        print(f"allocations dropped  : {dropped_assignments} (keeper already owned)")

        if apply_changes:
            db.commit()
            remaining = db.execute(
                text("SELECT count(*) FROM companies WHERE college_id = :cid"),
                {"cid": college.id},
            ).scalar()
            print(f"\nCOMMITTED. Companies now in {college.code}: {remaining}")
        else:
            db.rollback()
            print("\nDRY RUN — nothing was written. Re-run with APPLY=1 to commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
