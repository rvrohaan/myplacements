import { useState } from 'react'
import api from '@/lib/api'
import type { Officer } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'

/**
 * Edit an officer's profile and their targets. Targets could previously only be
 * set when the officer card was created, which left the placement head with no
 * way to change them — and target attainment on the dashboard stuck at 0%.
 * Backed by PUT /officers/{id} (management roles only).
 */
export default function EditOfficerModal({
  officer,
  onClose,
  onSaved,
}: {
  officer: Officer
  onClose: () => void
  onSaved: (o: Officer) => void
}) {
  const toast = useToast()
  const buildInitial = () => ({
    region: officer.region ?? '',
    sector_expertise: officer.sector_expertise ?? '',
    target_companies: String(officer.target_companies ?? 0),
    target_offers: String(officer.target_offers ?? 0),
  })
  const [form, setForm] = useState(buildInitial)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const update = (key: keyof ReturnType<typeof buildInitial>, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // OfficerUpdate skips None fields, so send 0 rather than null to clear a
      // target; empty input means "no target".
      const { data } = await api.put(`/officers/${officer.id}`, {
        region: form.region.trim() || null,
        sector_expertise: form.sector_expertise.trim() || null,
        target_companies: form.target_companies === '' ? 0 : Number(form.target_companies),
        target_offers: form.target_offers === '' ? 0 : Number(form.target_offers),
      })
      toast.success('Officer updated')
      onSaved(data)
      onClose()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Could not save changes'
      setError(detail)
      toast.error(detail)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={JSON.stringify(form) !== JSON.stringify(buildInitial())}
      panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white rounded-t-2xl">
        <ModalTitle>Edit officer</ModalTitle>
        <ModalClose />
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {error && (
          <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-900">{officer.officer_name ?? `Officer #${officer.id}`}</p>
          <p className="text-xs text-gray-500">{officer.email}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="officer-region" className="block text-sm font-medium text-gray-700 mb-1">
              Region
            </label>
            <input
              id="officer-region"
              autoFocus
              value={form.region}
              onChange={(e) => update('region', e.target.value)}
              placeholder="e.g. South"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="officer-sector" className="block text-sm font-medium text-gray-700 mb-1">
              Sector expertise
            </label>
            <input
              id="officer-sector"
              value={form.sector_expertise}
              onChange={(e) => update('sector_expertise', e.target.value)}
              placeholder="e.g. IT, Core"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="officer-target-companies" className="block text-sm font-medium text-gray-700 mb-1">
              Target companies
            </label>
            <input
              id="officer-target-companies"
              type="number"
              min={0}
              value={form.target_companies}
              onChange={(e) => update('target_companies', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="officer-target-offers" className="block text-sm font-medium text-gray-700 mb-1">
              Target offers
            </label>
            <input
              id="officer-target-offers"
              type="number"
              min={0}
              value={form.target_offers}
              onChange={(e) => update('target_offers', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Targets drive the “Target attainment” view on the placement head’s dashboard. Leave a
          target at 0 to leave that officer out of it.
        </p>

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
