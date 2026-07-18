import { useEffect, useState } from 'react'
import { Building2, GraduationCap, CalendarDays, TrendingUp } from 'lucide-react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '@/lib/api'
import type { AnalyticsOverview } from '@/types'
import { formatCTC } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// Soft tinted chips: one hue per metric so the row scans at a glance,
// all muted so no single card shouts.
const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  teal: 'bg-teal-50 text-teal-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
} as const

function StatCard({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  tone: keyof typeof TONES
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200/70 p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONES[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 shadow-sm">
              <Skeleton className="w-10 h-10 rounded-lg bg-gray-200" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-16 bg-gray-200" />
                <Skeleton className="h-4 w-24 bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <Skeleton className="h-5 w-40 mb-4 bg-gray-200" />
              <Skeleton className="h-48 w-full bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={GraduationCap}
          label="Total Students"
          value={overview?.students.total ?? 0}
          sub={`${overview?.students.placement_rate ?? 0}% placed`}
          tone="blue"
        />
        <StatCard
          icon={Building2}
          label="Companies"
          value={overview?.companies.total ?? 0}
          sub={`${overview?.companies.active ?? 0} active`}
          tone="sky"
        />
        <StatCard
          icon={CalendarDays}
          label="Drives Conducted"
          value={overview?.drives.total ?? 0}
          tone="teal"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg CTC"
          value={formatCTC(overview?.offers.avg_ctc)}
          sub={`${overview?.offers.total ?? 0} total offers`}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Branch-wise Placement</h3>
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
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Placement Summary</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-baseline text-sm mb-1.5">
                <span className="text-gray-600">Placed Students</span>
                <span className="font-semibold tabular-nums text-gray-900">
                  {overview?.students.placed} / {overview?.students.total}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-sky-400 to-blue-600 h-1.5 rounded-full transition-all"
                  style={{ width: `${overview?.students.placement_rate ?? 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between items-baseline text-sm mb-1.5">
                <span className="text-gray-600">Offer Acceptance Rate</span>
                <span className="font-semibold tabular-nums text-gray-900">
                  {overview?.offers.total
                    ? Math.round(((overview.offers.accepted || 0) / overview.offers.total) * 100)
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-amber-400 to-amber-500 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${overview?.offers.total
                      ? Math.round(((overview.offers.accepted || 0) / overview.offers.total) * 100)
                      : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
