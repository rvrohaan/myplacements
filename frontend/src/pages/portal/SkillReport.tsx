import { useEffect, useState } from 'react'
import { Sparkles, Target } from 'lucide-react'
import api from '@/lib/api'

interface CompanyOption {
  id: number
  name: string
}

export default function SkillReport() {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState('')
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/portal/companies').then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const generate = (targetCompanyId: string) => {
    setLoading(true)
    setError('')
    const params = targetCompanyId ? { company_id: targetCompanyId } : undefined
    api
      .post('/portal/me/gap-report', null, { params })
      .then((r) => setReport(r.data.report))
      .catch(() => setError('Could not generate your skill report. Please try again.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    generate('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCompanyChange = (value: string) => {
    setCompanyId(value)
    generate(value)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Target className="w-6 h-6 text-primary-600" /> My Skill Report
        </h1>
        <p className="text-sm text-gray-500">
          A personalised view of your gaps and how to close them — generally or for a target company.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
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

      <div className="bg-white rounded-xl border border-gray-200 p-5 min-h-[200px]">
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-10 justify-center text-sm">
            <Sparkles className="w-4 h-4 animate-pulse" />
            Analysing your profile...
          </div>
        ) : error ? (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        ) : (
          <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{report}</div>
        )}
      </div>
    </div>
  )
}
