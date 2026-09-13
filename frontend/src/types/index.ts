export interface CollegeBranding {
  name: string
  code: string
  logo_url?: string
}

export interface College {
  id: number
  name: string
  code: string
  city?: string
  logo_url?: string
  is_active: boolean
}

export type UserRole =
  | 'super_admin'
  | 'principal'
  | 'pro_chancellor'
  | 'deputy_pro_chancellor'
  | 'placement_officer'
  | 'department_coordinator'
  | 'student'

export interface User {
  id: number
  email: string
  full_name: string
  role: UserRole
  department?: string
  college_id?: number
  is_active: boolean
  must_reset_password: boolean
  created_at: string
}

export type NotificationPriority = 'normal' | 'high'

/**
 * One in-app notification.
 *
 * Named AppNotification rather than Notification because the latter is a DOM
 * global - shadowing it in a file that also touches the browser API is a nasty
 * debug. Title, body and link are rendered by the backend at emit time, so this
 * renders without knowing anything about what it refers to.
 */
export interface AppNotification {
  id: number
  type: string
  priority: NotificationPriority
  title: string
  body?: string
  link?: string
  entity_type?: string
  entity_id?: number
  meta?: Record<string, unknown>
  is_read: boolean
  actor_name?: string
  created_at: string
}

/** Delivery outcome for the one automated channel on an invite. */
export type EmailStatus = 'sent' | 'failed' | 'skipped'

/** A one-time password-setup link, returned when an account is provisioned. */
export interface Invite {
  url: string
  expires_at: string
  email: string
  email_status: EmailStatus
}

/** POST /users response: the account, plus the link when one was issued. */
export interface UserCreated extends User {
  invite?: Invite | null
}

export type CompanyStatus = 'active' | 'dormant' | 'blacklisted' | 'priority' | 'new'

export interface Company {
  id: number
  name: string
  sector?: string
  domain?: string
  location?: string
  size?: string
  website?: string
  products_services?: string
  status: CompanyStatus
  mou_status?: string
  preferred_branches?: string
  min_cgpa?: number
  salary_min?: number
  salary_max?: number
  previous_visit_count: number
  ai_profile?: string
  notes?: string
  source?: string
  review_status?: string
  created_by_id?: number
  created_by_name?: string
  created_at: string
  updated_at: string
  hr_contacts: HRContact[]
  roles: CompanyRole[]
}

export type CompanyRoleType = 'full_time' | 'internship' | 'internship_ppo' | 'contract' | 'apprenticeship'
export type CompanyRoleStatus = 'open' | 'on_hold' | 'filled' | 'closed'

/** A job role / offer the company recruits for — its standing catalogue, which
 *  outlives any one campus drive. */
export interface CompanyRole {
  id: number
  company_id: number
  title: string
  role_type: CompanyRoleType
  status: CompanyRoleStatus
  /** Annual package, in LPA. */
  ctc_min?: number
  ctc_max?: number
  /** Monthly stipend in rupees — internships only, a different unit from ctc_*. */
  stipend?: number
  openings?: number
  location?: string
  work_mode?: string
  eligible_branches?: string
  min_cgpa?: number
  max_backlogs?: number
  skills?: string
  job_description?: string
  apply_deadline?: string
  posting_url?: string
  notes?: string
  created_by_id?: number
  created_by_name?: string
  created_at: string
  updated_at: string
}

export interface HRContact {
  id: number
  company_id: number
  name: string
  designation?: string
  email?: string
  mobile?: string
  linkedin?: string
  region?: string
  response_status?: string
  /** The officer's own read on the relationship, 1–5. A human judgement, never
   *  computed — its evidence-based counterpart is `HREngagement`. */
  relationship_strength: number
  last_contacted_at?: string
  next_followup_date?: string
  /** What we owe this contact next, in the officer's words. `next_followup_date`
   *  says when; this says what. */
  next_action?: string
  notes?: string
  created_at: string
}

