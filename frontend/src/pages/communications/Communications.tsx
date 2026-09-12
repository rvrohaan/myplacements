import { useEffect, useState } from 'react'
import { Plus, Mail, Phone, MessageCircle, Users, Linkedin, Trash2, Clock, AlertTriangle, UserCircle2 } from 'lucide-react'
import api from '@/lib/api'
import type { Communication, CommunicationType, Company, HRContact, Officer, UserRole } from '@/types'
import { cn, STATUS_COLORS, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-context'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { required, type Rules } from '@/lib/validation'

const TYPE_ICON: Record<CommunicationType, typeof Mail> = {
  email: Mail,
  call: Phone,
  whatsapp: MessageCircle,
  meeting: Users,
  linkedin: Linkedin,
}

const RESPONSE_LABEL: Record<string, string> = {
  awaited: 'Awaiting reply',
  received: 'Replied',
  no_response: 'No response',
}

// Shown next to the author so a head can tell an officer's log from a peer's.
const ROLE_LABEL: Partial<Record<UserRole, string>> = {
  super_admin: 'Platform admin',
  principal: 'Principal',
  pro_chancellor: 'Pro Chancellor',
  deputy_pro_chancellor: 'Deputy Pro Chancellor',
  placement_officer: 'Placement Officer',
  department_coordinator: 'Department Coordinator',
}

// Roles that oversee the whole team and get the by-officer filter.
const HEAD_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

export default function Communications() {
  const { user } = useAuthStore()
  const toast = useToast()
  const confirm = useConfirm()
  const isHead = !!user && HEAD_ROLES.includes(user.role)

  const [tab, setTab] = useState<'timeline' | 'followups'>('timeline')
  const [items, setItems] = useState<Communication[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [officers, setOfficers] = useState<Officer[]>([])
  const [loading, setLoading] = useState(true)
  const [companyFilter, setCompanyFilter] = useState('')
  const [officerFilter, setOfficerFilter] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const fetchItems = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (officerFilter) params.officer_id = officerFilter
    if (tab === 'followups') {
      api.get('/communications/followups', { params }).then((r) => setItems(r.data)).finally(() => setLoading(false))
    } else {
      if (companyFilter) params.company_id = companyFilter
      api.get('/communications', { params }).then((r) => setItems(r.data)).finally(() => setLoading(false))
    }
  }

  useEffect(() => { fetchItems() }, [tab, companyFilter, officerFilter])
  useEffect(() => {
    api.get('/companies', { params: { limit: 200 } }).then((r) => setCompanies(r.data)).catch(() => {})
  }, [])
  useEffect(() => {
    // Only leadership can filter by officer; an officer's list holds just themselves.
    if (!isHead) return
    api.get('/officers').then((r) => setOfficers(r.data)).catch(() => {})
  }, [isHead])

  const isOverdue = (d?: string) => !!d && new Date(d) < new Date()

  const markReplied = async (c: Communication) => {
    try {
      await api.put(`/communications/${c.id}`, { response_received: 'received' })
      toast.success('Marked as replied')
      fetchItems()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not update this communication')
    }
  }

  const requestDelete = async (c: Communication) => {
    const ok = await confirm({
      title: 'Delete this communication?',
      message: (
        <>
          The log against{' '}
          <span className="font-medium text-gray-800">{c.company_name ?? `Company #${c.company_id}`}</span>
          {c.logged_by_name ? (
            <>
              {' '}by <span className="font-medium text-gray-800">{c.logged_by_name}</span>
            </>
          ) : null}{' '}
          will be removed from the timeline. This can’t be undone.
        </>
      ),
      confirmLabel: 'Delete communication',
      tone: 'danger',
    })
    if (!ok) return
    setDeletingId(c.id)
    try {
      await api.delete(`/communications/${c.id}`)
      toast.success('Communication deleted')
      fetchItems()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not delete this communication. Try again.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {(['timeline', 'followups'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                tab === t ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {t === 'timeline' ? 'Timeline' : 'Pending follow-ups'}
            </button>
          ))}
          {tab === 'timeline' && (
            <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
              <option value="">All companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {isHead && (
            <select
              value={officerFilter}
              onChange={(e) => setOfficerFilter(e.target.value)}
              aria-label="Filter by officer"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
            >
              <option value="">All officers</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.officer_name ?? `Officer #${o.id}`}</option>)}
            </select>
          )}
        </div>
        <button onClick={() => setShowLog(true)} className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors">
          <Plus className="w-4 h-4" /> Log Communication
        </button>
      </div>

      {showLog && (
        <LogForm companies={companies} onClose={() => setShowLog(false)} onSaved={() => { setShowLog(false); toast.success('Communication logged'); fetchItems() }} />
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            {tab === 'followups' ? 'No pending follow-ups. 🎉' : 'No communications logged yet.'}
          </div>
        ) : (
          items.map((c) => {
            const Icon = TYPE_ICON[c.comm_type] ?? Mail
            return (
              <div key={c.id} className="flex items-start gap-3 p-4">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{c.company_name ?? `Company #${c.company_id}`}</span>
                    {c.hr_contact_name && <span className="text-xs text-gray-500">· {c.hr_contact_name}</span>}
                    <span className="text-xs text-gray-400 capitalize">· {c.comm_type}</span>
                    {c.response_received && (
                      <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[c.response_received] ?? 'bg-gray-100 text-gray-700')}>
                        {RESPONSE_LABEL[c.response_received] ?? c.response_received}
                      </span>
                    )}
                  </div>
                  {c.subject && <p className="text-sm text-gray-700 mt-0.5">{c.subject}</p>}
                  {c.notes && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{c.notes}</p>}
                  <Attribution comm={c} />
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                    <span>{formatDate(c.communicated_at)}</span>
                    {c.next_followup_date && (
                      <span className={cn('flex items-center gap-1', isOverdue(c.next_followup_date) ? 'text-red-500 font-medium' : '')}>
                        {isOverdue(c.next_followup_date) ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        follow up {formatDate(c.next_followup_date)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.can_edit && c.response_received !== 'received' && (
                    <button onClick={() => markReplied(c)} className="text-xs text-primary-600 hover:text-primary-800 font-medium">Mark replied</button>
                  )}
                  {c.can_edit && (
                    <button onClick={() => requestDelete(c)} disabled={deletingId === c.id} title="Delete" aria-label="Delete communication" className="text-gray-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}

/** Who logged the entry. Entries predating authorship show as unattributed
 *  rather than silently borrowing the company's officer. */
function Attribution({ comm }: { comm: Communication }) {
  const role = comm.logged_by_role ? ROLE_LABEL[comm.logged_by_role] : undefined
  // The officer credited for the outreach, when that isn't the author (a
  // backfilled entry has an officer but no recorded author).
  const creditedElsewhere = comm.officer_name && comm.officer_name !== comm.logged_by_name

  return (
    <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-gray-500">
      <UserCircle2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      {comm.logged_by_name ? (
        <span>
          Logged by <span className="font-medium text-gray-700">{comm.logged_by_name}</span>
          {role && <span className="text-gray-400"> · {role}</span>}
        </span>
      ) : (
        <span className="italic text-gray-400">Author not recorded</span>
      )}
      {creditedElsewhere && (
        <span className="text-gray-400">
          · credited to {comm.officer_name}
          {comm.officer_attribution === 'inferred' && ' (from company allocation)'}
        </span>
      )}
    </div>
  )
}

type LogFormState = {
  company_id: string
  hr_contact_id: string
  comm_type: CommunicationType
  subject: string
  notes: string
  response_received: string
  next_followup_date: string
  communicated_at: string
}

const EMPTY_LOG_FORM: LogFormState = {
  company_id: '',
  hr_contact_id: '',
  comm_type: 'email',
  subject: '',
  notes: '',
  response_received: 'awaited',
  next_followup_date: '',
  communicated_at: '',
}

const LOG_RULES: Rules<LogFormState> = {
  company_id: required('Choose which company this was with.'),
  // A follow-up already in the past would never surface in the pending list.
  next_followup_date: (value) =>
    value && new Date(value) < new Date()
      ? 'That follow-up date has already passed. Pick a future date.'
      : undefined,
}

function LogForm({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [contacts, setContacts] = useState<HRContact[]>([])
  const [form, setForm] = useState<LogFormState>(EMPTY_LOG_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()
  const { formRef, errors, clearError, validate } = useFieldErrors<LogFormState>()

  const set = (field: keyof LogFormState, value: string) => {
    clearError(field)
    setForm((p) => ({ ...p, [field]: value }))
  }
  /** Inline panels get the same unsaved-changes guard as the modal forms. */
  const cancel = async () => {
    const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_LOG_FORM)
    if (dirty) {
      const discard = await confirm({
        title: 'Discard your changes?',
        message: 'You haven’t saved what you typed yet. Closing this form now will lose it.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        tone: 'warning',
      })
      if (!discard) return
    }
    onClose()
  }


  useEffect(() => {
    if (!form.company_id) { setContacts([]); return }
    api.get(`/companies/${form.company_id}/hr-contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]))
  }, [form.company_id])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(LOG_RULES, form)) return
    setSubmitting(true)
    try {
      // Authorship is stamped server-side from the session, so nothing to send.
      await api.post('/communications', {
        company_id: parseInt(form.company_id),
        hr_contact_id: form.hr_contact_id ? parseInt(form.hr_contact_id) : null,
        comm_type: form.comm_type,
        subject: form.subject || null,
        notes: form.notes || null,
        response_received: form.response_received || null,
        next_followup_date: form.next_followup_date || null,
        communicated_at: form.communicated_at || null,
      })
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Could not log this communication. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">Log Communication</h3>
      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field compact label="Company" name="company_id" required error={errors.company_id}>
          {(p) => (
            <select
              {...p}
              value={form.company_id}
              onChange={(e) => {
                clearError('company_id')
                setForm((prev) => ({ ...prev, company_id: e.target.value, hr_contact_id: '' }))
              }}
              className={inputClass(!!errors.company_id, 'px-3 py-2')}
            >
              <option value="" disabled>Select a company…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Field>
        <Field
          compact
          label="HR contact"
          name="hr_contact_id"
          optional
          hint={form.company_id ? undefined : 'Pick a company first'}
        >
          {(p) => (
            <select
              {...p}
              value={form.hr_contact_id}
              onChange={(e) => set('hr_contact_id', e.target.value)}
              className={inputClass(false, 'px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500')}
              disabled={!form.company_id}
            >
              <option value="">— none —</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Field>
        <Field compact label="Channel" name="comm_type">
          {(p) => (
            <select
              {...p}
              value={form.comm_type}
              onChange={(e) => set('comm_type', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
            >
              <option value="email">Email</option>
              <option value="call">Call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="meeting">Meeting</option>
              <option value="linkedin">LinkedIn</option>
            </select>
          )}
        </Field>
        <Field compact label="Response" name="response_received">
          {(p) => (
            <select
              {...p}
              value={form.response_received}
              onChange={(e) => set('response_received', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
            >
              <option value="awaited">Awaiting reply</option>
              <option value="received">Replied</option>
              <option value="no_response">No response</option>
            </select>
          )}
        </Field>
        <Field compact className="sm:col-span-2" label="Subject" name="subject" optional>
          {(p) => (
            <input
              {...p}
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="e.g. Campus drive proposal for 2026 batch"
            />
          )}
        </Field>
        <Field compact className="sm:col-span-2" label="Notes" name="notes" optional>
          {(p) => (
            <textarea
              {...p}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              className={inputClass(false, 'px-3 py-2')}
            />
          )}
        </Field>
        <Field compact label="Communicated on" name="communicated_at" optional hint="Defaults to now">
          {(p) => (
            <input
              {...p}
              type="datetime-local"
              value={form.communicated_at}
              onChange={(e) => set('communicated_at', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
            />
          )}
        </Field>
        <Field compact label="Next follow-up" name="next_followup_date" optional error={errors.next_followup_date}>
          {(p) => (
            <input
              {...p}
              type="datetime-local"
              value={form.next_followup_date}
              onChange={(e) => set('next_followup_date', e.target.value)}
              className={inputClass(!!errors.next_followup_date, 'px-3 py-2')}
            />
          )}
        </Field>
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={cancel} className="min-h-[44px] px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2">Cancel</button>
          <button type="submit" disabled={submitting} className="min-h-[44px] px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
            {submitting ? 'Saving…' : 'Log'}
          </button>
        </div>
      </form>
    </div>
  )
}
