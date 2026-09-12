import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Info,
  MessageSquare,
  Phone,
  Trophy,
  Users,
} from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { required, type Rules } from '@/lib/validation'
import { StatCard, DashboardSkeleton, Panel, type Tone } from '@/pages/dashboard/StatCard'
import { formatDate } from '@/lib/utils'
import type {
  DailyUpdate as DailyUpdateRow,
  DailyUpdateMetrics,
  DailyUpdateToday,
  WorkMode,
} from '@/types'

const WORK_MODES: Array<{ value: WorkMode; label: string }> = [
  { value: 'office', label: 'In office' },
  { value: 'field', label: 'Field visits' },
  { value: 'travel', label: 'Travelling' },
  { value: 'wfh', label: 'Working from home' },
  { value: 'leave', label: 'On leave' },
]

interface FormState {
  work_mode: string
  highlights: string
  blockers: string
  support_needed: string
  plan_tomorrow: string
  needs_escalation: boolean
  escalation_note: string
  manual_visits: string
  manual_meetings: string
}

const EMPTY_FORM: FormState = {
  work_mode: 'office',
  highlights: '',
  blockers: '',
  support_needed: '',
  plan_tomorrow: '',
  needs_escalation: false,
  escalation_note: '',
  manual_visits: '',
  manual_meetings: '',
}

const RULES: Rules<FormState> = {
  highlights: (value, form) =>
    form.work_mode === 'leave' || value.trim()
      ? undefined
      : 'Say what moved today, even if it was a quiet one.',
  // Flagging an escalation without saying what it is gives leadership nothing
  // to act on, which defeats the point of the flag.
  escalation_note: (value, form) =>
    form.needs_escalation && !value.trim()
      ? 'Describe what you need leadership to decide or unblock.'
      : undefined,
}

function toForm(row: DailyUpdateRow): FormState {
  return {
    work_mode: row.work_mode ?? 'office',
    highlights: row.highlights ?? '',
    blockers: row.blockers ?? '',
    support_needed: row.support_needed ?? '',
    plan_tomorrow: row.plan_tomorrow ?? '',
    needs_escalation: row.needs_escalation,
    escalation_note: row.escalation_note ?? '',
    manual_visits: row.manual_visits ? String(row.manual_visits) : '',
    manual_meetings: row.manual_meetings ? String(row.manual_meetings) : '',
  }
}

/** The counts worth showing, per flavour of update. */
function metricCards(
  kind: string,
  metrics: DailyUpdateMetrics,
): Array<{ icon: React.ElementType; label: string; value: number; tone: Tone }> {
  if (kind === 'coordinator') {
    return [
      { icon: CheckCircle2, label: 'Trainings completed', value: metrics.trainings_completed ?? 0, tone: 'teal' },
      { icon: Users, label: 'Newly enrolled', value: metrics.trainings_enrolled ?? 0, tone: 'sky' },
      { icon: CalendarCheck, label: 'Modules added', value: metrics.modules_added ?? 0, tone: 'violet' },
      { icon: AlertTriangle, label: 'Students at risk', value: metrics.students_at_risk ?? 0, tone: 'amber' },
    ]
  }
  return [
    { icon: Phone, label: 'Calls', value: metrics.calls ?? 0, tone: 'blue' },
    { icon: MessageSquare, label: 'Emails & messages', value: (metrics.emails ?? 0) + (metrics.whatsapp ?? 0) + (metrics.linkedin ?? 0), tone: 'sky' },
    { icon: Users, label: 'Meetings', value: metrics.meetings ?? 0, tone: 'violet' },
    { icon: Building2, label: 'Companies touched', value: metrics.companies_touched ?? 0, tone: 'teal' },
    { icon: CalendarCheck, label: 'Drives conducted', value: metrics.drives_conducted ?? 0, tone: 'amber' },
    { icon: Trophy, label: 'Offers', value: metrics.offers ?? 0, tone: 'rose' },
  ]
}