export type EngagementBand = 'responsive' | 'warm' | 'slow' | 'cold'

/** Computed from the communication log — see backend services/hr_engagement.py.
 *  Absent entirely for a contact with no logged history, rather than zero. */
export interface HREngagement {
  score: number
  band: EngagementBand
  /** No contact at all inside the scoring window. The score is capped below
   *  "warm" when true, because there is no recent evidence either way. */
  stale: boolean
  days_since_contact?: number
  total_logged: number
  replied: number
  awaited: number
  last_contacted_at?: string
  last_replied_at?: string
  days_since_reply?: number
  overdue_followups: number
  components: Record<string, number>
}

/** A contact as the cross-company HR directory returns it. */
export interface HRContactDirectoryEntry extends HRContact {
  company_name: string
  company_status?: string
  /** Author of the most recent communication logged against them. */
  last_contacted_by?: string
  engagement?: HREngagement
}

export interface HRSummary {
  total: number
  overdue: number
  due_this_week: number
  no_followup: number
  never_contacted: number
}

export type PlacementStatus = 'unplaced' | 'placed' | 'opted_out' | 'higher_studies'
export type RiskCategory = 'low' | 'medium' | 'high'

export interface Student {
  id: number
  user_id: number
  full_name?: string
  roll_number: string
  branch: string
  batch_year: number
  cgpa?: number
  backlogs: number
  skills?: string
  certifications?: string
  internships?: string
  projects?: string
  resume_url?: string
  linkedin_url?: string
  github_url?: string
  placement_preference?: string
  location_preference?: string
  placement_status: PlacementStatus
  placement_ctc?: number
  readiness_score?: number
  risk_category: RiskCategory
  higher_studies_plan: boolean
  login_enabled?: boolean
  created_at: string
  updated_at: string
}

export interface EnableLoginResult {
  student_id: number
  roll_number: string
  full_name?: string
  // Student accounts carry no real email address, so nothing is delivered for
  // them automatically - staff share this link themselves.
  invite_url: string
  expires_at: string
}

export interface InterviewPrepItem {
  question: string
  answer: string
}

export interface ExamQuestionItem {
  category: string
  question: string
  options: string[]
  correct_index: number
  explanation: string
}

export interface StudentDrive {
  id: number
  company_id: number
  company_name?: string
  job_role: string
  drive_date?: string
  mode: DriveMode
  ctc_offered?: number
  location?: string
  min_cgpa?: number
  eligible_branches?: string
  registration_deadline?: string
  applied: boolean
}

export type DriveMode = 'online' | 'offline' | 'hybrid'
export type DriveStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled'

export interface Drive {
  id: number
  company_id: number
  /** Resolved server-side, so a list of drives needs no company lookup. */
  company_name?: string
  job_role: string
  drive_date?: string
  mode: DriveMode
  status: DriveStatus
  min_cgpa?: number
  eligible_branches?: string
  max_backlogs: number
  ctc_offered?: number
  job_description?: string
  location?: string
  registration_deadline?: string
  notes?: string
  total_rounds?: number
  participant_count: number
  rounds: DriveRound[]
  created_at: string
  updated_at: string
}

export interface DriveRound {
  id: number
  drive_id: number
  round_number: number
  name?: string
  appeared_count?: number
  passed_count?: number
  conducted_at?: string
}

export type ParticipantStatus =
  | 'registered'
  | 'shortlisted'
  | 'attended'
  | 'in_process'
  | 'aptitude_cleared'
  | 'technical_cleared'
  | 'hr_cleared'
  | 'selected'
  | 'rejected'
  | 'withdrawn'

export interface RoundResult {
  round_number?: number
  appeared: boolean
  passed?: boolean | null
}

export interface Participant {
  id: number
  drive_id: number
  student_id: number
  status: ParticipantStatus
  rejection_reason?: string
  resume_url?: string
  registered_at: string
  student_name?: string
  roll_number?: string
  branch?: string
  cgpa?: number
  ctc?: number
  round_results: RoundResult[]
}

