import { useEffect, useState } from 'react'
import { Download, Sparkles, FileText } from 'lucide-react'
import api from '@/lib/api'
import type { ReportCatalogue, ReportDoc } from '@/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import ReportView from './ReportView'

const selectClass =
  'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500'

/**
 * Reports (spec §7).
 *
 * Pick a report, set its parameters, read it on screen, download the same thing
 * as .xlsx. Preview and file are rendered from one description server-side, so
 * what is on screen is what lands in the workbook.
 */
/** Sentinel for the batch picker's "All batches" position. Not a year, so it
    can never collide with a real one. */
const ALL_BATCHES = 'all'

export default function Reports() {
  const toast = useToast()
  const [catalogue, setCatalogue] = useState<ReportCatalogue | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [batchYear, setBatchYear] = useState('')
  const [years, setYears] = useState('3')
  const [months, setMonths] = useState('6')
  const [month, setMonth] = useState('')
  const [writing, setWriting] = useState(false)
  const [report, setReport] = useState<ReportDoc | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    api
      .get<ReportCatalogue>('/reports')
      .then((r) => {
        setCatalogue(r.data)
        setSelected((prev) => prev || r.data.reports[0]?.id || '')
      })
      .catch(() => toast.error('Could not load the report list.'))
  }, [])

  const spec = catalogue?.reports.find((r) => r.id === selected)

  /**
   * Only send a parameter the chosen report actually takes.
   *
   * The batch picker has three positions, and they are three different requests:
   * '' sends nothing and the report falls back to the latest batch, ALL_BATCHES
   * sends the pooling flag, and a year sends that year. Preview and download
   * both read this, so the .xlsx can never cover a different span than the
   * preview it was downloaded from.
   */
  const params = () => ({
    ...(spec?.params.includes('batch_year') && batchYear === ALL_BATCHES
      ? { all_batches: true }
      : {}),
    ...(spec?.params.includes('batch_year') && batchYear && batchYear !== ALL_BATCHES
      ? { batch_year: batchYear }
      : {}),
    ...(spec?.params.includes('years') && years ? { years } : {}),
    ...(spec?.params.includes('months') && months ? { months } : {}),
    ...(spec?.params.includes('month') && month ? { month } : {}),
  })

  useEffect(() => {
    if (!selected || !spec) return
    setLoading(true)
    api
      .get<ReportDoc>(`/reports/${selected}`, { params: params() })
      .then((r) => setReport(r.data))
      .catch(() => {
        setReport(null)
        toast.error('Could not build that report.')
      })
      .finally(() => setLoading(false))
  }, [selected, batchYear, years, months, month, spec?.id])

  /** Ask for the month's covering note. The only paid call on this page, and the
      result is cached for the month so the next reader does not pay again. */
  const writeUp = async () => {
    if (!spec) return
    setWriting(true)
    try {
      const r = await api.post('/insights/monthly', null, {
        params: { ...(month ? { month } : {}), refresh: true },
      })
      const written = (r.data as { narrated: boolean; note?: string | null }).narrated
      // Reload the report rather than splicing the prose in: the report is the
      // one place the narrative and its tables are assembled together.
      const fresh = await api.get<ReportDoc>(`/reports/${spec.id}`, { params: params() })
      setReport(fresh.data)
      if (written) toast.success('Summary written.')
      else toast.info((r.data as { note?: string | null }).note || 'Showing the findings instead.')
    } catch {
      toast.error('Could not write the summary.')
    } finally {
      setWriting(false)
    }
  }

  const download = async () => {
    if (!spec) return
    setDownloading(true)
    try {
      const r = await api.get(`/reports/${spec.id}/export`, {
        params: params(),
        responseType: 'blob',
      })
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${spec.id}-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Report downloaded')
    } catch {
      toast.error('Could not download that report.')
    } finally {
      setDownloading(false)
    }
  }

  if (!catalogue) return <p className="text-center py-20 text-gray-400">Loading reports…</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {catalogue.reports.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            aria-pressed={selected === r.id}
            className={cn(
              'text-left bg-white rounded-xl border p-4 transition-colors hover:border-primary-300',
              selected === r.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200',
            )}
          >
            <span className="flex items-center gap-2">
              <FileText
                className={cn('w-4 h-4', selected === r.id ? 'text-primary-600' : 'text-gray-400')}
              />
              <span className="font-medium text-gray-900 text-sm">{r.name}</span>
            </span>
            <span className="block text-xs text-gray-500 mt-1.5 leading-snug">{r.description}</span>
          </button>
        ))}
      </div>

      {spec && (
        <div className="flex flex-wrap items-center gap-2">
          {spec.params.includes('batch_year') && (
            <select
              value={batchYear}
              onChange={(e) => setBatchYear(e.target.value)}
              aria-label="Batch year"
              className={selectClass}
            >
              <option value="">Latest batch</option>
              <option value={ALL_BATCHES}>All batches</option>
              {catalogue.batch_years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          {spec.params.includes('month') && (
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month"
              className={selectClass}
            >
              {/* Empty means the last complete month, which is what a monthly
                  report is normally about — the current one is still running. */}
              <option value="">Last complete month</option>
              {catalogue.months.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          )}
          {spec.params.includes('years') && (
            <select
              value={years}
              onChange={(e) => setYears(e.target.value)}
              aria-label="How many batches to cover"
              className={selectClass}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>Last {n} batch{n === 1 ? '' : 'es'}</option>
              ))}
            </select>
          )}
          {spec.params.includes('months') && (
            <select
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              aria-label="How many months to cover"
              className={selectClass}
            >
              {[3, 6, 12, 18, 24].map((n) => (
                <option key={n} value={n}>Last {n} months</option>
              ))}
            </select>
          )}
          {/* Only the monthly report is written up, and only on request: this is
              the one button on the page that calls a model. Reading or
              downloading the report never does. */}
          {spec.params.includes('month') && (
            <button
              onClick={writeUp}
              disabled={writing || !report}
              className="flex items-center gap-2 border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-60 ml-auto"
            >
              <Sparkles className={cn('w-4 h-4', writing && 'animate-pulse')} />
              {writing
                ? 'Writing…'
                : report && report.narrative.length > 0
                ? 'Rewrite the summary'
                : 'Write the summary'}
            </button>
          )}
          <button
            onClick={download}
            disabled={downloading || !report}
            className={cn(
              'flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm',
              'font-medium px-4 py-2 rounded-lg transition-colors shadow-sm',
              'shadow-primary-600/25 disabled:opacity-60',
              !spec.params.includes('month') && 'ml-auto',
            )}
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Preparing…' : 'Download .xlsx'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-center py-20 text-gray-400">Building the report…</p>
      ) : report ? (
        <ReportView report={report} />
      ) : null}
    </div>
  )
}
