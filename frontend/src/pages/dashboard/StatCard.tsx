import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Soft tinted chips: one hue per metric so the row scans at a glance,
// all muted so no single card shouts.
export const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  teal: 'bg-teal-50 text-teal-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
} as const

export type Tone = keyof typeof TONES

/**
 * A headline metric. Pass `to` to make the whole card a link through to the page
 * that metric lives on, or `onClick` to make it a toggle that filters a list
 * further down the same page (`selected` then renders it pressed). Either way
 * the card shows a hover affordance and is reachable by keyboard.
 */
export function StatCard({ icon: Icon, label, value, sub, tone, to, onClick, selected }: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  tone: Tone
  to?: string
  onClick?: () => void
  /** Only meaningful with `onClick`: marks this card as the active filter. */
  selected?: boolean
}) {
  const interactive = !!to || !!onClick
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-gray-500 flex items-center gap-1">
          {label}
          {interactive && (
            <ArrowUpRight
              className={cn(
                'w-3.5 h-3.5 text-gray-300 transition-opacity group-hover:opacity-100',
                selected ? 'opacity-100 text-primary-400' : 'opacity-0',
              )}
            />
          )}
        </p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONES[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </>
  )

  const base = 'block bg-white rounded-xl border border-gray-200/70 p-5 shadow-sm transition-shadow hover:shadow-md'
  const focusable =
    'transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          'group w-full text-left',
          base,
          focusable,
          selected && 'border-primary-400 ring-2 ring-primary-400/30',
        )}
      >
        {body}
      </button>
    )
  }
  if (!to) return <div className={base}>{body}</div>
  return (
    <Link to={to} className={cn('group', base, focusable)}>
      {body}
    </Link>
  )
}

/** A labelled progress bar — used for targets and completion rates. */
export function ProgressRow({ label, value, percent, tone = 'sky' }: {
  label: string
  value: string
  percent: number
  tone?: 'sky' | 'amber' | 'teal'
}) {
  const bars = {
    sky: 'bg-gradient-to-r from-sky-400 to-blue-600',
    amber: 'bg-gradient-to-r from-amber-400 to-amber-500',
    teal: 'bg-gradient-to-r from-teal-400 to-teal-600',
  }
  return (
    <div>
      <div className="flex justify-between items-baseline text-sm mb-1.5">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900">{value}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={`${bars[tone]} h-1.5 rounded-full transition-all`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  )
}

/** Placeholder shown while any of the dashboards load. */
export function DashboardSkeleton({ cards = 4, panels = 2 }: { cards?: number; panels?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
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
        {Array.from({ length: panels }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <Skeleton className="h-5 w-40 mb-4 bg-gray-200" />
            <Skeleton className="h-48 w-full bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Card shell with a heading, used by every dashboard panel. */
export function Panel({ title, action, children, className = '' }: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}
