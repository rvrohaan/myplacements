import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, RefreshCw, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import type { DashboardInsights } from '@/types'
import { cn, formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { useAuthStore } from '@/store/authStore'
import { isLeadership } from '@/lib/roles'
import { Panel } from './StatCard'

/**
 * The summary at the top of the dashboard.
 *
 * Opening the page only ever GETs, which never calls the model — so a dashboard
 * five people keep open all day costs nothing. Writing it up is a button, and
 * the result is shared across the college for the day rather than billed per
 * reader.
 *
 * The findings below the prose are the same ones the write-up was made from,
 * recomputed on every load. They are what is actually shown when the model is
 * off or when its reply quoted a figure nobody computed, which is why they are
 * full sentences rather than fragments.
 *
 * Mounted on the College overview only. The summary pools the whole college, so
 * it has no place on the per-officer Team progress tab — it was on both, and a
 * leadership user saw the identical panel twice.
 *
 * CollegeDashboard is also the fallback dashboard for staff who are not
 * leadership, and the endpoint behind this panel is leadership-only. Without the
 * role check below those users fired a request on every dashboard load that
 * could only ever 403. The server is still the authority; this just stops the
 * UI asking a question it knows the answer to.
 */

// Severity carries an icon and a word as well as a colour: the status palette is
// never the only thing distinguishing one row from another.
const SEVERITY = {
  urgent: { label: 'Act now', icon: AlertTriangle, cls: 'bg-red-50 text-red-700 border-red-200' },
  watch: { label: 'Watch', icon: Eye, cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  good: { label: 'On track', icon: Check, cls: 'bg-green-50 text-green-700 border-green-200' },
} as const

export default function InsightsPanel() {
  const toast = useToast()
  const role = useAuthStore((s) => s.user?.role)
  const allowed = isLeadership(role)
  const [data, setData] = useState<DashboardInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [writing, setWriting] = useState(false)

  const load = useCallback(() => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .get<DashboardInsights>('/insights/dashboard')
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [allowed])

  useEffect(load, [load])

  const write = async (refresh: boolean) => {
    setWriting(true)
    try {
      const r = await api.post<DashboardInsights>('/insights/dashboard', null, {
        params: refresh ? { refresh: true } : {},
      })
      setData(r.data)
      if (r.data.narrated) toast.success('Summary written.')
      // Not an error: the findings are still right, only the prose is missing.
      else toast.info(r.data.note || 'Showing the findings without a write-up.')
    } catch {
      toast.error('Could not write the summary.')
    } finally {
      setWriting(false)
    }
  }

  if (!allowed || loading || !data || data.findings.length === 0) return null

  const hasNarrative = data.narrative.length > 0

  return (
    <Panel
      title="What the numbers say"
      action={
        <button
          onClick={() => write(hasNarrative)}
          disabled={writing}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium',
            'border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60',
          )}
        >
          {hasNarrative ? (
            <RefreshCw className={cn('w-3.5 h-3.5', writing && 'animate-spin')} />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {writing ? 'Writing…' : hasNarrative ? 'Rewrite' : 'Write it up'}
        </button>
      }
    >
      {hasNarrative && (
        <div className="space-y-2 mb-4">
          {data.narrative.map((p, i) => (
            <p key={i} className="text-sm text-gray-700 leading-relaxed">
              {p}
            </p>
          ))}
          <p className="text-xs text-gray-400">
            Written by {data.model} from the findings below
            {data.generated_at && <> · {formatDateTime(data.generated_at)}</>}
            {data.generated_by && <> · asked for by {data.generated_by}</>}
          </p>
        </div>
      )}

      {data.note && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {data.note}
        </p>
      )}

      <ul className="space-y-2">
        {data.findings.map((f) => {
          const s = SEVERITY[f.severity] ?? SEVERITY.watch
          const Icon = s.icon
          return (
            <li key={f.key} className="flex items-start gap-2.5">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
                  'text-xs font-medium',
                  s.cls,
                )}
              >
                <Icon className="w-3 h-3" aria-hidden="true" />
                {s.label}
              </span>
              <span className="text-sm text-gray-700 leading-snug">{f.headline}</span>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-gray-400 mt-3">
        Every figure here is computed from your data; the write-up only rephrases these
        findings and is discarded if it quotes anything else.
      </p>
    </Panel>
  )
}
