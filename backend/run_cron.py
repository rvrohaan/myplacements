"""Scheduler tick for the unattended jobs. Run this hourly.

Two endpoints are called in turn:

  * POST /api/daily-updates/cron/run - works out per college whether a filing
    reminder or the leadership digest is due, from that college's own cutoff.
  * POST /api/job-leads/cron/run - runs the day's web scan for new job and
    internship postings: one search for the whole platform, once a day, and only
    while a super_admin has the daily scan switched on (it ships switched off).

Safe to run more often than needed and safe to retry: both endpoints keep a run
log, so a repeated tick sends nothing twice and searches nothing twice.

Deliberately standard-library only - the production image is python:3.12-slim,
which ships neither curl nor httpx at the system level, so a shell one-liner
would fail there. Exits non-zero if any tick fails, so a bad run shows up as a
failed run in the scheduler rather than passing silently.

Environment:
    CRON_TOKEN  required, must match the backend's CRON_TOKEN
    CRON_URL    optional, any URL on the backend; only its origin is used
"""

import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ORIGIN = "https://admin.myplacements.in"

# (path, timeout). The digest builds a week of history for every college before
# it sends. The scan tick only claims the day's runs and queues them - the
# searching itself happens in the background, so this call returns at once and
# a slow search can never fail the tick.
TICKS = [
    ("/api/daily-updates/cron/run", 120),
    ("/api/job-leads/cron/run", 60),
]


def _origin() -> str:
    """The backend's origin. CRON_URL may be a full endpoint URL - the path on it
    is ignored, so an older configuration pointing at one of the ticks keeps
    working and still drives both."""
    configured = os.environ.get("CRON_URL", "").strip()
    if not configured:
        return DEFAULT_ORIGIN
    parsed = urllib.parse.urlsplit(configured)
    if not parsed.scheme or not parsed.netloc:
        return configured.rstrip("/")
    return f"{parsed.scheme}://{parsed.netloc}"


def _tick(url: str, token: str, timeout: int) -> bool:
    request = urllib.request.Request(
        url, data=b"", method="POST", headers={"X-Cron-Token": token}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            print(f"{url} -> {response.read().decode()}")
        return True
    except urllib.error.HTTPError as exc:
        # 404 is what a wrong or unset token looks like - the endpoint hides
        # itself rather than advertising that it exists.
        detail = exc.read().decode()[:300]
        hint = " (wrong CRON_TOKEN, or the backend has none set?)" if exc.code == 404 else ""
        print(f"cron tick failed: {url}: HTTP {exc.code}{hint} {detail}", file=sys.stderr)
        return False
    except urllib.error.URLError as exc:
        print(f"cron tick failed: could not reach {url}: {exc.reason}", file=sys.stderr)
        return False


def main() -> int:
    token = os.environ.get("CRON_TOKEN", "").strip()
    if not token:
        print("CRON_TOKEN is not set - refusing to run", file=sys.stderr)
        return 1

    origin = _origin()
    # Every tick is attempted even if an earlier one failed - a digest that
    # cannot send is no reason to skip the day's scan.
    results = [_tick(f"{origin}{path}", token, timeout) for path, timeout in TICKS]
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
