import { useState } from 'react'
import { Upload, Download, Sparkles, FileSpreadsheet, CheckCircle2, UserPlus } from 'lucide-react'
import api from '@/lib/api'
import type { DriveRound, RoundUploadSummary } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

type Mode = 'combined' | 'separate'

/**
 * Upload a round's roster (.xlsx) and reconcile every student's status. Supports
 * either one file with a Status column, or separate "appeared" and "passed"
 * files (the passed file may carry a CTC column).
 */
export default function RoundResultsModal({
  driveId,
  round,
  onClose,
  onDone,
}: {
  driveId: number | string
  round: DriveRound
  onClose: () => void
  onDone: (summary: RoundUploadSummary) => void
}) {
  const [mode, setMode] = useState<Mode>('combined')
  const [combinedFile, setCombinedFile] = useState<File | null>(null)
  const [appearedFile, setAppearedFile] = useState<File | null>(null)
  const [passedFile, setPassedFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<RoundUploadSummary | null>(null)

  const roundLabel = round.name?.trim() || `Round ${round.round_number}`

  const downloadTemplate = async () => {
    try {
      const res = await api.get('/drives/rounds/results-template', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = 'round_results_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not download the template.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fd = new FormData()
    if (mode === 'combined') {
      if (!combinedFile) return setError('Choose a file to upload')
      fd.append('combined_file', combinedFile)
    } else {
      if (!appearedFile && !passedFile) return setError('Choose at least one file')
      if (appearedFile) fd.append('appeared_file', appearedFile)
      if (passedFile) fd.append('passed_file', passedFile)
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await api.post(`/drives/${driveId}/rounds/${round.id}/results`, fd)
      setSummary(res.data)
    } catch {
      setError('Upload failed. Check the file and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose} align="start" panelClassName="w-full max-w-lg my-8">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-primary-600" />
          <ModalTitle>Upload results — {roundLabel}</ModalTitle>
        </div>
        <ModalClose />
      </div>

      {summary ? (
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            <p className="font-semibold">Roster processed</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Appeared" value={summary.appeared} />
            <Stat label="Passed" value={summary.passed} />
            <Stat label="Auto-withdrawn" value={summary.withdrawn} hint="cleared the previous round but absent here" />
            <Stat label="Newly added" value={summary.created_participants} hint="not previously in the drive" />
          </div>
          {summary.skipped_eliminated > 0 && (
            <p className="text-xs text-gray-500">
              Ignored <span className="font-medium text-gray-700">{summary.skipped_eliminated}</span> row(s) for students
              already rejected or withdrawn in an earlier round.
            </p>
          )}
          {summary.used_ai && (
            <p className="flex items-center gap-1.5 text-xs text-sky-600">
              <Sparkles className="w-3.5 h-3.5" /> Columns were interpreted by Claude (non-standard layout).
            </p>
          )}
          {summary.created_students > 0 && (
            <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
              <p className="flex items-center gap-1.5 font-medium">
                <UserPlus className="w-4 h-4" /> {summary.created_students} student(s) weren't on file and were added to the database.
              </p>
              <p className="mt-1 text-xs">
                Review their profiles to fill in branch, batch year, and other details.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={() => onDone(summary)}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 shadow-sm shadow-primary-600/25 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Match is by <span className="font-medium text-gray-700">roll number</span>. Students not yet in the drive
              are added automatically.
            </p>
          </div>

          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <Download className="w-4 h-4" /> Download template (Roll Number, Name, Status, CTC)
          </button>

          {/* Mode toggle */}
          <div className="flex gap-2">
            {(['combined', 'separate'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  'flex-1 px-3 py-2 rounded-lg text-xs font-medium border ' +
                  (mode === m ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')
                }
              >
                {m === 'combined' ? 'One file (Status column)' : 'Two files (Appeared + Passed)'}
              </button>
            ))}
          </div>

          {mode === 'combined' ? (
            <FilePick
              label="Roster with Status column"
              hint="Status = passed / failed / absent (a no-show becomes withdrawn). CTC column optional."
              file={combinedFile}
              onPick={setCombinedFile}
            />
          ) : (
            <div className="space-y-3">
              <FilePick label="Appeared" hint="Everyone who turned up for this round." file={appearedFile} onPick={setAppearedFile} />
              <FilePick label="Passed (optional)" hint="Who cleared it. Add a CTC column for the final round." file={passedFile} onPick={setPassedFile} />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
            >
              {submitting ? 'Processing...' : (<><Upload className="w-4 h-4" /> Upload &amp; analyze</>)}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="px-3 py-2 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 leading-tight mt-0.5">{hint}</p>}
    </div>
  )
}

function FilePick({
  label,
  hint,
  file,
  onPick,
}: {
  label: string
  hint: string
  file: File | null
  onPick: (f: File | null) => void
}) {
  return (
    <label className="block border border-dashed border-gray-300 rounded-lg px-3 py-3 cursor-pointer hover:border-primary-300">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>
      {file && <p className="text-xs text-primary-600 mt-1 truncate">{file.name}</p>}
      <input
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}
