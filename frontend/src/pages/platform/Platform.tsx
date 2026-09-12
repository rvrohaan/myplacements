/**
 * Platform settings - the admin console's page for switches that are not any
 * one college's to flip.
 *
 * Today it holds one: whether the daily opportunity scan runs by itself. That
 * switch spends the platform's credit every morning on every tenant's behalf,
 * which is exactly why it lives here rather than inside a college's own
 * settings, and why it ships stopped.
 */

import { useCallback, useEffect, useState } from 'react'
import { PauseCircle, PlayCircle, RefreshCw, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-context'
import { useToast } from '@/components/ui/toast'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlatformScanStatus } from '@/types'
import { scanText } from '@/pages/opportunities/leadParts'

export default function Platform() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<PlatformScanStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)

  const load = useCallback(() => {
    api
      .get('/job-leads/platform')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const running = !!status?.schedule_enabled

  const toggle = async () => {
    if (!status) return
    // Starting it is the direction that costs money, so that is the one that asks.
    if (!running) {
      const ok = await confirm({
        title: 'Start the daily scan?',
        message:
          'From tomorrow morning a web search runs once a day and is billed whether or not anyone reads the results. Every college on MyPlacement.AI sees the same openings.',
        confirmLabel: 'Start it',
        tone: 'primary',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const r = await api.put('/job-leads/platform', { schedule_enabled: !running })
      setStatus(r.data)
      toast.success(!running ? 'Daily scan started.' : 'Daily scan stopped.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not change the schedule.')
    } finally {
      setSaving(false)
    }
  }

  const scanOnce = async () => {
    setScanning(true)
    try {
      const r = await api.post('/job-leads/scan')
      const { found, new_count } = r.data
      toast.success(
        new_count > 0
          ? `${new_count} new opening${new_count === 1 ? '' : 's'} added to the pool.`
          : found > 0
            ? 'Nothing new — everything found is already in the pool.'
            : 'No openings matched in the last 24 hours.',
      )
      load()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'The scan could not be completed.')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Platform settings</h2>
        <p className="text-sm text-gray-500">
          Switches that apply to every college on MyPlacement.AI.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-56 w-full max-w-2xl rounded-xl bg-gray-100" />
      ) : !status ? (
        <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500">
          Could not load the platform settings.
        </div>
      ) : (
        <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Daily opportunity scan</h3>
              <p className="mt-1 text-sm text-gray-600">
                One web search each morning at {String(status.scan_hour).padStart(2, '0')}:00 for
                job and internship openings posted in the last 24 hours. The results are shared
                by every college — campus hiring is national, so one search serves all of them.
              </p>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium',
                running
                  ? 'border-teal-200 bg-teal-50 text-teal-800'
                  : 'border-gray-200 bg-gray-50 text-gray-600',
              )}
            >
              {running ? (
                <PlayCircle className="w-4 h-4" aria-hidden="true" />
              ) : (
                <PauseCircle className="w-4 h-4" aria-hidden="true" />
              )}
              {running ? 'Running daily' : 'Stopped'}
            </span>
          </div>

          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Each scan is billed whether or not anyone reads it. Leave this stopped until a
            college is actually working the results — you can still run a scan by hand below.
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-gray-500">Openings in the pool</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums text-gray-900">
                {status.pool_size}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Last scan</dt>
              <dd className="mt-0.5 text-sm text-gray-700">{scanText(status.last_scan)}</dd>
            </div>
          </dl>

          {status.updated_by_name && (
            <p className="mt-3 text-xs text-gray-400">
              Last changed by {status.updated_by_name}
              {status.updated_at
                ? ` on ${new Date(
                    `${status.updated_at}${status.updated_at.endsWith('Z') ? '' : 'Z'}`,
                  ).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : ''}
              .
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={toggle}
              disabled={saving}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-60',
                running
                  ? 'bg-gray-700 hover:bg-gray-800'
                  : 'bg-primary-600 hover:bg-primary-700 shadow-primary-600/25',
              )}
            >
              {running ? (
                <PauseCircle className="w-4 h-4" aria-hidden="true" />
              ) : (
                <PlayCircle className="w-4 h-4" aria-hidden="true" />
              )}
              {saving ? 'Saving…' : running ? 'Stop the daily scan' : 'Start the daily scan'}
            </button>

            <button
              type="button"
              onClick={scanOnce}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {scanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              {scanning ? 'Searching the web…' : 'Run one scan now'}
            </button>
          </div>

          {scanning && (
            <p role="status" className="mt-3 text-xs text-gray-500">
              Searching career pages and job boards across India. This takes a few minutes —
              leave the page open.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