export interface RoundUploadSummary {
  round_number: number
  appeared: number
  passed: number
  withdrawn: number
  created_participants: number
  created_students: number
  skipped_eliminated: number
  unmatched: string[]
  used_ai: boolean
}

export type OfferStatus = 'issued' | 'accepted' | 'rejected' | 'joined' | 'dropout'

export interface Offer {
  id: number
  // Absent on an offer recorded outside a drive; both absent on the placeholder
  // the Students page's "mark as placed" flow maintains.
  drive_id?: number
  company_id?: number
  student_id: number
  ctc?: number
  role?: string
  location?: string
  joining_date?: string
  status: OfferStatus
  is_dream_offer: number
  dropout_reason?: string
  offer_letter_url?: string
  created_at: string
  // Resolved server-side so a row renders without fetching students/companies.
  student_name?: string
  roll_number?: string
  branch?: string
  batch_year?: number
  company_name?: string
  drive_title?: string
  is_placeholder: boolean
  /** How many offers this student holds in total. */
  offer_count?: number
}

/** Counts behind the offers screen's summary strip. */
export interface OfferSummary {
  total: number
  issued: number
  accepted: number
  joined: number
  rejected: number
  dropout: number
  students_with_offer: number
  students_with_multiple: number
  highest_ctc?: number
  median_ctc?: number
  avg_ctc?: number
  /** Of the offers students took, the share that reached joining. */
  joining_conversion?: number
  awaiting_joining_date: number
}

export interface OfferFilterOptions {
  branches: string[]
  batch_years: number[]
  companies: Array<{ id: number; name: string }>
}

export interface Officer {
  id: number
  user_id: number
  region?: string
  sector_expertise?: string
  target_companies: number
  target_offers: number
  created_at: string
  officer_name?: string
  email?: string
  department?: string
  assignment_count: number
  active_count: number
}

export type AssignmentStatus = 'active' | 'accepted' | 'escalated' | 'completed'

export interface Assignment {
  id: number
  company_id: number
  officer_id: number
  status: AssignmentStatus
  priority: string
  notes?: string
  assigned_at: string
  company_name?: string
  company_status?: string
  company_sector?: string
}

export interface AllocationProposal {
  company_id: number
  company_name?: string
  company_sector?: string
  company_location?: string
  company_status?: string
  officer_id: number
  officer_name?: string
  priority: string
  reasoning?: string
}

export type AllocationScope = 'pipeline' | 'all'

export interface AllocationPreview {
  proposals: AllocationProposal[]
  /** Every allocatable company in the college with no owner yet. */
  unassigned_count: number
  officer_count: number
  /** How many of those the chosen scope looked at. More than `proposals.length`
   *  means this is the top slice by importance and re-running will offer more. */
  considered_count: number
  scope: AllocationScope
  limit: number
}

export type CommunicationType = 'email' | 'call' | 'whatsapp' | 'meeting' | 'linkedin'

export interface Communication {
  id: number
  company_id: number
  hr_contact_id?: number
  logged_by_id?: number
  officer_id?: number
  /** 'recorded' when stamped at log time, 'inferred' when backfilled from the
   *  company allocation for entries logged before authorship was captured. */
  officer_attribution?: string
  comm_type: CommunicationType
  subject?: string
  notes?: string
  response_received?: string
  next_followup_date?: string
  communicated_at: string
  created_at: string
  updated_at?: string
  company_name?: string
  hr_contact_name?: string
  logged_by_name?: string
  logged_by_role?: UserRole
  officer_name?: string
  /** Whether the signed-in user may edit or delete this entry. */
  can_edit: boolean
}

export interface TrainingModule {
  id: number
  name: string
  category?: string
  description?: string
  created_at: string
  enrolled_count: number
  completed_count: number
  avg_score?: number
  avg_attendance?: number
  /** Comma-separated skills this module teaches; completing it credits them. */
  skills?: string | null
}

