import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, ExternalLink, CheckCircle2, XCircle, UserRound, Sparkles, Briefcase, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import type { Company, CompanyStatus, UserRole } from '@/types'
import { cn, formatDate, STATUS_COLORS } from '@/lib/utils'
import ImportExportControls from '@/components/ImportExportControls'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import { required, type Rules } from '@/lib/validation'
import AutoAllocateModal from './AutoAllocateModal'

type NewCompanyForm = { name: string; sector: string; domain: string; location: string; website: string; notes: string }

const NEW_COMPANY: NewCompanyForm = { name: '', sector: '', domain: '', location: '', website: '', notes: '' }

const NEW_COMPANY_RULES: Rules<NewCompanyForm> = {
  name: required('Enter the company name.'),
  website: (value) => {
    if (!value.trim()) return undefined
    return /^https?:\/\/.+/i.test(value.trim())
      ? undefined
      : 'Include the full address, starting with https://.'
  },
}

const MANAGE_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

// Sort keys the API accepts; anything else is rejected server-side.
type SortKey = 'name' | 'sector' | 'location' | 'salary_max' | 'status' | 'created_at'
type SortOrder = 'asc' | 'desc'

// The table header, and which column each heading sorts by. Text reads best
// A-Z on first click; money and dates are most useful largest/newest first.
const COLUMNS: { label: string; sort?: SortKey; firstOrder?: SortOrder }[] = [
  { label: 'Company', sort: 'name' },
  { label: 'Sector / Domain', sort: 'sector' },
  { label: 'Location', sort: 'location' },
  { label: 'CTC Range', sort: 'salary_max', firstOrder: 'desc' },
  { label: 'Status', sort: 'status' },
  { label: 'Added', sort: 'created_at', firstOrder: 'desc' },
  { label: '' },
]

type Sorting = { sort: SortKey | 'id'; order: SortOrder }

// A-Z by name: the order people scan a company list in. ('id' - the order rows
// were added - stays a valid stored value so sessions that chose it still work.)
const DEFAULT_SORTING: Sorting = { sort: 'name', order: 'asc' }
const SORT_STORAGE_KEY = 'companies:sorting'
const SORT_KEYS: (SortKey | 'id')[] = ['id', ...COLUMNS.flatMap((c) => (c.sort ? [c.sort] : []))]

/**
 * The sort the user last chose, remembered for the browser session so opening a
 * company and coming back lands on the same ordering. sessionStorage rather than
 * localStorage: a new tab starts from the default. Anything unreadable or stale
 * falls back to the default, since an invalid key would make the API 422.
 */
function storedSorting(): Sorting {
  try {
    const raw = sessionStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Sorting
      if (SORT_KEYS.includes(saved.sort) && (saved.order === 'asc' || saved.order === 'desc')) {
        return saved
      }
    }
  } catch {
    // Storage disabled or holding something we didn't write - use the default.
  }
  return DEFAULT_SORTING
}

