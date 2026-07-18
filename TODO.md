# MyPlacement.AI — Roadmap & To-Dos

Tracks remaining work against the product spec (`MyPlacement.docx`).
Status as of **2026-06-19**.

Legend: `[ ]` pending · `[~]` partial / backend-only · `[x]` done

---

## ✅ Already built (for reference)

- [x] **Module 1 — Company Database**: CRUD, import/export, detail page
- [x] **Module 5 — Student Profiles**: CRUD, import/export, readiness scoring
- [x] **Module 8 — Drive Management**: drives, participants, round tracking, per-drive offers
- [x] **Auth & roles**: login, password reset, user management (6 roles)
- [x] **AI — Company Profile generation** (backend + UI)
- [x] **AI — Skill-Gap Report** (backend + UI, with optional target company)
- [x] **Subdomain multi-tenancy** (2026-06-12): each college = `<code>.myplacements.in`;
  `super_admin` console at `admin.myplacements.in` (Colleges + People tabs) with one-call
  college + first-admin provisioning; tenant resolved via Host/`X-Tenant`; login boundary
  + JWT `college_id`; per-college roll-number uniqueness. See memory `multitenancy_subdomains`.
- [x] **Student Portal** (2026-06-19): students sign in with **roll number + password** on
  their college subdomain (Student/Staff toggle on the login screen). Admin "Enable login"
  (single + bulk) on the Students page issues one-time temp passwords (forced reset on first
  sign-in). Role-gated portal (`/portal`) with: Dashboard (readiness/risk/skills + resume
  card), Mock Interview practice (Q+A, `generate_interview_prep`), Skill Report (gap report),
  AI Resume Review (`review_resume`), Jobs & Drives with self-apply. Backend:
  `auth/student/login`, `students/{id}/enable-login` + bulk, `/portal/*`. Demo students
  seeded (CS21001/demo1234). See memory `student_portal`.
- [x] **Resume upload (PDF)** (2026-06-19): students upload a PDF on the dashboard
  (`POST /portal/me/resume`, stored under `uploads/`, served at `/api/uploads/*`). A resume
  is **required to apply**; each application snapshots `resume_url` onto the participant; staff
  see a "View" link per applicant. (Resume review still uses the structured profile, not the PDF.)
- [x] **"New drives" alert** (2026-06-19): in-app, client-side (localStorage) badge on the
  portal nav + dashboard banner for unseen eligible drives; cleared on viewing Jobs & Drives.
- [x] **Drive applicant management** (2026-06-19): staff Drive Detail page (`/drives/:id`)
  with applicants table + round-status controls; drive cards show company name + applicant
  count and link to detail; "New Drive" form uses a company **dropdown** (not raw ID).
- [x] **Drive selection → placement** (2026-06-19): marking a participant `selected` prompts
  for the package, sets the Student placed + a drive-linked accepted Offer (reflected in
  Students page & analytics); reverting undoes it; no double-counting with the manual
  "mark placed" flow. Added `withdrawn` participant status (placed elsewhere).

---

## 🌐 Multi-tenancy follow-ups (deferred)

- [ ] **Apex marketing site** — `myplacements.in` (and bare `localhost` in dev) currently
  loads the app; build a public landing/info page or redirect.
- [ ] **Per-college `users.email`** — still globally unique; switch to composite unique
  `(college_id, email)` so the same staff email can exist at two colleges (needs migration).
- [ ] **Remove dead `components/layout/Sidebar.tsx`** (+ `SidebarPreview` route) — the live
  sidebar is `components/ui/sidebar.tsx`; the dead one caused confusion.
- [ ] **Production infra** — wildcard DNS `*.myplacements.in`, wildcard TLS cert, reverse
  proxy that preserves the `Host` header (see `run_commands.txt`).

---

## ✅ Phase 1 — AI quick wins — DONE (2026-06-19)

- [x] **AI HR email drafting** (2026-06-19)
  - Backend: `POST /companies/{id}/hr-contacts/{hr_id}/draft-email` (body `{purpose}`) → `{email}`
  - Frontend: "Draft email" button per HR contact in `CompanyDetail.tsx` → `DraftEmailModal`
    (purpose presets, editable draft, copy + mailto)
