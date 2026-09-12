import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileCheck2,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserX,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { Modal, ModalCancelButton, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass } from '@/components/ui/field'
import { StatCard, DashboardSkeleton, Panel } from '@/pages/dashboard/StatCard'
import { formatDate } from '@/lib/utils'
import type { DailyDigest as DailyDigestData, DailyUpdate } from '@/types'

const CHART_TOOLTIP = {
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
  fontSize: 12,
} as const

/** Local YYYY-MM-DD — toISOString() would shift the date across midnight IST. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return isoDate(next)
}

const TOTAL_LABELS: Array<[keyof DailyDigestData['totals'], string]> = [
  ['calls', 'Calls'],
  ['meetings', 'Meetings'],
  ['companies_touched', 'Companies touched'],
  ['new_companies', 'New companies'],
  ['drives_conducted', 'Drives run'],
  ['offers', 'Offers'],
]

/** Today against the trailing average, so the number has somewhere to stand. */
function Delta({ value, baseline }: { value: number; baseline: number }) {
  const diff = value - baseline
  if (!baseline && !value) return <span className="text-xs text-gray-400">&mdash;</span>
  if (Math.abs(diff) < 0.5) {
    return <span className="text-xs text-gray-400">same as usual</span>
  }
  const up = diff > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? 'text-teal-600' : 'text-amber-600'}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? '+' : ''}
      {diff.toFixed(diff % 1 === 0 ? 0 : 1)} vs avg
    </span>
  )
}

/** Which slice of the day the compliance cards have drilled into. */
type Slice = 'filed' | 'on_time' | 'late' | 'not_filed'

const SLICE_TITLES: Record<Slice, string> = {
  filed: 'Filed',
  on_time: 'Filed on time',
  late: 'Filed late',
  not_filed: 'No update filed',
}