export interface TrainingRecord {
  id: number
  student_id: number
  module_id: number
  score?: number
  attendance_percent?: number
  mock_test_score?: number
  status: string
  completed_at?: string
  created_at: string
  student_name?: string
  roll_number?: string
  branch?: string
}

export interface AnalyticsOverview {
  // "officer" when the numbers cover only the signed-in officer's own
  // allocations; "college" for the full tenant view.
  scope?: 'officer' | 'college'
  students: { total: number; placed: number; placement_rate: number }
  companies: { total: number; active: number }
  drives: { total: number }
  offers: { total: number; accepted: number; avg_ctc: number }
}

// --- Officer's personal dashboard (GET /analytics/my-work) ------------------

export interface MyCompanyRow {
  id: number
  name: string
  sector?: string
  status?: CompanyStatus
  review_status?: string
  assignment_status?: AssignmentStatus
  priority?: string
  last_contacted_at?: string
  days_since_contact?: number
  drives: number
  offers: number
  stale: boolean
}

export interface FollowupRow {
  id: number
  company_id: number
  company_name?: string
  subject?: string
  comm_type?: CommunicationType
  next_followup_date: string
  overdue: boolean
}

export interface ActivityRow {
  id: number
  company_id: number
  company_name?: string
  comm_type?: CommunicationType
  subject?: string
  communicated_at?: string
}

export interface TargetProgress {
  target: number
  achieved: number
  percent: number
}

export interface MyWork {
  officer: { id: number; name: string; region?: string; sector_expertise?: string }
  assignments: { total: number; open: number; by_status: Record<string, number> }
  companies: { total: number; by_status: Record<string, number>; stale: number }
  communications: {
    total: number
    last_30_days: number
    pending_followups: number
    overdue_followups: number
  }
  drives: { total: number; upcoming: number; ongoing: number; completed: number }
  offers: { total: number; won: number; avg_ctc: number }
  students: { participated: number; placed: number }
  targets: { companies: TargetProgress; offers: TargetProgress }
  my_companies: MyCompanyRow[]
  upcoming_followups: FollowupRow[]
  recent_activity: ActivityRow[]
}

// --- Leadership view of officer progress (GET /analytics/officer-performance)

// How recently the officer logged work: active (7 days), slowing (30 days),
// idle (older), no_activity (never).
export type ActivityStatus = 'active' | 'slowing' | 'idle' | 'no_activity'

export interface OfficerPerformance {
  officer_id: number
  user_id: number
  name: string
  email?: string
  department?: string
  region?: string
  sector_expertise?: string
  companies_assigned: number
  open_assignments: number
  completed_assignments: number
  communications_total: number
  communications_30d: number
  pending_followups: number
  overdue_followups: number
  drives_total: number
  drives_completed: number
  drives_upcoming: number
  offers_total: number
  offers_won: number
  students_placed: number
  avg_ctc: number
  target_companies: number
  target_offers: number
  company_target_percent: number
  offer_target_percent: number
  last_activity?: string
  activity_status: ActivityStatus
}

export interface OfficerPerformanceReport {
  officers: OfficerPerformance[]
  totals: {
    officers: number
    companies_assigned: number
    open_assignments: number
    completed_assignments: number
    communications_30d: number
    overdue_followups: number
    drives_total: number
    offers_won: number
    students_placed: number
    unassigned_companies: number
    pending_lead_reviews: number
    needs_attention: number
  }
  trend: Array<{ month: string; communications: number; drives: number; offers: number }>
}

// --- Daily updates (GET /daily-updates/...) ---------------------------------

export type DailyUpdateKind = 'officer' | 'coordinator'
export type DailyUpdateStatus = 'on_time' | 'late'
export type WorkMode = 'office' | 'field' | 'travel' | 'wfh' | 'leave'

/** Counts the server derives from logged activity. Officer and coordinator
 *  updates carry different subsets, so every field is optional. */