/** "3 roles · 2 open" for the list row, or null when none are recorded. */
function rolesSummary(company: Company): string | null {
  const total = company.roles?.length ?? 0
  if (!total) return null
  const open = company.roles.filter((r) => r.status === 'open').length
  const label = `${total} role${total === 1 ? '' : 's'}`
  return open ? `${label} · ${open} open` : label
}

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
  // What's typed vs. what's been sent to the server (debounced, see below).
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CompanyStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showAutoAllocate, setShowAutoAllocate] = useState(false)
  const [formData, setFormData] = useState<NewCompanyForm>(NEW_COMPANY)
  const toast = useToast()
  const confirm = useConfirm()
  const { formRef, errors, clearError, validate } = useFieldErrors<NewCompanyForm>()

  const updateNew = (field: keyof NewCompanyForm, value: string) => {
    clearError(field)
    setFormData((p) => ({ ...p, [field]: value }))
  }

  /** The inline add-company panel is a form too, so closing it asks first. */
  const closeAddForm = async () => {
    const dirty = JSON.stringify(formData) !== JSON.stringify(NEW_COMPANY)
    if (dirty) {
      const discard = await confirm({
        title: 'Discard this company?',
        message: 'You haven’t saved what you typed yet. Closing the form now will lose it.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'warning',
      })
      if (!discard) return
    }
    setFormData(NEW_COMPANY)
    setShowForm(false)
  }
  const [submitting, setSubmitting] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  // Sorting is server-side: a page holds 25 of what can be thousands of
  // companies, so ordering the rows in the browser would only order the slice
  // already on screen.
  const [sorting, setSorting] = useState<Sorting>(storedSorting)
  const { sort, order } = sorting

  const PAGE_SIZE = 25

  // Searching hits the server, so wait for a pause in typing instead of firing a
  // query per keystroke. Filters change the result set, so restart at page one.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Responses can land out of order (an early, slower query resolving after a
  // later one); only the newest request is allowed to write to state.
  const latestRequest = useRef(0)

  // Paged server-side: the full list can run to hundreds of companies, more than
  // a single request returns. X-Total-Count carries the unpaged total.
  const fetchCompanies = () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    const params: Record<string, string> = {
      skip: String((page - 1) * PAGE_SIZE),
      limit: String(PAGE_SIZE),
      sort,
      order,
    }
    if (search) params.search = search
    if (status) params.status = status
    api
      .get('/companies', { params })
      .then((r) => {
        if (requestId !== latestRequest.current) return
        setCompanies(r.data)
        const count = Number(r.headers['x-total-count'])
        setTotal(Number.isFinite(count) ? count : r.data.length)
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false)
      })
  }

  useEffect(() => { fetchCompanies() }, [search, status, page, sort, order])

  const applyStatus = (value: CompanyStatus | '') => { setStatus(value); setPage(1) }

  // Clicking the active column flips direction; a new column starts in its own
  // most useful direction. Either way the reordered list restarts at page one.
  const applySort = (key: SortKey, firstOrder: SortOrder = 'asc') => {
    setSorting((prev) =>
      prev.sort === key
        ? { sort: key, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: firstOrder },
    )
    setPage(1)
  }

  // Remember the chosen sort for the rest of the session (see storedSorting).
  useEffect(() => {
    try {
      sessionStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sorting))
    } catch {
      // Storage unavailable - sorting still works, it just won't be remembered.
    }
  }, [sorting])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate(NEW_COMPANY_RULES, formData)) return
    setSubmitting(true)
    try {
      await api.post('/companies', formData)
      setShowForm(false)
      setFormData(NEW_COMPANY)
      toast.success(`${formData.name} added`)
      fetchCompanies()
    } catch (err: any) {
      // This used to fail silently — the panel just sat there looking idle.
      toast.error(err?.response?.data?.detail ?? 'Could not add this company. Check your connection and try again.')
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
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, sector, domain or location..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={status}
            onChange={(e) => applyStatus(e.target.value as CompanyStatus | '')}
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
            exportParams={{ ...(search ? { search } : {}), ...(status ? { status } : {}), sort, order }}
          />
          {canManage && (
            <button
              onClick={() => setShowAutoAllocate(true)}
              className="flex items-center gap-2 border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              title="Propose owners for unallocated companies, ranked by importance"
            >
              <Sparkles className="w-4 h-4" /> Auto-Assign
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
          {/* noValidate hands validation to the app, so the browser never shows its
              own tooltip bubbles over our fields. */}
          <form ref={formRef} onSubmit={handleCreate} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['name', 'sector', 'domain', 'location', 'website'] as const).map((field) => (
              <Field
                key={field}
                compact
                label={<span className="capitalize">{field}</span>}
                name={field}
                required={field === 'name'}
                optional={field !== 'name'}
                error={errors[field]}
              >
                {(p) => (
                  <input
                    {...p}
                    value={formData[field]}
                    onChange={(e) => updateNew(field, e.target.value)}
                    className={inputClass(!!errors[field], 'px-3 py-2')}
                    placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                  />
                )}
              </Field>
            ))}
            <Field
              compact
              className="sm:col-span-2"
              label={`Notes${isOfficer ? ' (context for the placement head)' : ''}`}
              name="notes"
              optional
            >
              {(p) => (
                <textarea
                  {...p}
                  value={formData.notes}
                  onChange={(e) => updateNew('notes', e.target.value)}
                  rows={2}
                  className={inputClass(false, 'px-3 py-2 resize-y')}
                  placeholder={isOfficer ? 'e.g. Met their HR at a job fair, open to 2025 batch…' : 'Optional notes'}
                />
              )}
            </Field>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={closeAddForm} className="min-h-[44px] px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2">Cancel</button>
              <button type="submit" disabled={submitting} className="min-h-[44px] px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                {submitting ? 'Saving…' : 'Save Company'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {COLUMNS.map((col) => {
                const active = col.sort === sort
                return (
                  <th
                    key={col.label}
                    aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                    className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    {col.sort ? (
                      <button
                        onClick={() => applySort(col.sort!, col.firstOrder)}
                        className={cn(
                          'group flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 transition-colors',
                          active && 'text-primary-600',
                        )}
                        title={`Sort by ${col.label.toLowerCase()}`}
                      >
                        {col.label}
                        {active ? (
                          order === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronsUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : companies.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-10 text-gray-400">No companies found</td></tr>
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
                    {rolesSummary(c) && (
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                        <Briefcase className="w-3 h-3" /> {rolesSummary(c)}
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
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(c.created_at)}</td>
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

      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min((page - 1) * PAGE_SIZE + companies.length, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
