import { useEffect, useState } from 'react'
import { Building2, GraduationCap, CalendarDays, TrendingUp } from 'lucide-react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '@/lib/api'
import type { AnalyticsOverview } from '@/types'
import { formatCTC } from '@/lib/utils'
import { DashboardSkeleton, Panel, ProgressRow, StatCard } from './StatCard'

/**
 * The college-wide placement snapshot. Shown to staff who aren't scoped to their
 * own allocations (department coordinators) and, as the second half of the
 * leadership dashboard, to the placement head.
 */
export default function CollegeDashboard() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [branchData, setBranchData] = useState<Array<{ branch: string; total: number; placed: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/branch-wise'),
    ]).then(([ov, bw]) => {
      setOverview(ov.data)
      setBranchData(bw.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <DashboardSkeleton />

  const acceptanceRate = overview?.offers.total
    ? Math.round(((overview.offers.accepted || 0) / overview.offers.total) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={GraduationCap}
          label="Total Students"
          value={overview?.students.total ?? 0}
          sub={`${overview?.students.placement_rate ?? 0}% placed`}
          tone="blue"
          to="/students"
        />
        <StatCard
          icon={Building2}
          label="Companies"
          value={overview?.companies.total ?? 0}
          sub={`${overview?.companies.active ?? 0} active`}
          tone="sky"
          to="/companies"
        />
        <StatCard
          icon={CalendarDays}
          label="Drives Conducted"
          value={overview?.drives.total ?? 0}
          tone="teal"
          to="/drives"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg CTC"
          value={formatCTC(overview?.offers.avg_ctc)}
          sub={`${overview?.offers.total ?? 0} total offers`}
          tone="amber"
          to="/analytics"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Branch-wise Placement">
          {branchData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={branchData}
                margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                barGap={6}
                barCategoryGap="28%"
              >
                <defs>
                  <linearGradient id="barPlaced" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="branch"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                <Bar dataKey="total" name="Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Bar dataKey="placed" name="Placed" fill="url(#barPlaced)" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Placement Summary">
          <div className="space-y-4">
            <ProgressRow
              label="Placed Students"
              value={`${overview?.students.placed ?? 0} / ${overview?.students.total ?? 0}`}
              percent={overview?.students.placement_rate ?? 0}
            />
            <ProgressRow
              label="Offer Acceptance Rate"
              value={`${acceptanceRate}%`}
              percent={acceptanceRate}
              tone="amber"
            />
          </div>
        </Panel>
      </div>
    </div>
  )
}
