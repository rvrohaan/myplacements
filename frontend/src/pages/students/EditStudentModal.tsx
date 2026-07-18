import { useState } from 'react'
import api from '@/lib/api'
import type { Student } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

export default function EditStudentModal({
  student,
  onClose,
  onSaved,
}: {
  student: Student
  onClose: () => void
  onSaved: (s: Student) => void
}) {
  const isPlaced = student.placement_status === 'placed'
  const initialForm = {
    full_name: student.full_name ?? '',
    roll_number: student.roll_number,
    branch: student.branch,
    batch_year: String(student.batch_year),
    cgpa: student.cgpa != null ? String(student.cgpa) : '',
    backlogs: String(student.backlogs),
    skills: student.skills ?? '',
    placement_ctc: student.placement_ctc != null ? String(student.placement_ctc) : '',
  }
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (field: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name,
        roll_number: form.roll_number,
        branch: form.branch,
        batch_year: Number(form.batch_year),
        cgpa: form.cgpa === '' ? null : Number(form.cgpa),
        backlogs: form.backlogs === '' ? 0 : Number(form.backlogs),
        skills: form.skills || null,
      }
      // CTC only applies to a placed student; let them fix a typo here.
      if (isPlaced) {
        payload.placement_ctc = form.placement_ctc === '' ? null : Number(form.placement_ctc)
      }
      const { data } = await api.put(`/students/${student.id}`, payload)
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
      isDirty={JSON.stringify(form) !== JSON.stringify(initialForm)}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
          <ModalTitle>Edit student</ModalTitle>
          <ModalClose />
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
            <input
              value={form.full_name}
              onChange={(e) => update('full_name', e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Jane Doe"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roll number</label>
              <input
                value={form.roll_number}
                onChange={(e) => update('roll_number', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="21CS001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch year</label>
              <input
                type="number"
                value={form.batch_year}
                onChange={(e) => update('batch_year', e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="2025"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
            <input
              value={form.branch}
              onChange={(e) => update('branch', e.target.value)}
              required
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Computer Science"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CGPA <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="10"
                value={form.cgpa}
                onChange={(e) => update('cgpa', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="8.2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Backlogs</label>
              <input
                type="number"
                min="0"
                value={form.backlogs}
                onChange={(e) => update('backlogs', e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Skills <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={form.skills}
              onChange={(e) => update('skills', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Python, React, SQL"
            />
          </div>
          {isPlaced && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Package (LPA)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.placement_ctc}
                  onChange={(e) => update('placement_ctc', e.target.value)}
                  className="w-full pl-7 pr-12 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="12.5"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">LPA</span>
              </div>
            </div>
          )}
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