export interface DailyUpdateMetrics {
  calls?: number
  emails?: number
  meetings?: number
  whatsapp?: number
  linkedin?: number
  communications?: number
  companies_touched?: number
  new_companies?: number
  hr_contacts_added?: number
  drives_conducted?: number
  drives_scheduled?: number
  rounds_conducted?: number
  offers?: number
  offers_won?: number
  companies_assigned?: number
  open_followups?: number
  overdue_followups?: number
  stale_companies?: number
  target_companies?: number
  target_offers?: number
  target_companies_percent?: number
  target_offers_percent?: number
  trainings_completed?: number
  trainings_enrolled?: number
  modules_added?: number
  students_at_risk?: number
  students_tracked?: number
}

export interface DailyUpdate {
  id: number
  college_id?: number
  report_date: string
  kind: DailyUpdateKind
  submitted_by_id: number
  officer_id?: number
  work_mode?: WorkMode
  highlights?: string
  blockers?: string
  support_needed?: string
  plan_tomorrow?: string
  needs_escalation: boolean
  escalation_note?: string
  manual_visits: number
  manual_meetings: number
  metrics?: DailyUpdateMetrics
  submitted_at?: string
  status?: DailyUpdateStatus
  created_at?: string
  updated_at?: string
  reviewed_by_id?: number
  reviewed_at?: string
  review_note?: string
  submitted_by_name?: string
  submitted_by_role?: string
  officer_name?: string
  reviewed_by_name?: string
  no_activity: boolean
  can_edit: boolean
  can_review: boolean
}

/** GET /daily-updates/today — everything the filing page needs in one call. */
export interface DailyUpdateToday {
  date: string
  kind: DailyUpdateKind
  cutoff: string
  deadline_passed: boolean
  enabled: boolean
  derived: DailyUpdateMetrics
  prompts: string[]
  existing: DailyUpdate | null
}

export interface DailyDigestTotals {
  calls: number
  emails: number
  meetings: number
  whatsapp: number
  linkedin: number
  communications: number
  companies_touched: number
  new_companies: number
  drives_conducted: number
  offers: number
  offers_won: number
  trainings_completed: number
}

/** GET /daily-updates/digest — the whole leadership page in one call. */
export interface DailyDigest {
  date: string
  cutoff: string
  is_today: boolean
  enabled: boolean
  compliance: {
    expected: number
    filed: number
    on_time: number
    late: number
    missing: number
    on_leave: number
  }
  totals: DailyDigestTotals
  /** Trailing average of the preceding days, for the up/down deltas. */
  baseline: DailyDigestTotals
  attention: {
    escalations: Array<{
      update_id: number
      name?: string
      escalation_note?: string
      reviewed: boolean
    }>
    not_filed: Array<{ user_id: number; name: string; role: string; kind: DailyUpdateKind }>
    zero_activity: Array<{ update_id: number; name?: string }>
    overdue_followups: number
    stale_companies: number
    pending_lead_reviews: number
    unassigned_companies: number
  }
  updates: DailyUpdate[]
  trend: Array<{
    date: string
    expected: number
    filed: number
    calls: number
    meetings: number
    offers: number
  }>
  filers: number
}

export interface DailyUpdateSettings {
  daily_update_cutoff: string
  daily_update_enabled: boolean
}

// --- Opportunity radar (web-discovered openings) ----------------------------
// One opening, as this college sees it: the posting is shared platform-wide,
// the status is this college's own decision about it ('new' = not yet decided).

export type LeadType = 'job' | 'internship'
export type LeadStatus = 'new' | 'added' | 'dismissed'

