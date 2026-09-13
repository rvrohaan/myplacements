import { useRef, useState } from 'react'
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import type { AttendanceImportResult } from '@/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/**
 * Bulk attendance for one module: upload the sheet the trainer sent back rather
 * than picking a hundred students one at a time.
 *
 * The result is shown row by row, including the rows that matched nobody. An
 * import that quietly drops half a batch is worse than one that fails outright,
 * because nobody goes looking for the missing half.
 */
export default function AttendanceImport({
  moduleId,
  moduleName,
  onImported,
}: {
  moduleId: number
  moduleName: string
  onImported: () => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'import' | 'template' | 'export' | null>(null)
  const [result, setResult] = useState<AttendanceImportResult | null>(null)
  const [error, setError] = useState('')

  const download = async (path: string, filename: string, kind: 'template' | 'export') => {
    setBusy(kind)
    try {
      const r = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not download that file.')
    } finally {
      setBusy(null)
    }
  }

  const upload = async (file: File) => {
    setBusy('import')
    setError('')
    setResult(null)
    const body = new FormData()
    body.append('file', file)
    try {
      const { data } = await api.post<AttendanceImportResult>(
        `/training/modules/${moduleId}/import`, body,
      )
      setResult(data)
      toast.success(`${data.enrolled} enrolled, ${data.updated} updated`)
      onImported()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Could not import that sheet.')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy === 'import'}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 transition-colors"
          title="Upload an attendance sheet to enrol or update everyone on it"
        >
          <Upload className="w-4 h-4" />
          {busy === 'import' ? 'Importing…' : 'Import attendance'}
        </button>
        <button
          onClick={() => download('/training/attendance-template',
                                  'training_attendance_template.xlsx', 'template')}
          disabled={busy === 'template'}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-60"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Template
        </button>
        <button
          onClick={() => download(`/training/modules/${moduleId}/export`,
                                  `${moduleName.replace(/\s+/g, '_')}_roster.xlsx`, 'export')}
          disabled={busy === 'export'}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          Export roster
        </button>
        <span className="text-xs text-gray-400">
          Matched on roll number. Blank cells leave existing marks alone.
        </span>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-gray-50 text-sm">
            <span className="flex items-center gap-1.5 text-gray-700">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              {result.rows} row{result.rows === 1 ? '' : 's'} read
            </span>
            <span className="text-gray-600">{result.enrolled} enrolled</span>
            <span className="text-gray-600">{result.updated} updated</span>
            <span className={cn(result.unmatched ? 'text-amber-700 font-medium' : 'text-gray-400')}>
              {result.unmatched} unmatched
            </span>
          </div>
          {result.unmatched > 0 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <p className="text-sm text-amber-800 mb-1">
                These roll numbers matched no student in this college — check them rather
                than assuming they were imported:
              </p>
              <p className="text-sm text-gray-700">
                {result.results.filter((r) => !r.matched).map((r) => r.roll_number).join(', ')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
