import { useState } from 'react'
import api from '@/lib/api'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { all, numberBetween, required, type Rule, type Rules } from '@/lib/validation'
import type { CompanyRole, CompanyRoleStatus, CompanyRoleType } from '@/types'

export const ROLE_TYPE_LABELS: Record<CompanyRoleType, string> = {
  full_time: 'Full-time',
  internship: 'Internship',
  internship_ppo: 'Internship + PPO',
  contract: 'Contract',
  apprenticeship: 'Apprenticeship',
}

export const ROLE_STATUS_LABELS: Record<CompanyRoleStatus, string> = {
  open: 'Open',
  on_hold: 'On hold',
  filled: 'Filled',
  closed: 'Closed',
}

/** Internships are paid a monthly stipend; everything else quotes an annual CTC. */
const STIPEND_TYPES: CompanyRoleType[] = ['internship', 'internship_ppo']

interface RoleForm {
  title: string
  role_type: CompanyRoleType
  status: CompanyRoleStatus
  ctc_min: string
  ctc_max: string
  stipend: string
  openings: string
  location: string
  work_mode: string
  eligible_branches: string
  min_cgpa: string
  max_backlogs: string
  skills: string
  apply_deadline: string
  posting_url: string
  job_description: string
  notes: string
}

const EMPTY: RoleForm = {
  title: '',
  role_type: 'full_time',
  status: 'open',
  ctc_min: '',
  ctc_max: '',
  stipend: '',
  openings: '',
  location: '',
  work_mode: '',
  eligible_branches: '',
  min_cgpa: '',
  max_backlogs: '',
  skills: '',
  apply_deadline: '',
  posting_url: '',
  job_description: '',
  notes: '',
}

/**
 * Only one compensation shape is on screen at a time, and the other keeps
 * whatever was typed before the type was switched. Skip the hidden one's rules —
 * otherwise a stale value blocks submission with an error nobody can see.
 */
function whenVisible(field: 'ctc' | 'stipend', rule: Rule<RoleForm>): Rule<RoleForm> {
  return (value, form) => {
    const showsStipend = STIPEND_TYPES.includes(form.role_type)
    if (showsStipend !== (field === 'stipend')) return undefined
    return rule(value, form)
  }
}

const RULES: Rules<RoleForm> = {
  title: required('Name the role, e.g. “Software Engineer”.'),
  ctc_min: whenVisible('ctc', numberBetween(0, 500, 'Enter the package in LPA, e.g. 6.5.')),
  ctc_max: whenVisible(
    'ctc',
    all<RoleForm>(
      numberBetween(0, 500, 'Enter the package in LPA, e.g. 12.'),
      // A range that reads backwards is almost always a slip, and it would make
      // the role card say "12 – 6.5 LPA".
      (value, form) => {
        if (!value.trim() || !form.ctc_min.trim()) return undefined
        return Number(value) < Number(form.ctc_min)
          ? 'The top of the range can’t be below the bottom.'
          : undefined
      },
    ),
  ),
  stipend: whenVisible(
    'stipend',
    numberBetween(0, 10_000_000, 'Enter the monthly stipend in rupees, e.g. 25000.'),
  ),
  openings: numberBetween(0, 100_000, 'Enter a whole number of openings.', { integer: true }),
  min_cgpa: numberBetween(0, 10, 'CGPA runs from 0 to 10.'),
  max_backlogs: numberBetween(0, 100, 'Enter a whole number of backlogs.', { integer: true }),
  posting_url: (value) => {
    if (!value.trim()) return undefined
    return /^https?:\/\/.+/i.test(value.trim())
      ? undefined
      : 'Paste the full link, starting with https://.'
  },
}

/** API value -> form string. Nulls become '' so the inputs stay controlled. */
const text = (value: string | number | undefined | null) =>
  value === undefined || value === null ? '' : String(value)

