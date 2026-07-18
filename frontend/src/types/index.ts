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
  temp_password: string
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

export interface AllocationPreview {
  proposals: AllocationProposal[]
  unassigned_count: number
  officer_count: number
}

export type CommunicationType = 'email' | 'call' | 'whatsapp' | 'meeting' | 'linkedin'

export interface Communication {
  id: number
  company_id: number
  hr_contact_id?: number
  officer_id?: number
  comm_type: CommunicationType
  subject?: string
  notes?: string
  response_received?: string
  next_followup_date?: string
  communicated_at: string
  created_at: string
  company_name?: string
  hr_contact_name?: string
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
  students: { total: number; placed: number; placement_rate: number }
  companies: { total: number; active: number }
  drives: { total: number }
  offers: { total: number; accepted: number; avg_ctc: number }
}
