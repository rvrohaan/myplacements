import { useEffect, useRef, useState } from 'react'
import { Plus, Search, X, Pencil, Trash2, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import api from '@/lib/api'
import type { Offer, OfferFilterOptions, OfferStatus, OfferSummary } from '@/types'
import { cn, formatCTC, formatDate, STATUS_COLORS } from '@/lib/utils'
import { SortableHead, useTableSorting, type SortColumn, type Sorting } from '@/components/ui/table-sort'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import OfferModal from './OfferModal'

// Sort keys the API accepts; anything else is rejected server-side.
type SortKey =
  | 'student_name'
  | 'roll_number'
  | 'branch'
  | 'batch_year'
  | 'company'
  | 'role'
  | 'ctc'
  | 'status'
  | 'joining_date'
  | 'created_at'

// Names and codes read best A-Z; packages, dates and the lifecycle open on what
// matters first — the biggest package, the newest record, the offers furthest
// from being settled.
const COLUMNS: SortColumn<SortKey>[] = [
  { label: 'Student', sort: 'student_name' },
  { label: 'Roll No', sort: 'roll_number' },
  { label: 'Branch', sort: 'branch' },
  { label: 'Batch', sort: 'batch_year', firstOrder: 'desc' },
  { label: 'Company', sort: 'company' },
  { label: 'Role', sort: 'role' },
  { label: 'Package', sort: 'ctc', firstOrder: 'desc' },
  { label: 'Status', sort: 'status' },
  { label: 'Joining', sort: 'joining_date', firstOrder: 'desc' },
  { label: 'Recorded', sort: 'created_at', firstOrder: 'desc' },
  { label: '' },
]

const SORT_KEYS = COLUMNS.flatMap((c) => (c.sort ? [c.sort] : []))

// Newest first: the offers screen is mostly read while offers are coming in.
const DEFAULT_SORTING: Sorting<SortKey> = { sort: 'created_at', order: 'desc' }

const STATUS_OPTIONS: { value: OfferStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'issued', label: 'Issued' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'joined', label: 'Joined' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'dropout', label: 'Dropped out' },
]

const selectClass =
  'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

const PAGE_SIZE = 25

/** A tile in the summary strip. Clicking one applies it as a filter. */
function Tile({
  label,
  value,
  hint,
  active,
  onClick,
}: {
  label: string
  value: string | number
  hint?: string
  active?: boolean
  onClick?: () => void
}) {
  const content = (
    <>
      <p className={cn('text-xl font-bold', active ? 'text-primary-700' : 'text-gray-900')}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </>
  )
  if (!onClick) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3" title={hint}>
        {content}
      </div>
    )
  }
  return (
    <button
      onClick={onClick}
      title={hint}
      aria-pressed={!!active}
      className={cn(
        'bg-white rounded-xl border px-4 py-3 text-left transition-colors hover:border-primary-300',
        active ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200',
      )}
    >
      {content}
    </button>
  )
}

/**
 * Offers & joining — every offer in the college, across drives and off-campus.
 *
 * The drives page answers "what happened at this company's drive"; this answers
 * the end-of-season questions that cut across drives: how many offers were
 * actually taken up, who is holding several, what the median package was, and
 * who still owes us a joining date.
 */
