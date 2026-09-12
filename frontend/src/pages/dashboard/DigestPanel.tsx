/**
 * Today's daily digest, on the dashboard.
 *
 * The digest page holds a whole day and lets a leader page back through past
 * ones. But the one question a pro-chancellor asks every evening - did the team
 * report, and is anything waiting on me? - should not need a second click. So
 * the part of the digest that is *today's news* is lifted onto the dashboard
 * they already land on, with the escalations answerable in place; the full page
 * stays one link away for everything else.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  UserX,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DailyDigest } from '@/types'
import {
  Delta,
  EscalationCard,
  NotFiledList,
  TOTAL_LABELS,
  useDigestActions,
} from '@/pages/daily/digestParts'
import { Panel } from './StatCard'

/** A compliance count, as a pill that reads at a glance. */
function Pill({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  tone: 'teal' | 'amber' | 'rose' | 'gray'
}) {
  const tones = {
    teal: 'border-teal-200 bg-teal-50 text-teal-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    gray: 'border-gray-200 bg-gray-50 text-gray-600',
  } as const
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm',
        tones[tone],
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{value}</span>
      {label}
    </span>
  )
}

export default function DigestPanel({
  digest,
  reload,
}: {
  digest: DailyDigest
  reload: () => void
}) {
  const { compliance, attention, totals, baseline } = digest
  const { remind, review } = useDigestActions(reload)
  // The activity numbers are the "how was today" half. They matter less than the
  // exceptions above them, so they start folded away and the panel stays short
  // enough not to push the rest of the dashboard off the screen.
  const [showActivity, setShowActivity] = useState(false)

  const open = attention.escalations.filter((e) => !e.reviewed)
  const nothingPending = open.length === 0 && attention.not_filed.length === 0

  return (
    <Panel
      title="Today's updates"
      action={
        <Link
          to="/daily-digest"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50"
        >
          Full digest
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          icon={ClipboardCheck}
          label="filed"
          value={`${compliance.filed}/${compliance.expected}`}
          tone={compliance.missing ? 'amber' : 'teal'}
        />
        {!!compliance.late && <Pill icon={Clock} label="late" value={compliance.late} tone="amber" />}
        {!!compliance.missing && (
          <Pill icon={UserX} label="not filed" value={compliance.missing} tone="rose" />
        )}
        {!!compliance.on_leave && (
          <Pill icon={CheckCircle2} label="on leave" value={compliance.on_leave} tone="gray" />
        )}
        <span className="ml-auto text-xs text-gray-400">cutoff {digest.cutoff}</span>
      </div>

      {/* Anything wanting a decision, answerable without leaving the page. */}
      {open.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-medium text-gray-500">
            Needs your reply ({open.length})
          </p>
          {open.map((item) => (
            <EscalationCard key={item.update_id} item={item} onReview={review} />
          ))}
        </div>
      )}

      {attention.not_filed.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            No update filed ({attention.not_filed.length})
          </p>
          <NotFiledList people={attention.not_filed} onRemind={remind} />
        </div>
      )}

      {nothingPending && (
        <p className="mt-3 text-sm text-gray-500">
          {compliance.filed === 0
            ? 'No updates filed yet today.'
            : 'Everyone has reported and nothing is waiting on you.'}
        </p>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3">
        <button
          type="button"
          onClick={() => setShowActivity((v) => !v)}
          aria-expanded={showActivity}
          className="flex w-full items-center justify-between text-left text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          Activity today
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', showActivity && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        {showActivity && (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {TOTAL_LABELS.map(([key, label]) => (
              <div key={key}>
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                  {totals[key] ?? 0}
                </p>
                <Delta value={totals[key] ?? 0} baseline={baseline[key] ?? 0} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