export interface JobLead {
  /** The shared posting's id - what the action endpoints take. */
  id: number
  company_name: string
  role_title?: string | null
  lead_type: LeadType
  location?: string | null
  work_mode?: string | null
  eligibility?: string | null
  compensation?: string | null
  posted_at?: string | null
  posted_label?: string | null
  source_name?: string | null
  source_url?: string | null
  summary?: string | null
  confidence?: 'high' | 'medium' | 'low' | null
  /** False when the scan's link never appeared in a search result. */
  verified: boolean
  discovered_at?: string | null
  status: LeadStatus
  company_id?: number | null
  dismiss_reason?: string | null
  actioned_by_name?: string | null
  actioned_at?: string | null
  /** A company of the same name already on the list, if there is one. */
  existing_company_id?: number | null
  existing_company_name?: string | null
}

export interface JobScan {
  id: number
  scan_date: string
  started_at?: string | null
  finished_at?: string | null
  /** 'stalled' = claimed but never finished; a restart took its background task. */
  status: 'ok' | 'failed' | 'stalled'
  found: number
  new_count: number
  error?: string | null
  triggered_by_name?: string | null
}

export interface JobLeadSummary {
  enabled: boolean
  /** Whether the scan runs by itself each morning. Platform-wide, off by default. */
  schedule_enabled: boolean
  new_24h: number
  new_total: number
  last_scan?: JobScan | null
  top: JobLead[]
}

export interface JobScanResult {
  found: number
  new_count: number
  scan: JobScan
}

export interface JobScanSettings {
  job_scan_enabled: boolean
  job_scan_focus?: string | null
  /** The platform's daily-scan switch: shared by every college, super_admin only. */
  schedule_enabled: boolean
  can_manage_schedule: boolean
}

export interface PlatformScanStatus {
  /** Whether the daily scan runs by itself. Platform-wide; super_admin only. */
  schedule_enabled: boolean
  scan_hour: number
  pool_size: number
  last_scan?: JobScan | null
  updated_at?: string | null
  updated_by_name?: string | null
}

/** `/analytics/offers` — counts **offers**, so a student holding three appears
    three times. The placement view counts students instead. */
export interface OfferAnalytics {
  scope: 'college' | 'officer'
  batch_year?: number | null
  headline: {
    offers: number
    students_with_offer: number
    students_with_multiple: number
    median_ctc?: number | null
    highest_ctc?: number | null
    avg_ctc?: number | null
    joining_conversion?: number | null
    dropout_rate?: number | null
    awaiting_joining_date: number
  }
  funnel: Array<{ stage: string; count: number }>
  lost: { rejected: number; dropout: number }
  by_branch: Array<{
    branch: string
    offers: number
    students: number
    joined: number
    median_ctc?: number | null
    highest_ctc?: number | null
  }>
  by_company: Array<{
    company: string
    offers: number
    students: number
    median_ctc?: number | null
    highest_ctc?: number | null
  }>
  by_role: Array<{ role: string; offers: number; median_ctc?: number | null }>
  offers_per_student: Array<{ offers: string; students: number }>
}

/** `/analytics/students` — placement measured against the inputs to it. */
export interface StudentAnalytics {
  scope: 'college' | 'officer'
  batch_year?: number | null
  headline: {
    students: number
    placed?: number
    placement_rate?: number | null
    seeking?: number
    /** Placed students score 100 by definition, so this covers the seeking only. */
    avg_readiness_of_seeking?: number | null
  }
  risk_of_seeking: Array<{ band: string; students: number }>
  cgpa_bands: Array<{ band: string; students: number; placed: number; placement_rate?: number | null }>
  backlogs: Array<{ band: string; students: number; placed: number; placement_rate?: number | null }>
  training: null | {
    enrolments: number
    students_trained: number
    completed: number
    avg_attendance?: number | null
    avg_score?: number | null
    avg_mock_score?: number | null
    placement_rate_trained?: number | null
    placement_rate_untrained?: number | null
  }
  skills: {
    placed: Array<{ skill: string; students: number; share?: number | null }>
    seeking: Array<{ skill: string; students: number; share?: number | null }>
    gaps: Array<{ skill: string; placed_share: number; seeking_share: number; gap: number }>
  }
}

/** One report in the §7 catalogue. `params` names the pickers the UI shows. */
export interface ReportSpec {
  id: string
  name: string
  description: string
  params: string[]
}

