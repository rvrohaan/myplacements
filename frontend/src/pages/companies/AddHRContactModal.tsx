import { useState } from 'react'
import api from '@/lib/api'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { email as emailRule, required, type Rules } from '@/lib/validation'

interface ContactForm {
  name: string
  designation: string
  email: string
  mobile: string
  linkedin: string
  region: string
  next_followup_date: string
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
  next_followup_date: '',
  notes: '',
}

export default function AddHRContactModal({
  companyId,
  onClose,
  onAdded,
}: {
  companyId: number
  onClose: () => void
  onAdded: () => void
}) {
  const [form, setForm] = useState<ContactForm>(EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<ContactForm>()

  const update = (key: keyof ContactForm, value: string) => {
    clearError(key)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    try {
      await api.post(`/companies/${companyId}/hr-contacts`, {
        name: form.name,
        designation: form.designation || null,
        email: form.email || null,
        mobile: form.mobile || null,
        linkedin: form.linkedin || null,
        region: form.region || null,
        next_followup_date: form.next_followup_date || null,
        notes: form.notes || null,
      })
      onAdded()
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'Could not add this contact. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(EMPTY)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <ModalTitle>Add HR contact</ModalTitle>
          <ModalClose />
        </div>

        {/* noValidate hands validation to the app, so the browser never shows its
            own tooltip bubbles over our fields. */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
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
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {loading ? 'Adding…' : 'Add contact'}
          </button>
        </form>
    </Modal>
  )
}
