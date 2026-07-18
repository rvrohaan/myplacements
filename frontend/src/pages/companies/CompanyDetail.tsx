import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Sparkles, Phone, Mail, Linkedin, Pencil, Plus, MessageSquare, AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import type { Company, CompanyStatus, HRContact, UserRole } from '@/types'
import { cn, formatDate, STATUS_COLORS } from '@/lib/utils'

const MANAGE_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']
import StatusSelect, { type StatusOption } from '@/components/StatusSelect'
import EditCompanyModal from './EditCompanyModal'
import AddHRContactModal from './AddHRContactModal'
import DraftEmailModal from './DraftEmailModal'
import InterviewQuestionsModal from './InterviewQuestionsModal'

const COMPANY_STATUS_OPTIONS: StatusOption<CompanyStatus>[] = [
  { value: 'new', label: 'new' },
  { value: 'active', label: 'active' },
  { value: 'priority', label: 'priority' },
  { value: 'dormant', label: 'dormant' },
  { value: 'blacklisted', label: 'blacklisted' },
]

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>()
  const role = useAuthStore((s) => s.user?.role)
  const canManage = !!role && MANAGE_ROLES.includes(role)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showInterviewQs, setShowInterviewQs] = useState(false)
  const [emailContact, setEmailContact] = useState<HRContact | null>(null)

  const refresh = () => api.get(`/companies/${id}`).then((r) => setCompany(r.data))

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [id])

  const generateProfile = async () => {
    setGenerating(true)
    try {
      const { data } = await api.post(`/companies/${id}/generate-profile`)
      setCompany(data)
    } finally {
      setGenerating(false)
    }
  }

  const approve = async () => {
    const { data } = await api.post(`/companies/${id}/approve`)
    setCompany(data)
  }

  const decline = async () => {
    const { data } = await api.post(`/companies/${id}/decline`)
    setCompany(data)
  }

  const updateStatus = async (status: CompanyStatus) => {
    if (!company) return
    const previous = company.status
    setCompany({ ...company, status })
    try {
      const { data } = await api.put(`/companies/${id}`, { status })
      setCompany(data)
    } catch {
      setCompany({ ...company, status: previous })
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>
  if (!company) return <div className="text-center py-20 text-gray-500">Company not found</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/companies" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{company.name}</h2>
            {canManage ? (
              <StatusSelect value={company.status} options={COMPANY_STATUS_OPTIONS} onChange={updateStatus} />
            ) : (
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[company.status])}>
                {company.status}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">{[company.sector, company.domain, company.location].filter(Boolean).join(' · ')}</p>
        </div>
        <button
          onClick={() => setShowEdit(true)}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg"
        >
          <Pencil className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={() => setShowInterviewQs(true)}
          className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg"
        >
          <MessageSquare className="w-4 h-4" />
          Interview & Exam Qs
        </button>
        <button
          onClick={generateProfile}
          disabled={generating}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Generating...' : 'AI Profile'}
        </button>
      </div>

      {company.review_status === 'pending' && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Officer-sourced lead{company.created_by_name ? ` from ${company.created_by_name}` : ''} — awaiting placement-head review.
            </span>
          </div>
          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={approve}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <CheckCircle2 className="w-4 h-4" /> Approve
              </button>
              <button
                onClick={decline}
                className="flex items-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <XCircle className="w-4 h-4" /> Decline
              </button>
            </div>
          )}
        </div>
      )}

      {company.review_status === 'declined' && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>
            This lead was declined{company.created_by_name ? ` (submitted by ${company.created_by_name})` : ''} and is no longer assigned to any officer.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Company Info</h3>
          <dl className="space-y-2 text-sm">
            {[
              ['Size', company.size],
              ['Website', company.website],
              ['MoU Status', company.mou_status],
              ['Preferred Branches', company.preferred_branches],
              ['Min CGPA', company.min_cgpa?.toString()],
              ['Salary Range', company.salary_min || company.salary_max ? `${company.salary_min ?? '?'} – ${company.salary_max ?? '?'} LPA` : null],
              ['Previous Visits', company.previous_visit_count.toString()],
            ].map(([k, v]) => v ? (
              <div key={k} className="flex gap-2">
                <dt className="w-32 shrink-0 text-gray-500">{k}</dt>
                <dd className="text-gray-900 font-medium">{v}</dd>
              </div>
            ) : null)}
          </dl>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">HR Contacts ({company.hr_contacts.length})</h3>
            <button
              onClick={() => setShowAddContact(true)}
              className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          {company.hr_contacts.length === 0 ? (
            <p className="text-sm text-gray-400">No HR contacts added yet</p>
          ) : (
            <div className="space-y-3">
              {company.hr_contacts.map((hr) => (
                <div key={hr.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{hr.name}</p>
                      <p className="text-xs text-gray-500">{hr.designation}</p>
                    </div>
                    <button
                      onClick={() => setEmailContact(hr)}
                      className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Draft email
                    </button>
                  </div>
                  <div className="flex gap-3 mt-2">
                    {hr.email && <a href={`mailto:${hr.email}`} className="text-gray-400 hover:text-primary-600"><Mail className="w-3.5 h-3.5" /></a>}
                    {hr.mobile && <a href={`tel:${hr.mobile}`} className="text-gray-400 hover:text-primary-600"><Phone className="w-3.5 h-3.5" /></a>}
                    {hr.linkedin && <a href={hr.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-primary-600"><Linkedin className="w-3.5 h-3.5" /></a>}
                  </div>
                  {hr.next_followup_date && (
                    <p className="text-xs text-orange-600 mt-1">Follow-up: {formatDate(hr.next_followup_date)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {company.ai_profile && (
        <div className="bg-white rounded-xl border border-primary-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary-600" />
            <h3 className="font-semibold text-gray-800">AI-Generated Company Profile</h3>
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{company.ai_profile}</div>
        </div>
      )}

      {company.notes && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-2">Notes</h3>
          <p className="text-sm text-gray-700 whitespace-pre-line">{company.notes}</p>
        </div>
      )}

      {showEdit && (
        <EditCompanyModal company={company} onClose={() => setShowEdit(false)} onSaved={setCompany} />
      )}
      {showAddContact && (
        <AddHRContactModal
          companyId={company.id}
          onClose={() => setShowAddContact(false)}
          onAdded={refresh}
        />
      )}
      {showInterviewQs && (
        <InterviewQuestionsModal company={company} onClose={() => setShowInterviewQs(false)} />
      )}
      {emailContact && (
        <DraftEmailModal company={company} contact={emailContact} onClose={() => setEmailContact(null)} />
      )}
    </div>
  )
}
