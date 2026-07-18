import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import api from '@/lib/api'
import type { AnalyticsOverview } from '@/types'
import { formatCTC } from '@/lib/utils'

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']

export default function Analytics() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [branchData, setBranchData] = useState<Array<{ branch: string; total: number; placed: number }>>([])
  const [ctcData, setCtcData] = useState<{ distribution: Array<{ range: string; count: number }>; min: number; max: number; avg: number; median: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/branch-wise'),
      api.get('/analytics/ctc-distribution'),
    ]).then(([ov, bw, ctc]) => {
      setOverview(ov.data)
      setBranchData(bw.data)
      setCtcData(ctc.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-20 text-gray-400">Loading analytics...</div>

  const placementPieData = [
    { name: 'Placed', value: overview?.students.placed ?? 0 },
    { name: 'Unplaced', value: (overview?.students.total ?? 0) - (overview?.students.placed ?? 0) },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Placement Rate', value: `${overview?.students.placement_rate ?? 0}%` },
          { label: 'Total Offers', value: overview?.offers.total ?? 0 },
          { label: 'Average CTC', value: formatCTC(overview?.offers.avg_ctc) },
          { label: 'Active Companies', value: overview?.companies.active ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-primary-600">{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Branch-wise Placement</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={branchData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" name="Total" fill="#93c5fd" radius={[3, 3, 0, 0]} />
              <Bar dataKey="placed" name="Placed" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Placement Status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={placementPieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {placementPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {ctcData && ctcData.distribution.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">CTC Distribution</h3>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>Min: {formatCTC(ctcData.min)}</span>
              <span>Avg: {formatCTC(ctcData.avg)}</span>
              <span>Median: {formatCTC(ctcData.median)}</span>
              <span>Max: {formatCTC(ctcData.max)}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={ctcData.distribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Students" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
