import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import api from '@/lib/api'
import type { Drive, Company } from '@/types'
import { Modal, ModalClose, ModalTitle, useModalClose } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { numberBetween, required, type Rules } from '@/lib/validation'

// Turn an ISO timestamp into the value a <input type="datetime-local"> expects.
const toLocalInput = (iso?: string) => (iso ? iso.slice(0, 16) : '')

type FormState = {
  company_id: string
  job_role: string
  drive_date: string
  mode: string
  status: string
  ctc_offered: string
  min_cgpa: string
  eligible_branches: string
  location: string
  total_rounds: string
  notes: string
}

/** Numbers are optional here, so blanks pass; only nonsense values are rejected. */
const RULES: Rules<FormState> = {
  company_id: required('Choose the company running this drive.'),
  job_role: required('Enter the role being hired for, e.g. Software Engineer.'),
  ctc_offered: numberBetween(0, 1000, 'Enter the package in LPA, e.g. 12.5.'),
  min_cgpa: numberBetween(0, 10, 'Minimum CGPA must be between 0 and 10.'),
  total_rounds: numberBetween(0, 15, 'Enter a whole number of rounds, 0 to 15.', { integer: true }),
}

const initialFrom = (drive?: Drive): FormState => ({
  company_id: drive ? String(drive.company_id) : '',
  job_role: drive?.job_role ?? '',
  drive_date: toLocalInput(drive?.drive_date),
  mode: drive?.mode ?? 'offline',
  status: drive?.status ?? 'upcoming',
  ctc_offered: drive?.ctc_offered != null ? String(drive.ctc_offered) : '',
  min_cgpa: drive?.min_cgpa != null ? String(drive.min_cgpa) : '',
  eligible_branches: drive?.eligible_branches ?? '',
  location: drive?.location ?? '',
  total_rounds: drive?.total_rounds != null ? String(drive.total_rounds) : '',
  notes: drive?.notes ?? '',
})

/**
 * Create or edit a placement drive. Pass a `drive` to edit (its company is fixed);
 * omit it to create. Calls `onSaved` with the persisted drive on success.
 */
