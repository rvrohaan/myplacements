import { useState } from 'react'
import { Sparkles, Copy, Check, MessageSquare, ClipboardList } from 'lucide-react'
import api from '@/lib/api'
import type { Company, ExamQuestionItem } from '@/types'
import { cn } from '@/lib/utils'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'

type Mode = 'interview' | 'exam'

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export default function InterviewQuestionsModal({
  company,
  onClose,
}: {
  company: Company
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('interview')
  const [jobRole, setJobRole] = useState('')
  const [questions, setQuestions] = useState<string[]>([])
  const [examQuestions, setExamQuestions] = useState<ExamQuestionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const hasResults = mode === 'interview' ? questions.length > 0 : examQuestions.length > 0

  const generate = async () => {
    if (mode === 'interview' && !jobRole.trim()) {
      setError('Enter a job role first.')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (mode === 'interview') {
        const { data } = await api.post(`/companies/${company.id}/interview-questions`, {
          job_role: jobRole,
        })
        setQuestions(data.questions)
      } else {
        // Blank role -> the company's general screening exam (e.g. TCS NQT style).
        const { data } = await api.post(`/companies/${company.id}/exam-questions`, {
          job_role: jobRole.trim() || null,
        })
        setExamQuestions(data.questions)
      }
    } catch {
      setError('Could not generate questions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    const text =
      mode === 'interview'
        ? questions.join('\n')
        : examQuestions
            .map(
              (q, i) =>
                `${i + 1}. [${q.category}] ${q.question}\n` +
                q.options.map((o, j) => `   ${OPTION_LABELS[j]}. ${o}`).join('\n') +
                `\n   Answer: ${OPTION_LABELS[q.correct_index]} — ${q.explanation}`
            )
            .join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      onClose={onClose}
      isDirty={questions.length > 0 || examQuestions.length > 0 || jobRole.trim().length > 0}
      panelClassName="w-full max-w-2xl max-h-[88vh] flex flex-col"
    >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            <div>
              <ModalTitle>AI Mock Interview & Exam Questions</ModalTitle>
              <p className="text-xs text-gray-500">{company.name}{company.domain ? ` · ${company.domain}` : ''}</p>
            </div>
          </div>
          <ModalClose />
        </div>

        <div className="px-6 pt-3 border-b border-gray-100">
          <div className="flex gap-1">
            {([
              { value: 'interview', label: 'Interview questions', icon: MessageSquare },
              { value: 'exam', label: 'Exam questions (MCQ)', icon: ClipboardList },
            ] as const).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => { setMode(value); setError('') }}
                disabled={loading}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors disabled:opacity-60',
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
        </div>

        <div className="px-6 py-4 border-b border-gray-100 space-y-2">
          <label className="block text-xs font-medium text-gray-500">
            {mode === 'exam' ? 'Job role (optional)' : 'Job role'}
          </label>
          <div className="flex gap-2">
            <input
              value={jobRole}
              onChange={(e) => setJobRole(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && generate()}
              disabled={loading}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
              placeholder={mode === 'exam' ? 'Leave blank for the general screening exam' : 'e.g. Software Engineer'}
            />
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60 whitespace-nowrap shadow-sm shadow-primary-600/25 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? 'Generating...' : hasResults ? 'Regenerate' : 'Generate'}
            </button>
          </div>
          {mode === 'exam' && (
            <p className="text-xs text-gray-400">
              MCQs for the screening rounds held before interviews. Leave the role blank to get the
              company's general test (e.g. TCS NQT / Infosys aptitude pattern).
            </p>
          )}
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {error ? (
            <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-10 justify-center text-sm">
              <Sparkles className="w-4 h-4 animate-pulse" />
              Generating questions...
            </div>
          ) : hasResults ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  onClick={copy}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-primary-600"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy all'}
                </button>
              </div>
              {mode === 'interview' ? (
                <ol className="space-y-2">
                  {questions.map((q, i) => (
                    <li key={i} className="text-sm text-gray-700 leading-relaxed border-b border-gray-100 pb-2">
                      {q}
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="space-y-4">
                  {examQuestions.map((q, i) => (
                    <li key={i} className="border border-gray-100 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm font-medium text-gray-800">
                          <span className="text-primary-600 mr-1.5">{i + 1}.</span>
                          {q.question}
                        </p>
                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium whitespace-nowrap">
                          {q.category}
                        </span>
                      </div>
                      <ul className="space-y-1 mb-2">
                        {q.options.map((opt, j) => (
                          <li
                            key={j}
                            className={cn(
                              'text-sm px-2.5 py-1.5 rounded-md',
                              j === q.correct_index
                                ? 'bg-green-50 text-green-800 font-medium'
                                : 'text-gray-600'
                            )}
                          >
                            <span className="font-medium mr-1.5">{OPTION_LABELS[j]}.</span>
                            {opt}
                            {j === q.correct_index && <Check className="w-3.5 h-3.5 inline ml-1.5 -mt-0.5" />}
                          </li>
                        ))}
                      </ul>
                      {q.explanation && (
                        <p className="text-xs text-gray-500 leading-relaxed">{q.explanation}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-10">
              Enter a job role above and click "Generate".
            </p>
          )}
        </div>
    </Modal>
  )
}
