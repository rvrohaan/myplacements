import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, Upload, FileSpreadsheet, X } from 'lucide-react'
import api from '@/lib/api'

interface ImportResult {
  created: number
  skipped: number
  // Companies only: HR contacts attached from the hr_* columns.
  hr_contacts?: number
  errors: { row: number; errors: string[] }[]
}

type Busy = 'export' | 'template' | 'import' | null

/**
 * Export / template-download / import controls for a list resource.
 * `base` is the API prefix, e.g. "/companies" or "/students".
 */
export default function ImportExportControls({
  base,
  label,
  onImported,
  exportParams,
  showImport = true,
}: {
  base: string
  label: string
  onImported?: () => void
  exportParams?: Record<string, string>
  // Import + template download are management-only; hide them where not allowed.
  showImport?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const showToast = (message: string) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4000)
  }

  const download = async (path: string, filename: string, kind: Busy, params?: Record<string, string>) => {
    setBusy(kind)
    setError('')
    try {
      const r = await api.get(path, { responseType: 'blob', params })
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(`Could not export ${label.toLowerCase()}.`)
    } finally {
      setBusy(null)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy('import')
    setError('')
    setResult(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const r = await api.post<ImportResult>(`${base}/import`, formData)
      if (r.data.created > 0) onImported?.()
      if (r.data.errors.length > 0) {
        // keep the detailed, scrollable card for row-level errors
        setResult(r.data)
      } else {
        const parts = [`${r.data.created} added`]
        if (r.data.hr_contacts) parts.push(`${r.data.hr_contacts} HR contacts`)
        if (r.data.skipped > 0) parts.push(`${r.data.skipped} skipped`)
        showToast(parts.join(' · '))
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      if (detail) {
        setError(detail)
      } else {
        // No JSON body means the request never reached the handler — a gateway
        // timeout on a large file, or the server erroring outright. Say which,
        // so the cause is diagnosable instead of a flat "could not import".
        const status = err?.response?.status
        setError(
          `Could not import ${label.toLowerCase()} — ` +
            (status
              ? `the server returned HTTP ${status}.`
              : 'the request did not complete (timed out or the connection dropped).') +
            ' If the file is large, try importing it in smaller batches.'
        )
      }
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx" onChange={handleFile} className="hidden" />
        <button
          onClick={() => download(`${base}/export`, `${label.toLowerCase()}.xlsx`, 'export', exportParams)}
          disabled={busy !== null}
          className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {busy === 'export' ? 'Exporting...' : 'Export'}
        </button>
        {showImport && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              <Upload className="w-4 h-4" />
              {busy === 'import' ? 'Importing...' : 'Import'}
            </button>
            <button
              onClick={() =>
                download(`${base}/import-template`, `${label.toLowerCase()}_template.xlsx`, 'template')
              }
              disabled={busy !== null}
              className="flex items-center gap-1.5 text-primary-600 hover:underline text-xs font-medium px-1"
              title="Download a blank .xlsx template"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Template
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
          {error}
        </div>
      )}

      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 bg-white border border-gray-200 shadow-lg rounded-lg pl-3 pr-2 py-2.5 text-sm text-gray-800">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <p className="font-medium text-gray-900">Import complete</p>
            <p className="text-xs text-gray-500">{toast}</p>
          </div>
          <button
            onClick={() => setToast('')}
            className="ml-2 text-gray-400 hover:text-gray-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {result && (
        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 relative">
          <button
            onClick={() => setResult(null)}
            className="absolute top-1.5 right-1.5 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <p className="font-medium text-gray-800">Import complete</p>
          <p className="mt-0.5">
            <span className="text-green-700">{result.created} added</span>
            {!!result.hr_contacts && <span className="text-green-700"> · {result.hr_contacts} HR contacts</span>}
            {result.skipped > 0 && <span className="text-gray-500"> · {result.skipped} skipped (duplicates)</span>}
            {result.errors.length > 0 && <span className="text-red-600"> · {result.errors.length} with errors</span>}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
              {result.errors.map((e) => (
                <li key={e.row} className="text-red-600">
                  Row {e.row}: {e.errors.join('; ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
