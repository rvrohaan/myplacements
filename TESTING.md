# Testing

Two suites, run independently. Neither needs Docker for the everyday case.

## Running

```bash
# Backend — the fast tier (SQLite, no container)
cd backend && .\venv\Scripts\Activate.ps1
pytest

# Backend — with coverage on the code that holds the logic
pytest --cov=app --cov-report=term-missing

# Frontend
cd frontend
npm test            # once
npm run test:watch  # while working
npm run typecheck:test
```

## How the backend harness works

`tests/conftest.py` does three things, in an order that matters.

**Environment is pinned before anything from `app` is imported.** `settings` and
the SQLAlchemy `engine` are both built at import time, so setting `DATABASE_URL`
afterwards would have no effect.

**SQLite stands in for Postgres.** Every model uses portable column types and
`run_migrations` is a no-op off Postgres, so `create_all` produces the complete
schema with no container to start. Where the two dialects genuinely differ,
the `postgres` tier covers it (below).

**Outbound sockets are blocked.** A test that reaches Anthropic, Resend or a
real database fails with an explanation instead of hanging. Loopback stays open
because asyncio needs it. Opt out with `@pytest.mark.allow_network`.

### Fixtures

| Fixture | What you get |
|---|---|
| `db` | A session whose writes — including a router's `db.commit()` — are rolled back at the end of the test. |
| `make_client(subdomain)` | A `TestClient` bound to that tenant's host, so `app.core.tenant` resolution runs for real. |
| `client` | `make_client()` on the apex host: no tenant. |
| `auth(user)` | `headers=` for that user, with a genuinely minted token. |
| `college` / `other_college` | Two tenants, for proving the boundary holds. |
| `pg_engine` | A real Postgres. Skips unless `TEST_POSTGRES_URL` is set. |

Objects come from `tests/factories.py`. Mention only the fields the test is
about; the factory fills in whatever the database insists on.

```python
def test_officers_cannot_see_another_colleges_companies(db, make_client, auth, college, other_college):
    officer = factories.make_user(db, college=college, role=UserRole.PLACEMENT_OFFICER)
    factories.make_company(db, college=other_college, name="Not Theirs")

    response = make_client("rit").get("/api/companies", headers=auth(officer))

    assert response.status_code == 200
    assert [c["name"] for c in response.json()] == []
```

### The Postgres tier

Marked `@pytest.mark.postgres` and skipped by default. It covers the three
things SQLite cannot answer: the Postgres-only DDL in `app/core/migrations.py`,
native enum types, and real `ilike`.

```bash
docker compose up db -d
docker exec myplacements-db-1 psql -U postgres -c "CREATE DATABASE myplacements_test"

TEST_POSTGRES_URL=postgresql://postgres:password@127.0.0.1:5432/myplacements_test pytest -m postgres
```

The database name **must** end in `_test`. The fixture drops every table, and
the dev database usually lives on the same container — the guard refuses
anything else rather than trusting the URL.

## How the frontend harness works

`vitest.config.ts` runs jsdom at `http://rit.myplacements.in/`, so tests start
on a tenant subdomain, which is where the staff app actually runs.

`src/test/setup.ts` resets everything between tests: the DOM, the mock API's
handlers, the host, and storage.

`src/test/utils.tsx` has the helpers: `setHost()` to change tenant,
`signIn()` / `signOut()` for a session, `fakeUser()`, and
`renderWithProviders()` for anything that needs the toast/confirm/router
context.

The mock API (`src/test/server.ts`) ships **no** default handlers. Each test
stubs what it needs; an unstubbed call fails the test rather than silently
passing through.

```ts
it('shows the error the API returned', async () => {
  server.use(http.get('/api/companies', () => HttpResponse.json({ detail: 'nope' }, { status: 403 })))
  renderWithProviders(<Companies />)
  expect(await screen.findByText(/nope/)).toBeInTheDocument()
})
```

## What is covered so far

**Tier 0 (pure units, no database)** is in place: 586 backend tests and 115
frontend, both suites under three seconds.

