import { useEffect, useState } from 'react'
import { Sparkles, MapPin, Briefcase, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import type { AllocationPreview, AllocationProposal, Officer } from '@/types'
import { cn } from '@/lib/utils'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

// An editable copy of a proposal: the head can toggle it off, reassign the
// officer, or change the priority before applying.
interface Row {
  proposal: AllocationProposal
  include: boolean
  officerId: number
  priority: string
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  normal: 'bg-blue-100 text-blue-700',
  low: 'bg-gray-100 text-gray-600',
}

export default function AutoAllocateModal({
  onClose,
  onApplied,
}: {
  onClose: () => void
  onApplied: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<AllocationPreview | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [officers, setOfficers] = useState<Officer[]>([])
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string>('')

  const runPreview = () => {
    setLoading(true)
    setError('')
    setResult('')
    api
      .post('/officers/auto-allocate/preview')
      .then((r) => {
        const data: AllocationPreview = r.data
        setPreview(data)
        setRows(
          data.proposals.map((p) => ({
            proposal: p,
            include: true,
            officerId: p.officer_id,
            priority: p.priority,
          }))
        )
      })
      .catch((err) => setError(err?.response?.data?.detail ?? 'Failed to generate allocations'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    runPreview()
    api.get('/officers').then((r) => setOfficers(r.data)).catch(() => {})
  }, [])

  const officerName = (id: number) =>
    officers.find((o) => o.id === id)?.officer_name ?? `Officer #${id}`

  const update = (companyId: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.proposal.company_id === companyId ? { ...row, ...patch } : row)))

  const selectedCount = rows.filter((r) => r.include).length

  const apply = async () => {
    const allocations = rows
      .filter((r) => r.include)
      .map((r) => ({ company_id: r.proposal.company_id, officer_id: r.officerId, priority: r.priority }))
    if (allocations.length === 0) return
    setApplying(true)
    try {
      const r = await api.post('/officers/auto-allocate/apply', { allocations })
      const { created, skipped } = r.data
      if (skipped > 0) {
        setResult(`Assigned ${created} compan${created === 1 ? 'y' : 'ies'} (${skipped} skipped).`)
        setApplying(false)
        // Give the head a beat to read the result, then refresh.
        setTimeout(onApplied, 900)
      } else {
        onApplied()
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to apply allocations')
      setApplying(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      align="start"
      panelClassName="rounded-xl border border-gray-200 shadow-xl w-full max-w-4xl my-8"
    >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            <div>
              <ModalTitle className="text-base font-semibold text-gray-900">AI Auto-Assign Companies</ModalTitle>
              <p className="text-xs text-gray-500">
                Proposals weigh region, sector, relationship, workload, priority, follow-up urgency &amp; targets.
              </p>
            </div>
          </div>
          <ModalClose className="p-0" />
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Sparkles className="w-6 h-6 text-primary-500 animate-pulse mb-2" />
              <p className="text-sm">Analyzing companies and officers…</p>
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 py-8 text-center">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">
              {preview && preview.unassigned_count === 0
                ? 'Every company already has an assigned officer — nothing to allocate.'
                : 'The AI returned no allocations.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                {preview?.unassigned_count} unassigned compan{preview?.unassigned_count === 1 ? 'y' : 'ies'} across{' '}
                {preview?.officer_count} officer{preview?.officer_count === 1 ? '' : 's'}. Review, adjust, then apply.
              </p>
              <div className="space-y-2">
                {rows.map((row) => {
                  const p = row.proposal
                  return (
                    <div
                      key={p.company_id}
                      className={cn(
                        'rounded-lg border px-3 py-2.5 transition',
                        row.include ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(e) => update(p.company_id, { include: e.target.checked })}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900 text-sm">{p.company_name}</p>
                            {p.company_status === 'priority' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                                priority
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                            {p.company_sector && (
                              <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{p.company_sector}</span>
                            )}
                            {p.company_location && (
                              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.company_location}</span>
                            )}
                          </div>
                          {p.reasoning && <p className="text-xs text-gray-600 italic mt-1">{p.reasoning}</p>}
                        </div>
                        <ArrowRight className="w-4 h-4 text-gray-300 mt-1 shrink-0" />
                        <div className="flex flex-col gap-1.5 shrink-0 w-44">
                          <select
                            value={row.officerId}
                            onChange={(e) => update(p.company_id, { officerId: parseInt(e.target.value) })}
                            disabled={!row.include}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs bg-white disabled:bg-gray-100"
                          >
                            {officers.length === 0 && <option value={row.officerId}>{officerName(row.officerId)}</option>}
                            {officers.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.officer_name ?? `Officer #${o.id}`} ({o.active_count} active)
                              </option>
                            ))}
                          </select>
                          <select
                            value={row.priority}
                            onChange={(e) => update(p.company_id, { priority: e.target.value })}
                            disabled={!row.include}
                            className={cn(
                              'w-full px-2 py-1 rounded-md text-xs font-medium border-0 disabled:opacity-60',
                              PRIORITY_STYLES[row.priority] ?? PRIORITY_STYLES.normal
                            )}
                          >
                            <option value="low">Low priority</option>
                            <option value="normal">Normal priority</option>
                            <option value="high">High priority</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
          <div className="text-xs text-gray-500">
            {result ? <span className="text-green-600 font-medium">{result}</span> : !loading && !error && rows.length > 0 ? `${selectedCount} selected` : ''}
          </div>
          <div className="flex items-center gap-2">
            {!loading && !error && rows.length > 0 && (
              <button
                onClick={runPreview}
                disabled={applying}
                className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
              >
                Re-run
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Close
            </button>
            <button
              onClick={apply}
              disabled={loading || applying || selectedCount === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              {applying ? 'Applying…' : `Apply ${selectedCount || ''}`.trim()}
            </button>
          </div>
        </div>
    </Modal>
  )
}
