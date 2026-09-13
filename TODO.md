# MyPlacement.AI — Roadmap & To-Dos

Tracks remaining work against the product spec (`MyPlacement.docx`).
Status as of **2026-09-13**.

Legend: `[ ]` pending · `[~]` partial / backend-only · `[x]` done

---

## ✅ Already built (for reference)

- [x] **Module 1 — Company Database**: CRUD, import/export, detail page, per-company
  **job roles** (2026-09-12): the roles a company hires for, with status (open/closed),
  shown on the list row as "3 roles · 2 open".
- [x] **Module 5 — Student Profiles**: CRUD, import/export, readiness scoring. Server-side
  **filters and column sorting** (2026-09-13): branch + batch built from the college's own
  data, min CGPA, backlogs, login state, placement, risk; all ten data columns sortable
  (blank-last, enums ranked by attention), sort remembered per session, export follows the
  filters and sort. Shared `components/ui/table-sort.tsx` with Companies.
- [x] **Module 8 — Drive Management**: drives, participants, round tracking, per-drive offers.
  Each drive carries its company's name (2026-09-13), so listing drives needs no company lookup.
- [x] **Auth & roles**: login, password reset, user management (7 roles)
- [x] **AI — Company Profile generation** (backend + UI)
- [x] **AI — Skill-Gap Report** (backend + UI, with optional target company)
- [x] **Subdomain multi-tenancy** (2026-06-12): each college = `<code>.myplacements.in`;
  `super_admin` console at `admin.myplacements.in` (Colleges + People + Platform tabs) with
  one-call college + first-admin provisioning; tenant resolved via Host/`X-Tenant`; login
  boundary + JWT `college_id`; per-college roll-number uniqueness. See memory
  `multitenancy_subdomains`.
- [x] **Student Portal** (2026-06-19): students sign in with **roll number + password** on
  their college subdomain (Student/Staff toggle on the login screen). Admin "Enable login"
  (single + bulk) on the Students page issues one-time password-setup links. Role-gated
  portal (`/portal`) with: Dashboard (readiness/risk/skills + resume card), Mock Interview
  practice (Q+A, `generate_interview_prep`), Skill Report (gap report), AI Resume Review
  (`review_resume`), Jobs & Drives with self-apply. Backend: `auth/student/login`,
  `students/{id}/enable-login` + bulk, `/portal/*`. See memory `student_portal`.
- [x] **Invite links instead of temporary passwords** (2026-09-12): every account is
  provisioned with a single-use, expiring link the person uses to set their own password —
  Add user (People), college + first-admin onboarding (console) and student "Enable login"
  all issue one, and a **Send/Resend link** action on People re-issues one (which also covers
  staff lockouts, since there is no self-service reset). Backend: `user_invites` (SHA-256 of
  the token only, single-use, revoked by a re-issue, tenant-bound), public
  `GET /auth/invite/{token}` + `POST /auth/invite/{token}/accept` (accepting signs you in),
  `POST /users/{id}/invite`. Email delivery via **Resend** (`RESEND_API_KEY`, `MAIL_FROM`);
  with no key set, links are still issued and shared by hand. Frontend public
  `/accept-invite/:token`. **SMS + WhatsApp are not automated** (TRAI DLT / Meta template
  lead times, and no phone column on `users` or `students`) — the UI hands the message to the
  sender's own WhatsApp via `wa.me` instead. See memory `invite_links`.
- [x] **Resume upload (PDF)** (2026-06-19): students upload a PDF on the dashboard
  (`POST /portal/me/resume`, stored under `uploads/`, served at `/api/uploads/*`). A resume
  is **required to apply**; each application snapshots `resume_url` onto the participant;
  staff see a "View" link per applicant. (Resume review still uses the structured profile.)
- [x] **"New drives" alert** (2026-06-19): in-app, client-side (localStorage) badge on the
  portal nav + dashboard banner for unseen eligible drives.
- [x] **Drive applicant management** (2026-06-19): staff Drive Detail page (`/drives/:id`)
  with applicants table + round-status controls; drive cards show company name + applicant
  count; "New Drive" form uses a company **dropdown**.
- [x] **Drive selection → placement** (2026-06-19): marking a participant `selected` prompts
  for the package, sets the Student placed + a drive-linked accepted Offer; reverting undoes
  it; no double-counting with the manual "mark placed" flow. Added `withdrawn` status.
- [x] **Role-specific dashboards** (2026-09-07): `Dashboard.tsx` dispatches by role —
  Officer (own allocations + results), Leadership (team progress / college overview tabs,
  Principal + Pro/Deputy Pro Chancellor) and the college snapshot for everyone else. Heads
  set per-officer targets. Backed by `/analytics/my-work` + `/analytics/officer-performance`.
