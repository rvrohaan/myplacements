import { useState } from 'react'
import api from '@/lib/api'
import type { Company } from '@/types'
import { Modal, ModalClose, ModalTitle, useModalClose } from '@/components/ui/modal'
import { Field, inputClass, useFieldErrors } from '@/components/ui/field'
import { numberBetween, required, type Rules } from '@/lib/validation'

const TEXT_FIELDS: { key: keyof Company; label: string; placeholder?: string; full?: boolean }[] = [
  { key: 'name', label: 'Name' },
  { key: 'sector', label: 'Sector', placeholder: 'IT, Civil, Finance...' },
  { key: 'domain', label: 'Domain' },
  { key: 'location', label: 'Location' },
  { key: 'size', label: 'Size', placeholder: 'e.g. 1000-5000' },
  { key: 'website', label: 'Website' },
  { key: 'mou_status', label: 'MoU Status' },
  { key: 'preferred_branches', label: 'Preferred Branches', full: true },
  { key: 'products_services', label: 'Products / Services', full: true },
]

const NUM_FIELDS: { key: keyof Company; label: string }[] = [
  { key: 'min_cgpa', label: 'Min CGPA' },
  { key: 'salary_min', label: 'Salary Min (LPA)' },
  { key: 'salary_max', label: 'Salary Max (LPA)' },
]

type CompanyForm = Record<string, string>

const RULES: Rules<CompanyForm> = {
  name: required('Enter the company name.'),
  website: (value) => {
    if (!value.trim()) return undefined
    return /^https?:\/\/.+/i.test(value.trim())
      ? undefined
      : 'Include the full address, starting with https://.'
  },
  min_cgpa: numberBetween(0, 10, 'Minimum CGPA must be between 0 and 10.'),
  salary_min: numberBetween(0, 1000, 'Enter the salary in LPA, e.g. 8.'),
  // Cross-field: a range that reads backwards would quietly mis-filter students.
  salary_max: (value, form) => {
    const range = numberBetween<CompanyForm>(0, 1000, 'Enter the salary in LPA, e.g. 24.')(value, form)
    if (range) return range
    const min = Number(form.salary_min)
    const max = Number(value)
    if (form.salary_min === '' || value === '' || !Number.isFinite(min) || !Number.isFinite(max)) {
      return undefined
    }
    return max < min ? 'Maximum salary can’t be lower than the minimum.' : undefined
  },
}

export default function EditCompanyModal({
  company,
  onClose,
  onSaved,
}: {
  company: Company
  onClose: () => void
  onSaved: (c: Company) => void
}) {
  const buildInitial = (): Record<string, string> => {
    const initial: Record<string, string> = {}
    ;[...TEXT_FIELDS, ...NUM_FIELDS].forEach(({ key }) => {
      const v = company[key]
      initial[key] = v == null ? '' : String(v)
    })
    initial.notes = company.notes ?? ''
    return initial
  }
  const [form, setForm] = useState<CompanyForm>(buildInitial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { formRef, errors, clearError, validate } = useFieldErrors<CompanyForm>()

  const update = (key: string, value: string) => {
    clearError(key)
    // The two salary fields judge each other, so editing one re-opens the other.
    if (key === 'salary_min') clearError('salary_max')
    setForm((f) => ({ ...f, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate(RULES, form)) return
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {}
      TEXT_FIELDS.forEach(({ key }) => (payload[key] = form[key]))
      payload.notes = form.notes
      NUM_FIELDS.forEach(({ key }) => {
        payload[key] = form[key] === '' ? null : Number(form[key])
      })
      const { data } = await api.put(`/companies/${company.id}`, payload)
      onSaved(data)
      onClose()
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || 'Could not save these changes. Check your connection and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(buildInitial())}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <ModalTitle>Edit company</ModalTitle>
          <ModalClose />
        </div>

        {/* noValidate hands validation to the app, so the browser never shows its
            own tooltip bubbles over our fields. */}
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {TEXT_FIELDS.map(({ key, label, placeholder, full }) => (
              <Field
                key={key}
                label={label}
                name={String(key)}
                required={key === 'name'}
                error={errors[key as string]}
                className={full ? 'col-span-2' : ''}
              >
                {(p) => (
                  <input
                    {...p}
                    value={form[key]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={placeholder}
                    className={inputClass(!!errors[key as string], 'px-3 py-2')}
                  />
                )}
              </Field>
            ))}
            {NUM_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} name={String(key)} optional error={errors[key as string]}>
                {(p) => (
                  <input
                    {...p}
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={form[key]}
                    onChange={(e) => update(key, e.target.value)}
                    className={inputClass(!!errors[key as string], 'px-3 py-2')}
                  />
                )}
              </Field>
            ))}
          </div>
          <Field label="Notes" name="notes" optional>
            {(p) => (
              <textarea
                {...p}
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                rows={3}
                className={inputClass(false, 'px-3 py-2')}
              />
            )}
          </Field>
          <EditCompanyActions loading={loading} />
        </form>
    </Modal>
  )
}

/** Separate so Cancel can reach the modal's guarded close through context. */
function EditCompanyActions({ loading }: { loading: boolean }) {
  const requestClose = useModalClose()
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={requestClose}
        className="flex-1 min-h-[44px] border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={loading}
        className="flex-1 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {loading ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
