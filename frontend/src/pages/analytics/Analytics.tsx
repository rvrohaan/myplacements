import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import PlacementAnalytics from './PlacementAnalytics'
import OfferAnalytics from './OfferAnalytics'
import StudentAnalytics from './StudentAnalytics'
import CompanyAnalytics from './CompanyAnalytics'
import HRAnalytics from './HRAnalytics'
import DriveAnalytics from './DriveAnalytics'

type Tab = 'placement' | 'offers' | 'students' | 'companies' | 'hr' | 'drives'

const TABS: { id: Tab; label: string }[] = [
  { id: 'placement', label: 'Placement' },
  { id: 'offers', label: 'Offers' },
  { id: 'students', label: 'Students' },
  { id: 'companies', label: 'Companies' },
  { id: 'hr', label: 'HR' },
  { id: 'drives', label: 'Drives' },
]

/** Tabs whose endpoints take a batch year. The others don't, and a filter that
    silently does nothing is worse than no filter. */
const BATCH_AWARE: Tab[] = ['offers', 'students', 'drives']

/**
 * Analytics, one question per tab.
 *
 *  - **Placement** counts students: how many of the year are placed, and at what
 *    package each of them ended up on.
 *  - **Offers** counts offers: a student holding three appears three times. The
 *    medians on the two tabs differ for that reason, not by mistake.
 *  - **Students** measures placement against the things that might explain it.
 *  - **Companies**, **HR** and **Drives** cover the pipeline that produces all of
 *    the above: which companies convert, whether outreach is answered, and how
 *    candidates move through the rounds.
 *
 * The batch filter is shown only on the tabs whose endpoints accept one (see
 * BATCH_AWARE); a filter that silently does nothing is worse than no filter.
 */
export default function Analytics() {
  const [tab, setTab] = useState<Tab>('placement')
  const [batchYear, setBatchYear] = useState('')
  const [years, setYears] = useState<number[]>([])
  const [scope, setScope] = useState<string | null>(null)

  useEffect(() => {
    api.get<number[]>('/analytics/batch-years').then((r) => setYears(r.data)).catch(() => {})
    // Every analytics endpoint narrows to a placement officer's own drives, while
    // the Students page shows the whole college. Without this line the two
    // disagree on screen for no visible reason — a student the officer can see
    // listed at 20 LPA simply isn't in their charts.
    api
      .get<{ scope?: string }>('/analytics/overview')
      .then((r) => setScope(r.data.scope ?? null))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {BATCH_AWARE.includes(tab) && years.length > 0 && (
          <select
            value={batchYear}
            onChange={(e) => setBatchYear(e.target.value)}
            aria-label="Filter by batch year"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Batches</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {scope === 'officer' && (
        <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          These figures cover only the students who sat drives at the companies
          allocated to you — not the whole college. The Students page is not
          narrowed this way, so a package listed there can sit outside these charts.
        </p>
      )}

      {tab === 'placement' && <PlacementAnalytics />}
      {tab === 'offers' && <OfferAnalytics batchYear={batchYear} />}
      {tab === 'students' && <StudentAnalytics batchYear={batchYear} />}
      {tab === 'companies' && <CompanyAnalytics />}
      {tab === 'hr' && <HRAnalytics />}
      {tab === 'drives' && <DriveAnalytics batchYear={batchYear} />}
    </div>
  )
}
