import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Briefcase,
  Building2,
  Clock,
  MessageSquare,
  ClipboardCheck,
  Table2,
  Target,
  UserCheck,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import api from '@/lib/api'
import type {
  ActivityStatus,
  DailyDigest,
  OfficerPerformance,
  OfficerPerformanceReport,
} from '@/types'
import { cn, formatCTC, formatDate } from '@/lib/utils'
import { DashboardSkeleton, Panel, StatCard } from './StatCard'

// How an officer's last logged activity reads at a glance.
const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  active: 'Active',
  slowing: 'Slowing',
  idle: 'Idle',
  no_activity: 'No activity',
}
const ACTIVITY_TONE: Record<ActivityStatus, string> = {
  active: 'bg-green-100 text-green-700',
  slowing: 'bg-amber-100 text-amber-700',
  idle: 'bg-red-100 text-red-700',
  no_activity: 'bg-gray-100 text-gray-600',
}

type SortKey = 'name' | 'companies_assigned' | 'communications_30d' | 'drives_total' | 'offers_won'
type View = 'chart' | 'table'
type Metric = 'work' | 'targets'

// The bars drawn in each chart mode, in draw order.
const WORK_SERIES = [
  { key: 'Companies', color: '#bae6fd' },
  { key: 'Outreach 30d', color: '#60a5fa' },
  { key: 'Drives', color: '#14b8a6' },
  { key: 'Offers', color: '#f59e0b' },
]
const TARGET_SERIES = [
  { key: 'Companies target %', color: '#38bdf8' },
  { key: 'Offers target %', color: '#f59e0b' },
]

const CHART_TOOLTIP = {
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
  fontSize: 12,
} as const

