import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown, MessageSquare, ClipboardList, Check, X } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ExamQuestionItem, InterviewPrepItem } from '@/types'

interface CompanyOption {
  id: number
  name: string
  domain?: string
}

type Mode = 'interview' | 'exam'

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export default function Practice() {
  const [mode, setMode] = useState<Mode>('interview')
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState('')
  const [jobRole, setJobRole] = useState('')
  const [items, setItems] = useState<InterviewPrepItem[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [examItems, setExamItems] = useState<ExamQuestionItem[]>([])
  // question index -> option index the student picked (answers lock once chosen)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/portal/companies').then((r) => setCompanies(r.data)).catch(() => {})
  }, [])

  const hasResults = mode === 'interview' ? items.length > 0 : examItems.length > 0

  const generate = async () => {
    if (mode === 'interview' && !jobRole.trim()) {
      setError('Enter the job role you want to practice for.')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (mode === 'interview') {
        setItems([])
        setOpen(null)
        const { data } = await api.post('/portal/me/interview-prep', {
          job_role: jobRole,
          company_id: companyId ? parseInt(companyId) : null,
        })
        setItems(data.questions)
      } else {
        setExamItems([])
        setPicked({})
        // Blank role -> the company's general screening exam (e.g. TCS NQT style).
        const { data } = await api.post('/portal/me/exam-prep', {
          job_role: jobRole.trim() || null,
          company_id: companyId ? parseInt(companyId) : null,
        })
        setExamItems(data.questions)
      }
    } catch {
      setError('Could not generate questions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const answered = Object.keys(picked).length
  const correct = Object.entries(picked).filter(
    ([q, o]) => examItems[Number(q)]?.correct_index === o
  ).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mock Practice</h1>
        <p className="text-sm text-gray-500">
          Pick a role (and optionally a company) to practice interview questions or a screening exam.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { value: 'interview', label: 'Mock Interview', icon: MessageSquare },
          { value: 'exam', label: 'Mock Exam', icon: ClipboardList },
        ] as const).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => { setMode(value); setError('') }}
            disabled={loading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors disabled:opacity-60',
              mode === value
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {mode === 'exam' ? 'Job role (optional)' : 'Job role *'}
          </label>
          <input
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
            placeholder={mode === 'exam' ? 'Leave blank for the general screening exam' : 'e.g. Software Engineer'}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Target company (optional)</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
          >
            <option value="">Any company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 shadow-sm shadow-primary-600/25 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {loading
              ? 'Generating...'
              : hasResults
                ? mode === 'interview' ? 'Regenerate' : 'New exam'
                : mode === 'interview' ? 'Generate questions' : 'Start mock exam'}
          </button>
          {mode === 'exam' && !examItems.length && !loading && (
            <p className="text-xs text-gray-400">
              MCQs like the aptitude/screening test rounds held before interviews. Leave the role
              blank for a company's general test (e.g. TCS NQT / Infosys aptitude pattern).
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-10 justify-center text-sm">
          <Sparkles className="w-4 h-4 animate-pulse" />
          {mode === 'interview' ? 'Preparing your questions...' : 'Setting your exam paper...'}
        </div>
      ) : mode === 'interview' ? (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="text-sm font-medium text-gray-800">
                  <span className="text-primary-600 mr-1.5">{i + 1}.</span>
                  {item.question}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${open === i ? 'rotate-180' : ''}`} />
              </button>
              {open === i && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Answer guidance</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{item.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {examItems.length > 0 && (
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 text-sm">
              <span className="text-gray-500">
                Answered {answered} of {examItems.length}
              </span>
              <span className={cn('font-semibold', answered ? 'text-gray-900' : 'text-gray-400')}>
                Score: {correct}/{answered || 0}
              </span>
            </div>
          )}
          {examItems.map((q, i) => {
            const chosen = picked[i]
            const isAnswered = chosen !== undefined
            return (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-sm font-medium text-gray-800">
                    <span className="text-primary-600 mr-1.5">{i + 1}.</span>
                    {q.question}
                  </p>
                  <span className="shrink-0 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium whitespace-nowrap">
                    {q.category}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {q.options.map((opt, j) => {
                    const isCorrect = j === q.correct_index
                    const isChosen = j === chosen
                    return (
                      <button
                        key={j}
                        onClick={() => !isAnswered && setPicked({ ...picked, [i]: j })}
                        disabled={isAnswered}
                        className={cn(
                          'w-full flex items-start gap-2 text-left text-sm px-3 py-2 rounded-lg border transition-colors',
                          !isAnswered && 'border-gray-200 text-gray-700 hover:border-primary-400 hover:bg-primary-50/50',
                          isAnswered && isCorrect && 'border-green-300 bg-green-50 text-green-800 font-medium',
                          isAnswered && isChosen && !isCorrect && 'border-red-300 bg-red-50 text-red-700',
                          isAnswered && !isChosen && !isCorrect && 'border-gray-100 text-gray-400'
                        )}
                      >
                        <span className="font-medium shrink-0">{OPTION_LABELS[j]}.</span>
                        <span className="flex-1">{opt}</span>
                        {isAnswered && isCorrect && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
                        {isAnswered && isChosen && !isCorrect && <X className="w-4 h-4 shrink-0 mt-0.5" />}
                      </button>
                    )
                  })}
                </div>
                {isAnswered && q.explanation && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Explanation</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{q.explanation}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
