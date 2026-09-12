import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileCheck2,
  Settings2,
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
import {
  Delta,
  EscalationCard,
  NotFiledList,
  StandingChip,
  TOTAL_LABELS,
  useDigestActions,
} from './digestParts'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
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
  // A notification links here as ?date=YYYY-MM-DD&update=<id>. The date has to
  // travel with it: this page opens on today, so without it a notification read
  // the next morning would land on the wrong day and the update would be absent.
  const [searchParams, setSearchParams] = useSearchParams()
  const targetId = Number(searchParams.get('update')) || null
  const today = useMemo(() => isoDate(new Date()), [])
  // Derived from the URL rather than copied into state at mount. This component
  // stays mounted when one notification is opened from another, so a `useState`
  // initialiser would run only for the first arrival - every later one would
  // change the address bar and leave the page on the day already on screen.
  // Stepping the day writes back here, which also makes the view shareable and
  // the back button work. Changing the day drops `update`: the targeted entry
  // belongs to the day that was being left.
  const date = searchParams.get('date') || today
  const setDate = (next: string) => setSearchParams({ date: next }, { replace: true })
  const [digest, setDigest] = useState<DailyDigestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [slice, setSlice] = useState<Slice | null>(null)
  // Briefly ringed after a deep link, so the reader's eye lands on the row the
  // notification was about rather than on whatever is at that scroll position.
  const [flash, setFlash] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Which target has already been applied, so the row does not snap back open
  // every time the digest reloads after a reply. A plain boolean would have
  // stopped at the first arrival and ignored every notification opened after it.
  const deepLinked = useRef<number | null>(null)

  /**
   * `silent` re-reads the day without swapping the page for the skeleton. Reply
   * and acknowledge do this: replacing the whole page for a one-row change loses
   * the reader's scroll position, so answering an update halfway down the list
   * would throw them back to the top.
   */
  const load = (forDate: string, silent = false) => {
    if (!silent) setLoading(true)
    api
      .get('/daily-updates/digest', { params: { date: forDate } })
      .then((r) => setDigest(r.data))
      .catch((err) =>
        toast.error(err?.response?.data?.detail ?? 'Could not load the digest.'),
      )
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    setSlice(null)
    setExpanded(null)
    load(date)
  }, [date])

  useEffect(() => {
    if (!digest || targetId === null || deepLinked.current === targetId) return
    // The person may not be on this day at all - a stale link, or the digest for
    // the previous day still on screen while the new one loads. Leave the page
    // alone and stay unmarked, so the arrival still applies once its day lands.
    if (!digest.updates.some((u) => u.id === targetId)) return
    deepLinked.current = targetId
    setSlice(null)
    setExpanded(targetId)
    // Scrolling is left to the row itself. This effect runs on the commit where
    // `digest` has arrived but `loading` is still true, so the page is showing
    // its skeleton and the row does not exist in the DOM yet - looking it up
    // here finds nothing and the scroll is silently lost, which is why the row
    // used to open without the page ever moving.
    setFlash(targetId)
  }, [digest, targetId])

  // Leaving the target behind - stepping the day, or arriving with no target at
  // all - clears the guard, so opening that same notification again still works.
  useEffect(() => {
    if (targetId === null) deepLinked.current = null
  }, [targetId])

  // Drop the ring once it has done its job. In its own effect so that a silent
  // reload of the digest cannot cut it short.
  useEffect(() => {
    if (flash === null) return
    const clear = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(clear)
  }, [flash])

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

  const { remind, review } = useDigestActions(() => load(date, true))

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
                  flash={flash === update.id}
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

function UpdateRow({
  update,
  open,
  flash,
  onToggle,
  onReview,
}: {
  update: DailyUpdate
  open: boolean
  flash?: boolean
  onToggle: () => void
  onReview: (id: number, note: string | null) => void
}) {
  const [note, setNote] = useState('')
  const rowRef = useRef<HTMLLIElement>(null)

  // Runs when this row is actually mounted, which is the only moment the scroll
  // can succeed. `open` is set in the same batch, so by now the row has its full
  // expanded height and `center` lands on the real middle of it.
  //
  // Deliberately not smooth: the reader is arriving from a notification, so they
  // already know what they clicked and an animation only makes them watch the
  // page travel. Landing on the row is the point, and it is the behaviour that
  // survives a competing scroll or reduced-motion settings.
  useEffect(() => {
    if (!flash) return
    rowRef.current?.scrollIntoView({ block: 'center' })
  }, [flash])

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
    <li
      ref={rowRef}
      id={`update-${update.id}`}
      className={cn(
        'py-3 first:pt-0 last:pb-0 transition-colors duration-500',
        flash && 'bg-primary-50/70 ring-1 ring-primary-200 rounded-lg px-3 -mx-3'
      )}
    >
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
            <>
              {/* Say plainly that this one has been acknowledged, and by whom.
                  Without it the only trace after a reload is the small tick in
                  the header, and the row reads as though the click never took. */}
              {update.reviewed_at && (
                <p className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Seen by {update.reviewed_by_name ?? 'you'} · {formatDateTime(update.reviewed_at)}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    update.reviewed_at ? 'Add a reply (optional)' : 'Reply to this update (optional)'
                  }
                  className="flex-1 min-w-[200px] text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  type="button"
                  // Once it is seen, the only thing left to send is a reply -
                  // so an empty box has nothing to do rather than re-stamping
                  // the acknowledgement it already carries.
                  disabled={!!update.reviewed_at && !note.trim()}
                  onClick={() => onReview(update.id, note.trim() || null)}
                  className="text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400 px-3 py-1.5 rounded-lg"
                >
                  {note.trim() || update.reviewed_at ? 'Send reply' : 'Mark seen'}
                </button>
              </div>
            </>
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
