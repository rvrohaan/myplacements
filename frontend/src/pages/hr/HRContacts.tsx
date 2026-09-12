import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarClock,
  Linkedin,
  Mail,
  Phone,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { cn, formatDate } from '@/lib/utils'
import type { Company, HRContactDirectoryEntry, HREngagement, HRSummary } from '@/types'
import { StrengthBar } from '../companies/HRContactsPanel'
import HRContactModal from '../companies/HRContactModal'
import DraftEmailModal from '../companies/DraftEmailModal'

const PAGE_SIZE = 50

type FollowupFilter = 'all' | 'due' | 'overdue' | 'upcoming' | 'none'
type SortKey = 'followup' | 'name' | 'company' | 'engagement' | 'relationship' | 'last_contacted'

const FOLLOWUP_TABS: { value: FollowupFilter; label: string }[] = [
  { value: 'due', label: 'Due' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'none', label: 'No date' },
  { value: 'all', label: 'Everyone' },
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'followup', label: 'Follow-up date' },
  { value: 'engagement', label: 'Engagement' },
  { value: 'relationship', label: 'Relationship' },
  { value: 'last_contacted', label: 'Last contacted' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
]

const BAND_STYLES: Record<string, string> = {
  responsive: 'bg-green-100 text-green-700',
  warm: 'bg-emerald-50 text-emerald-700',
  slow: 'bg-amber-100 text-amber-700',
  cold: 'bg-gray-200 text-gray-600',
}

/** The computed score, with the evidence behind it on hover. */
function EngagementPill({ engagement }: { engagement?: HREngagement }) {
  if (!engagement) {
    return (
      <span
        className="text-xs text-gray-400"
        title="Nothing logged against this contact yet — there is no evidence to score."
      >
        No history
      </span>
    )
  }
  const { score, band, stale, total_logged, replied, awaited, overdue_followups } = engagement
  const why = [
    `${total_logged} logged · ${replied} replied${awaited ? ` · ${awaited} awaiting` : ''}`,
    overdue_followups ? `${overdue_followups} follow-up(s) lapsed` : null,
    stale ? 'No contact inside the last 6 months — capped below “warm”.' : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span className="inline-flex items-center gap-1.5" title={why}>
      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', BAND_STYLES[band])}>
        {score}
      </span>
      <span className="text-xs text-gray-500 capitalize">{band}</span>
      {stale && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" aria-label="Stale" />}
    </span>
  )
}

function SummaryTile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: 'danger' | 'warn'
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left px-4 py-3 rounded-xl border bg-white transition-colors',
        active ? 'border-primary-400 ring-1 ring-primary-200' : 'border-gray-200 hover:border-gray-300',
      )}
    >
      <p
        className={cn(
          'text-xl font-semibold',
          tone === 'danger' ? 'text-red-600' : tone === 'warn' ? 'text-orange-600' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </button>
  )
}

