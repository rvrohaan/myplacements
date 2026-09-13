import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts'
import api from '@/lib/api'
import type { StudentAnalytics as Payload } from '@/types'
import { cn, STATUS_COLORS } from '@/lib/utils'
import { CHART_AXIS, Empty, Panel, SERIES, SERIES_A, SERIES_B, Stat, pct } from './parts'
import RiskCalibrationPanel from './RiskCalibrationPanel'

/**
 * Who is placed, against the things that might explain it.
 *
 * Deliberately absent: placement rate by risk band. `student_scoring.assess()`
 * sets a placed student to risk "low" by definition, so that chart would always
 * report that low-risk students are placed — it would be measuring its own
 * rules. The bands below are *inputs* to the score, not outputs of it.
 */
export default function StudentAnalytics({ batchYear }: { batchYear: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .get<Payload>('/analytics/students', { params: batchYear ? { batch_year: batchYear } : {} })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [batchYear])

  if (loading) return <p className="text-center py-20 text-gray-400">Loading student analytics…</p>
  if (!data || data.headline.students === 0) {
    return <Empty>No students on file{batchYear ? ` for the ${batchYear} batch` : ''}.</Empty>
  }

  const { headline, risk_of_seeking, cgpa_bands, backlogs, training, skills } = data
  const seekingTotal = risk_of_seeking.reduce((sum, r) => sum + r.students, 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Students" value={headline.students} />
        <Stat label="Placed" value={headline.placed ?? 0} />
        <Stat label="Placement rate" value={pct(headline.placement_rate)} />
        <Stat
          label="Still looking"
          value={headline.seeking ?? 0}
          hint={
            headline.avg_readiness_of_seeking != null
              ? `Average readiness ${headline.avg_readiness_of_seeking}/100`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Placement rate by CGPA"
          note="Marks are an input to the readiness score, not an output of it, so
            this says something the score doesn't already assume."
        >
          <RateBars rows={cgpa_bands} />
        </Panel>

        <Panel
          title="Placement rate by backlogs"
          note="Same basis: a count that exists independently of how we grade
            readiness."
        >
          <RateBars rows={backlogs} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="Who is still looking"
          note="Risk band of the students yet to be placed. Placed students are
            scored low-risk by definition, so they are left out rather than
            flattering the mix."
        >
          {seekingTotal === 0 ? (
            <Empty>Nobody is still looking.</Empty>
          ) : (
            <ul className="space-y-2">
              {risk_of_seeking.map((r) => (
                <li key={r.band} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium capitalize w-20 text-center',
                      STATUS_COLORS[r.band],
                    )}
                  >
                    {r.band}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{ width: `${seekingTotal ? (r.students / seekingTotal) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-600 tabular-nums w-16 text-right">
                    {r.students} ({seekingTotal ? Math.round((r.students / seekingTotal) * 100) : 0}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Training"
          note="Correlation, not proof: the students who turn up for training are
            rarely a random sample of the year."
        >
          {!training ? (
            <Empty>Nobody is enrolled on a training module yet.</Empty>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <Figure label="Students trained" value={String(training.students_trained)} />
                <Figure label="Avg attendance" value={pct(training.avg_attendance)} />
                <Figure label="Avg mock score" value={training.avg_mock_score == null ? '—' : String(training.avg_mock_score)} />
              </div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart
                  data={[
                    { group: 'Trained', rate: training.placement_rate_trained ?? 0 },
                    { group: 'Not trained', rate: training.placement_rate_untrained ?? 0 },
                  ]}
                  layout="vertical"
                  margin={{ top: 4, right: 44, left: 10, bottom: 4 }}
                >
                  <XAxis type="number" domain={[0, 100]} tick={CHART_AXIS} unit="%" />
                  <YAxis type="category" dataKey="group" tick={CHART_AXIS} width={84} />
                  <Tooltip formatter={(v: number) => [`${v}% placed`, '']} />
                  <Bar isAnimationActive={false} dataKey="rate" fill={SERIES} radius={[0, 3, 3, 0]} barSize={18}>
                    <LabelList dataKey="rate" position="right" formatter={(v: number) => `${v}%`} className="fill-gray-500 text-xs" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </Panel>
      </div>

      <RiskCalibrationPanel batchYear={batchYear} />

      <Panel
        title="Skill gaps"
        note="Skills listed by students who got placed, against the students still
          looking. Counted once per student however many times they list it, and
          limited to skills at least a fifth of placed students name — so one
          person's niche tool doesn't read as a training need."
      >
        {skills.gaps.length === 0 ? (
          <Empty>Not enough skills recorded to compare yet.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, skills.gaps.length * 42)}>
            <BarChart
              data={skills.gaps}
              layout="vertical"
              margin={{ top: 4, right: 52, left: 20, bottom: 4 }}
              barGap={2}
            >
              <XAxis type="number" domain={[0, 100]} tick={CHART_AXIS} unit="%" />
              <YAxis type="category" dataKey="skill" tick={CHART_AXIS} width={110} />
              <Tooltip formatter={(v: number, name) => [`${v}%`, name]} />
              <Legend verticalAlign="top" height={28} iconSize={9} wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="placed_share" name="Placed students" fill={SERIES_A} radius={[0, 3, 3, 0]} barSize={11}>
                <LabelList dataKey="placed_share" position="right" formatter={(v: number) => `${v}%`} className="fill-gray-500 text-[11px]" />
              </Bar>
              {/* Amber falls under 3:1 against white, so its value is always
                  labelled rather than left to the fill to communicate. */}
              <Bar isAnimationActive={false} dataKey="seeking_share" name="Still looking" fill={SERIES_B} radius={[0, 3, 3, 0]} barSize={11}>
                <LabelList dataKey="seeking_share" position="right" formatter={(v: number) => `${v}%`} className="fill-gray-500 text-[11px]" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

/** Placement rate per band, with the group size kept beside it: a 100% rate over
    two students is noise, and the chart must not let that read as a finding. */
function RateBars({
  rows,
}: {
  rows: Array<{ band: string; students: number; placed: number; placement_rate?: number | null }>
}) {
  if (rows.length === 0) return <Empty>Nothing recorded yet.</Empty>
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 38)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, left: 10, bottom: 4 }}>
          <XAxis type="number" domain={[0, 100]} tick={CHART_AXIS} unit="%" />
          <YAxis type="category" dataKey="band" tick={CHART_AXIS} width={84} />
          <Tooltip
            formatter={(v: number, _n, item: any) => [
              `${v}% placed (${item?.payload?.placed} of ${item?.payload?.students})`,
              '',
            ]}
          />
          <Bar isAnimationActive={false} dataKey="placement_rate" fill={SERIES} radius={[0, 3, 3, 0]} barSize={16}>
            <LabelList
              dataKey="placement_rate"
              position="right"
              formatter={(v: number) => (v == null ? '—' : `${v}%`)}
              className="fill-gray-500 text-xs"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 mt-1">
        {rows.map((r) => `${r.band}: ${r.placed}/${r.students}`).join(' · ')}
      </p>
    </>
  )
}
