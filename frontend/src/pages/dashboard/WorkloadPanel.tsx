import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import type { OfficerWorkload } from '@/types'
import { cn } from '@/lib/utils'
import { Panel } from './StatCard'

/**
 * How evenly the open work is spread across the team.
 *
 * The officer progress table above ranks by what each officer has *landed*.
 * This is the other half: what they are each carrying right now. An officer
 * holding twice the companies and landing fewer offers is not underperforming,
 * and a table sorted by offers won says exactly that — so the two are shown
 * separately rather than merged into one score.
 *
 * One bar per officer, one row of numbers behind it. The verdict is stated in
 * words rather than left to be inferred from the bars, the same way the risk
 * calibration panel does it.
 */
export default function WorkloadPanel() {
  const [data, setData] = useState<OfficerWorkload | null>(null)

  useEffect(() => {
    api
      .get<OfficerWorkload>('/analytics/officer-workload')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
  }, [])

  if (!data || data.officers.length === 0) return null

  const max = Math.max(...data.officers.map((o) => o.load), 1)

  return (
    <Panel title="Workload balance">
      <p className="text-xs text-gray-500 -mt-1 mb-3">
        What each officer is carrying now — open companies, drives about to run, and
        follow-ups owed. Not what they have landed, and not progress against their
        targets; both of those are in the table below.
      </p>

      <Verdict spread={data.spread} fairShare={data.fair_share} />

      <ul className="space-y-2.5 mt-3">
        {data.officers.map((o) => (
          <li key={o.officer_id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-gray-800 truncate">{o.name}</span>
              <span className="text-gray-500 tabular-nums shrink-0">
                {o.share != null ? `${o.share}%` : '—'}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${(o.load / max) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {o.open_companies} open {o.open_companies === 1 ? 'company' : 'companies'}
              {o.upcoming_drives > 0 && (
                <> · {o.upcoming_drives} drive{o.upcoming_drives === 1 ? '' : 's'} coming</>
              )}
              {o.followups_overdue > 0 && (
                <span className="text-red-700">
                  {' '}· {o.followups_overdue} follow-up{o.followups_overdue === 1 ? '' : 's'} overdue
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>

      {(data.unassigned_companies > 0 || data.idle_officers > 0) && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
          {data.unassigned_companies > 0 && (
            <>
              {data.unassigned_companies} active{' '}
              {data.unassigned_companies === 1 ? 'company has' : 'companies have'} no officer.
              Balancing the rest says little while work sits unowned —{' '}
              <Link to="/companies" className="underline font-medium">
                allocate them
              </Link>
              .
            </>
          )}
          {data.unassigned_companies > 0 && data.idle_officers > 0 && ' '}
          {data.idle_officers > 0 && (
            <>
              {data.idle_officers}{' '}
              {data.idle_officers === 1 ? 'officer is' : 'officers are'} carrying nothing open.
            </>
          )}
        </p>
      )}

      <p className="text-xs text-gray-400 mt-3">
        Load weights an upcoming drive heaviest, then an overdue follow-up, then an open
        company. They are a considered guess at relative effort, not a measurement — a
        college that weighs its work differently should change them.
      </p>
    </Panel>
  )
}

/** The one number that answers the question, in words. */
function Verdict({
  spread,
  fairShare,
}: {
  spread?: number | null
  fairShare?: number | null
}) {
  if (spread == null) {
    return (
      <p className="text-xs text-gray-500">
        One officer carries everything by definition — balance needs a team to measure.
      </p>
    )
  }
  const tone = spread <= 10 ? 'text-green-700' : spread <= 20 ? 'text-amber-700' : 'text-red-700'
  const verdict =
    spread <= 10
      ? 'evenly spread'
      : spread <= 20
      ? 'somewhat uneven'
      : 'heavily skewed — one officer is carrying far more than the rest'
  return (
    <p className={cn('text-xs font-medium', tone)}>
      {spread} point gap between the busiest and the lightest · {verdict}
      {fairShare != null && (
        <span className="text-gray-400 font-normal"> · an equal share is {fairShare}%</span>
      )}
    </p>
  )
}
