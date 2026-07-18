import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, ExternalLink, CheckCircle2, XCircle, UserRound, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import type { Company, CompanyStatus, UserRole } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import ImportExportControls from '@/components/ImportExportControls'
import AutoAllocateModal from './AutoAllocateModal'

const MANAGE_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

const STATUS_OPTIONS: { value: CompanyStatus | ''; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'priority', label: 'Priority' },
  { value: 'new', label: 'New' },
  { value: 'dormant', label: 'Dormant' },
  { value: 'blacklisted', label: 'Blacklisted' },
]

export default function Companies() {
  const role = useAuthStore((s) => s.user?.role)
  const canManage = !!role && MANAGE_ROLES.includes(role)
  const isOfficer = role === 'placement_officer'
  const [companies, setCompanies] = useState<Company[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CompanyStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showAutoAllocate, setShowAutoAllocate] = useState(false)
  const [formData, setFormData] = useState({ name: '', sector: '', domain: '', location: '', website: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)

  const fetchCompanies = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (status) params.status = status
    api.get('/companies', { params }).then((r) => setCompanies(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchCompanies() }, [search, status])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/companies', formData)
      setShowForm(false)
      setFormData({ name: '', sector: '', domain: '', location: '', website: '', notes: '' })
      fetchCompanies()
    } finally {
      setSubmitting(false)
    }
  }

  const approve = async (c: Company) => {
    await api.post(`/companies/${c.id}/approve`)
    fetchCompanies()
  }

  const decline = async (c: Company) => {
    await api.post(`/companies/${c.id}/decline`)
    fetchCompanies()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CompanyStatus | '')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-start gap-2">
          <ImportExportControls
            base="/companies"
            label="Companies"
            onImported={fetchCompanies}
            showImport={canManage}
            exportParams={{ ...(search ? { search } : {}), ...(status ? { status } : {}) }}
          />
          {canManage && (
            <button
              onClick={() => setShowAutoAllocate(true)}
              className="flex items-center gap-2 border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="Let AI assign unallocated companies to placement officers"
            >
              <Sparkles className="w-4 h-4" /> AI Auto-Assign
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
          >
            <Plus className="w-4 h-4" /> Add Company
          </button>
        </div>
      </div>

      {showAutoAllocate && canManage && (
        <AutoAllocateModal
          onClose={() => setShowAutoAllocate(false)}
          onApplied={() => { setShowAutoAllocate(false); fetchCompanies() }}
        />
      )}

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className={cn('font-semibold text-gray-800', isOfficer ? 'mb-1' : 'mb-4')}>Add New Company</h3>
          {isOfficer && (
            <p className="text-xs text-amber-600 mb-4">
              This lead will be assigned to you and flagged for the placement head to review.
            </p>
          )}
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['name', 'sector', 'domain', 'location', 'website'] as const).map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-600 mb-1 capitalize">{field}{field === 'name' ? ' *' : ''}</label>
                <input
                  value={formData[field]}
                  onChange={(e) => setFormData((p) => ({ ...p, [field]: e.target.value }))}
                  required={field === 'name'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Notes{isOfficer ? ' (context for the placement head)' : ''}
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
                placeholder={isOfficer ? 'e.g. Met their HR at a job fair, open to 2025 batch…' : 'Optional notes'}
              />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
                {submitting ? 'Saving...' : 'Save Company'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Company', 'Sector / Domain', 'Location', 'CTC Range', 'Status', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : companies.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No companies found</td></tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 flex items-center gap-1 mt-0.5">
                      <ExternalLink className="w-3 h-3" /> Website
                    </a>}
                    {canManage && c.created_by_name && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <UserRound className="w-3 h-3" /> Added by {c.created_by_name}
                      </p>
                    )}
                    {c.notes && (
                      <p className="text-xs text-gray-500 italic mt-0.5 max-w-[260px] truncate" title={c.notes}>
                        “{c.notes}”
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{[c.sector, c.domain].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.location || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {c.salary_min || c.salary_max ? `${c.salary_min ?? '?'} – ${c.salary_max ?? '?'} LPA` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[c.status])}>
                        {c.status}
                      </span>
                      {c.review_status === 'pending' && (
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                          title={c.created_by_name ? `Lead from ${c.created_by_name}, awaiting review` : 'Officer lead, awaiting review'}
                        >
                          review
                        </span>
                      )}
                      {c.review_status === 'declined' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700" title="Lead declined by the placement head">
                          declined
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {canManage && c.review_status === 'pending' && (
                        <>
                          <button
                            onClick={() => approve(c)}
                            className="flex items-center gap-1 text-green-600 hover:text-green-800 text-xs font-medium"
                            title="Approve this officer-sourced lead"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => decline(c)}
                            className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-medium"
                            title="Decline this lead (removes it from the officer)"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Decline
                          </button>
                        </>
                      )}
                      <Link to={`/companies/${c.id}`} className="text-primary-600 hover:underline text-xs font-medium">View</Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
