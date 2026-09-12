import { useEffect, useState } from 'react'
import { Plus, UserPlus, Target, Briefcase, MapPin, Pencil, Trash2, ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import fetchAll from '@/lib/fetchAll'
import { useAuthStore } from '@/store/authStore'
import type { Officer, Assignment, AssignmentStatus, Company, UserRole } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm'
import { useToast } from '@/components/ui/toast'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { numberBetween, required, type Rules } from '@/lib/validation'
import EditOfficerModal from './EditOfficerModal'

type OfficerForm = {
  user_id: string
  region: string
  sector_expertise: string
  target_companies: string
  target_offers: string
}

const EMPTY_OFFICER_FORM: OfficerForm = {
  user_id: '',
  region: '',
  sector_expertise: '',
  target_companies: '',
  target_offers: '',
}

const OFFICER_RULES: Rules<OfficerForm> = {
  user_id: required('Pick the staff member who will act as this officer.'),
  target_companies: numberBetween(0, 9999, 'Enter a whole number of companies, 0 or more.', {
    integer: true,
  }),
  target_offers: numberBetween(0, 9999, 'Enter a whole number of offers, 0 or more.', { integer: true }),
}

const STATUS_FLOW: AssignmentStatus[] = ['active', 'accepted', 'escalated', 'completed']
// Roles allowed to manage allocations — mirrors the backend's MANAGE_ROLES.
const MANAGE_ROLES: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']
// Plain-language meaning of each workflow status, shown as a tooltip on the badge.
const STATUS_HELP: Record<AssignmentStatus, string> = {
  active: 'Active — newly assigned, awaiting the officer',
  accepted: 'Accepted — the officer has taken ownership',
  escalated: 'Escalated — a blocker was raised to the placement head',
  completed: 'Completed — work on this company is done',
}

// Lightweight hover tooltip (no extra deps) used on the allocation icons/badges.
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/tip:opacity-100">
        {label}
      </span>
    </span>
  )
}

