import { useState } from 'react'
import api from '@/lib/api'
import type { Company } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

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
  const [form, setForm] = useState<Record<string, string>>(buildInitial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
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
      setError(err?.response?.data?.detail || 'Could not save changes')
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {TEXT_FIELDS.map(({ key, label, placeholder, full }) => (
              <div key={key} className={full ? 'col-span-2' : ''}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  required={key === 'name'}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            ))}
            {NUM_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form[key]}
                  onChange={(e) => update(key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25"
            >
              {loading ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