- [x] **Officer access model + lead review** (2026-06-30): `placement_officer` sees only its
  own officer card and the companies allocated to it, enforced in the API, not just the UI;
  an officer-created company is a **lead** flagged for head review (approve / decline), and
  officers can set the status of companies allocated to them. See memory
  `officer_access_model`.
- [x] **AI auto-allocation of companies to officers** (2026-06-30): "AI Auto-Assign" on the
  Companies tab proposes company → officer assignments weighing region, sector, existing
  relationship, workload, priority, follow-up state and targets.
  `POST /officers/auto-allocate/preview` → review → `/apply`. See memory `ai_auto_allocation`.
- [x] **Daily officer updates + leadership digest** (2026-09-12): officers/coordinators file
  at `/daily-update`, leadership reads `/daily-digest`. Countable activity is **derived** from
  communications/drives/offers and frozen onto the row as a `metrics` snapshot at submit time,
  so back-dating a call cannot rewrite a report leadership already read. Per-college cutoff;
  one hourly Railway cron (`run_cron.py`) covers every tenant. See memory `daily_updates`.
- [x] **Opportunity Radar** (2026-09-12): a daily web scan for job/internship openings posted
  in the last 24h, at `/opportunities` + a dashboard panel. Leadership adds one to the
  companies list (optionally allocating an officer in the same click) or dismisses it;
  officers get it read-only. **One national scan serves every tenant** (`job_postings` global,
  `job_leads` = one college's decision), so cost stays flat as colleges are added.
  **Ships stopped** — the schedule is a platform flag a `super_admin` starts from the console's
  Platform page, because a daily paid search spends real Anthropic credit. "Scan now" is
  unaffected. See memory `opportunity_radar`.
- [x] **In-app notifications** (2026-09-12): bell + `/notifications` page, unread count
  polling scoped to the staff shell; raised from companies, drives, officers, daily updates
  and the portal, with coalescing so one event doesn't fan out into a dozen rows.
- [x] **Module 2 — HR Contact Management** (2026-09-12): full CRUD (was create-only) with the
  tenant-leak on list/add fixed; dedicated `/hr-contacts` directory across companies with
  search, company/region filters, follow-up buckets and six sorts; relationship score kept
  deliberately in two halves (the officer's manual 1–5 beside a computed engagement score
  from the communication log); `next_action` beside `next_followup_date`; last-contacted-by
  derived from the latest communication's author. Delete **detaches** logged communications
  rather than deleting them. See memory `hr_contact_management`.
- [x] **Shared UI primitives**: `<Modal>` (focus trap, Escape, unsaved-changes guard,
  portalled to `<body>` as of 2026-09-13), `useToast()`, promise-based `useConfirm()`,
  `<Field>` + validation helpers, `<SortableHead>`/`useTableSorting` (server-ordered tables,
  sort remembered per session) and `<SearchSelect>` (below). No `window.confirm` or native
  validation bubbles anywhere. See memory `frontend_ui_primitives`.
- [x] **Nothing loads a whole table into a dropdown any more** (2026-09-13). Six screens each
  fetched every row up front so a `<select>` or a client-side filter could work — fine for a
  college with a hundred students, a stack of requests for a client with a hundred thousand
  (`fetchAll` pages 200 at a time, so 100k students meant ~500 requests before the form was
  usable). Now:
  - **`<SearchSelect>`** (`components/ui/search-select.tsx`) asks the API for the ~20 rows
    matching what is typed — debounced, stale responses discarded, arrow-key navigation,
    portalled menu so it works inside a dialog. Escape closes the menu, not the form: `<Modal>`
    listens for Escape in capture on `document`, so the picker listens on `window`, one step
    earlier in the capture path. The searches live in `lib/pickers.ts`.
  - Converted: record-an-offer (student + company), training enrolment, officer allocation
    (`unassigned` only), new-drive company.
  - **People** was a table, not a picker: moved to server-side search + pagination like
    Students and Offers.
  - **Drives** loaded a capped 200 companies purely to label cards (past that cap they read
    "Company #412"); `DriveOut` now carries `company_name`, so the page loads none.
  - `lib/fetchAll.ts` is gone with its last caller, so the pattern can't be reached for again.

---

## 🌐 Multi-tenancy follow-ups

- [x] **Apex marketing site** (2026-07-25) — `myplacements.in` and `www` serve a public
  landing page (`pages/marketing/Landing.tsx`); the staff app lives on tenant subdomains.
- [x] **Production infra** (2026-07-25) — live on Railway (one full-stack service serving the
  SPA from FastAPI) + Neon Postgres + GoDaddy DNS, with wildcard `*.myplacements.in` and its
  TLS cert. See memory `deployment_hosting`.
- [ ] **Per-college `users.email`** — still globally unique; switch to composite unique
  `(college_id, email)` so the same staff email can exist at two colleges (needs migration).
- [x] **Remove dead `components/layout/Sidebar.tsx`** (+ `SidebarPreview` route) — done
  2026-09-13; the live sidebar is `components/ui/sidebar.tsx`.

---

## ✅ Phase 1 — AI quick wins — DONE (2026-06-19)

- [x] **AI HR email drafting**: `POST /companies/{id}/hr-contacts/{hr_id}/draft-email` →
  `DraftEmailModal` (purpose presets, editable draft, copy + mailto)
- [x] **AI mock interview question generation**: `POST /companies/{id}/interview-questions` →
  `InterviewQuestionsModal`

---

## ✅ Phase 2 — Scaffolded modules — DONE (2026-06-19)

- [x] **Module 3 — Placement Officer Work Allocation**: officer CRUD, assignable users,
  per-officer assignments with an active→accepted→escalated→completed workflow;
  `pages/officers/Officers.tsx`. Extended since with the officer access model and AI
  auto-allocation (above).
- [x] **Module 9 — Communication Tracking**: `GET /communications`, pending follow-ups,
  log/update/delete; logging syncs the HR contact's `last_contacted_at` /
  `next_followup_date`. Timeline + Pending follow-ups tabs with overdue highlighting.
  Authorship recorded per entry (2026-09-12).
- [x] **Module 7 — Placement Training Monitoring**: module CRUD with enrolment aggregates,
  enrol students, per-record progress (score, attendance %, mock score, status).
  **Bulk attendance import** (2026-09-13): upload the sheet the trainer sent back instead of
  picking students one at a time. Matched on roll number, case-insensitively; a student already
  on the module is updated rather than rejected, so the same sheet can be re-uploaded once
  marks are added. A blank cell means "no figure supplied" and never wipes a recorded mark.
  Every row is reported back including the ones that matched nobody — an import that silently
  drops half a batch is worse than one that fails. Deliberately no AI: unlike a drive roster,
  an attendance sheet is a column of roll numbers, and if that column can't be found the
  honest answer is to say so rather than spend credit guessing. Plus a blank template and a
  roster export in the same columns, so the round trip closes.
  **`TrainingModule.skills`** (2026-09-13) records what a module teaches, which is what turns
  a completion into evidence a student has a skill — see Module 6.

---

## 🤖 Phase 3 — New AI features (greenfield)

- [x] **AI Resume Review** (2026-06-19) — profile-based review in the student portal.
  Future: parse the uploaded PDF instead of the structured profile.
- [x] **AI Officer Workload Optimization** (2026-06-30) — shipped as AI auto-allocation.
- [x] **AI escalation reply drafting** + **AI round-roster sheet parsing** (`parse_roster_sheet`)
  + **AI exam question generation** — not originally on this list.
- [x] **Module 6 — AI Student–Company Matching** (2026-09-13): "Suggest students" on Company
  Detail. `POST /companies/{id}/match`, `services/matching.py`.
  - **Eligibility is a rule, not a judgement.** Branch, CGPA, backlogs and batch come off the
    role (falling back to the company), and the response says which record supplied each — so
    an empty shortlist can be traced to the criterion that emptied it rather than guessed at.
    Every excluded student is counted against the *first* rule they failed, so the tally sums
    to the number not shortlisted instead of double-counting.
  - **The ranking is deterministic and auditable.** Fit is a weighted sum of six components
    (skills, academics, clean record, readiness, training, similarity to past hires), all
    shown per student with the weights used. A placement head has to be able to answer "why is
    this student third?", and "the model said so" is not an answer when a parent asks.
  - **AI shapes the inputs, never the order.** `use_ai` makes one Sonnet call that returns a
    *weighted skill profile* — which skills matter and how much — and those weights are printed
    before the ranking that used them. The model never sees the student list and never ranks
    anybody. Weights are clamped to 0.05–1.0 on the way in: an unclamped 40 would silently
    dominate every other component.
  - Everything works with **no API key**: the toggle then reports why and ranks on the skills
    already recorded. A model failure or an unusable reply degrades the same way.
  - Also returns the training gaps (wanted skills the shortlist most lacks — a training list,
    not a rejection list) and what the company actually took before, computed from won offers.
  - Costs a call **only when the toggle is on**, per run.
  - **Skills now come from three places** (2026-09-13), not just the manual field:
    `TrainingModule.skills` records what a module teaches, so *completing* it credits the
    student with those skills; `Student.certifications` is read with a whole-word search, so
    "AWS Certified Solutions Architect" satisfies an `aws` requirement; and the declared list
    still counts. Enrolment alone credits nothing — being on a Python course is not evidence
    of Python.
  - The shortlist shows **which source backs each skill** (trained / certified / declared).
    That distinction is the point: merge the three into one free-text column and a verified
    skill becomes permanently indistinguishable from a claimed one, and can never be weighted
    differently later.
- [x] **Student skills with provenance** — ✅ 2026-09-13. `student_skills`
  `(student_id, skill, label, source, evidence, verified_at)`, one row per source, so the same
  skill can be backed by more than one and "trained **and** self-declared" stays visible.
  - **`Student.skills` survives as a derived cache** with exactly one writer,
    `services/skills.py:resync`, and is never assigned directly. A dozen places read it
    (scoring, risk, the AI prompts, exports, search) and it is what a human skims on the
    Students page. Denormalisation with a single author — not the two-sources-of-truth mistake
    that lost a ₹20 LPA placement from the offer analytics earlier today.
  - **Each source can only delete its own rows.** An officer clearing the skills field removes
    their entries and leaves a training-earned skill standing: that was earned, not asserted,
    and is not theirs to delete. Tested, because it is the whole point of the table.
  - Training completion grants skills and **un-completing withdraws them** —
    `sync_training_skills` recomputes from what is completed now rather than appending.
  - Trust order `training > officer > student` extends the matcher's existing
    training > certification > declared rather than inventing a second ordering. The cache
    leads with the verified ones; within a tier the order is alphabetical, so the string is
    stable rather than dependent on module order.
  - **Certifications are deliberately not stored here.** Certificate evidence is a text search
    against the skills a particular role asks for ("AWS Certified Developer" backs "aws"), and
    that set is not known ahead of time — so the matcher keeps deriving it per shortlist.
    Enumerable sources go in the table; this one cannot.
  - `normalise` / `split_skills` moved here and are re-exported from `matching.py`. Two
    spellings of "normalise" would let a skill match in one place and miss in the other.
  - **`PUT /portal/me` ships**: students can finally maintain their own skills and links.
    Recorded as `source='student'`, labelled as theirs for good. The payload is a closed schema
    — CGPA, backlogs, branch and placement status are the college's record and drive the
    reports, so a student sending them is ignored (tested). `GET /portal/me/skills` and
    `GET /students/{id}/skills` return the provenance; the portal card shows it with an icon
    and a word, not colour alone.
  - `backfill_student_skills.py` seeds rows from the existing free-text column, attributed to
    `officer` — who could edit the field — rather than to a guessed source. Dry run by default.
- [x] **Follow-up Reminder** (2026-09-13) — a reminder already rode the daily cron, but it
  only fired on the exact due date, counted follow-ups the contact had **already answered**,
  attributed them by whoever typed the log rather than the officer, and never looked at
  `HRContact.next_followup_date` at all. Rewritten onto `services/followups.py`:
  - **Overdue keeps surfacing.** A reminder that fires once on the due date and never again is
    silent about everything an officer missed while they were on leave.
  - **Answered follow-ups are not owed**, however old the date — the rule the officer report
    already applied.
  - **The unit is the obligation, not the row.** Logging a communication syncs the contact's
    follow-up date, so the same promise lives in two tables; counting both told an officer
    they owed twice what they did.
  - Attribution order matches the officer report: officer stamped on the log → whoever typed
    it → the officer the company is allocated to. Unattributable follow-ups go to nobody
    rather than everybody.
  - One standing notification per person, grouped so a persisting backlog updates the unread
    row instead of adding one a day; high priority once anything is actually overdue; email
    suppressed so it can't double up with the daily digest.
  - **No new model call.** The decision of who is owed what is a rule, and the drafting help
    already exists as `draft_hr_email`. A per-officer-per-day paid call across every tenant
    would be a recurring cost with no switch — see the Opportunity Radar precedent.
- [x] **One "overdue" boundary** (2026-09-13) — `timeutil.overdue_before()`. Eleven sites
  compared `next_followup_date < now`, but that column holds a *date* (it comes from an
  `<input type="date">` and is stored at naive local midnight), so anything due today read as
  overdue from 00:01 — on the morning it was due. Late now means the follow-up's **day** has
  passed, everywhere at once: the HR directory's filter and summary, the analytics buckets,
  the officer dashboard and report, the engagement scorer, the daily metrics and the reminder.
  - The `upcoming` filters moved with it deliberately. Had only `overdue` shifted, a follow-up
    dated today would have belonged to neither bucket and disappeared from both.
  - It deliberately does **not** use `day_bounds_utc()`. That shifts by the timezone offset,
    which is right for genuine UTC instants (`communicated_at`, `created_at`) and wrong for a
    date column: in IST it made every overdue age read a day short, and on a negative offset
    it would have put today's follow-ups straight back into "overdue".
  - Visible effect: same-day follow-ups now show as due rather than overdue, and engagement
    scores move very slightly for contacts whose promise falls due today.
- [x] **AI Placement Risk Prediction** — ✅ 2026-09-13. Scored on inputs, and *checked*.
  - **Deliberately not a language model.** `student_scoring.assess()` is called synchronously
    from eight sites — every student save, drive selection and placement recompute — and a
    student who asks why they were flagged has to get the same answer twice. A per-save
    network call would be wrong on cost, latency and auditability at once. `risk.py` runs on
    structured features instead.
  - **Input-only scoring** (`score_baseline`, `score_evidence` in `services/risk.py`). The
    stored score folds placement status in — a placed student is 100/low by definition. That
    is right for the stored field but makes the score impossible to validate: asking whether
    it predicts placement when it is *derived* from placement is circular. These two read
    only what was true before the outcome.
  - `score_baseline` is the shipped rule with placement status removed, kept verbatim, so
    calibrating it says something about the score the app has actually been storing.
    `score_evidence` adds certifications, completed training, mock scores and drive progress.
  - **Optional evidence can only help.** The first version was additive on a fixed 100-point
    scale, which scored *absence of data* as weakness — a 9.0-CGPA student with no training
    recorded fell to medium risk. It now renormalises over the components it can measure, so
    a college that has not adopted Training does not see every student drop a band.
  - `GET /analytics/risk-calibration` (leadership only) + the panel on the Students tab band
    a settled batch and report the observed placement rate per band, plus one `separation`
    number — low-band rate minus high-band rate — stated in words: "separates well" /
    "does not separate — the bands carry no information" / "points the wrong way". Students
    who opted out or went for higher studies are excluded and counted separately; they were
    never trying to be placed.
  - **The weights are reasoned, not fitted.** That is exactly why calibration exists. Put
    `score_evidence` in place of the baseline only once it separates better on this college's
    own past batches — on the seeded data both sit near zero, which is the honest answer for
    a batch with a 1.4% placement rate.
- [x] **Fix: a hand-recorded placement vanished from the offer analytics** — ✅ 2026-09-13.
  `_sync_placement_offer` stood aside whenever a student had *any* real offer row, including
  a **rejected or still-pending** one. A student marked placed by hand at 20 LPA who had
  earlier been rejected somewhere kept the package only on the student row: the Students
  table showed ₹20 LPA and every offer-based figure — the Offers tab's highest/median CTC,
  the offer counts, the company and role breakdowns — silently skipped it.
  - Only a **live** offer (`LIVE_STATUSES`, imported from `services/placement.py` rather than
    restated) now suppresses the placeholder, so the rule cannot drift from the one the
    placement rate already uses.
  - `backfill_placement_offers.py` repairs rows written before the fix — dry run by default,
    `--apply` to write. Idempotent; leaves correct rows and unplaced students alone.
  - Separately, an officer's analytics are scoped to their own drives while the Students page
    is college-wide — the same symptom, but by design. The Analytics page now says so instead
    of letting the two disagree silently.

- [x] **Reports: an "All batches" option** — ✅ 2026-09-13. `branch_wise`, `ctc_analysis` and
  `unplaced_risk` could only ever cover one batch: `year = batch_year or years[0]`, so with
  nothing picked they silently reported the newest year. A head asking "what is our highest
  package?" got the latest batch's answer, which is how a ₹20 LPA placement in an older batch
  can be missing from a report that looks college-wide.
  - The picker now has three positions, and they are three distinct requests: `''` → latest
    batch (unchanged), `all_batches=true` → every batch pooled, a year → that year. The flag
    is separate from `batch_year` rather than a magic value, because "no year to filter on"
    genuinely means two different things — an empty college and a deliberate pooling request.
  - `_resolve_batch` / `_batch_label` / `_batch_meta` are shared, so the three reports cannot
    drift on what they claim to cover. The subtitle reads "All batches"; the meta row stays
    bare ("Batch: 2026", not "Batch: 2026 batch").
  - Pooling is **disclosed**: a caveat names the span and warns that counts and packages pool
    across years but a placement *percentage* does not — the newest batch is usually still in
    progress and drags the combined rate below any single year's. It travels into the .xlsx.
  - Not a bug in the reports: the reported "report says 12.5, table says 20" was this batch
    scoping working as designed. `students.batch_year` is NOT NULL, so no placement can fall
    between the batches — verified.

- [x] **AI Placement Dashboard Insights** — ✅ 2026-09-13. The rules find; the model phrases.
  - `services/insights.py` computes the findings deterministically from the services the
    charts and reports already use (`company_metrics`, `followups`, the student rows). The
    model is handed a finished list and asked only to join it into prose — it is never asked
    what matters. So a summary cannot disagree with the chart beside it, and turning the model
    off costs presentation, not content: the rule-written headlines are full sentences and are
    what gets shown.
  - **The output is checked.** `verify()` pulls every digit-bearing figure out of the
    generated text and discards the *whole* narrative if any of them is not one we supplied —
    a rounded placement rate, a transposed package, an invented company count. Not patched up:
    a summary with one invented number reads exactly as confident as a correct one. The prompt
    reserves digits for quoting supplied figures and asks for words elsewhere ("two areas need
    attention"), which keeps the check strict without tripping over ordinary prose.
  - **Cost.** `GET /insights/dashboard` never calls the model, so an open dashboard is free
    however many people have it. `POST` generates, needs a button press, and caches against
    `(college, scope, day)` in the new `dashboard_insights` table — a head, a principal and a
    pro-chancellor share one run instead of paying for three. `?refresh=true` forces a rerun.
  - The row keeps the fact pack it was written from, so a claim in the text can still be
    checked against what was true months later.
  - Leadership-only, matching Reports. Findings carry an icon and a word beside the colour.
  - **On the College overview tab only.** It was first mounted on both leadership tabs, so a
    head saw the identical panel twice (spotted in review). The summary pools the whole
    college, so it has no place on the per-officer Team progress tab. Team progress keeps the
    workload panel; College overview keeps this one.
  - `CollegeDashboard` is also the fallback dashboard for staff who are not leadership, and
    this endpoint is leadership-only — so the panel checks the role before fetching rather
    than firing a request on every load that could only ever 403. The server is still the
    authority; `lib/roles.ts` now holds the one frontend copy of `LEADERSHIP_ROLES`, mirroring
    `app/core/roles.py`, instead of the list living inside `Dashboard.tsx`.
- [x] **AI Monthly Placement Report generation** — ✅ 2026-09-13. The tenth report:
  **Monthly placement report**, one month written up for management with its tables underneath.
  - Same split as the dashboard summary, and deliberately the same code: `services/monthly.py`
    computes the month's facts and findings, and imports `Finding` and the number check from
    `services/insights.py` rather than redefining them. Two features that both claim to state
    "what happened" must not be able to disagree about it.
  - **Defaults to the last complete month.** A report about a month still running understates
    everything in it. The current month can be picked and carries a caveat saying so.
  - `Report` gained `narrative` / `narrative_note`, rendered as prose by *both* renderings —
    JSON and .xlsx (merged, wrapped cells). It lives on the Report rather than inside a
    one-column Section, because a summary that arrives in the workbook as a column of cells is
    not the same document that was on screen.
  - **Reading the report never calls a model.** The prose is written by `POST /insights/monthly`
    and cached per month in the shared `dashboard_insights` table (`scope="monthly"`), so three
    readers and every export share one run. `refresh=true` reruns it.
  - A write-up made for one month and served for another is **rejected by the number check** —
    tested. So is an invented figure; the findings stand in and the report says why.
  - **Bug found by that test:** allowed figures were a hand-maintained list per finding, which
    drifted from the headlines. A monthly headline names its month, so "August 2026" put a year
    in the prose that no list mentioned and a write-up that did nothing worse than name its own
    month was discarded. `allowed_numbers` now derives from the headlines themselves — anything
    printed to the reader is quotable — and cannot drift again.

---

## 📊 Phase 4 — Analytics expansion (spec §4)

Built: overview, branch-wise, CTC distribution, per-drive funnel, my-work (officer), officer
performance — plus the six Analytics tabs below.

- [x] **Officer Analytics** — `/analytics/officer-performance` + the Leadership dashboard
  cover assigned/contacted/converted and targets. **Workload balance** ✅ 2026-09-13:
  `GET /analytics/officer-workload` + the panel above Officer progress.
  - **Deliberately a separate panel, not a column in the progress table.** That table ranks by
    what officers have *landed*. This measures what they are *carrying*. An officer holding
    twice the companies and landing fewer offers is not underperforming, and one score merging
    the two says exactly that.
  - Load = open companies + upcoming drives + follow-ups owed, weighted. The weights are
    **reasoned, not fitted** — an upcoming drive has a date, a room and a panel behind it, so
    it outweighs a company being talked to; an overdue promise outweighs a pending one. Said
    out loud on the panel, and kept in one place so a college can change them.
  - One reading: each officer's **share of the team's load**, and the spread between busiest
    and lightest, stated in words — "evenly spread" / "somewhat uneven" / "heavily skewed".
  - **No target comparison, deliberately.** The first version showed open companies as a
    percentage of `target_companies`, reading that field as capacity. It is not:
    `assigned / target_companies` is already rendered as *Target attainment* on the officer
    progress table, where it means progress toward a goal. One ratio cannot mean "what they
    have achieved" in one panel and "how overloaded they are" in another on the same page —
    and a reader did take "25x their target" to mean the officer had done twenty-five times
    their job. No field in the schema states an officer's capacity, so the panel no longer
    pretends to measure it; the subtitle points at the table for targets.
  - Unowned companies are reported beside the spread — balancing the rest says little while
    work sits unallocated — with a link to allocation rather than a second allocator.
  - Follow-ups come from `services/followups`, so "owed" means what the reminder and the
    officer report mean: **one obligation per HR contact**, not per log row. Chasing the same
    contact twice is one promise, and the test asserts it does not double an officer's load.
  - Diagnoses only. Moving companies between officers stays with AI auto-allocation, which
    already exists and already shows its proposal before applying it.
- [x] **Offer Analytics** (2026-09-13) — `GET /analytics/offers`, the **Offers** tab.
  Headline (median/highest/average live package, joining conversion, dropout rate), an
  offer→taken-up→joined funnel whose stages are true subsets, offers-per-student, and
  breakdowns by branch, company and role. Packages read off live offers only: an offer the
  student turned down was never this college's number.
  - Counts **offers**, where the Placement tab counts **students**. A student holding three
    offers is one placement and three offers, so the two medians differ by design; each card
    says which basis it uses. This is the single most misreadable thing on the page.
  - Multi-measure breakdowns are tables, not charts — which is also what keeps two different
    scales off one pair of axes.
- [x] **Student Analytics** (2026-09-13) — `GET /analytics/students`, the **Students** tab.
  Placement rate by CGPA band and by backlogs, the risk mix of students still looking,
  training (attendance, mock scores, and placement rate trained vs not), and skill gaps
  between placed students and those still looking.
  - **Placement rate by risk band is deliberately not built**: `student_scoring.assess()`
    sets a placed student to risk *low* by definition, so the chart would always report that
    low-risk students get placed — it would be measuring its own rules. The bands that *are*
    shown (CGPA, backlogs, training) are inputs to the score rather than outputs of it.
  - Readiness is averaged over the students still looking for the same reason: placed
    students score 100 by construction, so an average over everyone just tracks the
    placement rate.
  - "Placement probability" from the spec stays with **AI Placement Risk Prediction** below;
    what is here is the observed evidence you would want before trusting such a model.
- [x] **Company Analytics** (2026-09-13) — `GET /analytics/companies`, the **Companies** tab.
  Status mix in attention order, the conversion funnel, reply rate, and two work lists: best
  converting, and companies going quiet (workable ones with nothing logged lately and no offer
  — dormant and blacklisted are left out, they are quiet on purpose).
  - The arithmetic lives in `services/company_metrics.py`, **shared with the Company
    Conversion report**. Two copies of "what counts as contacted" would drift apart the first
    time either was tuned; the report's tests pass unchanged against the shared version.
- [ ] **Chart palette** — the five-colour `PIE_COLORS` in `lib/utils.ts` fails colour-blind
  separation: green `#22c55e` and amber `#f59e0b` sit at ΔE 5.7 under protanopia, below the
  usable floor. It only bites where 3+ series share a chart, which nothing does today, but any
  new multi-series chart must re-step it (the validated pair now in `pages/analytics/parts.tsx`
  is blue `#2563eb` + amber `#f59e0b`). Related: the Placement tab's placement-status pie is a
  two-slice pie showing a number already on a tile above it — a stat tile would say it better.
- [x] **HR Analytics** (2026-09-13) — `GET /analytics/hr`, the **HR** tab. Reply rate per
  channel, follow-up ageing in the same four buckets the HR directory filters on, the
  engagement band mix, and an escalation queue ordered by how long each contact has been
  ignored.
  - `services/hr_metrics.py` is **shared with the HR Communication report**, so "answered" and
    "overdue" mean one thing in both.
  - Entries still awaiting a reply stay out of the rate's denominator — an unanswered mail
    from this morning is not evidence of anything yet. "No history" is its own group, never a
    score of zero.
- [x] **Drive Analytics** (2026-09-13) — `GET /analytics/drives`, the **Drives** tab.
  Participant funnel, round-by-round appeared/passed with where candidates drop, selection and
  offer conversion, and a per-drive table. Takes a batch year.
  - Round figures are the counts **officers entered per round**, not a recomputation from
    participant statuses. The two can legitimately differ — a student who cleared a round then
    withdrew — so both views sit side by side rather than one silently reconciling the other.
  - A round nobody has filled in yet is left out rather than counted as zero appearances.

---

## 📑 Phase 5 — Dashboards & Reports

- [x] **Module 10 — Offer & Joining Tracking** (2026-09-13): offers were written by the drive
  flow and never read back — `joining_date`, `dropout_reason`, `offer_letter_url` and
  `is_dream_offer` were dead columns, and the lifecycle stopped at *placed* rather than
  *joined*.
  - **`routers/offers.py`**: list (paged, `X-Total-Count`), `/summary`, `/filter-options`,
    create, update, delete. Filters: status, company, student, branch (exact), batch,
    awaiting-joining, search. All ten data columns sortable, blanks last, status ranked by
    lifecycle position. Tenant-scoped through the student; an officer sees only offers from
    companies allocated to them and cannot file against anyone else's.
  - **`offers.company_id`** added + backfilled from the drive: an offer knew its company only
    *through* a drive, so an off-campus or referral offer had no company at all and the list
    could not be read company-wise. `student_id` also gained the index it never had.
  - **`services/placement.py`** is now the single place that decides the student row from the
    offers they hold: placed while they hold an accepted or joined offer, at the **highest**
    package among them; the last live one going returns them to unplaced (the same reversion
    the drive flow already did). Opted-out and higher-studies students are left alone.
  - The **placeholder** the "mark as placed" flow maintains is now the row with *neither*
    drive nor company. It used to match any drive-less offer, so once offers could be recorded
    by hand, editing a student would have overwritten a real offer's package.
  - Frontend `/offers`: summary strip whose tiles double as filters, a badge on students
    holding several offers, dropout reasons inline, and "Not set" on live offers still missing
    a joining date. Records an off-campus or referral offer, and turns a placeholder into a
    real one by naming the company.
  - Fixed on the way: `POST /drives/{id}/offers` passed `drive_id` twice and raised
    `TypeError` on every call, and `OfferOut.drive_id` was non-optional so any drive-less offer
    would have failed serialisation. Nothing called either, which is why neither had surfaced.
  - Unblocks: Offer Analytics, and credible NBA/NAAC/NIRF evidence (which counts *joined*,
    not offered).
- [x] **Role dashboards (§6)**: Student (portal), Officer, Leadership and college snapshot
  all done. Remaining: dedicated Department, Company, Training and Offer dashboards — most of
  which are better served by the analytics tabs above than by another landing page.
- [x] **Reports (§7)** — all nine built (2026-09-13), at `/reports`,
  leadership-only (a report covers the whole college, and an officer's view of the college is
  deliberately partial everywhere else — one that silently showed them a slice would be quoted
  as if it covered everything).
  - **One description, two renderings.** `services/report_defs.py` builds a `Report`
    (title, meta, sections, caveats); `services/report_builder.py` renders it as JSON for the
    screen and as .xlsx for the file. A report whose downloaded copy can disagree with what
    was on screen is worse than no report, because the disagreement surfaces in a meeting.
  - Caveats travel *with* the figures into the workbook and are not collapsible on screen: a
    placement number quoted without its basis — which denominator, offers or people — is how
    these end up wrong.
  - All nine built: **Placement evidence** (the NBA/NAAC/NIRF numbers), **Branch-wise
    placement**, **CTC analysis**, **Students still seeking**, **Training effectiveness**,
    **Officer follow-up**, **Company conversion**, **HR communication**, **Monthly progress**.
  - Thresholds ("overdue", "active", what counts as a won offer) are imported from
    `routers/analytics.py` rather than redefined, so a report and the dashboard quoting the
    same word cannot drift apart.
  - Outreach in the officer report counts only against the officer stamped on the log — a call
    a head logged themselves belongs to nobody and is *not* added to the company owner's
    count, which would credit them with work they did not do.
  - **Not a filled-in submission form.** The evidence report produces the underlying figures;
    NBA, NAAC and NIRF each ask for them in their own template and window, and those change
    between cycles. Shaping the output to a specific template needs that template in hand.

---

## Suggested order

1. ~~Phase 1 (cheap AI wins)~~ ✅ done (2026-06-19)
2. ~~Module 3 → Module 9 → Module 7~~ ✅ done (2026-06-19)
3. ~~Module 10 — Offer & Joining tracking~~ ✅ done (2026-09-13)
4. ~~Offer + Student analytics~~ ✅ done (2026-09-13)
5. ~~Reports (§7)~~ ✅ done (2026-09-13) — all nine.
6. ~~Module 6 (AI matching)~~ ✅ done (2026-09-13)
7. ~~Remaining analytics tabs (Company, HR, Drive)~~ ✅ done (2026-09-13) — Analytics now has
   six tabs.
8. **Phase 3 AI items** ← current: ~~follow-up reminders~~ ✅, ~~the "overdue" boundary~~ ✅
   and ~~risk prediction~~ ✅ (2026-09-13); remaining are dashboard insights and monthly
   report generation, plus the officer workload-balance view and the `student_skills`
   provenance table.

