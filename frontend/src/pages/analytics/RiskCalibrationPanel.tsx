import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { RiskCalibration } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { Empty, Panel, pct } from './parts'

/**
 * Does the risk score actually predict placement?
 *
 * Scored on inputs only — the stored band sets a placed student to low risk by
 * definition, so validating that against placement would be measuring its own
 * definition. Two models are shown side by side so a change to the scorer can be
 * argued from this college's outcomes rather than asserted.
 */
export default function RiskCalibrationPanel({ batchYear }: { batchYear: string }) {
  const [data, setData] = useState<RiskCalibration | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .get<RiskCalibration>('/analytics/risk-calibration', {
        params: batchYear ? { batch_year: batchYear } : {},
      })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [batchYear])

  if (loading || !data) return null
  if (data.students === 0) return null

  return (
    <Panel
      title="Does the risk score predict placement?"
      note={
        <>
          Scored on marks, backlogs, skills and the rest of the profile — never on
          placement status, which the stored band folds in and which would make this
          circular. {data.students} student{data.students === 1 ? '' : 's'} who were
          seeking placement
          {data.excluded_not_seeking > 0 && (
            <> ({data.excluded_not_seeking} who opted out or went for higher studies are left
              out — they were never trying to be placed)</>
          )}
          .
        </>
      }
    >
      {!batchYear && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Pick a batch whose outcomes are settled. Pooling a finished year with one still in
          progress hides whatever signal either has.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.models.map((model) => (
          <div key={model.key} className="border border-gray-200 rounded-lg p-4">
            <p className="font-medium text-gray-900 text-sm">{model.label}</p>
            <Verdict separation={model.separation} />
            <table className="w-full text-sm mt-3">
              <thead>
                <tr>
                  {['Band', 'Students', 'Placed', 'Placement %'].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        'py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide',
                        i === 0 ? 'text-left' : 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {model.bands.map((b) => (
                  <tr key={b.band}>
                    <td className="py-1.5">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          STATUS_COLORS[b.band],
                        )}
                      >
                        {b.band}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-gray-600 tabular-nums">{b.students}</td>
                    <td className="py-1.5 text-right text-gray-600 tabular-nums">{b.placed}</td>
                    <td className="py-1.5 text-right font-medium text-gray-900 tabular-nums">
                      {pct(b.placement_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        A working model places its low-risk students far more often than its high-risk ones.
        If the two rates are close, the bands carry no information however confident they look
        on the Students page — and a negative gap means it is pointing the wrong way.
      </p>
    </Panel>
  )
}

/** The one number that answers the question, stated in words rather than left
    for the reader to infer from four percentages. */
function Verdict({ separation }: { separation?: number | null }) {
  if (separation == null) {
    return <p className="text-xs text-gray-500 mt-1">Not enough students in both bands to tell.</p>
  }
  const tone =
    separation >= 25 ? 'text-green-700' : separation > 5 ? 'text-amber-700' : 'text-red-700'
  const verdict =
    separation >= 25
      ? 'separates well'
      : separation > 5
      ? 'separates weakly'
      : separation >= -5
      ? 'does not separate — the bands carry no information'
      : 'points the wrong way'
  return (
    <p className={cn('text-xs mt-1 font-medium', tone)}>
      {separation > 0 ? '+' : ''}
      {separation} point gap · {verdict}
    </p>
  )
}
