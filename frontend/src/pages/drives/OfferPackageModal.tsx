import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Modal, ModalCancelButton, ModalClose, ModalTitle } from '@/components/ui/modal'
import { Field, inputClass } from '@/components/ui/field'

export default function OfferPackageModal({
  studentName,
  defaultCtc,
  onClose,
  onConfirm,
}: {
  studentName: string
  defaultCtc?: number
  onClose: () => void
  onConfirm: (ctc: number) => void
}) {
  const [ctc, setCtc] = useState(defaultCtc != null ? String(defaultCtc) : '')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(ctc)
    if (ctc === '' || Number.isNaN(value) || value <= 0) {
      setError('Enter the package in LPA, e.g. 12.5.')
      return
    }
    onConfirm(value)
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={ctc !== (defaultCtc != null ? String(defaultCtc) : '')}
      panelClassName="w-full max-w-sm"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-green-600" />
            <ModalTitle>Mark as selected</ModalTitle>
          </div>
          <ModalClose />
        </div>

        {/* noValidate keeps the browser from popping its own "please enter a
            valid value" tooltip over the amount field. */}
        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Enter the package <span className="font-medium text-gray-700">{studentName}</span> was
            selected with. This marks them <span className="font-medium text-gray-700">placed</span> and
            records the offer.
          </p>
          <Field label="Package (LPA)" name="ctc" required error={error}>
            {(p) => (
              <div className="relative">
                <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                <input
                  {...p}
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  autoFocus
                  value={ctc}
                  onChange={(e) => {
                    setError('')
                    setCtc(e.target.value)
                  }}
                  className={inputClass(!!error, 'pl-7 pr-12 py-2.5')}
                  placeholder="12.5"
                />
                <span aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">LPA</span>
              </div>
            )}
          </Field>
          <div className="flex gap-2">
            <ModalCancelButton className="flex-1" />
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors shadow-sm shadow-primary-600/25"
            >
              Confirm selected
            </button>
          </div>
        </form>
    </Modal>
  )
}
