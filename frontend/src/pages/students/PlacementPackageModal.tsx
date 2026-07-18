import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import type { Student } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

export default function PlacementPackageModal({
  student,
  onClose,
  onConfirm,
}: {
  student: Student
  onClose: () => void
  onConfirm: (ctc: number) => void
}) {
  const [ctc, setCtc] = useState(student.placement_ctc != null ? String(student.placement_ctc) : '')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(ctc)
    if (ctc === '' || Number.isNaN(value) || value <= 0) {
      setError('Enter a valid package amount')
      return
    }
    onConfirm(value)
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={ctc !== (student.placement_ctc != null ? String(student.placement_ctc) : '')}
      panelClassName="w-full max-w-sm"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-green-600" />
            <ModalTitle>Mark as placed</ModalTitle>
          </div>
          <ModalClose />
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Enter the package <span className="font-medium text-gray-700">{student.full_name}</span> was
            placed with.
          </p>
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Package (LPA)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={ctc}
                onChange={(e) => setCtc(e.target.value)}
                className="w-full pl-7 pr-12 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="12.5"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">LPA</span>
            </div>
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
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors shadow-sm shadow-primary-600/25"
            >
              Confirm placed
            </button>
          </div>
        </form>
    </Modal>
  )
}
