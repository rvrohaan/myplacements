import { useState } from 'react'
import { Sparkles, FileText } from 'lucide-react'
import api from '@/lib/api'

export default function ResumeReview() {
  const [review, setReview] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/portal/me/resume-review')
      setReview(data.review)
    } catch {
      setError('Could not review your resume. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary-600" /> AI Resume Review
        </h1>
        <p className="text-sm text-gray-500">
          Get AI feedback based on your profile — strengths, gaps, and concrete rewrites.
        </p>
      </div>

      {!review && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">
            We'll review the skills, projects, internships and certifications on your profile.
            Keep them up to date with your placement office for the best feedback.
          </p>
          <button
            onClick={generate}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm shadow-primary-600/25 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Review my resume
          </button>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 py-10 justify-center text-sm">
          <Sparkles className="w-4 h-4 animate-pulse" />
          Reviewing your resume...
        </div>
      )}

      {review && !loading && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={generate}
              className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Sparkles className="w-4 h-4" />
              Regenerate
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{review}</div>
          </div>
        </div>
      )}
    </div>
  )
}