function ContactRow({
  contact,
  onEdit,
  onDraftEmail,
}: {
  contact: HRContactDirectoryEntry
  onEdit: () => void
  onDraftEmail: () => void
}) {
  const overdue =
    contact.next_followup_date && new Date(contact.next_followup_date) < new Date()

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50/70">
      <td className="px-4 py-3">
        <button
          onClick={onEdit}
          className="text-left font-medium text-gray-900 text-sm hover:text-primary-600"
        >
          {contact.name}
        </button>
        {contact.designation && (
          <p className="text-xs text-gray-500">{contact.designation}</p>
        )}
        <div className="flex items-center gap-2.5 mt-1">
          {contact.email && (
            <a href={`mailto:${contact.email}`} title={contact.email} className="text-gray-400 hover:text-primary-600">
              <Mail className="w-3.5 h-3.5" />
            </a>
          )}
          {contact.mobile && (
            <a href={`tel:${contact.mobile}`} title={contact.mobile} className="text-gray-400 hover:text-primary-600">
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          {contact.linkedin && (
            <a
              href={contact.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              title="LinkedIn profile"
              className="text-gray-400 hover:text-primary-600"
            >
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </td>

      <td className="px-4 py-3">
        <Link
          to={`/companies/${contact.company_id}`}
          className="text-sm text-gray-700 hover:text-primary-600 font-medium"
        >
          {contact.company_name}
        </Link>
        {contact.region && <p className="text-xs text-gray-400 mt-0.5">{contact.region}</p>}
      </td>

      <td className="px-4 py-3">
        <EngagementPill engagement={contact.engagement} />
      </td>

      <td className="px-4 py-3">
        <StrengthBar value={contact.relationship_strength} />
      </td>

      <td className="px-4 py-3">
        {contact.last_contacted_at ? (
          <>
            <p className="text-xs text-gray-700">{formatDate(contact.last_contacted_at)}</p>
            {contact.last_contacted_by && (
              <p className="text-xs text-gray-400">by {contact.last_contacted_by}</p>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400">Never</span>
        )}
      </td>

      <td className="px-4 py-3">
        {contact.next_action && (
          <p className="text-xs text-gray-700 max-w-[16rem]">{contact.next_action}</p>
        )}
        {contact.next_followup_date ? (
          <p
            className={cn(
              'text-xs mt-0.5 flex items-center gap-1',
              overdue ? 'text-red-600 font-medium' : 'text-orange-600',
            )}
          >
            <CalendarClock className="w-3 h-3 shrink-0" />
            {overdue ? 'Overdue since' : ''} {formatDate(contact.next_followup_date)}
          </p>
        ) : (
          !contact.next_action && <span className="text-xs text-gray-300">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        <button
          onClick={onDraftEmail}
          title="Draft an email to this contact"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Draft
        </button>
      </td>
    </tr>
  )
}

/**
 * The HR directory — every contact in the college, across companies.
 *
 * Company Detail answers "who do we know at Infosys". This page answers the
 * question that cuts the other way: "who owes whom a reply, and which
 * relationships are going cold" — which no single company page can show.
 */
export default function HRContacts() {
  const toast = useToast()
  const [contacts, setContacts] = useState<HRContactDirectoryEntry[]>([])
  const [summary, setSummary] = useState<HRSummary | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [companyId, setCompanyId] = useState<string>('')
  const [followup, setFollowup] = useState<FollowupFilter>('due')
  const [sort, setSort] = useState<SortKey>('followup')

  const [editing, setEditing] = useState<HRContactDirectoryEntry | null>(null)
  const [emailing, setEmailing] = useState<HRContactDirectoryEntry | null>(null)

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, headers } = await api.get('/hr-contacts', {
        params: {
          search: debouncedSearch || undefined,
          company_id: companyId || undefined,
          followup,
          sort,
          // Follow-up soonest first is the useful default; every other column
          // reads better with the strongest value at the top.
          order: sort === 'followup' || sort === 'name' || sort === 'company' ? 'asc' : 'desc',
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        },
      })
      setContacts(data)
      setTotal(Number(headers['x-total-count'] ?? data.length))
    } catch {
      toast.error('Could not load the HR directory. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, companyId, followup, sort, page, toast])

  useEffect(() => {
    load()
  }, [load])

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get('/hr-contacts/summary')
      setSummary(data)
    } catch {
      /* The header strip is a nicety — the table below still works without it. */
    }
  }, [])

  useEffect(() => {
    loadSummary()
    api
      .get('/companies', { params: { limit: 200 } })
      .then((r) => setCompanies(r.data))
      .catch(() => undefined)
  }, [loadSummary])

  const refresh = useCallback(async () => {
    await Promise.all([load(), loadSummary()])
  }, [load, loadSummary])

  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">HR Contacts</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Every contact across your companies — who owes whom a reply, and which relationships are
          going cold.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryTile
            label="Contacts"
            value={summary.total}
            active={followup === 'all'}
            onClick={() => {
              setFollowup('all')
              setPage(0)
            }}
          />
          <SummaryTile
            label="Overdue"
            value={summary.overdue}
            tone="danger"
            active={followup === 'overdue'}
            onClick={() => {
              setFollowup('overdue')
              setPage(0)
            }}
          />
          <SummaryTile
            label="Due this week"
            value={summary.due_this_week}
            tone="warn"
            active={followup === 'upcoming'}
            onClick={() => {
              setFollowup('upcoming')
              setPage(0)
            }}
          />
          <SummaryTile
            label="No follow-up set"
            value={summary.no_followup}
            active={followup === 'none'}
            onClick={() => {
              setFollowup('none')
              setPage(0)
            }}
          />
          <SummaryTile label="Never contacted" value={summary.never_contacted} />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, designation or company…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value)
              setPage(0)
            }}
            className="w-full sm:w-auto sm:max-w-[16rem] px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey)
              setPage(0)
            }}
            className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="px-4 py-2.5 flex gap-1 border-b border-gray-100 overflow-x-auto">
          {FOLLOWUP_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setFollowup(t.value)
                setPage(0)
              }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                followup === t.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
        ) : contacts.length === 0 ? (
          <div className="p-10 text-center">
            <UserRound className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No contacts match these filters.</p>
            <p className="text-xs text-gray-400 mt-1">
              HR contacts are added from a company’s page — open a company and use “Add”.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 bg-gray-50/70">
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Engagement</th>
                  <th className="px-4 py-2.5">Relationship</th>
                  <th className="px-4 py-2.5">Last contacted</th>
                  <th className="px-4 py-2.5">Next action</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    onEdit={() => setEditing(c)}
                    onDraftEmail={() => setEmailing(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="px-4 py-3 flex items-center justify-between border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <HRContactModal
          companyId={editing.company_id}
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {emailing && (
        <DraftEmailModal
          company={{ id: emailing.company_id, name: emailing.company_name }}
          contact={emailing}
          onClose={() => setEmailing(null)}
        />
      )}
    </div>
  )
}
