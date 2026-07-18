import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin, IndianRupee, Users, FileText, Pencil, CheckCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import api from '@/lib/api'
import type { Drive, DriveRound, Participant, ParticipantStatus, Company } from '@/types'
import { cn, STATUS_COLORS, formatDate, formatCTC } from '@/lib/utils'
import OfferPackageModal from './OfferPackageModal'
import DriveFormModal from './DriveFormModal'
import DriveRoundsPanel from './DriveRoundsPanel'

const PARTICIPANT_STATUSES: ParticipantStatus[] = [
  'registered',
  'shortlisted',
  'attended',
  'in_process',
  'aptitude_cleared',
  'technical_cleared',
  'hr_cleared',
  'selected',
  'rejected',
  'withdrawn',
]

const labelFor = (s: string) => s.replace(/_/g, ' ')

type SortKey = 'name' | 'roll' | 'branch' | 'cgpa' | 'applied' | 'rounds' | 'ctc' | 'status'

export default function DriveDetail() {
  const { id } = useParams<{ id: string }>()
  const [drive, setDrive] = useState<Drive | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [packageFor, setPackageFor] = useState<Participant | null>(null)
  const [editing, setEditing] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('roll')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    Promise.all([
      api.get(`/drives/${id}`),
      api.get(`/drives/${id}/participants`),
    ])
      .then(([d, p]) => {
        setDrive(d.data)
        setParticipants(p.data)
        return api.get(`/companies/${d.data.company_id}`).then((c) => setCompany(c.data)).catch(() => {})
      })
      .finally(() => setLoading(false))
  }, [id])

  // Companies list backs the (read-only) company field in the edit modal.
  useEffect(() => {
    api.get('/companies', { params: { limit: 200 } }).then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const setRounds = (rounds: DriveRound[]) => setDrive((prev) => (prev ? { ...prev, rounds } : prev))

  // After a roster upload, both the round counts and participant statuses change.
  const refreshAfterUpload = () => {
    Promise.all([api.get(`/drives/${id}`), api.get(`/drives/${id}/participants`)])
      .then(([d, p]) => {
        setDrive(d.data)
        setParticipants(p.data)
      })
      .catch(() => {})
  }

  const [completing, setCompleting] = useState(false)
  const markCompleted = async () => {
    setCompleting(true)
    try {
      const res = await api.put(`/drives/${id}`, { status: 'completed' })
      setDrive(res.data)
    } finally {
      setCompleting(false)
    }
  }

  const updateStatus = async (participant: Participant, status: ParticipantStatus, ctc?: number) => {
    const previous = participant.status
    setParticipants((prev) => prev.map((p) => (p.id === participant.id ? { ...p, status } : p)))
    try {
      await api.put(`/drives/${id}/participants/${participant.id}`, { status, ctc })
    } catch {
      setParticipants((prev) => prev.map((p) => (p.id === participant.id ? { ...p, status: previous } : p)))
    }
  }

  // Selecting a participant asks for the package first; everything else applies directly.
  const onStatusChange = (participant: Participant, status: ParticipantStatus) => {
    if (status === 'selected') {
      setPackageFor(participant)
    } else {
      updateStatus(participant, status)
    }
  }

  // Sort accessor per column. Kept above the early returns so the useMemo hook
  // below always runs (rules of hooks). None of these depend on `drive`.
  const progress = (p: Participant) => p.round_results.filter((r) => r.passed === true).length
  const accessors: Record<SortKey, (p: Participant) => string | number | null | undefined> = {
    name: (p) => p.student_name?.toLowerCase(),
    roll: (p) => p.roll_number,
    branch: (p) => p.branch?.toLowerCase(),
    cgpa: (p) => p.cgpa,
    applied: (p) => p.registered_at,
    rounds: (p) => progress(p),
    ctc: (p) => p.ctc,
    status: (p) => PARTICIPANT_STATUSES.indexOf(p.status),
  }

  const sortedParticipants = useMemo(() => {
    const get = accessors[sortKey]
    return [...participants].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      const na = va === null || va === undefined
      const nb = vb === null || vb === undefined
      if (na && nb) return 0
      if (na) return 1 // nulls always last, regardless of direction
      if (nb) return -1
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>
  if (!drive) return <div className="text-center py-20 text-gray-500">Drive not found</div>

  // Funnel counts for the summary strip.
  const count = (s: ParticipantStatus) => participants.filter((p) => p.status === s).length
  const selected = count('selected')

  const roundNumbers = [...drive.rounds].map((r) => r.round_number).sort((a, b) => a - b)
  const hasRounds = roundNumbers.length > 0

  const columns: { label: string; key?: SortKey; show?: boolean }[] = [
    { label: 'Name', key: 'name' },
    { label: 'Roll No', key: 'roll' },
    { label: 'Branch', key: 'branch' },
    { label: 'CGPA', key: 'cgpa' },
    { label: 'Resume' },
    { label: 'Applied', key: 'applied' },
    { label: 'Rounds', key: 'rounds', show: hasRounds },
    { label: 'CTC', key: 'ctc' },
    { label: 'Status', key: 'status' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/drives" className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{drive.job_role}</h2>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[drive.status])}>
              {drive.status}
            </span>
          </div>
          <p className="text-sm text-gray-500">
            {company?.name || `Company #${drive.company_id}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {drive.status !== 'completed' && drive.status !== 'cancelled' && (
            <button
              onClick={markCompleted}
              disabled={completing}
              className="flex items-center gap-2 text-sm font-medium border border-green-300 text-green-700 hover:bg-green-50 px-3 py-2 rounded-lg disabled:opacity-60"
            >
              <CheckCircle className="w-4 h-4" /> {completing ? 'Saving...' : 'Mark completed'}
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {drive.drive_date && (
            <Info icon={<CalendarDays className="w-4 h-4" />} label="Date">
              {formatDate(drive.drive_date)} · {drive.mode}
            </Info>
          )}
          {drive.location && (
            <Info icon={<MapPin className="w-4 h-4" />} label="Location">{drive.location}</Info>
          )}
          {drive.ctc_offered != null && (
            <Info icon={<IndianRupee className="w-4 h-4" />} label="CTC">{formatCTC(drive.ctc_offered)}</Info>
          )}
          <Info icon={<Users className="w-4 h-4" />} label="Applicants">{participants.length}</Info>
          {drive.min_cgpa != null && <Info label="Min CGPA">{drive.min_cgpa}</Info>}
          {drive.eligible_branches && <Info label="Branches">{drive.eligible_branches}</Info>}
        </div>
      </div>

      {(drive.rounds.length > 0 || drive.total_rounds) && (
        <DriveRoundsPanel
          driveId={drive.id}
          rounds={drive.rounds}
          applicantCount={participants.length}
          onRoundsChange={setRounds}
          onResultsUploaded={refreshAfterUpload}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Applicants ({participants.length})</h3>
          {selected > 0 && <span className="text-xs font-medium text-green-700">{selected} selected</span>}
        </div>
        {participants.length === 0 ? (
          <p className="text-sm text-gray-400 px-5 py-10 text-center">No students have applied yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {columns.filter((col) => col.show !== false).map((col) => (
                    <th key={col.label} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {col.key ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key!)}
                          className="inline-flex items-center gap-1 hover:text-gray-700 uppercase tracking-wide"
                        >
                          {col.label}
                          {sortKey === col.key ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronsUpDown className="w-3.5 h-3.5 text-gray-300" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedParticipants.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{p.student_name || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700">{p.roll_number || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{p.branch || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{p.cgpa ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {p.resume_url ? (
                        <a
                          href={p.resume_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
                        >
                          <FileText className="w-3.5 h-3.5" /> View
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDate(p.registered_at)}</td>
                    {hasRounds && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          {roundNumbers.map((rn) => {
                            const res = p.round_results.find((r) => r.round_number === rn)
                            const state = !res || !res.appeared
                              ? 'absent'
                              : res.passed === true
                                ? 'pass'
                                : res.passed === false
                                  ? 'fail'
                                  : 'appeared'
                            return <RoundDot key={rn} n={rn} state={state} />
                          })}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-gray-700">{p.ctc != null ? formatCTC(p.ctc) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={p.status}
                        onChange={(e) => onStatusChange(p, e.target.value as ParticipantStatus)}
                        className={cn(
                          'px-2 py-1 rounded-lg text-xs font-medium border-0 capitalize cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500',
                          STATUS_COLORS[p.status]
                        )}
                      >
                        {PARTICIPANT_STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-white text-gray-800">{labelFor(s)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {packageFor && (
        <OfferPackageModal
          studentName={packageFor.student_name || packageFor.roll_number || 'this student'}
          defaultCtc={drive.ctc_offered}
          onClose={() => setPackageFor(null)}
          onConfirm={(ctc) => {
            updateStatus(packageFor, 'selected', ctc)
            setPackageFor(null)
          }}
        />
      )}

      {editing && (
        <DriveFormModal
          drive={drive}
          companies={companies}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setDrive(updated)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

function Info({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">{icon}{label}</p>
      <p className="font-medium text-gray-900">{children}</p>
    </div>
  )
}

type RoundDotState = 'pass' | 'fail' | 'appeared' | 'absent'

/** Small per-round outcome pill in the applicants table. */
function RoundDot({ n, state }: { n: number; state: RoundDotState }) {
  const styles: Record<RoundDotState, string> = {
    pass: 'bg-green-100 text-green-700 border-green-200',
    fail: 'bg-red-100 text-red-600 border-red-200',
    appeared: 'bg-sky-100 text-sky-700 border-sky-200',
    absent: 'bg-gray-100 text-gray-400 border-gray-200',
  }
  const titles: Record<RoundDotState, string> = {
    pass: 'Passed',
    fail: 'Did not pass',
    appeared: 'Appeared (result pending)',
    absent: 'No record',
  }
  return (
    <span
      title={`Round ${n}: ${titles[state]}`}
      className={cn(
        'w-5 h-5 rounded-full border text-[10px] font-semibold flex items-center justify-center',
        styles[state],
      )}
    >
      {n}
    </span>
  )
}