- [x] **AI mock interview question generation** (2026-06-19)
  - Backend: `POST /companies/{id}/interview-questions` (body `{job_role}`) → `{questions}`
    (put on company by job role — there's no Drive detail page yet)
  - Frontend: "Interview Qs" button in `CompanyDetail.tsx` header → `InterviewQuestionsModal`

---

## ✅ Phase 2 — Scaffolded modules — DONE (2026-06-19)

- [x] **Module 3 — Placement Officer Work Allocation** (2026-06-19)
  - Backend `routers/officers.py`: officer CRUD (`GET/POST/PUT/DELETE /officers`),
    `GET /officers/assignable-users` (eligible staff), per-officer assignments
    (`/officers/{id}/assignments`) with assign/update/delete and an
    active→accepted→escalated→completed status workflow. Schemas `schemas/officer.py`.
  - Frontend `pages/officers/Officers.tsx`: officer cards (region/sector/targets +
    active/assigned counts), add-officer form, and an allocation panel to assign
    companies, set priority, and accept/escalate/complete each assignment.
  - Added `college_id` to `placement_officers` (model + migration).
  - Unblocks: Officer Analytics + AI workload optimization
- [x] **Module 9 — Communication Tracking** (2026-06-19)
  - Backend `routers/communications.py`: `GET /communications` (filter by company/HR/type),
    `GET /communications/followups` (pending, soonest-first), log/update/delete. Logging an
    entry syncs the HR contact's `last_contacted_at` / `next_followup_date`. Schemas
    `schemas/communication.py`.
  - Frontend `pages/communications/Communications.tsx`: Timeline tab (per-company filter)
    + Pending follow-ups tab with overdue highlighting; log form (channel, subject, notes,
    response status, follow-up date), one-click "Mark replied".
  - Added `college_id` to `communications` (model + migration).
  - Unblocks: HR Analytics + AI follow-up reminders
- [x] **Module 7 — Placement Training Monitoring** (2026-06-19)
  - Backend `routers/training.py`: training-module CRUD (`/training/modules`) with enrolment
    aggregates (enrolled/completed/avg score/avg attendance), enrol students, per-record
    progress updates (`/training/records/{id}`: score, attendance %, mock score, status;
    auto-stamps `completed_at`). Schemas `schemas/training.py`.
  - Frontend `pages/training/Training.tsx`: module-cards dashboard + per-module student
    progress table with inline editable score/attendance/mock/status and an enrol picker.
  - Added `college_id` to `training_modules` (model + migration).
  - Unblocks: Training dashboard + training effectiveness report

---

## 🤖 Phase 3 — New AI features (greenfield)

- [ ] **Module 6 — AI Student–Company Matching**
  - Recommend best-fit students per company (branch, CGPA, skills, role, past patterns)
  - Output: eligible students, best-fit ranking, training gaps, interview readiness
- [x] **AI Resume Review** (2026-06-19) — profile-based review in the student portal
  (`review_resume`). Future: parse an uploaded resume file instead of the structured profile.
- [ ] **AI Follow-up Reminder** (depends on Module 9)
- [ ] **AI Placement Risk Prediction** — upgrade rule-based `student_scoring.py` to an AI model
- [ ] **AI Officer Workload Optimization** (depends on Module 3)
- [ ] **AI Placement Dashboard Insights** — narrative insights on dashboards
- [ ] **AI Monthly Placement Report generation**

---

## 📊 Phase 4 — Analytics expansion (spec §4)

Currently built: overview, branch-wise, CTC distribution, drive funnel.

- [ ] **Company Analytics** — active/dormant/new, conversion, response rate, engagement score
- [ ] **HR Analytics** — response rate, follow-up ageing, reliability, escalation alerts
- [ ] **Officer Analytics** — assigned/contacted/converted, productivity, workload balance
- [ ] **Student Analytics** — skill-gap, training attendance, mock performance, placement probability
- [ ] **Drive Analytics** — round-wise rejection, selection/offer conversion ratios
- [ ] **Offer Analytics** — median/highest CTC, branch/company/role-wise, joining conversion

---

## 📑 Phase 5 — Dashboards & Reports

- [~] **Module 10 — Offer & Joining Tracking** (extend): drive selection now auto-creates an
  accepted, drive-linked offer (2026-06-19). Remaining: joining date, multiple-offer view,
  dropout reasons, consolidated offers screen
- [ ] **Module 2 — HR Contact Management** (extend): dedicated HR view, relationship score, last-contacted-by, next action
- [~] **Role dashboards (§6)**: ~~Student~~ done (student portal dashboard, 2026-06-19);
  remaining: Principal, Pro Chancellor, Deputy Pro Chancellor, Officer, Department, Company, Training, Offer, AI Insights
- [ ] **Reports (§7)**: officer follow-up, company conversion, branch-wise, student readiness, training effectiveness, CTC analysis, unplaced-risk, HR communication, monthly progress, **NBA/NAAC/NIRF evidence report**

---

## Suggested order

1. ~~Phase 1 (cheap AI wins)~~ ✅ done (2026-06-19)
2. **Module 3 → Module 9 → Module 7** (scaffolded models, unblock analytics + AI) ← next
3. Module 6 (high-value AI matching)
4. Analytics expansion → Dashboards → Reports
