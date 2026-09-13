import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import api from '@/lib/api'
import type { CompanyAnalytics as Payload } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { CHART_AXIS, Empty, Panel, SERIES, Stat, pct } from './parts'

/**
 * Where the company pipeline actually is.
 *
 * Shares its arithmetic with the Company Conversion report, so the chart and
 * the downloadable table cannot disagree about what "contacted" means.
 */
export default function CompanyAnalytics() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get<Payload>('/analytics/companies')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-center py-20 text-gray-400">Loading company analytics…</p>
  if (!data || data.companies === 0) return <Empty>No companies on file yet.</Empty>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Companies" value={data.companies} />
        <Stat label="Outreach logged" value={data.logged} />
        <Stat label="Answered" value={pct(data.reply_rate)} hint="Of everything logged" />
        <Stat label="Gone quiet" value={data.stale} hint="No contact logged in 30 days" />
        <Stat label="Never contacted" value={data.never_contacted} />
        <Stat label="No owner" value={data.unassigned} hint={`${data.without_contacts} have no HR contact`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Pipeline"
          note="Each stage is a subset of the one above it — the same funnel the Company
            Conversion report prints."
        >
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={data.funnel} layout="vertical" margin={{ top: 4, right: 44, left: 10, bottom: 4 }}>
              <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" tick={CHART_AXIS} width={150} />
              <Tooltip formatter={(v: number) => [`${v} companies`, '']} />
              <Bar isAnimationActive={false} dataKey="companies" fill={SERIES} radius={[0, 3, 3, 0]} barSize={16}>
                <LabelList dataKey="companies" position="right" className="fill-gray-500 text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Status mix" note="In attention order, the same order the Companies list sorts by.">
          {data.status_mix.length === 0 ? <Empty>Nothing recorded.</Empty> : (
            <ul className="space-y-2">
              {data.status_mix.map((s) => (
                <li key={s.status} className="flex items-center gap-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize w-24 text-center',
                                      STATUS_COLORS[s.status])}>
                    {s.status}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full"
                         style={{ width: `${(s.companies / data.companies) * 100}%` }} />
                  </div>
                  <span className="text-sm text-gray-600 tabular-nums w-8 text-right">{s.companies}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Best converting" note="Top ten by students placed, then offers." className="overflow-x-auto">
          <Table
            head={['Company', 'Logged', 'Reply %', 'Drives', 'Offers', 'Placed']}
            rows={data.top_companies.map((c) => [
              c.company, String(c.logged), pct(c.reply_rate), String(c.drives),
              String(c.offers), String(c.students_placed),
            ])}
          />
        </Panel>
        <Panel
          title="Going quiet"
          note="Workable companies with nothing logged lately and no offer yet. Dormant and
            blacklisted ones are left out — they are quiet on purpose."
          className="overflow-x-auto"
        >
          {data.going_quiet.length === 0 ? <Empty>Nothing has gone quiet.</Empty> : (
            <Table
              head={['Company', 'Owner', 'Days since contact', 'Logged']}
              rows={data.going_quiet.map((c) => [
                c.company, c.owner,
                c.days_since_contact == null ? 'Never' : String(c.days_since_contact),
                String(c.logged),
              ])}
            />
          )}
        </Panel>
      </div>

      {data.engagement.length > 0 && (
        <Panel
          title="Strongest relationships"
          note="Averaged from each company's HR contacts, using the same scorer the HR
            directory shows per contact."
          className="overflow-x-auto"
        >
          <Table
            head={['Company', 'Engagement', 'Contacts scored']}
            rows={data.engagement.map((e) => [e.company, String(e.score), String(e.contacts_scored)])}
          />
        </Panel>
      )}
    </div>
  )
}

/** Several measures per row is a table's job — and it keeps two scales off one axis. */
export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <Empty>Nothing to show.</Empty>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} scope="col"
                className={cn('py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide',
                              i === 0 ? 'text-left' : 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((c, i) => (
              <td key={i} className={cn('py-2', i === 0 ? 'font-medium text-gray-900'
                                                        : 'text-right text-gray-600 tabular-nums')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
