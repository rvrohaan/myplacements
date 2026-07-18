import { useRef, useState } from 'react'
import { FileText, Upload, ExternalLink, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import type { Student } from '@/types'

export default function ResumeCard({
  resumeUrl,
  onUploaded,
}: {
  resumeUrl?: string
  onUploaded: (student: Student) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/portal/me/resume', form)
      onUploaded(data)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not upload resume')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">My Resume</h2>
        {resumeUrl && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
          </span>
        )}
      </div>

      {resumeUrl ? (
        <div className="flex items-center gap-3">
          <a
            href={resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <FileText className="w-4 h-4" /> View resume <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="ml-auto flex items-center gap-1.5 text-sm border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg disabled:opacity-60"
          >
            <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading...' : 'Replace'}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            Upload your resume (PDF) so you can apply to drives. Recruiters see this with your application.
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
          >
            <Upload className="w-4 h-4" /> {uploading ? 'Uploading...' : 'Upload resume (PDF)'}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onFile} className="hidden" />
    </div>
  )
}
