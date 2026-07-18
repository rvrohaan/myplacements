"""One-off migration: split the old PLACEMENT_HEAD role into
PRO_CHANCELLOR + DEPUTY_PRO_CHANCELLOR on an existing database.

Run from the backend dir with the venv active and Postgres up:

    python migrate_pro_chancellor.py

Safe to re-run: enum values are added IF NOT EXISTS and the UPDATE only
touches leftover PLACEMENT_HEAD rows.

Notes on Postgres enums:
- SQLAlchemy stores the enum *name* (uppercase), so the DB type `userrole`
  uses labels like 'PLACEMENT_HEAD', not 'placement_head'.
- `ALTER TYPE ... ADD VALUE` must run outside a transaction (AUTOCOMMIT), and a
  value added this way can't be referenced until the ADD commits, so the UPDATE
  runs afterwards in its own transaction.
- The old 'PLACEMENT_HEAD' label can't be dropped from a PG enum without
  recreating the type; it's left as a harmless orphan once no rows use it.
"""

from sqlalchemy import text

from app.core.database import engine

NEW_LABELS = ("PRO_CHANCELLOR", "DEPUTY_PRO_CHANCELLOR")


def main() -> None:
    # 1) Add the new enum labels (each in its own autocommit statement).
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for label in NEW_LABELS:
            conn.execute(text(f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{label}'"))
            print(f"+ enum label ensured: {label}")

    # 2) Migrate existing rows. Everyone who was PLACEMENT_HEAD becomes the
    #    primary PRO_CHANCELLOR; promote specific users to Deputy by hand after.
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "UPDATE users SET role = 'PRO_CHANCELLOR' "
                "WHERE role = 'PLACEMENT_HEAD'"
            )
        )
        print(f"= users migrated PLACEMENT_HEAD -> PRO_CHANCELLOR: {result.rowcount}")

    print("Done.")


if __name__ == "__main__":
    main()