export default function DriveFormModal({
  drive,
  companies,
  onClose,
  onSaved,
}: {
  drive?: Drive
  companies: Company[]
  onClose: () => void
  onSaved: (drive: Drive) => void
}) {
  const isEdit = !!drive
  const [form, setForm] = useState<FormState>(() => initialFrom(drive))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const { formRef, errors, clearError, validate } = useFieldErrors<FormState>()

  const set = (key: keyof FormState, value: string) => {
    clearError(key)
    setForm((p) => ({ ...p, [key]: value }))
  }
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFrom(drive))

  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const int = (v: string) => (v.trim() === '' ? null : parseInt(v, 10))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // The company is fixed once a drive exists, so editing doesn't re-check it.
    const rules = isEdit ? { ...RULES, company_id: undefined } : RULES
    if (!validate(rules, form)) return
    setSubmitting(true)

    // Company can't be reassigned after creation, so it's omitted from edits.
    const base = {
      job_role: form.job_role.trim(),
      drive_date: form.drive_date || null,
      mode: form.mode,
      status: form.status,
      ctc_offered: num(form.ctc_offered),
      min_cgpa: num(form.min_cgpa),
      eligible_branches: form.eligible_branches.trim() || null,
      location: form.location.trim() || null,
      total_rounds: int(form.total_rounds),
      notes: form.notes.trim() || null,
    }

    try {
      const res = isEdit
        ? await api.put(`/drives/${drive!.id}`, base)
        : await api.post('/drives', { ...base, company_id: parseInt(form.company_id, 10) })
      onSaved(res.data)
    } catch {
      setError('Could not save this drive. Check your connection and try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose} isDirty={isDirty} align="start" panelClassName="w-full max-w-2xl my-8">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <CalendarPlus className="w-5 h-5 text-primary-600" />
          <ModalTitle>{isEdit ? 'Edit Drive' : 'Create Placement Drive'}</ModalTitle>
        </div>
        <ModalClose />
      </div>

      {/* noValidate hands validation to the app, so the browser never shows its
          own tooltip bubbles over our fields. */}
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {error && (
          <div role="alert" className="sm:col-span-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <Field
          compact
          label="Company"
          name="company_id"
          required
          error={errors.company_id}
          hint={isEdit ? 'Fixed once the drive exists' : undefined}
        >
          {(p) => (
            <select
              {...p}
              value={form.company_id}
              onChange={(e) => set('company_id', e.target.value)}
              disabled={isEdit}
              className={inputClass(
                !!errors.company_id,
                'px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500',
              )}
            >
              <option value="" disabled>Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field compact label="Job Role" name="job_role" required error={errors.job_role}>
          {(p) => (
            <input
              {...p}
              value={form.job_role}
              onChange={(e) => set('job_role', e.target.value)}
              className={inputClass(!!errors.job_role, 'px-3 py-2')}
              placeholder="e.g. Software Engineer"
            />
          )}
        </Field>
        <Field compact label="Drive Date" name="drive_date" optional>
          {(p) => (
            <input
              {...p}
              value={form.drive_date}
              onChange={(e) => set('drive_date', e.target.value)}
              type="datetime-local"
              className={inputClass(false, 'px-3 py-2')}
            />
          )}
        </Field>
        <Field compact label="Mode" name="mode">
          {(p) => (
          <select {...p} value={form.mode} onChange={(e) => set('mode', e.target.value)} className={inputClass(false, 'px-3 py-2')}>
            <option value="offline">Offline</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
          )}
        </Field>
        {isEdit && (
          <Field compact label="Status" name="status">
            {(p) => (
              <select {...p} value={form.status} onChange={(e) => set('status', e.target.value)} className={inputClass(false, 'px-3 py-2')}>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            )}
          </Field>
        )}
        <Field compact label="CTC Offered (LPA)" name="ctc_offered" optional error={errors.ctc_offered}>
          {(p) => (
            <input
              {...p}
              value={form.ctc_offered}
              onChange={(e) => set('ctc_offered', e.target.value)}
              type="number"
              step="0.1"
              inputMode="decimal"
              className={inputClass(!!errors.ctc_offered, 'px-3 py-2')}
              placeholder="e.g. 12.5"
            />
          )}
        </Field>
        <Field compact label="Min CGPA" name="min_cgpa" optional error={errors.min_cgpa}>
          {(p) => (
            <input
              {...p}
              value={form.min_cgpa}
              onChange={(e) => set('min_cgpa', e.target.value)}
              type="number"
              step="0.1"
              inputMode="decimal"
              className={inputClass(!!errors.min_cgpa, 'px-3 py-2')}
              placeholder="e.g. 7.0"
            />
          )}
        </Field>
        <Field compact label="Location" name="location" optional>
          {(p) => (
            <input
              {...p}
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="e.g. Bengaluru"
            />
          )}
        </Field>
        <Field
          compact
          className="sm:col-span-2"
          label="Eligible Branches"
          name="eligible_branches"
          optional
          hint="Separate with commas"
        >
          {(p) => (
            <input
              {...p}
              value={form.eligible_branches}
              onChange={(e) => set('eligible_branches', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="CSE, IT, ECE"
            />
          )}
        </Field>
        <Field
          compact
          className="sm:col-span-2"
          label="Interview Rounds"
          name="total_rounds"
          optional
          error={errors.total_rounds}
          hint="How many rounds the role has. Record who appeared and passed for each round on the drive page."
        >
          {(p) => (
            <input
              {...p}
              value={form.total_rounds}
              onChange={(e) => set('total_rounds', e.target.value)}
              type="number"
              min="0"
              max="15"
              inputMode="numeric"
              className={inputClass(!!errors.total_rounds, 'px-3 py-2')}
              placeholder="e.g. 3"
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
              placeholder="Anything the placement team should know"
            />
          )}
        </Field>

        <DriveFormActions submitting={submitting} isEdit={isEdit} />
      </form>
    </Modal>
  )
}

/** Separate so Cancel can reach the modal's guarded close through context. */
function DriveFormActions({ submitting, isEdit }: { submitting: boolean; isEdit: boolean }) {
  const requestClose = useModalClose()
  return (
    <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
      <button
        type="button"
        onClick={requestClose}
        className="min-h-[44px] px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="min-h-[44px] px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Drive'}
      </button>
    </div>
  )
}
