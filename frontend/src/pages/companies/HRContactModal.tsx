import { useState } from 'react'
import api from '@/lib/api'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { email as emailRule, required, type Rules } from '@/lib/validation'
import { cn } from '@/lib/utils'
import type { HRContact } from '@/types'

interface ContactForm {
  name: string
  designation: string
  email: string
  mobile: string
  linkedin: string
  region: string
  relationship_strength: number
  next_followup_date: string
  next_action: string
  notes: string
}

const RULES: Rules<ContactForm> = {
  name: required('Enter the contact’s name.'),
  // Email is optional, but a typo here means outreach silently goes nowhere.
  email: emailRule('That doesn’t look like an email address — check for a typo.'),
  linkedin: (value) => {
    if (!value.trim()) return undefined
    return /^https?:\/\/.+/i.test(value.trim())
      ? undefined
      : 'Paste the full profile link, starting with https://.'
  },
}

const EMPTY: ContactForm = {
  name: '',
  designation: '',
  email: '',
  mobile: '',
  linkedin: '',
  region: '',
  relationship_strength: 3,
  next_followup_date: '',
  next_action: '',
  notes: '',
}

// What each rung of the 1-5 rating means. Spelled out because an unlabelled
// star row invites everybody to use a different scale, which makes the column
// useless the moment a second officer starts filling it in.
export const STRENGTH_LABELS: Record<number, string> = {
  1: 'Cold — no relationship yet',
  2: 'Formal — responds, no warmth',
  3: 'Working — normal back-and-forth',
  4: 'Strong — goes out of their way',
  5: 'Champion — advocates for us internally',
}

/** The 1-5 rating, as a labelled row of buttons rather than a bare number input. */
function StrengthPicker({
  id,
  value,
  onChange,
}: {
  id?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div id={id} className="flex items-center gap-1.5" role="radiogroup" aria-label="Relationship strength">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={STRENGTH_LABELS[n]}
            onClick={() => onChange(n)}
            className={cn(
              'w-9 h-9 rounded-lg border text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
              n <= value
                ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-1.5">{STRENGTH_LABELS[value]}</p>
    </div>
  )
}

/** Date input wants `yyyy-mm-dd`; the API returns a full ISO timestamp. */
function toDateInput(iso?: string): string {
  return iso ? iso.slice(0, 10) : ''
}

/**
 * Add or edit an HR contact. One component for both, so the two forms can't
 * drift apart — `contact` absent means add, present means edit.
 */
export default function HRContactModal({
  companyId,
  contact,
  onClose,
  onSaved,
}: {
  companyId: number
  contact?: HRContact
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const editing = !!contact
  const initial: ContactForm = contact
    ? {
        name: contact.name,
        designation: contact.designation ?? '',
        email: contact.email ?? '',
        mobile: contact.mobile ?? '',
        linkedin: contact.linkedin ?? '',
        region: contact.region ?? '',
        relationship_strength: contact.relationship_strength ?? 3,
        next_followup_date: toDateInput(contact.next_followup_date),
        next_action: contact.next_action ?? '',
        notes: contact.notes ?? '',
      }
    : EMPTY

  const [form, setForm] = useState<ContactForm>(initial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<ContactForm>()

  const update = (key: keyof ContactForm, value: string | number) => {
    clearError(key)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    const body = {
      name: form.name,
      designation: form.designation || null,
      email: form.email || null,
      mobile: form.mobile || null,
      linkedin: form.linkedin || null,
      region: form.region || null,
      relationship_strength: form.relationship_strength,
      next_followup_date: form.next_followup_date || null,
      next_action: form.next_action || null,
      notes: form.notes || null,
    }
    try {
      if (editing) {
        await api.put(`/companies/${companyId}/hr-contacts/${contact!.id}`, body)
      } else {
        await api.post(`/companies/${companyId}/hr-contacts`, body)
      }
      await onSaved()
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          `Could not ${editing ? 'save' : 'add'} this contact. Check your connection and try again.`,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(initial)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
        <ModalTitle>{editing ? 'Edit HR contact' : 'Add HR contact'}</ModalTitle>
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
        <Field label="Name" name="name" required error={errors.name}>
          {(p) => (
            <input
              {...p}
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              className={inputClass(!!errors.name, 'px-3 py-2')}
              placeholder="Priya Sharma"
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation" name="designation" optional>
            {(p) => (
              <input
                {...p}
                value={form.designation}
                onChange={(e) => update('designation', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="HR Manager"
              />
            )}
          </Field>
          <Field label="Region" name="region" optional>
            {(p) => (
              <input
                {...p}
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="South"
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" name="email" optional error={errors.email}>
            {(p) => (
              <input
                {...p}
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                className={inputClass(!!errors.email, 'px-3 py-2')}
                placeholder="priya@company.com"
              />
            )}
          </Field>
          <Field label="Mobile" name="mobile" optional>
            {(p) => (
              <input
                {...p}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.mobile}
                onChange={(e) => update('mobile', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="+91 ..."
              />
            )}
          </Field>
        </div>
        <Field label="LinkedIn" name="linkedin" optional error={errors.linkedin}>
          {(p) => (
            <input
              {...p}
              type="url"
              value={form.linkedin}
              onChange={(e) => update('linkedin', e.target.value)}
              className={inputClass(!!errors.linkedin, 'px-3 py-2')}
              placeholder="https://linkedin.com/in/..."
            />
          )}
        </Field>

        <Field
          label="Relationship strength"
          name="relationship_strength"
          hint="Your own read on this person. The engagement score next to it is computed from the communication log — this one isn’t."
        >
          {(p) => (
            <StrengthPicker
              id={p.id}
              value={form.relationship_strength}
              onChange={(n) => update('relationship_strength', n)}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Next follow-up" name="next_followup_date" optional>
            {(p) => (
              <input
                {...p}
                type="date"
                value={form.next_followup_date}
                onChange={(e) => update('next_followup_date', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
              />
            )}
          </Field>
          <Field label="Next action" name="next_action" optional>
            {(p) => (
              <input
                {...p}
                value={form.next_action}
                onChange={(e) => update('next_action', e.target.value)}
                className={inputClass(false, 'px-3 py-2')}
                placeholder="Send the 2027 brochure"
              />
            )}
          </Field>
        </div>

        <Field label="Notes" name="notes" optional>
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              className={inputClass(false, 'px-3 py-2')}
              placeholder="Prefers a call over email. Handles CSE hiring only."
            />
          )}
        </Field>

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {loading ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}
        </button>
      </form>
    </Modal>
  )
}
