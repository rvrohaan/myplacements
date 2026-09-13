import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts'
import api from '@/lib/api'
import type { DriveAnalytics as Payload } from '@/types'
import { CHART_AXIS, Empty, Panel, SERIES, SERIES_A, SERIES_B, Stat, pct } from './parts'
import { Table } from './CompanyAnalytics'

/**
 * How drives convert.
 *
 * Round figures are the counts officers entered per round, not a recomputation
 * from participant statuses. The two can legitimately differ — a student who
 * cleared a round then withdrew — and quietly reconciling them would hide that
 * rather than show it, so the two views sit side by side.
 */
export default function DriveAnalytics({ batchYear }: { batchYear: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get<Payload>('/analytics/drives', { params: batchYear ? { batch_year: batchYear } : {} })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [batchYear])

  if (loading) return <p className="text-center py-20 text-gray-400">Loading drive analytics…</p>
  if (!data || data.drives === 0) return <Empty>No drives recorded yet.</Empty>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Drives" value={data.drives} />
        <Stat label="Participants" value={data.participants} />
        <Stat label="Selected" value={pct(data.conversion.selection_rate)} hint="Of everyone who registered" />
        <Stat
          label="Offers per selection"
          value={data.conversion.offers_per_selection ?? '—'}
          hint="Above 1 means more offers than selections recorded"
        />
        <Stat label="Offers taken up" value={pct(data.conversion.offer_conversion)}
              hint={`${data.conversion.offers_won} accepted or joined`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Participant funnel"
          note="From the participant list. Each stage is a subset of the one above it."
        >
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={data.funnel} layout="vertical" margin={{ top: 4, right: 44, left: 10, bottom: 4 }}>
              <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" tick={CHART_AXIS} width={130} />
              <Tooltip formatter={(v: number) => [`${v} students`, '']} />
              <Bar isAnimationActive={false} dataKey="count" fill={SERIES} radius={[0, 3, 3, 0]} barSize={16}>
                <LabelList dataKey="count" position="right" className="fill-gray-500 text-xs" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2">
            {data.lost.rejected} rejected by the company · {data.lost.withdrawn} withdrew
          </p>
        </Panel>

        <Panel
          title="Round by round"
          note="The appeared/passed counts officers entered, summed across drives. A round
            nobody has filled in yet is left out rather than counted as zero."
        >
          {data.rounds.length === 0 ? <Empty>No round counts recorded yet.</Empty> : (
            <ResponsiveContainer width="100%" height={Math.max(180, data.rounds.length * 58)}>
              <BarChart data={data.rounds} layout="vertical"
                        margin={{ top: 4, right: 50, left: 10, bottom: 4 }} barGap={2}>
                <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={CHART_AXIS} width={90} />
                <Tooltip formatter={(v: number, name) => [v, name]} />
                <Legend verticalAlign="top" height={26} iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="appeared" name="Appeared" fill={SERIES_A}
                     radius={[0, 3, 3, 0]} barSize={11}>
                  <LabelList dataKey="appeared" position="right" className="fill-gray-500 text-[11px]" />
                </Bar>
                {/* Amber is under 3:1 on white, so its value is always labelled. */}
                <Bar isAnimationActive={false} dataKey="passed" name="Passed" fill={SERIES_B}
                     radius={[0, 3, 3, 0]} barSize={11}>
                  <LabelList dataKey="passed" position="right" className="fill-gray-500 text-[11px]" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Where candidates drop" className="overflow-x-auto"
               note="Dropped is appeared minus passed for that round, across every drive that recorded it.">
          <Table
            head={['Round', 'Drives', 'Appeared', 'Passed', 'Dropped', 'Pass %']}
            rows={data.rounds.map((r) => [
              r.name, String(r.drives), String(r.appeared), String(r.passed),
              String(r.dropped), pct(r.pass_rate),
            ])}
          />
        </Panel>
        <Panel title="By drive" note="Top twelve by students selected." className="overflow-x-auto">
          <Table
            head={['Drive', 'Status', 'Participants', 'Selected', 'Offers', 'Selected %']}
            rows={data.by_drive.map((d) => [
              d.drive, d.status, String(d.participants), String(d.selected),
              String(d.offers), pct(d.selection_rate),
            ])}
          />
        </Panel>
      </div>
    </div>
  )
}