export default function Officers() {
  const role = useAuthStore((s) => s.user?.role)
  const canManage = !!role && MANAGE_ROLES.includes(role)
  const [officers, setOfficers] = useState<Officer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Officer | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Officer | null>(null)

  const fetchOfficers = () => {
    setLoading(true)
    api.get('/officers').then((r) => setOfficers(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchOfficers() }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{officers.length} placement officer{officers.length === 1 ? '' : 's'}</p>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Add Officer
          </button>
        )}
      </div>

      {showAdd && canManage && <AddOfficerForm onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchOfficers() }} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-10 text-gray-400">Loading officers...</div>
        ) : officers.length === 0 ? (
          <div className="col-span-3 text-center py-10 text-gray-400">
            No placement officers yet. Add a staff member with the “placement officer” role.
          </div>
        ) : (
          officers.map((o) => (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              aria-label={`View allocations for ${o.officer_name ?? `Officer #${o.id}`}`}
              onClick={() => setSelected(o)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelected(o)
                }
              }}
              className={cn(
                'text-left bg-white rounded-xl border p-4 space-y-3 cursor-pointer transition hover:border-primary-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                selected?.id === o.id ? 'border-primary-400 ring-1 ring-primary-200' : 'border-gray-200'
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{o.officer_name ?? `Officer #${o.id}`}</p>
                  <p className="text-xs text-gray-500">{o.email}</p>
                </div>
                <div className="flex items-start gap-1.5">
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary-600">{o.active_count}</p>
                    <p className="text-[10px] uppercase text-gray-400">active</p>
                  </div>
                  {canManage && (
                    <Tip label="Edit details & targets">
                      <button
                        type="button"
                        aria-label={`Edit ${o.officer_name ?? `officer #${o.id}`}`}
                        onClick={(e) => {
                          // The card itself opens the allocation panel.
                          e.stopPropagation()
                          setEditing(o)
                        }}
                        className="p-1.5 rounded-md text-gray-400 transition-colors hover:bg-primary-50 hover:text-primary-600"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Tip>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                {o.region && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{o.region}</span>}
                {o.sector_expertise && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{o.sector_expertise}</span>}
                <span className="flex items-center gap-1"><Target className="w-3 h-3" />{o.target_companies} co · {o.target_offers} offers</span>
              </div>
              <div className="text-xs text-gray-500 border-t border-gray-100 pt-2">
                {o.assignment_count} compan{o.assignment_count === 1 ? 'y' : 'ies'} assigned
              </div>
            </div>
          ))
        )}
      </div>

      {editing && canManage && (
        <EditOfficerModal
          officer={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setOfficers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
            setSelected((cur) => (cur && cur.id === updated.id ? updated : cur))
          }}
        />
      )}

      {selected && (
        <AssignmentPanel
          officer={selected}
          canManage={canManage}
          onChanged={fetchOfficers}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function AddOfficerForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [users, setUsers] = useState<{ id: number; full_name: string; email: string; department?: string }[]>([])
  const [form, setForm] = useState<OfficerForm>(EMPTY_OFFICER_FORM)
  const confirm = useConfirm()
  const { formRef, errors, clearError, validate } = useFieldErrors<OfficerForm>()

  const set = (field: keyof OfficerForm, value: string) => {
    clearError(field)
    setForm((p) => ({ ...p, [field]: value }))
  }
  /** Inline panels get the same unsaved-changes guard as the modal forms. */
  const cancel = async () => {
    const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_OFFICER_FORM)
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

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/officers/assignable-users').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(OFFICER_RULES, form)) return
    setSubmitting(true)
    try {
      await api.post('/officers', {
        user_id: parseInt(form.user_id),
        region: form.region || null,
        sector_expertise: form.sector_expertise || null,
        target_companies: form.target_companies ? parseInt(form.target_companies) : 0,
        target_offers: form.target_offers ? parseInt(form.target_offers) : 0,
      })
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Could not add this officer. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-800 mb-4">Add Placement Officer</h3>
      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={submit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          compact
          className="sm:col-span-2"
          label="Staff member"
          name="user_id"
          required
          error={errors.user_id}
          hint={
            users.length === 0
              ? 'No eligible staff. Create a user with the “placement officer” role on the People tab first.'
              : undefined
          }
        >
          {(p) => (
            <select
              {...p}
              value={form.user_id}
              onChange={(e) => set('user_id', e.target.value)}
              className={inputClass(!!errors.user_id, 'px-3 py-2')}
            >
              <option value="" disabled>Select a staff member…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} · {u.email}</option>
              ))}
            </select>
          )}
        </Field>
        <Field compact label="Region" name="region" optional>
          {(p) => (
            <input
              {...p}
              value={form.region}
              onChange={(e) => set('region', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="e.g. South"
            />
          )}
        </Field>
        <Field compact label="Sector expertise" name="sector_expertise" optional>
          {(p) => (
            <input
              {...p}
              value={form.sector_expertise}
              onChange={(e) => set('sector_expertise', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="e.g. IT, Core"
            />
          )}
        </Field>
        <Field compact label="Target companies" name="target_companies" optional error={errors.target_companies}>
          {(p) => (
            <input
              {...p}
              type="number"
              min="0"
              inputMode="numeric"
              value={form.target_companies}
              onChange={(e) => set('target_companies', e.target.value)}
              className={inputClass(!!errors.target_companies, 'px-3 py-2')}
            />
          )}
        </Field>
        <Field compact label="Target offers" name="target_offers" optional error={errors.target_offers}>
          {(p) => (
            <input
              {...p}
              type="number"
              min="0"
              inputMode="numeric"
              value={form.target_offers}
              onChange={(e) => set('target_offers', e.target.value)}
              className={inputClass(!!errors.target_offers, 'px-3 py-2')}
            />
          )}
        </Field>
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={cancel} className="min-h-[44px] px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2">Cancel</button>
          <button type="submit" disabled={submitting} className="min-h-[44px] px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
            {submitting ? 'Saving…' : 'Add Officer'}
          </button>
        </div>
      </form>
    </div>
  )
}

function AssignmentPanel({ officer, canManage, onChanged, onClose }: { officer: Officer; canManage: boolean; onChanged: () => void; onClose: () => void }) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState('')
  const [priority, setPriority] = useState('normal')
  const [assigning, setAssigning] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  const fetchAssignments = () => {
    setLoading(true)
    api.get(`/officers/${officer.id}/assignments`).then((r) => setAssignments(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchAssignments()
    // Only unassigned companies are pickable — a company has a single owner, so
    // companies already allocated to another officer must not appear here.
    fetchAll<Company>('/companies', { unassigned: true }).then(setCompanies).catch(() => {})
  }, [officer.id])

  // Backend already excludes globally-assigned companies; this also drops any
  // just assigned in this panel before the unassigned list is refetched.
  const assigned = new Set(assignments.map((a) => a.company_id))
  const available = companies.filter((c) => !assigned.has(c.id))

  const assign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
    setAssigning(true)
    try {
      await api.post(`/officers/${officer.id}/assignments`, { company_id: parseInt(companyId), priority })
      setCompanyId('')
      toast.success('Company allocated')
      fetchAssignments()
      onChanged()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not allocate this company. Try again.')
    } finally {
      setAssigning(false)
    }
  }

  const setStatus = async (a: Assignment, status: AssignmentStatus) => {
    await api.put(`/officers/${officer.id}/assignments/${a.id}`, { status })
    fetchAssignments()
    onChanged()
  }

  const remove = async (a: Assignment) => {
    const ok = await confirm({
      title: 'Remove this allocation?',
      message: (
        <>
          <span className="font-medium text-gray-800">{a.company_name ?? `Company #${a.company_id}`}</span>{' '}
          will go back to the unassigned pool and any notes on this allocation will be lost.
          You can allocate it again afterwards.
        </>
      ),
      confirmLabel: 'Remove allocation',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/officers/${officer.id}/assignments/${a.id}`)
      toast.success('Allocation removed')
      fetchAssignments()
      onChanged()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not remove this allocation. Try again.')
    }
  }

  const saveNote = async (a: Assignment, notes: string) => {
    await api.put(`/officers/${officer.id}/assignments/${a.id}`, { notes })
    fetchAssignments()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">
          Allocation — {officer.officer_name ?? `Officer #${officer.id}`}
        </h3>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">Close</button>
      </div>

      {canManage && (
        <form onSubmit={assign} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Assign a company</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="" disabled>Select a company…</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
          <button type="submit" disabled={!companyId || assigning} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
            <Plus className="w-4 h-4" /> Assign
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-4">Loading assignments…</p>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">No companies assigned yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              a={a}
              canManage={canManage}
              onStatus={setStatus}
              onRemove={remove}
              onSaveNote={saveNote}
            />
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400">Workflow: {STATUS_FLOW.join(' → ')}. Officers accept work or escalate blockers to a placement head.</p>
    </div>
  )
}

function AssignmentRow({
  a,
  canManage,
  onStatus,
  onRemove,
  onSaveNote,
}: {
  a: Assignment
  canManage: boolean
  onStatus: (a: Assignment, status: AssignmentStatus) => void
  onRemove: (a: Assignment) => void
  onSaveNote: (a: Assignment, notes: string) => Promise<void>
}) {
  const [note, setNote] = useState(a.notes ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = note !== (a.notes ?? '')

  const save = async () => {
    setSaving(true)
    try {
      await onSaveNote(a, note)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-900">{a.company_name ?? `Company #${a.company_id}`}</p>
          <p className="text-xs text-gray-500">
            {a.company_sector ?? '—'} · priority {a.priority}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tip label={STATUS_HELP[a.status] ?? a.status}>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-700')}>
              {a.status}
            </span>
          </Tip>
          {a.status !== 'accepted' && a.status !== 'completed' && (
            <Tip label="Accept — take ownership of this company">
              <button onClick={() => onStatus(a, 'accepted')} aria-label="Accept" className="text-blue-600 hover:text-blue-800"><CheckCircle2 className="w-4 h-4" /></button>
            </Tip>
          )}
          {a.status !== 'escalated' && a.status !== 'completed' && (
            <Tip label="Escalate — flag a blocker to the placement head">
              <button onClick={() => onStatus(a, 'escalated')} aria-label="Escalate" className="text-amber-600 hover:text-amber-800"><ArrowUpCircle className="w-4 h-4" /></button>
            </Tip>
          )}
          {a.status !== 'completed' && (
            <Tip label="Mark complete — work on this company is done">
              <button onClick={() => onStatus(a, 'completed')} aria-label="Mark complete" className="text-green-600 hover:text-green-800"><CheckCircle2 className="w-4 h-4 fill-green-100" /></button>
            </Tip>
          )}
          {canManage && (
            <Tip label="Remove this allocation">
              <button onClick={() => onRemove(a)} aria-label="Remove" className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </Tip>
          )}
        </div>
      </div>

      {canManage ? (
        a.notes ? (
          <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Note from officer</p>
            <p className="text-xs text-gray-700 whitespace-pre-wrap">{a.notes}</p>
          </div>
        ) : null
      ) : (
        <div className="space-y-1">
          <label className="block text-[10px] uppercase tracking-wide text-gray-400">Note for placement head</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add a note the placement head can see…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary-300"
          />
          {dirty && (
            <div className="flex justify-end gap-3">
              <button onClick={() => setNote(a.notes ?? '')} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              <button onClick={save} disabled={saving} className="text-xs bg-primary-600 text-white px-3 py-1 rounded-md hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
