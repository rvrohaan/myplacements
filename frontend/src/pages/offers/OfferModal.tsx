import { useMemo, useState } from 'react'
import api from '@/lib/api'
import type { Offer, OfferStatus } from '@/types'
import { Modal, ModalCancelButton, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import SearchSelect, { type SearchOption } from '@/components/ui/search-select'
import { searchCompanies, searchStudents } from '@/lib/pickers'
import { useToast } from '@/components/ui/toast'
import { required, type Rules } from '@/lib/validation'

type Form = {
  student_id: string
  company_id: string
  ctc: string
  role: string
  location: string
  status: OfferStatus
  joining_date: string
  dropout_reason: string
}

const STATUS_LABELS: Record<OfferStatus, string> = {
  issued: 'Issued — offer made',
  accepted: 'Accepted — student said yes',
  joined: 'Joined — student has started',
  rejected: 'Rejected — student declined',
  dropout: 'Dropped out — did not join / left',
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; the API returns a full ISO string. */
function toInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : ''
}

function fromInput(value: string): string | null {
  return value ? `${value}T00:00:00` : null
}

/** What the pickers display for an offer being edited: the row already carries
    the student's and company's names, so neither needs a lookup to render. */
function initialPicked(offer?: Offer): { student: SearchOption | null; company: SearchOption | null } {
  return {
    student: offer
      ? {
          id: offer.student_id,
          label: offer.student_name || offer.roll_number || 'This student',
          hint: [offer.roll_number, offer.branch].filter(Boolean).join(' · ') || undefined,
        }
      : null,
    company: offer?.company_id
      ? { id: offer.company_id, label: offer.company_name || 'Selected company' }
      : null,
  }
}

function blankForm(offer?: Offer): Form {
  return {
    student_id: offer ? String(offer.student_id) : '',
    company_id: offer?.company_id ? String(offer.company_id) : '',
    ctc: offer?.ctc != null ? String(offer.ctc) : '',
    role: offer?.role ?? '',
    location: offer?.location ?? '',
    status: offer?.status ?? 'issued',
    joining_date: toInput(offer?.joining_date),
    dropout_reason: offer?.dropout_reason ?? '',
  }
}

/**
 * Record a new offer, or edit one that exists.
 *
 * Editing a drive-linked offer leaves the student and company fixed: those came
 * from the drive, and letting them be re-pointed here would silently detach the
 * offer from the drive that produced it.
 */
export default function OfferModal({
  offer,
  onClose,
  onSaved,
}: {
  offer?: Offer
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<Form>(() => blankForm(offer))
  const [picked, setPicked] = useState(() => initialPicked(offer))
  const [saving, setSaving] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<Form>()
  const initial = useMemo(() => JSON.stringify(blankForm(offer)), [offer])

  const isEdit = !!offer
  const fromDrive = !!offer?.drive_id
  // The "mark as placed" placeholder has no company; naming one here is exactly
  // how it becomes a real offer.
  const isPlaceholder = !!offer?.is_placeholder

  const update = (field: keyof Form, value: string) => {
    clearError(field)
    setForm((f) => ({ ...f, [field]: value }))
  }

  const RULES: Rules<Form> = {
    student_id: required('Choose the student this offer is for.'),
    company_id: required('Choose the company making the offer.'),
    ctc: (value) => {
      if (!value.trim()) return undefined
      const n = Number(value)
      if (Number.isNaN(n) || n <= 0) return 'Enter the package in LPA, e.g. 7.5.'
      return undefined
    },
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // A drive-linked offer keeps the student and company it was created with, so
    // those rules don't apply to it.
    const rules = fromDrive ? { ...RULES, student_id: undefined, company_id: undefined } : RULES
    if (!validate(rules, form)) return
    setSaving(true)
    const body = {
      ctc: form.ctc ? Number(form.ctc) : null,
      role: form.role.trim() || null,
      location: form.location.trim() || null,
      status: form.status,
      joining_date: fromInput(form.joining_date),
      dropout_reason: form.status === 'dropout' ? form.dropout_reason.trim() || null : null,
    }
    try {
      if (isEdit) {
        await api.put(`/offers/${offer!.id}`, {
          ...body,
          ...(fromDrive ? {} : { company_id: Number(form.company_id) }),
        })
        toast.success('Offer updated')
      } else {
        await api.post('/offers', {
          ...body,
          student_id: Number(form.student_id),
          company_id: Number(form.company_id),
        })
        toast.success('Offer recorded')
      }
      onSaved()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save this offer. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== initial}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
        <ModalTitle>{isEdit ? 'Edit offer' : 'Record an offer'}</ModalTitle>
        <ModalClose />
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
        {isPlaceholder && (
          <p className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            This student was marked placed without an offer on record. Naming the company
            turns this into a real offer that counts company-wise.
          </p>
        )}
        {fromDrive && (
          <p className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-600 text-sm">
            From the {offer?.drive_title ? <span className="font-medium">{offer.drive_title}</span> : 'drive'} drive
            {offer?.company_name ? ` at ${offer.company_name}` : ''} — the student and company
            come from the drive and can't be changed here.
          </p>
        )}

        {!fromDrive && (
          <>
            <Field
              label="Student"
              name="student_id"
              required
              error={errors.student_id}
              hint={isEdit ? undefined : 'Search by name, roll number or branch.'}
            >
              {(p) => (
                <SearchSelect
                  {...p}
                  value={picked.student}
                  onChange={(option) => {
                    setPicked((prev) => ({ ...prev, student: option }))
                    update('student_id', option ? String(option.id) : '')
                  }}
                  search={searchStudents}
                  disabled={isEdit}
                  hasError={!!errors.student_id}
                  placeholder="Search students…"
                  emptyText="No student matches that"
                  moreHint="Keep typing to narrow this down"
                />
              )}
            </Field>
            <Field
              label="Company"
              name="company_id"
              required
              error={errors.company_id}
              hint="Search by name, sector or location."
            >
              {(p) => (
                <SearchSelect
                  {...p}
                  value={picked.company}
                  onChange={(option) => {
                    setPicked((prev) => ({ ...prev, company: option }))
                    update('company_id', option ? String(option.id) : '')
                  }}
                  search={searchCompanies}
                  hasError={!!errors.company_id}
                  placeholder="Search companies…"
                  emptyText="No company matches that"
                />
              )}
            </Field>
          </>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Package (LPA)" name="ctc" optional error={errors.ctc}>
            {(p) => (
              <input
                {...p}
                value={form.ctc}
                onChange={(e) => update('ctc', e.target.value)}
                inputMode="decimal"
                placeholder="7.5"
                className={inputClass(!!errors.ctc)}
              />
            )}
          </Field>
          <Field label="Role" name="role" optional>
            {(p) => (
              <input
                {...p}
                value={form.role}
                onChange={(e) => update('role', e.target.value)}
                placeholder="Software Engineer"
                className={inputClass(false)}
              />
            )}
          </Field>
        </div>

        <Field label="Location" name="location" optional>
          {(p) => (
            <input
              {...p}
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              placeholder="Hyderabad"
              className={inputClass(false)}
            />
          )}
        </Field>

        <Field
          label="Status"
          name="status"
          hint="Accepted and joined both count the student as placed; the package on file is their best live offer."
        >
          {(p) => (
            <select
              {...p}
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
              className={inputClass(false)}
            >
              {(Object.keys(STATUS_LABELS) as OfferStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Joining date"
          name="joining_date"
          optional
          hint="Leave blank until it's confirmed — the offers list can show you everything still waiting on one."
        >
          {(p) => (
            <input
              {...p}
              type="date"
              value={form.joining_date}
              onChange={(e) => update('joining_date', e.target.value)}
              className={inputClass(false)}
            />
          )}
        </Field>

        {form.status === 'dropout' && (
          <Field label="Why did it fall through?" name="dropout_reason" optional>
            {(p) => (
              <textarea
                {...p}
                value={form.dropout_reason}
                onChange={(e) => update('dropout_reason', e.target.value)}
                rows={2}
                placeholder="Took a better offer / went for higher studies / company deferred joining"
                className={inputClass(false)}
              />
            )}
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <ModalCancelButton />
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Record offer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
