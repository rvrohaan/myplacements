import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, CalendarDays, MapPin, IndianRupee, Check, FileText } from 'lucide-react'
import api from '@/lib/api'
import type { StudentDrive, Student } from '@/types'
import { formatDate, formatCTC } from '@/lib/utils'
import { useDriveAlerts } from '@/store/driveAlerts'

export default function StudentDrives() {
  const [drives, setDrives] = useState<StudentDrive[]>([])
  const [hasResume, setHasResume] = useState(true)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<number | null>(null)
  const [error, setError] = useState('')
  const markSeen = useDriveAlerts((s) => s.markSeen)

  const fetchDrives = () => {
    setLoading(true)
    api.get<Student>('/portal/me').then((r) => setHasResume(!!r.data.resume_url)).catch(() => {})
    api
      .get<StudentDrive[]>('/portal/me/drives')
      .then((r) => {
        setDrives(r.data)
        // Viewing the list clears the "new drives" badge.
        markSeen(r.data.map((d) => d.id))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchDrives() }, [])

  const apply = async (driveId: number) => {
    setApplying(driveId)
    setError('')
    try {
      await api.post(`/portal/me/drives/${driveId}/apply`)
      setDrives((prev) => prev.map((d) => (d.id === driveId ? { ...d, applied: true } : d)))
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not apply. Please try again.')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Briefcase className="w-6 h-6 text-primary-600" /> Jobs & Drives
        </h1>
        <p className="text-sm text-gray-500">Upcoming drives you're eligible for. Apply to register your interest.</p>
      </div>

      {!hasResume && (
        <Link
          to="/portal"
          className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition"
        >
          <FileText className="w-5 h-5 text-amber-600 shrink-0" />
          <span className="text-sm font-medium text-amber-800">
            Upload your resume to apply for drives — add it on your dashboard →
          </span>
        </Link>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading drives...</div>
      ) : drives.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400 text-sm">
          No eligible upcoming drives right now. Check back soon!
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {drives.map((d) => (
            <div key={d.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 flex flex-col">
              <div>
                <p className="font-semibold text-gray-900">{d.job_role}</p>
                <p className="text-xs text-gray-500">{d.company_name || `Company #${d.company_id}`}</p>
              </div>
              <div className="space-y-1 text-xs text-gray-500 flex-1">
                {d.drive_date && (
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(d.drive_date)} · {d.mode}
                  </div>
                )}
                {d.location && (
                  <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{d.location}</div>
                )}
                {d.ctc_offered != null && (
                  <div className="flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" />{formatCTC(d.ctc_offered)}</div>
                )}
                {d.registration_deadline && (
                  <div className="text-orange-600">Apply by {formatDate(d.registration_deadline)}</div>
                )}
              </div>
              {d.applied ? (
                <span className="flex items-center justify-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-lg py-2">
                  <Check className="w-4 h-4" /> Applied
                </span>
              ) : !hasResume ? (
                <Link
                  to="/portal"
                  className="flex items-center justify-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium py-2 rounded-lg"
                >
                  <FileText className="w-4 h-4" /> Add resume to apply
                </Link>
              ) : (
                <button
                  onClick={() => apply(d.id)}
                  disabled={applying === d.id}
                  className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
                >
                  {applying === d.id ? 'Applying...' : 'Apply'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
