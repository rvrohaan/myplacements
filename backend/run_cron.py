"""Scheduler tick for daily updates. Run this hourly.

Calls POST /api/daily-updates/cron/run, which works out per college whether a
filing reminder or the leadership digest is due from that college's own cutoff.
Safe to run more often than needed and safe to retry: the endpoint keeps a run
log so a repeated tick sends nothing twice.

Deliberately standard-library only - the production image is python:3.12-slim,
which ships neither curl nor httpx at the system level, so a shell one-liner
would fail there. Exits non-zero on failure so a bad tick shows up as a failed
run in the scheduler rather than passing silently.

Environment:
    CRON_TOKEN  required, must match the backend's CRON_TOKEN
    CRON_URL    optional, defaults to the admin host below
"""

import os
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://admin.myplacements.in/api/daily-updates/cron/run"

# Generous: the digest builds a week of history for every college before it sends.
TIMEOUT_SECONDS = 120


def main() -> int:
    token = os.environ.get("CRON_TOKEN", "").strip()
    if not token:
        print("CRON_TOKEN is not set - refusing to run", file=sys.stderr)
        return 1

    url = os.environ.get("CRON_URL", "").strip() or DEFAULT_URL
    request = urllib.request.Request(
        url, data=b"", method="POST", headers={"X-Cron-Token": token}
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            print(response.read().decode())
        return 0
    except urllib.error.HTTPError as exc:
        # 404 is what a wrong or unset token looks like - the endpoint hides
        # itself rather than advertising that it exists.
        detail = exc.read().decode()[:300]
        hint = " (wrong CRON_TOKEN, or the backend has none set?)" if exc.code == 404 else ""
        print(f"cron tick failed: HTTP {exc.code}{hint} {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"cron tick failed: could not reach {url}: {exc.reason}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
