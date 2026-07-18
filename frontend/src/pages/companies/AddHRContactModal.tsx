import { useState } from 'react'
import api from '@/lib/api'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

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

  const update = (key: keyof ContactForm, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
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
      setError(err?.response?.data?.detail || 'Could not add contact')
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Priya Sharma"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
              <input
                value={form.designation}
                onChange={(e) => update('designation', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="HR Manager"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
              <input
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="South"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="priya@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
              <input
                value={form.mobile}
                onChange={(e) => update('mobile', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="+91 ..."
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">LinkedIn</label>
            <input
              value={form.linkedin}
              onChange={(e) => update('linkedin', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="https://linkedin.com/in/..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Next follow-up <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={form.next_followup_date}
              onChange={(e) => update('next_followup_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm shadow-primary-600/25"
          >
            {loading ? 'Adding...' : 'Add contact'}
          </button>
        </form>
    </Modal>
  )
}