| Module | What the tests hold down |
|---|---|
| `core/timeutil` | Local-day bounds in IST, cutoffs, and the `overdue_before` rule that must not apply the timezone shift. |
| `core/tenant` + `lib/tenant.ts` | The subdomain table, on both sides, with the shared cases written out so a divergence turns one of them red. |
| `core/security` | Token claims, expiry, tampering, `alg=none`. |
| `services/risk` | The scoring arithmetic, and that optional evidence can only ever help. |
| `services/matching` | Blank criteria are not applied, a missing CGPA is counted apart from missing the bar, and evidence is ranked by how it was earned. |
| `services/allocation` | `NO_MOU` vocabulary, workload outbidding a perfect fit, and that the same input proposes the same allocation twice. |
| `services/hr_engagement` | Unresolved outreach kept out of the denominator, and the staleness cap. |
| `services/insights` | `verify` - the guard on what the model may quote. |
| `services/excel_io` | Import coercion, per-row errors, and sheet selection. |
| `services/monthly` | Period arithmetic across short months and year ends. |
| `ai_service` parsers | Fenced JSON, thinking blocks, failed search results, placeholder words. |
| `lib/utils.ts` | The missing-Z fix in `formatDateTime` and `timeAgo`. |
| `lib/validation.ts` | Every rule, plus declaration-order reporting. |

Coverage sits at 100% on `allocation` and `hr_engagement`, 98% on `excel_io`,
93% on `timeutil`. The modules still low (`skills`, `notify`, `followups`,
`report_defs`) are the ones that need a session; those are the service tier.

Two deliberate gaps, recorded rather than hidden:

* `insights.verify` matches figures, not units, so "12%" passes on the strength
  of a finding that said "12 students". Tightening it means parsing units out of
  free-text headlines. `test_the_guard_matches_figures_not_units` says so.
* Test output carries two React Router v7 future-flag warnings. Silencing them
  would make the test config disagree with what `BrowserRouter` does in the app.

## The security tier

`backend/tests/security/` asks one question in four ways: who may reach what.
It is kept separate from the feature tests because it is the tier most worth
running on its own, and because it found three live holes the first time it ran.

| File | Question |
|---|---|
| `test_route_inventory.py` | Does every endpoint have *any* authentication? Public ones must be named in `PUBLIC_ENDPOINTS` with a reason, so adding one lands in a diff. |
| `test_tenant_boundary.py` | Can one college reach another's data? Reads are checked by row count, not status code - a 200 carrying the other college's rows has leaked just as completely. |
| `test_role_gates.py` | Within a college, who may do what. Asserted from both sides: a gate that refuses everyone would otherwise pass. |
| `test_officer_scope.py` | An officer sees their own book and nothing else. |
| `test_auth_boundaries.py` | Where you may sign in, and what a setup link is worth. |
| `test_portal_and_cron.py` | The two surfaces deliberately outside the staff gate, and that they still work. |

Two conventions worth knowing before adding to it:

* **404 for "not yours", 403 for "not allowed".** A 403 on another college's row
  would confirm the row exists, which is itself a leak. Within your own college
  nothing is hidden, so 403 is both safe and more useful.
* **Assert the permitted case too.** Every refusal test has a sibling proving
  the right person still gets through.

### What it found

Running it the first time turned up three things, all now covered by a test that
fails if they come back:

1. **Five handlers in `companies.py` had no tenant scoping** - `DELETE`,
   `generate-profile`, `interview-questions`, `exam-questions` and the HR
   `draft-email`. Any signed-in user of any college could delete any company on
   the platform, and draft an email naming another college's HR contact. Fixed
   by routing them through `_accessible_company`, the helper every sibling
   handler already used.
2. **Students could read the staff API.** They hold real accounts on their
   college's subdomain, so a student token passed `get_current_user` exactly
   like an officer's - 28 endpoints answered it, including `/api/students/export`
   (every classmate's CGPA, backlogs and risk band as a spreadsheet) and
   `/api/hr-contacts`. Fixed with `get_current_staff`, attached at the router
   level so new endpoints are covered by default. The tokenless cron ticks moved
   to their own ungated router; `/api/portal`, `/api/auth` and
   `/api/notifications` are deliberately outside the gate.
3. **A disabled account answers 403 where everything else answers 401**, and
   that check runs before the host check. Documented rather than changed - it
   takes a correct password to reach, and login semantics are a product
   decision. See `test_the_disabled_check_currently_runs_before_the_host_check`.

## Conventions

- `describe` names the unit; the `it` reads as a sentence about behaviour, not
  about implementation.
- One reason to fail per test.
- A test that needs the AI or email mocks the seam: `ai_service._get_client`
  or `notifications.send_email`. Nothing else reaches them.
- Deprecation warnings from our own code fail the run, so they get fixed while
  the context is fresh. `datetime.utcnow()` is the one documented exception.