export default function DailyDigest() {
  const toast = useToast()
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [digest, setDigest] = useState<DailyDigestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [slice, setSlice] = useState<Slice | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const load = (forDate: string) => {
    setLoading(true)
    api
      .get('/daily-updates/digest', { params: { date: forDate } })
      .then((r) => setDigest(r.data))
      .catch((err) =>
        toast.error(err?.response?.data?.detail ?? 'Could not load the digest.'),
      )
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setSlice(null)
    setExpanded(null)
    load(date)
  }, [date])

  const today = useMemo(() => isoDate(new Date()), [])

  /** Clicking a compliance card drills the list below into that slice; clicking
   *  the same card again clears it. The list sits under the fold, so bring it
   *  into view or the click looks like it did nothing. */
  const drillInto = (next: Slice) => {
    const cleared = slice === next
    setSlice(cleared ? null : next)
    setExpanded(null)
    if (cleared) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }),
    )
  }

  const remind = async (userId: number, name: string) => {
    try {
      const r = await api.post(`/daily-updates/remind/${userId}`)
      if (r.data?.email_status === 'sent') toast.success(`Reminder sent to ${name}.`)
      else toast.info(`No email could be sent to ${name} — check their address or the mail setup.`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not send the reminder.')
    }
  }

  const review = async (updateId: number, note: string | null) => {
    try {
      await api.post(`/daily-updates/${updateId}/review`, { note })
      toast.success(note ? 'Reply sent.' : 'Marked as seen.')
      load(date)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save your response.')
    }
  }

  if (loading || !digest) return <DashboardSkeleton cards={4} panels={2} />

  const { compliance, attention, totals, baseline } = digest
  // Plain expression rather than useMemo: it runs after the early return above,
  // where a hook would break the rules of hooks, and it is a filter over a
  // handful of rows. Someone on leave is not "filed" - the compliance counts
  // exclude them, so the drill-down has to as well or the numbers won't match.
  const working = digest.updates.filter((u) => u.work_mode !== 'leave')
  const shown =
    slice === 'filed'
      ? working
      : slice === 'on_time' || slice === 'late'
        ? working.filter((u) => u.status === slice)
        : digest.updates

  const hasAttention =
    attention.escalations.length > 0 ||
    attention.not_filed.length > 0 ||
    attention.zero_activity.length > 0

  return (
    <div className="space-y-6">
      {/* Date stepper + cutoff control */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDate(shiftDate(date, -1))}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="text-sm font-medium text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            aria-label="Next day"
            disabled={date >= today}
            onClick={() => setDate(shiftDate(date, 1))}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
          {date !== today && (
            <button
              type="button"
              onClick={() => setDate(today)}
              className="ml-1 text-sm font-medium text-primary-600 hover:text-primary-700 px-2.5 py-1.5 rounded-lg hover:bg-primary-50"
            >
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
        >
          <Settings2 className="w-4 h-4" aria-hidden="true" />
          Cutoff {digest.cutoff}
        </button>
      </div>

      {/* Compliance — each card drills the list further down into that slice. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FileCheck2}
          label="Filed"
          value={`${compliance.filed}/${compliance.expected}`}
          sub={compliance.on_leave ? `${compliance.on_leave} on leave` : undefined}
          tone={compliance.missing ? 'amber' : 'teal'}
          onClick={compliance.filed ? () => drillInto('filed') : undefined}
          selected={slice === 'filed'}
        />
        <StatCard
          icon={CheckCircle2}
          label="On time"
          value={compliance.on_time}
          tone="teal"
          onClick={compliance.on_time ? () => drillInto('on_time') : undefined}
          selected={slice === 'on_time'}
        />
        <StatCard
          icon={Clock}
          label="Late"
          value={compliance.late}
          tone="amber"
          onClick={compliance.late ? () => drillInto('late') : undefined}
          selected={slice === 'late'}
        />
        <StatCard
          icon={UserX}
          label="Not filed"
          value={compliance.missing}
          tone={compliance.missing ? 'rose' : 'blue'}
          onClick={compliance.missing ? () => drillInto('not_filed') : undefined}
          selected={slice === 'not_filed'}
        />
      </div>

      {/* Exceptions first — this is what needs a decision. */}
      {hasAttention && (
        <Panel title="Needs your attention">
          <div className="space-y-4">
            {attention.escalations.map((item) => (
              <EscalationCard key={item.update_id} item={item} onReview={review} />
            ))}

            {attention.not_filed.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  No update filed ({attention.not_filed.length})
                </p>
                <NotFiledList people={attention.not_filed} onRemind={remind} />
              </div>
            )}

            {attention.zero_activity.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  Filed, but nothing recorded ({attention.zero_activity.length})
                </p>
                <p className="text-sm text-gray-600">
                  {attention.zero_activity.map((p) => p.name).join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Standing worries, not today's events. */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
            <StandingChip
              to="/communications"
              label="overdue follow-ups"
              count={attention.overdue_followups}
            />
            <StandingChip to="/companies" label="companies going cold" count={attention.stale_companies} />
            <StandingChip to="/companies" label="leads awaiting review" count={attention.pending_lead_reviews} />
            <StandingChip to="/officers" label="companies unassigned" count={attention.unassigned_companies} />
          </div>
        </Panel>
      )}

      {/* What the college did that day */}
      <Panel title={`Activity on ${formatDate(digest.date)}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {TOTAL_LABELS.map(([key, label]) => (
            <div key={key}>
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                {totals[key] ?? 0}
              </p>
              <Delta value={totals[key] ?? 0} baseline={baseline[key] ?? 0} />
            </div>
          ))}
        </div>
      </Panel>

      {/* Per-person detail, narrowed by whichever compliance card is active. */}
      <div ref={listRef} className="scroll-mt-4">
        <Panel
          title={
            slice
              ? `${SLICE_TITLES[slice]} (${
                  slice === 'not_filed' ? attention.not_filed.length : shown.length
                })`
              : `Updates (${digest.updates.length})`
          }
          action={
            slice && (
              <button
                type="button"
                onClick={() => setSlice(null)}
                className="text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50"
              >
                Show all
              </button>
            )
          }
        >
          {slice === 'not_filed' ? (
            <NotFiledList people={attention.not_filed} onRemind={remind} />
          ) : shown.length === 0 ? (
            <p className="text-sm text-gray-500">
              {digest.updates.length === 0
                ? 'Nobody filed an update for this day.'
                : 'No updates in this group.'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {shown.map((update) => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  open={expanded === update.id}
                  onToggle={() => setExpanded(expanded === update.id ? null : update.id)}
                  onReview={review}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Last 7 days">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={digest.trend} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            {/* Recharts freezes the grow-in when the series change, so it stays off. */}
            <Bar dataKey="filed" name="Updates filed" fill="#bae6fd" isAnimationActive={false} />
            <Line type="monotone" dataKey="calls" name="Calls" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="offers" name="Offers" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {showSettings && (
        <SettingsModal
          current={{ daily_update_cutoff: digest.cutoff, daily_update_enabled: digest.enabled }}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false)
            load(date)
          }}
        />
      )}
    </div>
  )
}

function NotFiledList({
  people,
  onRemind,
}: {
  people: DailyDigestData['attention']['not_filed']
  onRemind: (userId: number, name: string) => void
}) {
  if (people.length === 0) {
    return <p className="text-sm text-gray-500">Everyone has filed.</p>
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {people.map((person) => (
        <li
          key={person.user_id}
          className="inline-flex items-center gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg pl-3 pr-1.5 py-1"
        >
          {person.name}
          <button
            type="button"
            onClick={() => onRemind(person.user_id, person.name)}
            className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 hover:bg-rose-100 px-2 py-1 rounded"
          >
            <Bell className="w-3 h-3" aria-hidden="true" />
            Remind
          </button>
        </li>
      ))}
    </ul>
  )
}

function StandingChip({ to, label, count }: { to: string; label: string; count: number }) {
  if (!count) return null
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-lg px-2.5 py-1.5"
    >
      <span className="font-semibold tabular-nums">{count}</span> {label}
    </Link>
  )
}

function EscalationCard({
  item,
  onReview,
}: {
  item: DailyDigestData['attention']['escalations'][number]
  onReview: (id: number, note: string | null) => void
}) {
  const [replying, setReplying] = useState(false)
  const [note, setNote] = useState('')
  // A draft of the reply, written from this escalation. Shown as ghost text in
  // the empty box; Tab or the button below accepts it. Null means there is none
  // to offer - no API key, a model hiccup - and the box is simply empty.
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const drafted = useRef(false)

  const startReply = () => {
    setReplying(true)
    // Drafting costs an API call, so ask once per card: cancelling and reopening
    // the box reuses the draft already fetched rather than paying for it again.
    if (drafted.current) return
    drafted.current = true
    setDrafting(true)
    api
      .post(`/daily-updates/${item.update_id}/suggest-reply`)
      .then((r) => setSuggestion(r.data?.suggestion ?? null))
      .catch(() => setSuggestion(null))
      .finally(() => setDrafting(false))
  }

  const acceptSuggestion = () => {
    if (!suggestion) return
    setNote(suggestion)
    boxRef.current?.focus()
  }

  // Tab accepts the draft only while the box is still empty, so once there is
  // anything to send Tab goes back to doing what it should and reaches the Send
  // button. The button below does the same thing for anyone not using Tab.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || note !== '' || !suggestion) return
    e.preventDefault()
    acceptSuggestion()
  }

  const placeholder = drafting
    ? 'Drafting a suggestion…'
    : suggestion ?? `Reply to ${item.name ?? 'this update'}…`

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        {item.name ?? 'Unknown'}
      </p>
      <p className="mt-1 text-sm text-amber-900">{item.escalation_note}</p>
      {item.reviewed ? (
        <p className="mt-2 text-xs text-amber-700 inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Acknowledged
        </p>
      ) : replying ? (
        <div className="mt-2 space-y-2">
          <textarea
            ref={boxRef}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            placeholder={placeholder}
            aria-describedby={suggestion && !note ? `suggest-${item.update_id}` : undefined}
            className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {suggestion && !note && (
            <button
              type="button"
              id={`suggest-${item.update_id}`}
              onClick={acceptSuggestion}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 px-2.5 py-1 rounded-lg"
            >
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              Use this draft
              <kbd className="ml-0.5 px-1 py-px font-sans text-[10px] border border-amber-300 rounded bg-amber-50">
                Tab
              </kbd>
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReview(item.update_id, note.trim() || null)}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
            >
              Send reply
            </button>
            <button
              type="button"
              onClick={() => setReplying(false)}
              className="text-xs font-medium text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
            >
              Cancel
            </button>
          </div>
          {suggestion && (
            <p className="text-[11px] text-amber-700/80">
              Drafted for you — read it before sending.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onReview(item.update_id, null)}
            className="text-xs font-medium text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
          >
            Acknowledge
          </button>
          <button
            type="button"
            onClick={startReply}
            className="text-xs font-medium text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
          >
            Reply
          </button>
        </div>
      )}
    </div>
  )
}

function UpdateRow({
  update,
  open,
  onToggle,
  onReview,
}: {
  update: DailyUpdate
  open: boolean
  onToggle: () => void
  onReview: (id: number, note: string | null) => void
}) {
  const [note, setNote] = useState('')
  const metrics = update.metrics ?? {}
  // [metric, singular, plural] - "1 calls" reads as a bug to whoever spots it.
  const chips =
    update.kind === 'coordinator'
      ? ([
          ['trainings_completed', 'completed', 'completed'],
          ['trainings_enrolled', 'enrolled', 'enrolled'],
          ['students_at_risk', 'at risk', 'at risk'],
        ] as const)
      : ([
          ['calls', 'call', 'calls'],
          ['meetings', 'meeting', 'meetings'],
          ['companies_touched', 'company', 'companies'],
          ['drives_conducted', 'drive', 'drives'],
          ['offers', 'offer', 'offers'],
        ] as const)

  const sections: Array<[string, string | undefined]> = [
    ['What moved', update.highlights],
    ['Stuck on', update.blockers],
    ['Plan for tomorrow', update.plan_tomorrow],
    ['Support needed', update.support_needed],
  ]

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left group"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
            {update.submitted_by_name ?? 'Unknown'}
            {update.needs_escalation && (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Escalation flagged" />
            )}
            {update.reviewed_at && (
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" aria-label="Acknowledged" />
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 truncate">
            {update.work_mode === 'leave'
              ? 'On leave'
              : chips
                  .filter(([key]) => metrics[key])
                  .map(([key, one, many]) => `${metrics[key]} ${metrics[key] === 1 ? one : many}`)
                  .join(' · ') || 'no recorded activity'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {update.status && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                update.status === 'late' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {update.status === 'late' ? 'Late' : 'On time'}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-1 space-y-3">
          {sections.map(([label, value]) =>
            value ? (
              <div key={label}>
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-line">{value}</p>
              </div>
            ) : null,
          )}
          {(update.manual_visits > 0 || update.manual_meetings > 0) && (
            <p className="text-xs text-gray-500">
              Also reported: {update.manual_visits} visits, {update.manual_meetings} meetings not
              yet logged in the system.
            </p>
          )}

          {update.review_note && (
            <p className="text-sm text-gray-800 bg-primary-50 border-l-2 border-primary-400 pl-3 py-2 rounded-r">
              <span className="font-medium">{update.reviewed_by_name ?? 'You'}:</span>{' '}
              {update.review_note}
            </p>
          )}

          {update.can_review && !update.review_note && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reply to this update (optional)"
                className="flex-1 min-w-[200px] text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={() => onReview(update.id, note.trim() || null)}
                className="text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg"
              >
                {note.trim() ? 'Send reply' : update.reviewed_at ? 'Seen' : 'Mark seen'}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function SettingsModal({
  current,
  onClose,
  onSaved,
}: {
  current: { daily_update_cutoff: string; daily_update_enabled: boolean }
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [cutoff, setCutoff] = useState(current.daily_update_cutoff)
  const [enabled, setEnabled] = useState(current.daily_update_enabled)
  const [saving, setSaving] = useState(false)

  const dirty = cutoff !== current.daily_update_cutoff || enabled !== current.daily_update_enabled

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put('/daily-updates/settings', {
        daily_update_cutoff: cutoff,
        daily_update_enabled: enabled,
      })
      toast.success('Settings saved.')
      onSaved()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} isDirty={dirty} panelClassName="w-full max-w-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <ModalTitle>Daily update settings</ModalTitle>
        <ModalClose />
      </div>
      <form onSubmit={save} noValidate className="p-6 space-y-4">
        <Field
          label="Filing cutoff"
          name="cutoff"
          hint="Updates filed after this time are recorded as late. Reminders go out two hours before."
        >
          {(p) => (
            <input
              {...p}
              type="time"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
            />
          )}
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span>
            <span className="font-medium">Daily updates are on</span>
            <span className="block text-xs text-gray-500">
              Turning this off stops the reminder and digest emails.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <ModalCancelButton />
        </div>
      </form>
    </Modal>
  )
}
