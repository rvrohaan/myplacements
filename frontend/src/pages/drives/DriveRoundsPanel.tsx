import { useState } from 'react'
import { Layers, Check, Upload } from 'lucide-react'
import api from '@/lib/api'
import type { DriveRound } from '@/types'
import { cn } from '@/lib/utils'
import RoundResultsModal from './RoundResultsModal'

const passRate = (appeared?: number | null, passed?: number | null) => {
  if (!appeared || passed == null) return null
  return Math.round((passed / appeared) * 100)
}

/**
 * Interview-round funnel for a drive. Both "appeared" (who turned up) and
 * "passed" (who cleared) are editable per round, so drives that aren't
 * portal-driven can be tracked too. Recording a round's passed count auto-fills
 * the next round's appeared count when it's still empty — a convenience the
 * officer can always override.
 */
export default function DriveRoundsPanel({
  driveId,
  rounds,
  applicantCount,
  onRoundsChange,
  onResultsUploaded,
}: {
  driveId: number | string
  rounds: DriveRound[]
  applicantCount: number
  onRoundsChange: (rounds: DriveRound[]) => void
  onResultsUploaded: () => void
}) {
  // Per-round draft edits (keyed by round id) so counts aren't sent on every keystroke.
  const [drafts, setDrafts] = useState<Record<number, { name: string; appeared: string; passed: string }>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [uploadFor, setUploadFor] = useState<DriveRound | null>(null)

  // Round 1's appeared count is pre-filled from the portal applicant count while
  // it's still unset — a starting estimate the officer confirms or overrides.
  // Bulk/offline drives (no applicants) get no seed and are entered by hand.
  const isSeeded = (r: DriveRound) =>
    !drafts[r.id] && r.round_number === 1 && r.appeared_count == null && applicantCount > 0

  const draftFor = (r: DriveRound) =>
    drafts[r.id] ?? {
      name: r.name ?? '',
      appeared: r.appeared_count != null ? String(r.appeared_count) : isSeeded(r) ? String(applicantCount) : '',
      passed: r.passed_count != null ? String(r.passed_count) : '',
    }

  const setDraft = (r: DriveRound, patch: Partial<{ name: string; appeared: string; passed: string }>) =>
    setDrafts((p) => ({ ...p, [r.id]: { ...draftFor(r), ...patch } }))

  const isDirty = (r: DriveRound) => {
    // A seeded-but-unsaved round 1 is savable so the suggestion can be committed.
    if (isSeeded(r)) return true
    const d = drafts[r.id]
    if (!d) return false
    const appearedNow = r.appeared_count != null ? String(r.appeared_count) : ''
    const passedNow = r.passed_count != null ? String(r.passed_count) : ''
    return d.name !== (r.name ?? '') || d.appeared !== appearedNow || d.passed !== passedNow
  }

  const saveRound = async (r: DriveRound) => {
    const d = draftFor(r)
    const appeared = d.appeared.trim() === '' ? null : parseInt(d.appeared, 10)
    const passed = d.passed.trim() === '' ? null : parseInt(d.passed, 10)

    if (appeared != null && (Number.isNaN(appeared) || appeared < 0)) {
      setError('Enter a valid number of candidates who appeared')
      return
    }
    if (passed != null && (Number.isNaN(passed) || passed < 0)) {
      setError('Enter a valid number of candidates who passed')
      return
    }
    if (passed != null && appeared != null && passed > appeared) {
      setError(`Round ${r.round_number}: passed cannot exceed the ${appeared} who appeared`)
      return
    }
    setSavingId(r.id)
    setError('')
    try {
      await api.put(`/drives/${driveId}/rounds/${r.id}`, {
        name: d.name.trim() || null,
        appeared_count: appeared,
        passed_count: passed,
      })
      // Saving a passed count may seed the next round, so refetch the whole funnel.
      const fresh = await api.get(`/drives/${driveId}/rounds`)
      onRoundsChange(fresh.data)
      setDrafts((p) => {
        const next = { ...p }
        delete next[r.id]
        return next
      })
    } catch {
      setError('Could not save the round. Please try again.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-600" /> Interview Rounds
        </h3>
      </div>

      {rounds.length === 0 ? (
        <p className="text-sm text-gray-400 px-5 py-8 text-center">
          No rounds set. Edit the drive to set the number of interview rounds.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {error && (
            <div role="alert" className="mx-5 my-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          {rounds.map((r) => {
            const d = draftFor(r)
            const rate = passRate(r.appeared_count, r.passed_count)
            return (
              <div key={r.id} className="px-5 py-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold shrink-0',
                      r.passed_count != null ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    )}
                    title={r.passed_count != null ? 'Recorded' : 'Pending'}
                  >
                    {r.passed_count != null ? <Check className="w-3.5 h-3.5" /> : r.round_number}
                  </span>

                  <input
                    value={d.name}
                    onChange={(e) => setDraft(r, { name: e.target.value })}
                    placeholder={`Round ${r.round_number}`}
                    className="flex-1 min-w-[140px] px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />

                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-500">Appeared</label>
                    <input
                      value={d.appeared}
                      onChange={(e) => setDraft(r, { appeared: e.target.value })}
                      type="number"
                      min="0"
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      placeholder={r.round_number === 1 ? 'e.g. 1000' : '—'}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-500">Passed</label>
                    <input
                      value={d.passed}
                      onChange={(e) => setDraft(r, { passed: e.target.value })}
                      type="number"
                      min="0"
                      className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                      placeholder="—"
                    />
                  </div>

                  {rate != null && (
                    <span className="text-xs font-medium text-gray-400 whitespace-nowrap">{rate}% cleared</span>
                  )}

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setUploadFor(r)}
                      title="Upload appeared/passed roster"
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
                    >
                      <Upload className="w-3.5 h-3.5" /> Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => saveRound(r)}
                      disabled={!isDirty(r) || savingId === r.id}
                      className="px-3 py-1.5 text-xs font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-primary-600/25 transition-colors"
                    >
                      {savingId === r.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Funnel bar once a result is recorded; otherwise a hint if seeded. */}
                {r.passed_count != null && r.appeared_count ? (
                  <div className="mt-2.5 ml-10 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (r.passed_count / r.appeared_count) * 100)}%` }}
                    />
                  </div>
                ) : isSeeded(r) ? (
                  <p className="mt-2 ml-10 text-[11px] text-gray-400">
                    Pre-filled from {applicantCount} portal applicant{applicantCount === 1 ? '' : 's'} — adjust to
                    actual attendance, then save.
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {uploadFor && (
        <RoundResultsModal
          driveId={driveId}
          round={uploadFor}
          onClose={() => setUploadFor(null)}
          onDone={() => {
            setUploadFor(null)
            onResultsUploaded()
          }}
        />
      )}
    </div>
  )
}
