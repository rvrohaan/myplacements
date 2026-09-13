import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import api from '@/lib/api'
import type { OfferAnalytics as Payload } from '@/types'
import { formatCTC } from '@/lib/utils'
import { CHART_AXIS, Empty, Panel, SERIES, Stat, num, pct } from './parts'

/**
 * Offers cut by branch, company and role.
 *
 * Everything here counts **offers**, not students: a student holding three
 * offers appears three times. The Placement tab answers the other question —
 * what package did each student end up with — so the two medians differ on
 * purpose, and each card says which basis it is using.
 */
export default function OfferAnalytics({ batchYear }: { batchYear: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .get<Payload>('/analytics/offers', { params: batchYear ? { batch_year: batchYear } : {} })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [batchYear])

  if (loading) return <p className="text-center py-20 text-gray-400">Loading offer analytics…</p>
  if (!data || data.headline.offers === 0) {
    return <Empty>No offers recorded yet{batchYear ? ` for the ${batchYear} batch` : ''}.</Empty>
  }

  const { headline, funnel, lost, by_branch, by_company, by_role, offers_per_student } = data

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Offers" value={headline.offers} />
        <Stat
          label="Students holding one"
          value={headline.students_with_offer}
          hint={`${headline.students_with_multiple} hold more than one`}
        />
        <Stat label="Median offer" value={formatCTC(headline.median_ctc ?? undefined)} hint="Across live offers" />
        <Stat label="Highest offer" value={formatCTC(headline.highest_ctc ?? undefined)} />
        <Stat
          label="Reached joining"
          value={pct(headline.joining_conversion)}
          hint="Of the offers students accepted"
        />
        <Stat
          label="Fell through"
          value={pct(headline.dropout_rate)}
          hint={`${headline.awaiting_joining_date} live offers have no joining date`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="From offer to joining"
          note="Each stage is a subset of the one above it. Lost along the way:
            rejected and dropped out are counted separately below."
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 40, left: 70, bottom: 4 }}>
              <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" tick={CHART_AXIS} width={90} />
              <Tooltip formatter={(v: number) => [`${v} offers`, '']} />
              <Bar isAnimationActive={false} dataKey="count" fill={SERIES} radius={[0, 3, 3, 0]} barSize={18}>
                <LabelList dataKey="count" position="right" className="fill-gray-500 text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2">
            {lost.rejected} declined by the student · {lost.dropout} dropped out after accepting
          </p>
        </Panel>

        <Panel
          title="Offers per student"
          note="How many students are holding more than one offer — the reason an
            offer count is never a placement count."
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={offers_per_student} margin={{ top: 12, right: 8, left: -20, bottom: 4 }}>
              <XAxis dataKey="offers" tick={CHART_AXIS} />
              <YAxis tick={CHART_AXIS} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${v} students`, '']} labelFormatter={(l) => `${l} offer(s)`} />
              <Bar isAnimationActive={false} dataKey="students" fill={SERIES} radius={[3, 3, 0, 0]} barSize={46}>
                <LabelList dataKey="students" position="top" className="fill-gray-500 text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel
        title="By branch"
        note="Median and highest read off live offers only — an offer the student
          turned down was never this college's package."
        className="overflow-x-auto"
      >
        <Breakdown
          head={['Branch', 'Offers', 'Students', 'Joined', 'Median', 'Highest']}
          rows={by_branch.map((r) => [
            r.branch,
            String(r.offers),
            String(r.students),
            String(r.joined),
            formatCTC(r.median_ctc ?? undefined),
            formatCTC(r.highest_ctc ?? undefined),
          ])}
        />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="By company" note="Top 12 by offers made." className="overflow-x-auto">
          {by_company.length === 0 ? (
            <Empty>No offer carries a company yet.</Empty>
          ) : (
            <Breakdown
              head={['Company', 'Offers', 'Students', 'Median', 'Highest']}
              rows={by_company.map((r) => [
                r.company,
                String(r.offers),
                String(r.students),
                formatCTC(r.median_ctc ?? undefined),
                formatCTC(r.highest_ctc ?? undefined),
              ])}
            />
          )}
        </Panel>
        <Panel title="By role" note="Top 12 by offers made, matched case-insensitively." className="overflow-x-auto">
          {by_role.length === 0 ? (
            <Empty>No offer names a role yet.</Empty>
          ) : (
            <Breakdown
              head={['Role', 'Offers', 'Median']}
              rows={by_role.map((r) => [r.role, String(r.offers), formatCTC(r.median_ctc ?? undefined)])}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}

/** Several measures per category is a table's job, not a chart's — and it keeps
    two different scales off one pair of axes. */
function Breakdown({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={`py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i === 0 ? 'text-left' : 'text-right'}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((cells) => (
          <tr key={cells[0]}>
            {cells.map((c, i) => (
              <td
                key={i}
                className={`py-2 ${i === 0 ? 'font-medium text-gray-900' : 'text-right text-gray-600 tabular-nums'}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export { num }