function toForm(role: CompanyRole): RoleForm {
  return {
    title: role.title,
    role_type: role.role_type,
    status: role.status,
    ctc_min: text(role.ctc_min),
    ctc_max: text(role.ctc_max),
    stipend: text(role.stipend),
    openings: text(role.openings),
    location: text(role.location),
    work_mode: text(role.work_mode),
    eligible_branches: text(role.eligible_branches),
    min_cgpa: text(role.min_cgpa),
    max_backlogs: text(role.max_backlogs),
    skills: text(role.skills),
    // The API sends an ISO timestamp; <input type="date"> wants just the date.
    apply_deadline: role.apply_deadline ? role.apply_deadline.slice(0, 10) : '',
    posting_url: text(role.posting_url),
    job_description: text(role.job_description),
    notes: text(role.notes),
  }
}

const num = (value: string) => (value.trim() === '' ? null : Number(value))
const str = (value: string) => (value.trim() === '' ? null : value.trim())

/**
 * Add or edit one job role on a company. `role` switches it to edit mode; the
 * PUT sends every field, so clearing an input clears it on the server too.
 */
export default function RoleModal({
  companyId,
  role,
  onClose,
  onSaved,
}: {
  companyId: number
  role?: CompanyRole
  onClose: () => void
  onSaved: () => void
}) {
  const initial = role ? toForm(role) : EMPTY
  const [form, setForm] = useState<RoleForm>(initial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<RoleForm>()

  const isStipendRole = STIPEND_TYPES.includes(form.role_type)

  const update = <K extends keyof RoleForm>(key: K, value: RoleForm[K]) => {
    clearError(key)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    const payload = {
      title: form.title.trim(),
      role_type: form.role_type,
      status: form.status,
      // Only one compensation shape is on screen at a time; send the other as
      // null so switching an internship to full-time doesn't leave a stipend
      // hanging around invisibly on the record.
      ctc_min: isStipendRole ? null : num(form.ctc_min),
      ctc_max: isStipendRole ? null : num(form.ctc_max),
      stipend: isStipendRole ? num(form.stipend) : null,
      openings: num(form.openings),
      location: str(form.location),
      work_mode: str(form.work_mode),
      eligible_branches: str(form.eligible_branches),
      min_cgpa: num(form.min_cgpa),
      max_backlogs: num(form.max_backlogs),
      skills: str(form.skills),
      apply_deadline: str(form.apply_deadline),
      posting_url: str(form.posting_url),
      job_description: str(form.job_description),
      notes: str(form.notes),
    }
    try {
      if (role) {
        await api.put(`/companies/${companyId}/roles/${role.id}`, payload)
      } else {
        await api.post(`/companies/${companyId}/roles`, payload)
      }
      onSaved()
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          'Could not save this role. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(initial)}
      panelClassName="w-full max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl z-10">
        <ModalTitle>{role ? 'Edit role' : 'Add job role'}</ModalTitle>
        <ModalClose />
      </div>

      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
        {error && (
          <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <Field label="Role title" name="title" required error={errors.title} compact>
          {(p) => (
            <input
              {...p}
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              className={inputClass(!!errors.title, 'px-3 py-2')}
              placeholder="Software Engineer"
            />
          )}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Type" name="role_type" compact>
            {(p) => (
              <select
                {...p}
                value={form.role_type}
                onChange={(e) => update('role_type', e.target.value as CompanyRoleType)}
                className={inputClass(false, 'px-3 py-2')}
              >
                {(Object.keys(ROLE_TYPE_LABELS) as CompanyRoleType[]).map((t) => (
                  <option key={t} value={t}>{ROLE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Status" name="status" compact>
            {(p) => (
              <select
                {...p}
                value={form.status}
                onChange={(e) => update('status', e.target.value as CompanyRoleStatus)}
                className={inputClass(false, 'px-3 py-2')}
              >
                {(Object.keys(ROLE_STATUS_LABELS) as CompanyRoleStatus[]).map((st) => (
                  <option key={st} value={st}>{ROLE_STATUS_LABELS[st]}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Openings" name="openings" optional error={errors.openings} compact>
            {(p) => (
              <input
                {...p}
                type="number"
                min={0}
                value={form.openings}
                onChange={(e) => update('openings', e.target.value)}
                className={inputClass(!!errors.openings, 'px-3 py-2')}
                placeholder="25"
              />
            )}
          </Field>
        </div>

        {isStipendRole ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field
              label="Stipend / month"
              name="stipend"
              optional
              error={errors.stipend}
              hint="₹ per month"
              compact
            >
              {(p) => (
                <input
                  {...p}
                  type="number"
                  min={0}
                  value={form.stipend}
                  onChange={(e) => update('stipend', e.target.value)}
                  className={inputClass(!!errors.stipend, 'px-3 py-2')}
                  placeholder="25000"
                />
              )}
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="CTC from" name="ctc_min" optional error={errors.ctc_min} hint="LPA" compact>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.ctc_min}
                  onChange={(e) => update('ctc_min', e.target.value)}
                  className={inputClass(!!errors.ctc_min, 'px-3 py-2')}
                  placeholder="6.5"
                />
              )}
            </Field>
            <Field label="CTC to" name="ctc_max" optional error={errors.ctc_max} hint="LPA" compact>
              {(p) => (
                <input
                  {...p}
                  type="number"
                  step="0.1"
                  min={0}
                  value={form.ctc_max}
                  onChange={(e) => update('ctc_max', e.target.value)}
                  className={inputClass(!!errors.ctc_max, 'px-3 py-2')}
                  placeholder="12"
                />
              )}
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Location" name="location" optional compact>
            {(p) => (
              <input
                {...p}
                value={form.location}
                onChange={(e) => update('location', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="Bengaluru"
              />
            )}
          </Field>
          <Field label="Work mode" name="work_mode" optional compact>
            {(p) => (
              <select
                {...p}
                value={form.work_mode}
                onChange={(e) => update('work_mode', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
              >
                <option value="">Not specified</option>
                <option value="onsite">On-site</option>
                <option value="hybrid">Hybrid</option>
                <option value="remote">Remote</option>
              </select>
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Eligible branches" name="eligible_branches" optional compact>
            {(p) => (
              <input
                {...p}
                value={form.eligible_branches}
                onChange={(e) => update('eligible_branches', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="CSE, ISE, ECE"
              />
            )}
          </Field>
          <Field label="Min CGPA" name="min_cgpa" optional error={errors.min_cgpa} compact>
            {(p) => (
              <input
                {...p}
                type="number"
                step="0.1"
                min={0}
                max={10}
                value={form.min_cgpa}
                onChange={(e) => update('min_cgpa', e.target.value)}
                className={inputClass(!!errors.min_cgpa, 'px-3 py-2')}
                placeholder="7.0"
              />
            )}
          </Field>
          <Field label="Max backlogs" name="max_backlogs" optional error={errors.max_backlogs} compact>
            {(p) => (
              <input
                {...p}
                type="number"
                min={0}
                value={form.max_backlogs}
                onChange={(e) => update('max_backlogs', e.target.value)}
                className={inputClass(!!errors.max_backlogs, 'px-3 py-2')}
                placeholder="0"
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Apply by" name="apply_deadline" optional compact>
            {(p) => (
              <input
                {...p}
                type="date"
                value={form.apply_deadline}
                onChange={(e) => update('apply_deadline', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
              />
            )}
          </Field>
          <Field label="Posting link" name="posting_url" optional error={errors.posting_url} compact>
            {(p) => (
              <input
                {...p}
                type="url"
                value={form.posting_url}
                onChange={(e) => update('posting_url', e.target.value)}
                className={inputClass(!!errors.posting_url, 'px-3 py-2')}
                placeholder="https://careers.company.com/..."
              />
            )}
          </Field>
        </div>

        <Field label="Key skills" name="skills" optional hint="Comma-separated" compact>
          {(p) => (
            <input
              {...p}
              value={form.skills}
              onChange={(e) => update('skills', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="Java, Spring Boot, SQL"
            />
          )}
        </Field>

        <Field label="Job description" name="job_description" optional compact>
          {(p) => (
            <textarea
              {...p}
              rows={4}
              value={form.job_description}
              onChange={(e) => update('job_description', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="Responsibilities, selection process, bond details…"
            />
          )}
        </Field>

        <Field label="Internal notes" name="notes" optional compact>
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="What HR said on the call…"
            />
          )}
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Saving…' : role ? 'Save changes' : 'Add role'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
