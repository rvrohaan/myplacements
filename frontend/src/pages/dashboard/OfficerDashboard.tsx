import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  MessageSquare,
  Target,
} from 'lucide-react'
import api from '@/lib/api'
import type { DailyUpdateToday, MyWork } from '@/types'
import { cn, formatCTC, formatDate, STATUS_COLORS } from '@/lib/utils'
import { DashboardSkeleton, Panel, ProgressRow, StatCard } from './StatCard'

/**
 * A placement officer's personal dashboard. Every number here comes from
 * /analytics/my-work, which is scoped server-side to the companies allocated to
 * this officer — an officer never sees another officer's portfolio.
 */
export default function OfficerDashboard() {
  const [work, setWork] = useState<MyWork | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Whether today's daily update is still outstanding. A failure here is silent:
  // the dashboard is still useful without the nudge.
  const [updateDue, setUpdateDue] = useState<DailyUpdateToday | null>(null)

  useEffect(() => {
    api
      .get('/daily-updates/today')
      .then((r) => setUpdateDue(r.data))
      .catch(() => setUpdateDue(null))
  }, [])

  useEffect(() => {
    api
      .get('/analytics/my-work')
      .then((r) => setWork(r.data))
      .catch((e) =>
        setError(
          e?.response?.status === 404
            ? 'Your account is not linked to a placement officer profile yet. Ask the placement head to add you under Officers.'
            : 'Could not load your dashboard. Please try again.'
        )
      )
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <DashboardSkeleton cards={4} panels={2} />

  if (error || !work) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center shadow-sm">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-sm text-gray-600 max-w-md mx-auto">{error}</p>
      </div>
    )
  }

  const { targets, communications, offers, drives, companies, assignments } = work

  return (
    <div className="space-y-6">
      {updateDue && !updateDue.existing && (
        <Link
          to="/daily-update"
          className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-900 rounded-xl px-4 py-3 text-sm transition-colors"
        >
          <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">Today&rsquo;s update isn&rsquo;t filed yet.</span>{' '}
            It takes a minute &mdash; your call and drive counts are already filled in.
          </span>
          <span className="ml-auto font-medium whitespace-nowrap">Due {updateDue.cutoff} &rarr;</span>
        </Link>
      )}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">My work</h2>
        <p className="text-sm text-gray-500">
          {work.officer.name}
          {work.officer.region ? ` · ${work.officer.region}` : ''}
          {work.officer.sector_expertise ? ` · ${work.officer.sector_expertise}` : ''}
          {' — showing only the companies allocated to you.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}
          label="My Companies"
          value={companies.total}
          sub={`${assignments.open} open · ${assignments.by_status?.completed ?? 0} completed`}
          tone="sky"
          to="/companies"
        />
        <StatCard
          icon={MessageSquare}
          label="Outreach (30 days)"
          value={communications.last_30_days}
          sub={`${communications.total} logged in total`}
          tone="blue"
          to="/communications"
        />
        <StatCard
          icon={CalendarDays}
          label="My Drives"
          value={drives.total}
          sub={`${drives.upcoming} upcoming · ${drives.completed} done`}
          tone="teal"
          to="/drives"
        />
        <StatCard
          icon={Briefcase}
          label="Offers Landed"
          value={offers.won}
          sub={offers.avg_ctc ? `avg ${formatCTC(offers.avg_ctc)}` : `${offers.total} offers rolled out`}
          tone="amber"
          to="/drives"
        />
      </div>

      {(communications.overdue_followups > 0 || companies.stale > 0) && (
        <div className="flex flex-wrap gap-3">
          {communications.overdue_followups > 0 && (
            <Link
              to="/communications"
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition-colors hover:bg-red-100"
            >
              <Clock className="w-4 h-4" />
              {communications.overdue_followups} follow-up
              {communications.overdue_followups === 1 ? '' : 's'} overdue
            </Link>
          )}
          {companies.stale > 0 && (
            <span className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              {companies.stale} compan{companies.stale === 1 ? 'y has' : 'ies have'} had no contact in 30 days
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="My targets">
          <div className="space-y-4">
            <ProgressRow
              label="Companies owned"
              value={
                targets.companies.target
                  ? `${targets.companies.achieved} / ${targets.companies.target}`
                  : `${targets.companies.achieved}`
              }
              percent={targets.companies.percent}
            />
            <ProgressRow
              label="Offers landed"
              value={
                targets.offers.target
                  ? `${targets.offers.achieved} / ${targets.offers.target}`
                  : `${targets.offers.achieved}`
              }
              percent={targets.offers.percent}
              tone="amber"
            />
            {!targets.companies.target && !targets.offers.target && (
              <p className="text-xs text-gray-400">
                No targets set for you yet — the placement head sets these on your officer card.
              </p>
            )}
            <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500 text-xs">Students from my drives</p>
                <p className="font-semibold tabular-nums text-gray-900">{work.students.participated}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">Placed among them</p>
                <p className="font-semibold tabular-nums text-gray-900">{work.students.placed}</p>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Follow-ups due"
          action={
            <Link to="/communications" className="text-xs font-medium text-primary-600 hover:underline">
              All communications
            </Link>
          }
        >
          {work.upcoming_followups.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              <CheckCircle2 className="w-5 h-5 mx-auto mb-2 text-gray-300" />
              Nothing pending
            </div>
          ) : (
            <ul className="space-y-2.5">
              {work.upcoming_followups.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link
                      to={`/companies/${f.company_id}`}
                      className="font-medium text-gray-900 hover:text-primary-600 truncate block"
                    >
                      {f.company_name ?? 'Company'}
                    </Link>
                    <p className="text-xs text-gray-500 truncate">{f.subject || f.comm_type}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                      f.overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {formatDate(f.next_followup_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="My recent activity">
          {work.recent_activity.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              No communications logged yet
            </div>
          ) : (
            <ul className="space-y-2.5">
              {work.recent_activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link
                      to={`/companies/${a.company_id}`}
                      className="font-medium text-gray-900 hover:text-primary-600 truncate block"
                    >
                      {a.company_name ?? 'Company'}
                    </Link>
                    <p className="text-xs text-gray-500 capitalize truncate">
                      {a.comm_type}
                      {a.subject ? ` · ${a.subject}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {formatDate(a.communicated_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="My companies"
        action={
          <Link to="/companies" className="text-xs font-medium text-primary-600 hover:underline">
            Open companies
          </Link>
        }
      >
        {work.my_companies.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            <Target className="w-6 h-6 mx-auto mb-2 text-gray-300" />
            No companies allocated to you yet.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Allocation</th>
                  <th className="pb-2 font-medium text-right">Drives</th>
                  <th className="pb-2 font-medium text-right">Offers</th>
                  <th className="pb-2 font-medium text-right">Last contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {work.my_companies.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/60">
                    <td className="py-2.5 pr-3">
                      <Link
                        to={`/companies/${c.id}`}
                        className="font-medium text-gray-900 hover:text-primary-600"
                      >
                        {c.name}
                      </Link>
                      {c.sector && <p className="text-xs text-gray-500">{c.sector}</p>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {c.status && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
                            STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {c.status}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {c.assignment_status && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
                            STATUS_COLORS[c.assignment_status] ?? 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {c.assignment_status}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">{c.drives}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">{c.offers}</td>
                    <td
                      className={cn(
                        'py-2.5 text-right text-xs tabular-nums',
                        c.stale ? 'text-amber-600 font-medium' : 'text-gray-500'
                      )}
                    >
                      {c.days_since_contact == null
                        ? 'Never'
                        : c.days_since_contact === 0
                          ? 'Today'
                          : `${c.days_since_contact}d ago`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
