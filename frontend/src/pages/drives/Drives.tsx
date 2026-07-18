import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, CalendarDays, MapPin, IndianRupee, Users, Layers } from 'lucide-react'
import api from '@/lib/api'
import type { Drive, DriveStatus, Company } from '@/types'
import { cn, STATUS_COLORS, formatDate, formatCTC } from '@/lib/utils'
import DriveFormModal from './DriveFormModal'

export default function Drives() {
  const [drives, setDrives] = useState<Drive[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<DriveStatus | ''>('')
  const [showForm, setShowForm] = useState(false)

  const fetchDrives = () => {
    setLoading(true)
    const params: Record<string, string> = {}
    if (statusFilter) params.status = statusFilter
    api.get('/drives', { params }).then((r) => setDrives(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchDrives() }, [statusFilter])

  // Load companies once for the create-drive dropdown and to show names on cards.
  useEffect(() => {
    api.get('/companies', { params: { limit: 200 } }).then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const companyName = (id: number) => companies.find((c) => c.id === id)?.name ?? `Company #${id}`

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['', 'upcoming', 'ongoing', 'completed', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Drive
        </button>
      </div>

      {showForm && (
        <DriveFormModal
          companies={companies}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            fetchDrives()
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-10 text-gray-400">Loading drives...</div>
        ) : drives.length === 0 ? (
          <div className="col-span-3 text-center py-10 text-gray-400">No drives found</div>
        ) : (
          drives.map((d) => (
            <Link
              to={`/drives/${d.id}`}
              key={d.id}
              className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 block hover:border-primary-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{d.job_role}</p>
                  <p className="text-xs text-gray-500">{companyName(d.company_id)}</p>
                </div>
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[d.status])}>
                  {d.status}
                </span>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {d.drive_date && (
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(d.drive_date)} · {d.mode}
                  </div>
                )}
                {d.location && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {d.location}
                  </div>
                )}
                {d.ctc_offered && (
                  <div className="flex items-center gap-1.5">
                    <IndianRupee className="w-3.5 h-3.5" />
                    {formatCTC(d.ctc_offered)}
                  </div>
                )}
              </div>
              {(d.min_cgpa || d.eligible_branches) && (
                <div className="text-xs text-gray-500 border-t border-gray-100 pt-2">
                  {d.min_cgpa && <span className="mr-3">Min CGPA: {d.min_cgpa}</span>}
                  {d.eligible_branches && <span>{d.eligible_branches}</span>}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary-600">
                  <Users className="w-3.5 h-3.5" />
                  {d.participant_count} applicant{d.participant_count === 1 ? '' : 's'}
                </div>
                {d.total_rounds ? (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Layers className="w-3.5 h-3.5" />
                    {d.total_rounds} round{d.total_rounds === 1 ? '' : 's'}
                  </div>
                ) : null}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
