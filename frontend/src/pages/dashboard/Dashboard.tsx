import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import type { UserRole } from '@/types'
import { cn } from '@/lib/utils'
import CollegeDashboard from './CollegeDashboard'
import LeadershipDashboard from './LeadershipDashboard'
import OfficerDashboard from './OfficerDashboard'

// Placement heads get the team view: how each officer is progressing. Mirrors
// the backend's LEADERSHIP_ROLES on /analytics/officer-performance.
const LEADERSHIP_ROLES: UserRole[] = [
  'super_admin',
  'principal',
  'pro_chancellor',
  'deputy_pro_chancellor',
]

/**
 * The dashboard is per-user, not one shared page:
 *  - a placement officer sees only their own allocations and results
 *  - a Pro/Deputy Pro Chancellor (or Principal) sees their officers' progress,
 *    with the college-wide snapshot one tab away
 *  - everyone else keeps the college placement snapshot
 */
export default function Dashboard() {
  const role = useAuthStore((s) => s.user?.role)
  const [tab, setTab] = useState<'team' | 'college'>('team')

  if (role === 'placement_officer') return <OfficerDashboard />

  if (role && LEADERSHIP_ROLES.includes(role)) {
    return (
      <div className="space-y-5">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
          {(['team', 'college'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === t ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {t === 'team' ? 'Team progress' : 'College overview'}
            </button>
          ))}
        </div>
        {tab === 'team' ? <LeadershipDashboard /> : <CollegeDashboard />}
      </div>
    )
  }

  return <CollegeDashboard />
}
