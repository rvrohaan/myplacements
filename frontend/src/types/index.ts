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
  relationship_strength: number
  last_contacted_at?: string
  next_followup_date?: string
  notes?: string
  created_at: string
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
  drive_id: number
  student_id: number
  ctc?: number
  role?: string
  location?: string
  joining_date?: string
  status: OfferStatus
  is_dream_offer: number
  dropout_reason?: string
  created_at: string
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