function MiniBar({ percent, tone }: { percent: number; tone: 'sky' | 'amber' }) {
  const bar = tone === 'sky' ? 'bg-sky-500' : 'bg-amber-500'
  return (
    <div className="w-16 bg-gray-100 rounded-full h-1.5">
      <div className={`${bar} h-1.5 rounded-full`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  )
}

/**
 * The placement head's dashboard (Pro Chancellor / Deputy Pro Chancellor /
 * Principal). Instead of raw college totals it leads with how each placement
 * officer is progressing: what they own, what they've worked, and what they've
 * landed against their targets.
 */
export default function LeadershipDashboard() {
  const [report, setReport] = useState<OfficerPerformanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('offers_won')
  const [view, setView] = useState<View>('chart')
  const [metric, setMetric] = useState<Metric>('work')
  // Today's filing compliance, for the chip through to the digest. Failure is
  // silent - the dashboard stands on its own without it.
  const [digest, setDigest] = useState<DailyDigest | null>(null)

  useEffect(() => {
    api
      .get('/analytics/officer-performance')
      .then((r) => setReport(r.data))
      .finally(() => setLoading(false))
    api
      .get('/daily-updates/digest')
      .then((r) => setDigest(r.data))
      .catch(() => setDigest(null))
  }, [])

  const officers = useMemo(() => {
    const rows = [...(report?.officers ?? [])]
    rows.sort((a, b) =>
      sortKey === 'name'
        ? a.name.localeCompare(b.name)
        : (b[sortKey] as number) - (a[sortKey] as number)
    )
    return rows
  }, [report, sortKey])

  if (loading) return <DashboardSkeleton cards={4} panels={2} />

  const totals = report?.totals
  const series = metric === 'work' ? WORK_SERIES : TARGET_SERIES
  // Attainment is only meaningful for officers who have a target to hit. Officers
  // without one would otherwise plot as a flat 0%, which reads as "failing"
  // rather than "nothing to measure against".
  const withTargets = officers.filter((o) => o.target_companies > 0 || o.target_offers > 0)
  const withoutTargets = officers.filter((o) => !o.target_companies && !o.target_offers)
  const plotted = metric === 'work' ? officers : withTargets
  // Recharts lays a vertical-layout chart out in data order, top-down, so the
  // sorted leader lands at the top as-is.
  const chartData = plotted.map((o) =>
    metric === 'work'
      ? {
          name: o.name,
          Companies: o.companies_assigned,
          'Outreach 30d': o.communications_30d,
          Drives: o.drives_total,
          Offers: o.offers_won,
        }
      : {
          name: o.name,
          'Companies target %': o.company_target_percent,
          'Offers target %': o.offer_target_percent,
        }
  )
  // Give every officer a comfortable band rather than squashing them together.
  const chartHeight = Math.max(220, plotted.length * (metric === 'work' ? 76 : 56) + 50)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Placement team progress</h2>
        <p className="text-sm text-gray-500">
          How each placement officer is tracking against their allocations and targets.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="Placement Officers"
          value={totals?.officers ?? 0}
          sub={`${totals?.needs_attention ?? 0} need attention`}
          tone="violet"
          to="/officers"
        />
        <StatCard
          icon={Building2}
          label="Companies Allocated"
          value={totals?.companies_assigned ?? 0}
          sub={`${totals?.unassigned_companies ?? 0} still unassigned`}
          tone="sky"
          to="/companies"
        />
        <StatCard
          icon={MessageSquare}
          label="Team Outreach (30 days)"
          value={totals?.communications_30d ?? 0}
          sub={`${totals?.overdue_followups ?? 0} follow-ups overdue`}
          tone="blue"
          to="/communications"
        />
        <StatCard
          icon={Briefcase}
          label="Offers Landed"
          value={totals?.offers_won ?? 0}
          sub={`${totals?.students_placed ?? 0} students placed · ${totals?.drives_total ?? 0} drives`}
          tone="amber"
          to="/drives"
        />
      </div>

      {(!!totals?.pending_lead_reviews || !!totals?.unassigned_companies || !!totals?.needs_attention) && (
        <div className="flex flex-wrap gap-3">
          {!!totals?.pending_lead_reviews && (
            <Link
              to="/companies"
              className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 transition-colors hover:bg-blue-100"
            >
              <UserCheck className="w-4 h-4" />
              {totals.pending_lead_reviews} officer lead
              {totals.pending_lead_reviews === 1 ? '' : 's'} awaiting your review
            </Link>
          )}
          {!!totals?.unassigned_companies && (
            <Link
              to="/companies"
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Building2 className="w-4 h-4" />
              {totals.unassigned_companies} compan
              {totals.unassigned_companies === 1 ? 'y has' : 'ies have'} no officer yet
            </Link>
          )}
          {!!totals?.needs_attention && (
            <span className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4" />
              {totals.needs_attention} officer{totals.needs_attention === 1 ? '' : 's'} logged nothing in 30 days
            </span>
          )}
          {digest && digest.compliance.expected > 0 && (
            <Link
              to="/daily-digest"
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                digest.compliance.missing
                  ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100',
              )}
            >
              <ClipboardCheck className="w-4 h-4" />
              {digest.compliance.filed}/{digest.compliance.expected} daily updates filed today
              {!!digest.attention.escalations.length && (
                <span className="font-medium">
                  &middot; {digest.attention.escalations.length} escalation
                  {digest.attention.escalations.length === 1 ? '' : 's'}
                </span>
              )}
            </Link>
          )}
        </div>
      )}

      <Panel
        title="Officer progress"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            {view === 'chart' && (
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary-400 focus:outline-none"
              >
                <option value="work">Workload &amp; results</option>
                <option value="targets">Target attainment</option>
              </select>
            )}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary-400 focus:outline-none"
            >
              <option value="offers_won">Sort: offers landed</option>
              <option value="companies_assigned">Sort: companies owned</option>
              <option value="communications_30d">Sort: recent outreach</option>
              <option value="drives_total">Sort: drives</option>
              <option value="name">Sort: name</option>
            </select>
            <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
              {([
                { id: 'chart', icon: BarChart3, label: 'Chart' },
                { id: 'table', icon: Table2, label: 'Table' },
              ] as const).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  title={`${label} view`}
                  aria-pressed={view === id}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors',
                    view === id ? 'bg-primary-600 text-white' : 'text-gray-500 hover:text-gray-900'
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {officers.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            No placement officers yet.{' '}
            <Link to="/officers" className="text-primary-600 hover:underline">
              Add one
            </Link>{' '}
            to start tracking progress.
          </div>
        ) : view === 'chart' && metric === 'targets' && plotted.length === 0 ? (
          // Targets default to 0 on a new officer card, so attainment has nothing
          // to plot until someone sets them. Say that instead of drawing a blank
          // chart that reads as broken.
          <div className="py-10 text-center text-sm text-gray-500">
            <Target className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            <p>No targets set for any officer yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              Set company and offer targets on each officer&apos;s card under{' '}
              <Link to="/officers" className="text-primary-600 hover:underline">
                Officers
              </Link>{' '}
              to track attainment here. Switch to “Workload &amp; results” to see
              what the team is working on today.
            </p>
          </div>
        ) : view === 'chart' ? (
          <>
            <ResponsiveContainer width="100%" height={chartHeight}>
              {/* Keyed by metric: switching modes swaps every series' dataKey,
                  and reconciling the old bars onto the new scale leaves them
                  drawn at stale widths. Remounting avoids that. */}
              <BarChart
                key={metric}
                data={chartData}
                layout="vertical"
                margin={{ top: 5, right: 24, left: 8, bottom: 5 }}
                barGap={3}
                barCategoryGap="22%"
              >
                <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                <XAxis
                  type="number"
                  domain={metric === 'targets' ? [0, 100] : undefined}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  unit={metric === 'targets' ? '%' : undefined}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 12, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    fill={s.color}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={14}
                    unit={metric === 'targets' ? '%' : undefined}
                    // Recharts freezes the grow-in animation at its start frame
                    // when the series are swapped, leaving zero-width bars.
                    isAnimationActive={false}
                  >
                    {/* Percentages are often small enough that the bar alone is
                        unreadable, so print the value at its end. */}
                    {metric === 'targets' && (
                      <LabelList
                        dataKey={s.key}
                        position="right"
                        formatter={(v: number) => `${v}%`}
                        style={{ fontSize: 11, fill: '#64748b' }}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            {metric === 'targets' && withoutTargets.length > 0 && (
              <p className="mt-2 text-[11px] text-gray-400">
                Not shown (no target set):{' '}
                {withoutTargets.map((o) => o.name).join(', ')}
              </p>
            )}
            {/* The chart can't carry the "is this officer still working?" signal,
                so the badges ride underneath it. */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
              {officers.map((o) => (
                <span
                  key={o.officer_id}
                  className="inline-flex items-center gap-1.5 text-[11px] text-gray-500"
                >
                  <span className="font-medium text-gray-700">{o.name}</span>
                  <span
                    className={cn('rounded px-1.5 py-0.5 font-medium', ACTIVITY_TONE[o.activity_status])}
                  >
                    {ACTIVITY_LABEL[o.activity_status]}
                  </span>
                  {o.overdue_followups > 0 && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-600">
                      {o.overdue_followups} overdue
                    </span>
                  )}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Officer</th>
                  <th className="pb-2 font-medium">Activity</th>
                  <th className="pb-2 font-medium text-right">Companies</th>
                  <th className="pb-2 font-medium text-right">Open</th>
                  <th className="pb-2 font-medium text-right">Outreach 30d</th>
                  <th className="pb-2 font-medium text-right">Overdue</th>
                  <th className="pb-2 font-medium text-right">Drives</th>
                  <th className="pb-2 font-medium text-right pr-6">Offers</th>
                  <th className="pb-2 font-medium">Targets</th>
                  <th className="pb-2 font-medium text-right">Last logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {officers.map((o) => (
                  <OfficerRow key={o.officer_id} officer={o} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Team activity over the last 6 months">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={report?.trend ?? []} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
            <Bar dataKey="communications" name="Outreach" fill="#bae6fd" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Line type="monotone" dataKey="drives" name="Drives" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="offers" name="Offers" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

function OfficerRow({ officer: o }: { officer: OfficerPerformance }) {
  return (
    <tr className="hover:bg-gray-50/60">
      <td className="py-2.5 pr-3">
        <Link to="/officers" className="font-medium text-gray-900 hover:text-primary-600">
          {o.name}
        </Link>
        <p className="text-xs text-gray-500">
          {[o.department, o.region, o.sector_expertise].filter(Boolean).join(' · ') || '—'}
        </p>
      </td>
      <td className="py-2.5 pr-3">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            ACTIVITY_TONE[o.activity_status]
          )}
        >
          {ACTIVITY_LABEL[o.activity_status]}
        </span>
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">{o.companies_assigned}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">{o.open_assignments}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">{o.communications_30d}</td>
      <td
        className={cn(
          'py-2.5 pr-3 text-right tabular-nums',
          o.overdue_followups > 0 ? 'text-red-600 font-medium' : 'text-gray-400'
        )}
      >
        {o.overdue_followups}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">
        {o.drives_total}
        {o.drives_upcoming > 0 && (
          <span className="text-[11px] text-gray-400"> (+{o.drives_upcoming})</span>
        )}
      </td>
      <td className="py-2.5 pr-6 text-right tabular-nums text-gray-900 font-medium">
        {o.offers_won}
        {o.avg_ctc > 0 && (
          <p className="text-[11px] font-normal text-gray-400">{formatCTC(o.avg_ctc)}</p>
        )}
      </td>
      <td className="py-2.5 pr-3">
        {o.target_companies || o.target_offers ? (
          <div className="space-y-1">
            {!!o.target_companies && (
              <div className="flex items-center gap-2">
                <MiniBar percent={o.company_target_percent} tone="sky" />
                <span className="text-[11px] text-gray-500 tabular-nums">
                  {o.companies_assigned}/{o.target_companies} co.
                </span>
              </div>
            )}
            {!!o.target_offers && (
              <div className="flex items-center gap-2">
                <MiniBar percent={o.offer_target_percent} tone="amber" />
                <span className="text-[11px] text-gray-500 tabular-nums">
                  {o.offers_won}/{o.target_offers} off.
                </span>
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-400">No targets set</span>
        )}
      </td>
      <td className="py-2.5 text-right text-xs text-gray-500 tabular-nums">
        {o.last_activity ? (
          formatDate(o.last_activity)
        ) : (
          <span className="inline-flex items-center gap-1 text-gray-400">
            <Clock className="w-3 h-3" /> Never
          </span>
        )}
      </td>
    </tr>
  )
}
