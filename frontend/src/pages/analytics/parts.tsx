import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Shared furniture for the analytics tabs.
 *
 * Chart colours live here rather than per-file so every tab draws from the same
 * short list. The two-series pair was checked for colour-blind separation rather
 * than picked by eye — blue/violet, the obvious choice, is indistinguishable
 * under deuteranopia (ΔE 1.3) and barely separable with full colour vision.
 */

/** Single-series marks. One series, one colour, on every bar. */
export const SERIES = '#3b82f6'

/** Two-series comparison: blue vs amber (ΔE 37 protan, 44 normal). */
export const SERIES_A = '#2563eb'
export const SERIES_B = '#f59e0b'

/** Amber sits under 3:1 against white, so anything drawn in it carries a visible
    value label — the contrast relief, not an optional flourish. */
export const CHART_AXIS = { fontSize: 11, fill: '#6b7280' }

/** A headline figure. Three numbers don't need a chart; this is the chart. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3" title={hint}>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

/** A titled card. `note` is for what a figure does *not* say — which basis it
    counts on, or why a correlation isn't a cause. */
export function Panel({
  title,
  note,
  children,
  className,
}: {
  title: string
  note?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 p-5', className)}>
      <h3 className="font-semibold text-gray-800">{title}</h3>
      {note && <p className="text-xs text-gray-500 mt-1 mb-3 leading-snug">{note}</p>}
      <div className={note ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{children}</p>
}

/** Percentages arrive as numbers or null — null means "no denominator", which is
    not the same as zero and must not be drawn as a 0% bar. */
export function pct(value?: number | null): string {
  return value == null ? '—' : `${value}%`
}

export function num(value?: number | null): string {
  return value == null ? '—' : String(value)
}