export default function Offers() {
  const toast = useToast()
  const confirm = useConfirm()
  const [offers, setOffers] = useState<Offer[]>([])
  const [summary, setSummary] = useState<OfferSummary | null>(null)
  const [options, setOptions] = useState<OfferFilterOptions>({ branches: [], batch_years: [], companies: [] })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<OfferStatus | ''>('')
  const [companyId, setCompanyId] = useState('')
  const [branch, setBranch] = useState('')
  const [batchYear, setBatchYear] = useState('')
  const [awaitingJoining, setAwaitingJoining] = useState(false)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Offer | null>(null)

  const { sorting, applySort } = useTableSorting<SortKey>({
    storageKey: 'offers:sorting',
    fallback: DEFAULT_SORTING,
    keys: SORT_KEYS,
    onChange: () => setPage(1),
  })
  const { sort, order } = sorting

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Responses can land out of order; only the newest request writes to state.
  const latestRequest = useRef(0)

  /** Filters the list and the summary share. The summary deliberately ignores
      status and the awaiting-joining bucket — those are what its tiles set. */
  const sharedParams: Record<string, string> = {
    ...(search ? { search } : {}),
    ...(companyId ? { company_id: companyId } : {}),
    ...(branch ? { branch } : {}),
    ...(batchYear ? { batch_year: batchYear } : {}),
  }

  const load = () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    const params: Record<string, string> = {
      ...sharedParams,
      ...(status ? { status } : {}),
      ...(awaitingJoining ? { awaiting_joining: 'true' } : {}),
      skip: String((page - 1) * PAGE_SIZE),
      limit: String(PAGE_SIZE),
      sort,
      order,
    }
    api
      .get<Offer[]>('/offers', { params })
      .then((r) => {
        if (requestId !== latestRequest.current) return
        setOffers(r.data)
        const count = Number(r.headers['x-total-count'])
        setTotal(Number.isFinite(count) ? count : r.data.length)
      })
      .catch(() => {
        if (requestId === latestRequest.current) toast.error('Could not load offers. Please refresh.')
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false)
      })
    api.get<OfferSummary>('/offers/summary', { params: sharedParams })
      .then((r) => { if (requestId === latestRequest.current) setSummary(r.data) })
      .catch(() => {
        // Non-fatal: the strip stays as it was, the table still works.
      })
  }

  useEffect(load, [search, status, companyId, branch, batchYear, awaitingJoining, page, sort, order])

  const loadOptions = () => {
    api.get<OfferFilterOptions>('/offers/filter-options')
      .then((r) => setOptions(r.data))
      .catch(() => {})
  }
  useEffect(loadOptions, [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const activeFilters = [status, companyId, branch, batchYear, awaitingJoining ? 'y' : '']
    .filter(Boolean).length

  const clearFilters = () => {
    setStatus('')
    setCompanyId('')
    setBranch('')
    setBatchYear('')
    setAwaitingJoining(false)
    setSearchInput('')
    setPage(1)
  }

  const onFilter = <T,>(set: (value: T) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value as T)
    setPage(1)
  }

  /** Tiles toggle: clicking the active one clears it rather than re-applying. */
  const toggleStatus = (value: OfferStatus) => {
    setStatus((prev) => (prev === value ? '' : value))
    setAwaitingJoining(false)
    setPage(1)
  }

  const afterWrite = () => {
    setShowForm(false)
    setEditing(null)
    load()
    loadOptions()
  }

  const remove = async (offer: Offer) => {
    const who = offer.student_name || offer.roll_number || 'this student'
    const ok = await confirm({
      title: 'Delete this offer?',
      message:
        `${who}'s offer${offer.company_name ? ` from ${offer.company_name}` : ''} will be removed. ` +
        'If it was their only live offer they go back to the unplaced list.',
      confirmLabel: 'Delete offer',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/offers/${offer.id}`)
      toast.success('Offer deleted')
      load()
    } catch {
      toast.error('Could not delete this offer. Please try again.')
    }
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile
            label="Offers"
            value={summary.total}
            hint={`Held by ${summary.students_with_offer} student${summary.students_with_offer === 1 ? '' : 's'}`}
          />
          <Tile
            label="Accepted"
            value={summary.accepted}
            hint="Students who said yes but haven't started yet"
            active={status === 'accepted'}
            onClick={() => toggleStatus('accepted')}
          />
          <Tile
            label="Joined"
            value={summary.joined}
            hint={
              summary.joining_conversion != null
                ? `${summary.joining_conversion}% of offers taken up reached joining`
                : 'Students who have actually started'
            }
            active={status === 'joined'}
            onClick={() => toggleStatus('joined')}
          />
          <Tile
            label="Dropped out"
            value={summary.dropout}
            hint="Accepted, then didn't join or left"
            active={status === 'dropout'}
            onClick={() => toggleStatus('dropout')}
          />
          <Tile
            label="No joining date"
            value={summary.awaiting_joining_date}
            hint="Live offers with no joining date on record"
            active={awaitingJoining}
            onClick={() => {
              setAwaitingJoining((prev) => !prev)
              setStatus('')
              setPage(1)
            }}
          />
          <Tile
            label="Median package"
            value={formatCTC(summary.median_ctc)}
            hint={
              summary.highest_ctc != null
                ? `Highest ${formatCTC(summary.highest_ctc)} · average ${formatCTC(summary.avg_ctc)}`
                : 'Across live offers only'
            }
          />
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search student, roll no, company or role..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select value={status} onChange={onFilter<OfferStatus | ''>(setStatus)} aria-label="Filter by offer status" className={selectClass}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={companyId} onChange={onFilter(setCompanyId)} aria-label="Filter by company" className={selectClass}>
            <option value="">All Companies</option>
            {options.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={branch} onChange={onFilter(setBranch)} aria-label="Filter by branch" className={selectClass}>
            <option value="">All Branches</option>
            {options.branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={batchYear} onChange={onFilter(setBatchYear)} aria-label="Filter by batch year" className={selectClass}>
            <option value="">All Batches</option>
            {options.batch_years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {(activeFilters > 0 || searchInput) && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-2 transition-colors"
              title="Clear the search and every filter"
            >
              <X className="w-3.5 h-3.5" />
              Clear{activeFilters > 0 ? ` (${activeFilters})` : ''}
            </button>
          )}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shadow-primary-600/25 lg:ml-auto"
        >
          <Plus className="w-4 h-4" />
          Record offer
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <SortableHead columns={COLUMNS} sorting={sorting} onSort={applySort} />
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-10 text-gray-500">Loading...</td></tr>
            ) : offers.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="text-center py-10 text-gray-500">No offers found</td></tr>
            ) : (
              offers.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{o.student_name || '—'}</span>
                      {(o.offer_count ?? 1) > 1 && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium"
                          title="This student is holding more than one offer"
                        >
                          <Layers className="w-3 h-3" />
                          {o.offer_count}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{o.roll_number || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{o.branch || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{o.batch_year || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {o.company_name ? (
                      <span>{o.company_name}</span>
                    ) : (
                      <span
                        className="text-amber-600"
                        title="Marked placed on the Students page with no company recorded — edit the offer to name one"
                      >
                        Not recorded
                      </span>
                    )}
                    {o.drive_title && (
                      <span className="block text-xs text-gray-400 mt-0.5">via {o.drive_title} drive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.role || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{formatCTC(o.ctc)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[o.status])}>
                      {o.status === 'dropout' ? 'dropped out' : o.status}
                    </span>
                    {o.status === 'dropout' && o.dropout_reason && (
                      <span className="block text-xs text-gray-500 italic mt-0.5 max-w-[200px] truncate" title={o.dropout_reason}>
                        {o.dropout_reason}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {o.joining_date ? (
                      formatDate(o.joining_date)
                    ) : (
                      <span className="text-gray-400">{o.status === 'accepted' || o.status === 'joined' ? 'Not set' : '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditing(o)}
                        title="Edit this offer"
                        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => remove(o)}
                        title="Delete this offer"
                        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600 whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
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
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min((page - 1) * PAGE_SIZE + offers.length, total)} of {total}
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

      {(showForm || editing) && (
        <OfferModal
          offer={editing ?? undefined}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={afterWrite}
        />
      )}
    </div>
  )
}
