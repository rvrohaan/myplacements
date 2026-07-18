import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import api from '@/lib/api'
import type { Drive, Company } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

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

  const set = (key: keyof FormState, value: string) => setForm((p) => ({ ...p, [key]: value }))
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialFrom(drive))

  const num = (v: string) => (v.trim() === '' ? null : Number(v))
  const int = (v: string) => (v.trim() === '' ? null : parseInt(v, 10))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isEdit && !form.company_id) {
      setError('Select a company')
      return
    }
    if (!form.job_role.trim()) {
      setError('Job role is required')
      return
    }
    setSubmitting(true)
    setError('')

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
      setError('Could not save the drive. Please try again.')
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

      <form onSubmit={handleSubmit} className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {error && (
          <div role="alert" className="sm:col-span-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Company *</label>
          <select
            value={form.company_id}
            onChange={(e) => set('company_id', e.target.value)}
            required
            disabled={isEdit}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="" disabled>Select a company...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Job Role *</label>
          <input value={form.job_role} onChange={(e) => set('job_role', e.target.value)} required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Software Engineer" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Drive Date</label>
          <input value={form.drive_date} onChange={(e) => set('drive_date', e.target.value)} type="datetime-local" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mode</label>
          <select value={form.mode} onChange={(e) => set('mode', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="offline">Offline</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
        {isEdit && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="upcoming">Upcoming</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">CTC Offered (LPA)</label>
          <input value={form.ctc_offered} onChange={(e) => set('ctc_offered', e.target.value)} type="number" step="0.1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 12.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Min CGPA</label>
          <input value={form.min_cgpa} onChange={(e) => set('min_cgpa', e.target.value)} type="number" step="0.1" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 7.0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
          <input value={form.location} onChange={(e) => set('location', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Bengaluru" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Eligible Branches</label>
          <input value={form.eligible_branches} onChange={(e) => set('eligible_branches', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="CSE, IT, ECE" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Interview Rounds</label>
          <input value={form.total_rounds} onChange={(e) => set('total_rounds', e.target.value)} type="number" min="0" max="15" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 3" />
          <p className="text-[11px] text-gray-400 mt-1">How many rounds the role has. Record how many appeared and passed for each round on the drive page.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Anything the placement team should know" />
        </div>

        <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors">
            {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Drive'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