export default function DailyUpdate() {
  const toast = useToast()
  const confirm = useConfirm()
  const { formRef, errors, clearError, validate } = useFieldErrors<FormState>()

  const [today, setToday] = useState<DailyUpdateToday | null>(null)
  const [history, setHistory] = useState<DailyUpdateRow[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notAFiler, setNotAFiler] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = () => {
    setLoading(true)
    api
      .get('/daily-updates/today')
      .then((r) => {
        const data: DailyUpdateToday = r.data
        setToday(data)
        setForm(data.existing ? toForm(data.existing) : EMPTY_FORM)
        setEditing(!data.existing)
      })
      .catch((err) => {
        if (err?.response?.status === 404) setNotAFiler(true)
        else toast.error(err?.response?.data?.detail ?? 'Could not load today’s update.')
      })
      .finally(() => setLoading(false))
    api.get('/daily-updates/mine', { params: { limit: 7 } }).then((r) => setHistory(r.data))
  }

  useEffect(load, [])

  const update = (field: keyof FormState, value: string | boolean) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate(RULES, form)) return
    setSaving(true)
    const body = {
      work_mode: form.work_mode,
      highlights: form.highlights.trim() || null,
      blockers: form.blockers.trim() || null,
      support_needed: form.support_needed.trim() || null,
      plan_tomorrow: form.plan_tomorrow.trim() || null,
      needs_escalation: form.needs_escalation,
      escalation_note: form.needs_escalation ? form.escalation_note.trim() || null : null,
      manual_visits: Number(form.manual_visits) || 0,
      manual_meetings: Number(form.manual_meetings) || 0,
    }
    try {
      if (today?.existing) {
        await api.put(`/daily-updates/${today.existing.id}`, body)
        toast.success('Update saved.')
      } else {
        await api.post('/daily-updates', body)
        toast.success('Update filed. Leadership will see it in today’s digest.')
      }
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save your update. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = async () => {
    const original = today?.existing ? toForm(today.existing) : EMPTY_FORM
    if (JSON.stringify(form) !== JSON.stringify(original)) {
      const discard = await confirm({
        title: 'Discard your changes?',
        message: 'The edits you have made to this update will be lost.',
        confirmLabel: 'Discard',
        tone: 'warning',
      })
      if (!discard) return
    }
    setForm(original)
    setEditing(false)
  }

  if (notAFiler) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
        <Info className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm font-medium text-gray-900">Daily updates aren&rsquo;t filed from this account</p>
        <p className="mt-1 text-sm text-gray-500">
          They come from placement officers and department coordinators. If you lead the team,
          the roll-up is on the{' '}
          <Link to="/daily-digest" className="text-primary-600 hover:underline">
            Daily Digest
          </Link>{' '}
          page.
        </p>
      </div>
    )
  }

  if (loading || !today) return <DashboardSkeleton cards={4} panels={1} />

  const existing = today.existing
  const onLeave = form.work_mode === 'leave'
  const cards = metricCards(today.kind, today.derived)

  return (
    <div className="space-y-6">
      {/* Status bar: what day this is, when it is due, and where it stands. */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Update for {formatDate(today.date)}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Due by {today.cutoff}
            {today.deadline_passed && !existing && (
              <span className="text-amber-600 font-medium">&middot; past the cutoff</span>
            )}
          </p>
        </div>
        {existing ? (
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                existing.status === 'late'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-teal-50 text-teal-700'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              Filed{existing.status === 'late' ? ' late' : ' on time'}
            </span>
            {!editing && existing.can_edit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm font-medium text-primary-600 hover:text-primary-700 px-3 py-1.5 rounded-lg hover:bg-primary-50"
              >
                Edit
              </button>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            Not filed yet
          </span>
        )}
      </div>

      {/* The half nobody has to type. */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Recorded today</h3>
          <p className="text-xs text-gray-500">
            From what you&rsquo;ve logged &mdash;{' '}
            <Link to="/communications" className="text-primary-600 hover:underline">
              log anything missing
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map((card) => (
            <StatCard
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              tone={card.tone}
            />
          ))}
        </div>
        {today.prompts.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {today.prompts.map((prompt) => (
              <li
                key={prompt}
                className="inline-flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                <span>{prompt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The half only a person can write. */}
      {editing ? (
        <form
          ref={formRef}
          onSubmit={submit}
          noValidate
          className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Your notes</h3>
            <p className="text-xs text-gray-500">Only you and leadership see this</p>
          </div>

          <Field label="Where you worked" name="work_mode">
            {(p) => (
              <select
                {...p}
                value={form.work_mode}
                onChange={(e) => update('work_mode', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
              >
                {WORK_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {onLeave ? (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5">
              Marked as on leave &mdash; you won&rsquo;t be counted as a non-filer for today.
            </p>
          ) : (
            <>
              <Field
                label="What moved today"
                name="highlights"
                required
                error={errors.highlights}
                hint="Wins, confirmations, anything leadership would want to know."
              >
                {(p) => (
                  <textarea
                    {...p}
                    rows={3}
                    value={form.highlights}
                    onChange={(e) => update('highlights', e.target.value)}
                    className={inputClass(!!errors.highlights)}
                    placeholder="Infosys confirmed a 12 Oct slot; TCS HR asked for the updated branch list."
                  />
                )}
              </Field>

              <Field label="Anything stuck" name="blockers" optional>
                {(p) => (
                  <textarea
                    {...p}
                    rows={2}
                    value={form.blockers}
                    onChange={(e) => update('blockers', e.target.value)}
                    className={inputClass(false)}
                    placeholder="Waiting on the seating plan before Wipro will confirm."
                  />
                )}
              </Field>

              <Field label="Plan for tomorrow" name="plan_tomorrow" optional>
                {(p) => (
                  <textarea
                    {...p}
                    rows={2}
                    value={form.plan_tomorrow}
                    onChange={(e) => update('plan_tomorrow', e.target.value)}
                    className={inputClass(false)}
                    placeholder="Two follow-up calls, campus visit to Bosch."
                  />
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Visits not yet logged" name="manual_visits" optional compact>
                  {(p) => (
                    <input
                      {...p}
                      type="number"
                      min={0}
                      value={form.manual_visits}
                      onChange={(e) => update('manual_visits', e.target.value)}
                      className={inputClass(false, 'px-3 py-2')}
                    />
                  )}
                </Field>
                <Field label="Meetings not yet logged" name="manual_meetings" optional compact>
                  {(p) => (
                    <input
                      {...p}
                      type="number"
                      min={0}
                      value={form.manual_meetings}
                      onChange={(e) => update('manual_meetings', e.target.value)}
                      className={inputClass(false, 'px-3 py-2')}
                    />
                  )}
                </Field>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.needs_escalation}
                    onChange={(e) => update('needs_escalation', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>
                    <span className="font-medium">Needs leadership attention</span>
                    <span className="block text-xs text-gray-500">
                      Flagged at the top of today&rsquo;s digest.
                    </span>
                  </span>
                </label>

                {form.needs_escalation && (
                  <Field
                    label="What do you need decided?"
                    name="escalation_note"
                    required
                    error={errors.escalation_note}
                  >
                    {(p) => (
                      <textarea
                        {...p}
                        rows={2}
                        value={form.escalation_note}
                        onChange={(e) => update('escalation_note', e.target.value)}
                        className={inputClass(!!errors.escalation_note)}
                        placeholder="Infosys wants 200 seats; we can offer 80. Need a call on whether to split the drive."
                      />
                    )}
                  </Field>
                )}

                <Field label="Support needed" name="support_needed" optional>
                  {(p) => (
                    <textarea
                      {...p}
                      rows={2}
                      value={form.support_needed}
                      onChange={(e) => update('support_needed', e.target.value)}
                      className={inputClass(false)}
                      placeholder="Transport for the Bosch visit on Friday."
                    />
                  )}
                </Field>
              </div>
            </>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
            >
              {saving ? 'Saving…' : existing ? 'Save changes' : 'File update'}
            </button>
            {existing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        existing && <FiledSummary update={existing} />
      )}

      <Panel title="Your recent updates">
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing filed yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((row) => (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-900">
                    {formatDate(row.report_date)}
                  </span>
                  <div className="flex items-center gap-2">
                    {row.work_mode === 'leave' && (
                      <span className="text-xs text-gray-500">On leave</span>
                    )}
                    {row.reviewed_at && (
                      <span className="inline-flex items-center gap-1 text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Seen
                      </span>
                    )}
                    {row.status && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          row.status === 'late'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {row.status === 'late' ? 'Late' : 'On time'}
                      </span>
                    )}
                  </div>
                </div>
                {row.highlights && (
                  <p className="mt-1 text-sm text-gray-600 line-clamp-2">{row.highlights}</p>
                )}
                {row.review_note && (
                  <p className="mt-2 text-sm text-gray-800 bg-primary-50 border-l-2 border-primary-400 pl-3 py-1.5 rounded-r">
                    <span className="font-medium">{row.reviewed_by_name ?? 'Leadership'}:</span>{' '}
                    {row.review_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

/** Read-only rendering of an update that has already been filed. */
function FiledSummary({ update }: { update: DailyUpdateRow }) {
  const sections: Array<[string, string | undefined]> = [
    ['What moved today', update.highlights],
    ['Stuck on', update.blockers],
    ['Plan for tomorrow', update.plan_tomorrow],
    ['Support needed', update.support_needed],
  ]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-4">
      {update.needs_escalation && update.escalation_note && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            Flagged for leadership
          </p>
          <p className="mt-1 text-sm text-amber-900">{update.escalation_note}</p>
        </div>
      )}
      {sections.map(([label, value]) =>
        value ? (
          <div key={label}>
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-line">{value}</p>
          </div>
        ) : null,
      )}
      {update.review_note && (
        <p className="text-sm text-gray-800 bg-primary-50 border-l-2 border-primary-400 pl-3 py-2 rounded-r">
          <span className="font-medium">{update.reviewed_by_name ?? 'Leadership'}:</span>{' '}
          {update.review_note}
        </p>
      )}
    </div>
  )
}
