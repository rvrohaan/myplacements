import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import api from '@/lib/api'
import type { Student, Company } from '@/types'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

export default function StudentGapReportModal({
  student,
  onClose,
}: {
  student: Student
  onClose: () => void
}) {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // load companies once so the report can be targeted at a specific one
  useEffect(() => {
    api.get('/companies').then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const generate = (targetCompanyId: string) => {
    setLoading(true)
    setError('')
    const params = targetCompanyId ? { company_id: targetCompanyId } : undefined
    api
      .post(`/students/${student.id}/gap-report`, null, { params })
      .then((r) => setReport(r.data.report))
      .catch(() => setError('Could not generate the gap report. Please try again.'))
      .finally(() => setLoading(false))
  }

  // generate the general report as soon as the modal opens
  useEffect(() => {
    generate('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCompanyChange = (value: string) => {
    setCompanyId(value)
    generate(value)
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            <div>
              <ModalTitle>AI Skill Gap Report</ModalTitle>
              <p className="text-xs text-gray-500">{student.full_name || student.roll_number} · {student.branch}</p>
            </div>
          </div>
          <ModalClose />
        </div>

        <div className="px-6 py-3 border-b border-gray-100">
          <label className="block text-xs font-medium text-gray-500 mb-1">Target company (optional)</label>
          <select
            value={companyId}
            onChange={(e) => onCompanyChange(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
          >
            <option value="">General readiness (no specific company)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-10 justify-center text-sm">
              <Sparkles className="w-4 h-4 animate-pulse" />
              Generating report...
            </div>
          ) : error ? (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          ) : (
            <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{report}</div>
          )}
        </div>
    </Modal>
  )
}