export interface ReportCatalogue {
  batch_years: number[]
  /** Months the month picker should offer, newest first. */
  months: Array<{ key: string; label: string }>
  reports: ReportSpec[]
}

export interface ReportSection {
  heading: string
  columns: string[]
  rows: Array<Array<string | number | null>>
  total_row: Array<string | number | null> | null
  note?: string | null
}

/** A built report. The .xlsx export renders from the same description, so the
    screen and the downloaded file cannot disagree. */
export interface ReportDoc {
  id: string
  title: string
  subtitle?: string | null
  generated_at: string
  meta: Array<{ label: string; value: string }>
  sections: ReportSection[]
  /** Prose above the tables, when the report has any. Written by the model from
      the report's own findings and cached; empty until somebody asks for it. */
  narrative: string[]
  /** Who wrote the narrative and when — or why there isn't one. */
  narrative_note?: string | null
  caveats: string[]
}

/** Module 6 — a shortlist for one company/role, with its workings. */
export interface MatchResult {
  company_id: number
  company_name: string
  role_id?: number | null
  role_title?: string | null
  criteria: {
    branches: string[]
    min_cgpa?: number | null
    max_backlogs?: number | null
    skills: string[]
    batch_year?: number | null
    /** Which record supplied each criterion: "role" | "company" | "none". */
    source: Record<string, string>
  }
  considered: number
  eligible: number
  excluded: Array<{ reason: string; label: string; students: number }>
  /** What each score component contributed. Shown, so the ranking is arguable. */
  weights: Record<string, number>
  skills_used: Array<{ skill: string; weight: number }>
  shortlist: Array<{
    student_id: number
    roll_number: string
    name?: string | null
    branch?: string | null
    batch_year?: number | null
    cgpa?: number | null
    backlogs: number
    readiness_score?: number | null
    placement_status?: string | null
    score: number
    components: Record<string, number>
    matched_skills: string[]
    missing_skills: string[]
    /** Matched skill -> "training" | "certification" | "declared". */
    skill_evidence?: Record<string, string>
  }>
  training_gaps: Array<{ skill: string; students_missing: number; share_missing: number }>
  past_pattern: {
    hires: number
    branches: Array<{ branch: string; students: number }>
    median_cgpa?: number | null
    min_cgpa?: number | null
    common_skills: Array<{ skill: string; students: number }>
  }
  /** Present only when the skill weighting came from the model. */
  ai_summary?: string | null
  ai_skills?: Array<{ skill: string; weight: number; why: string }> | null
  ai_error?: string | null
}

/** One row of an uploaded training attendance sheet, and what happened to it. */
export interface AttendanceImportRow {
  roll_number: string
  name?: string | null
  matched: boolean
  action?: string | null
  student_id?: number | null
  attendance_percent?: number | null
  score?: number | null
  mock_test_score?: number | null
  status?: string | null
  note?: string | null
}

export interface AttendanceImportResult {
  module_id: number
  rows: number
  enrolled: number
  updated: number
  unmatched: number
  used_ai: boolean
  results: AttendanceImportRow[]
}

/** `/analytics/companies` — shares its arithmetic with the Company Conversion report. */
export interface CompanyAnalytics {
  companies: number
  status_mix: Array<{ status: string; companies: number }>
  funnel: Array<{ stage: string; companies: number }>
  logged: number
  replied: number
  reply_rate?: number | null
  stale: number
  never_contacted: number
  unassigned: number
  without_contacts: number
  top_companies: Array<{
    company: string
    status: string
    owner: string
    logged: number
    reply_rate?: number | null
    drives: number
    offers: number
    students_placed: number
    engagement?: number | null
  }>
  going_quiet: Array<{
    company: string
    status: string
    owner: string
    days_since_contact?: number | null
    logged: number
  }>
  engagement: Array<{ company: string; score: number; contacts_scored: number }>
}

