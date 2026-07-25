import { useEffect, useRef, useState } from 'react'
import { Search, UserPlus, Sparkles, ChevronLeft, ChevronRight, Pencil, KeyRound, Check } from 'lucide-react'
import api from '@/lib/api'
import type { Student, PlacementStatus, RiskCategory, EnableLoginResult } from '@/types'
import { cn, formatCTC } from '@/lib/utils'
import AddStudentModal from './AddStudentModal'
import EditStudentModal from './EditStudentModal'
import PlacementPackageModal from './PlacementPackageModal'
import StudentGapReportModal from './StudentGapReportModal'
import EnableLoginModal from './EnableLoginModal'
import StatusSelect, { type StatusOption } from '@/components/StatusSelect'
import ImportExportControls from '@/components/ImportExportControls'
import { useToast } from '@/components/ui/toast'

const PLACEMENT_OPTIONS: StatusOption<PlacementStatus>[] = [
  { value: 'unplaced', label: 'unplaced' },
  { value: 'placed', label: 'placed' },
  { value: 'opted_out', label: 'opted out' },
  { value: 'higher_studies', label: 'higher studies' },
]

const RISK_OPTIONS: StatusOption<RiskCategory>[] = [
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
]

export default function Students() {
  const toast = useToast()
  const [students, setStudents] = useState<Student[]>([])
  // What's typed vs. what's been sent to the server (debounced, see below).
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PlacementStatus | ''>('')
  const [riskFilter, setRiskFilter] = useState<RiskCategory | ''>('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [placingStudent, setPlacingStudent] = useState<Student | null>(null)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [reportStudent, setReportStudent] = useState<Student | null>(null)
  const [loginResults, setLoginResults] = useState<EnableLoginResult[] | null>(null)
  const [enablingId, setEnablingId] = useState<number | null>(null)
  const [enablingAll, setEnablingAll] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const PAGE_SIZE = 25

  // Searching hits the server, so wait for a pause in typing instead of firing a
  // query per keystroke. Filters change the result set, so restart at page one.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Responses can land out of order (an early, slower query resolving after a
  // later one); only the newest request is allowed to write to state.
  const latestRequest = useRef(0)

  // Paged server-side: a college can have far more students than one request
  // returns. X-Total-Count carries the unpaged total.
  const loadStudents = () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    const params: Record<string, string> = {
      skip: String((page - 1) * PAGE_SIZE),
      limit: String(PAGE_SIZE),
    }
    if (search) params.search = search
    if (statusFilter) params.placement_status = statusFilter
    if (riskFilter) params.risk_category = riskFilter
    api
      .get('/students', { params })
      .then((r) => {
        if (requestId !== latestRequest.current) return
        setStudents(r.data)
        const count = Number(r.headers['x-total-count'])
        setTotal(Number.isFinite(count) ? count : r.data.length)
      })
      .catch(() => {
        if (requestId === latestRequest.current) toast.error('Could not load students. Please refresh.')
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false)
      })
  }

  useEffect(loadStudents, [search, statusFilter, riskFilter, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const markEnabled = (ids: number[]) => {
    const idSet = new Set(ids)
    setStudents((prev) => prev.map((s) => (idSet.has(s.id) ? { ...s, login_enabled: true } : s)))
  }

  const enableOneLogin = async (student: Student) => {
    setEnablingId(student.id)
    try {
      const { data } = await api.post(`/students/${student.id}/enable-login`)
      markEnabled([student.id])
      setLoginResults([data])
    } catch {
      toast.error('Could not enable login for this student.')
    } finally {
      setEnablingId(null)
    }
  }

  // Acts on the students actually on screen — with server-side paging that's the
  // current page, so a click can't fan out over an entire college.
  const enableAllShown = async () => {
    const ids = students.filter((s) => !s.login_enabled).map((s) => s.id)
    if (ids.length === 0) return
    setEnablingAll(true)
    try {
      const { data } = await api.post('/students/enable-login', { student_ids: ids })
      markEnabled(data.map((r: EnableLoginResult) => r.student_id))
      setLoginResults(data)
    } catch {
      toast.error('Could not enable logins. Please try again.')
    } finally {
      setEnablingAll(false)
    }
  }

  const handlePlacementChange = (student: Student, status: PlacementStatus) => {
    if (status === 'placed') {
      setPlacingStudent(student) // ask for the package first
    } else {
      patchStudent(student, { placement_status: status })
    }
  }

  const patchStudent = async (student: Student, patch: Partial<Student>) => {
    // optimistic update; revert to the original record on failure
    setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, ...patch } : s)))
    try {
      const { data } = await api.put(`/students/${student.id}`, patch)
      setStudents((prev) => prev.map((s) => (s.id === student.id ? data : s)))
    } catch {
      setStudents((prev) => prev.map((s) => (s.id === student.id ? student : s)))
      toast.error(`Could not update ${student.full_name || student.roll_number}. Change reverted.`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, roll no or branch..."
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as PlacementStatus | ''); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Status</option>
          <option value="unplaced">Unplaced</option>
          <option value="placed">Placed</option>
          <option value="opted_out">Opted Out</option>
          <option value="higher_studies">Higher Studies</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => { setRiskFilter(e.target.value as RiskCategory | ''); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All Risk</option>
          <option value="low">Low Risk</option>
          <option value="medium">Medium Risk</option>
          <option value="high">High Risk</option>
        </select>
        <div className="flex items-start gap-2 sm:ml-auto">
          <ImportExportControls
            base="/students"
            label="Students"
            onImported={loadStudents}
            exportParams={{
              ...(search ? { search } : {}),
              ...(statusFilter ? { placement_status: statusFilter } : {}),
              ...(riskFilter ? { risk_category: riskFilter } : {}),
            }}
          />
          <button
            onClick={enableAllShown}
            disabled={enablingAll || students.every((s) => s.login_enabled)}
            title="Enable login for the students on this page that don't have it yet"
            className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4" />
            {enablingAll ? 'Enabling...' : 'Enable logins'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm shadow-primary-600/25"
          >
            <UserPlus className="w-4 h-4" />
            Add student
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Name', 'Roll No', 'Branch', 'Batch', 'CGPA', 'Backlogs', 'Skills', 'Placement', 'Risk', 'Login', ''].map((h, i) => (
                <th key={h || i} scope="col" className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={11} className="text-center py-10 text-gray-500">Loading...</td></tr>
            ) : students.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-10 text-gray-500">No students found</td></tr>
            ) : (
              students.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.full_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{s.roll_number}</td>
                  <td className="px-4 py-3 text-gray-600">{s.branch}</td>
                  <td className="px-4 py-3 text-gray-600">{s.batch_year}</td>
                  <td className="px-4 py-3">
                    <span className={cn('font-medium', s.cgpa && s.cgpa < 6 ? 'text-red-600' : 'text-gray-900')}>
                      {s.cgpa ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.backlogs}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate">{s.skills || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusSelect
                        value={s.placement_status}
                        options={PLACEMENT_OPTIONS}
                        onChange={(status) => handlePlacementChange(s, status)}
                      />
                      {s.placement_status === 'placed' && s.placement_ctc != null && (
                        <span className="text-xs font-medium text-green-700 whitespace-nowrap">
                          {formatCTC(s.placement_ctc)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusSelect
                        value={s.risk_category}
                        options={RISK_OPTIONS}
                        onChange={(risk) => patchStudent(s, { risk_category: risk })}
                      />
                      {s.readiness_score != null && (
                        <span className="text-xs text-gray-400" title="Readiness score">
                          {s.readiness_score}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.login_enabled ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                        <Check className="w-3.5 h-3.5" /> Enabled
                      </span>
                    ) : (
                      <button
                        onClick={() => enableOneLogin(s)}
                        disabled={enablingId === s.id}
                        title="Enable student login (generates a temp password)"
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-primary-600 disabled:opacity-50"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {enablingId === s.id ? '...' : 'Enable'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditingStudent(s)}
                        title="Edit student"
                        className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => setReportStudent(s)}
                        title="Generate AI skill gap report"
                        className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Gap report
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min((page - 1) * PAGE_SIZE + students.length, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <AddStudentModal onClose={() => setShowModal(false)} onCreated={loadStudents} />
      )}
      {editingStudent && (
        <EditStudentModal
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={(updated) =>
            setStudents((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
          }
        />
      )}
      {reportStudent && (
        <StudentGapReportModal student={reportStudent} onClose={() => setReportStudent(null)} />
      )}
      {loginResults && (
        <EnableLoginModal results={loginResults} onClose={() => setLoginResults(null)} />
      )}
      {placingStudent && (
        <PlacementPackageModal
          student={placingStudent}
          onClose={() => setPlacingStudent(null)}
          onConfirm={(ctc) => {
            patchStudent(placingStudent, { placement_status: 'placed', placement_ctc: ctc })
            setPlacingStudent(null)
          }}
        />
      )}
    </div>
  )
}
