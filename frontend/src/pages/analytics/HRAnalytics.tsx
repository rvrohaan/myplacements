import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import api from '@/lib/api'
import type { HRAnalytics as Payload } from '@/types'
import { cn } from '@/lib/utils'
import { CHART_AXIS, Empty, Panel, SERIES, Stat, pct } from './parts'
import { Table } from './CompanyAnalytics'

/** Engagement bands are a state, not a series — they get status colouring with
    the label always present, never colour alone. */
const BAND_STYLE: Record<string, string> = {
  responsive: 'bg-green-100 text-green-700',
  warm: 'bg-blue-100 text-blue-700',
  slow: 'bg-yellow-100 text-yellow-700',
  cold: 'bg-red-100 text-red-700',
  'no history': 'bg-gray-100 text-gray-600',
}

/**
 * Whether outreach is landing.
 *
 * Channel reply rates share their definition with the HR Communication report:
 * entries still awaiting an answer stay out of the denominator, because an
 * unanswered mail from this morning is not evidence of anything yet.
 */
export default function HRAnalytics() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get<Payload>('/analytics/hr')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-center py-20 text-gray-400">Loading HR analytics…</p>
  if (!data || data.contacts === 0) return <Empty>No HR contacts on file yet.</Empty>

  const overdue = data.followups.find((f) => f.bucket === 'Overdue')?.contacts ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Contacts" value={data.contacts} />
        <Stat label="Outreach logged" value={data.logged} />
        <Stat label="Reply rate" value={pct(data.reply_rate)} hint="Of outreach whose outcome was recorded" />
        <Stat label="Still awaiting" value={data.awaiting} hint="Logged, outcome not yet recorded" />
        <Stat label="Follow-ups overdue" value={overdue} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Which channels get answered"
          note="Rate is of the outreach whose outcome was recorded. A channel with nothing
            resolved yet shows no rate rather than 0%."
          className="overflow-x-auto"
        >
          <Table
            head={['Channel', 'Logged', 'Replied', 'No reply', 'Awaiting', 'Reply %']}
            rows={data.channels.map((c) => [
              c.channel, String(c.logged), String(c.replied), String(c.no_response),
              String(c.awaiting), pct(c.reply_rate),
            ])}
          />
        </Panel>

        <Panel title="Follow-ups" note="The same buckets the HR directory filters on.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.followups} layout="vertical" margin={{ top: 4, right: 44, left: 10, bottom: 4 }}>
              <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="bucket" tick={CHART_AXIS} width={130} />
              <Tooltip formatter={(v: number) => [`${v} contacts`, '']} />
              <Bar isAnimationActive={false} dataKey="contacts" fill={SERIES} radius={[0, 3, 3, 0]} barSize={16}>
                <LabelList dataKey="contacts" position="right" className="fill-gray-500 text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Relationship bands"
          note="Computed from the log. “No history” means nothing has been logged against that
            contact — not a score of zero, and not the same thing."
        >
          {data.engagement.length === 0 ? <Empty>Nothing scored yet.</Empty> : (
            <ul className="space-y-2">
              {data.engagement.map((b) => (
                <li key={b.band} className="flex items-center gap-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize w-24 text-center',
                                      BAND_STYLE[b.band] ?? 'bg-gray-100 text-gray-600')}>
                    {b.band}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full"
                         style={{ width: `${(b.contacts / data.contacts) * 100}%` }} />
                  </div>
                  <span className="text-sm text-gray-600 tabular-nums w-8 text-right">{b.contacts}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Needs chasing${data.alert_total > data.alerts.length ? ` (${data.alerts.length} of ${data.alert_total})` : ''}`}
          note="Overdue first, then the longest silences. A work queue, not a scoreboard."
          className="overflow-x-auto"
        >
          {data.alerts.length === 0 ? <Empty>Nothing overdue or gone cold.</Empty> : (
            <Table
              head={['Contact', 'Company', 'Why', 'Overdue by', 'Silent for']}
              rows={data.alerts.map((a) => [
                a.contact, a.company, a.reason,
                a.overdue_days == null ? '—' : `${a.overdue_days}d`,
                a.days_since_contact == null ? 'Never' : `${a.days_since_contact}d`,
              ])}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