/** `/analytics/hr` — channel rates share their definition with the HR report. */
export interface HRAnalytics {
  contacts: number
  logged: number
  replied: number
  reply_rate?: number | null
  awaiting: number
  channels: Array<{
    channel: string
    logged: number
    replied: number
    no_response: number
    awaiting: number
    reply_rate?: number | null
  }>
  engagement: Array<{ band: string; contacts: number }>
  followups: Array<{ bucket: string; contacts: number }>
  alerts: Array<{
    contact: string
    company: string
    band: string
    days_since_contact?: number | null
    overdue_days?: number | null
    reason: string
  }>
  alert_total: number
}

/** `/analytics/drives` — round counts are what officers entered, not a recomputation. */
export interface DriveAnalytics {
  drives: number
  batch_year?: number | null
  by_status: Array<{ status: string; drives: number }>
  participants: number
  funnel: Array<{ stage: string; count: number }>
  lost: { rejected: number; withdrawn: number }
  rounds: Array<{
    round: number
    name: string
    drives: number
    appeared: number
    passed: number
    dropped: number
    pass_rate?: number | null
  }>
  conversion: {
    selection_rate?: number | null
    offers_per_selection?: number | null
    offers_won: number
    offer_conversion?: number | null
  }
  by_drive: Array<{
    drive: string
    status: string
    participants: number
    selected: number
    offers: number
    selection_rate?: number | null
  }>
}

/** `/analytics/risk-calibration` — does the risk score predict placement?
    Scored on inputs only; the stored band folds in placement status, so
    validating that against placement would be circular. */
export interface RiskCalibration {
  batch_year?: number | null
  students: number
  placed: number
  placement_rate?: number | null
  excluded_not_seeking: number
  models: Array<{
    key: string
    label: string
    bands: Array<{
      band: string
      students: number
      placed: number
      placement_rate?: number | null
    }>
    /** Placement rate of the students it called safe, minus those it called
        at risk. Near zero means the bands carry no information. */
    separation?: number | null
  }>
}

/** `/insights/dashboard` — the dashboard summary.

    `findings` is always present and always computed by rules; `narrative` is the
    model's write-up of exactly those findings and is empty whenever the model
    was unavailable or quoted a figure nobody computed. `note` says which. */
export interface DashboardInsights {
  narrative: string[]
  /** False when `findings` are standing in for a write-up — see `note`. */
  narrated: boolean
  findings: Array<{
    key: string
    severity: 'urgent' | 'watch' | 'good'
    headline: string
  }>
  facts: Record<string, unknown>
  generated_at?: string | null
  generated_by?: string | null
  model?: string | null
  note?: string | null
}

/** One skill with every source that backs it, strongest first.

    The distinction is the point: a skill earned by completing a training module
    is evidence, one an officer typed is a record, one the student typed is a
    claim. `student_skills` keeps them apart so they can be weighted. */
export interface SkillWithSources {
  skill: string
  label: string
  sources: Array<{
    source: 'training' | 'officer' | 'student'
    evidence?: string | null
    verified_at?: string | null
  }>
}

/** `/analytics/officer-workload` — how evenly the open work is spread.

    Distinct from officer performance, which ranks by what officers have landed
    and tracks progress against targets. This measures only what officers are
    currently carrying; it deliberately carries no target comparison, because
    `assigned / target_companies` already means "attainment" on that table and
    one ratio cannot mean two things on one page. */
export interface OfficerWorkload {
  officers: Array<{
    officer_id: number
    user_id?: number | null
    name: string
    open_companies: number
    upcoming_drives: number
    followups_due: number
    followups_overdue: number
    load: number
    share?: number | null
  }>
  total_load: number
  /** What each officer would hold if the work were split evenly. */
  fair_share?: number | null
  /** Busiest minus lightest, in points of share. `null` with fewer than two
      officers, where the question carries no meaning. */
  spread?: number | null
  idle_officers: number
  unassigned_companies: number
  weights: Record<string, number>
}
