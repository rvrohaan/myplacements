import { useState } from 'react'
import { ArrowRight, Loader2, Search } from 'lucide-react'
import { Modal, ModalClose, ModalTitle } from '@/components/ui/modal'
import api from '@/lib/api'

interface PortalMatch {
  name: string
  code: string
  city: string | null
}

// Where a college portal lives, relative to wherever the apex is running:
// rit.localhost:5173 in dev, rit.myplacements.in in production.
function portalUrl(code: string) {
  return `${window.location.protocol}//${code}.${window.location.host}/login`
}

export default function FindPortalModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PortalMatch[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim().length < 2 || loading) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/auth/find-portal', { query: query.trim() })
      setResults(data.colleges)
    } catch {
      setError('Something went wrong. Please try again.')
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      panelClassName="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 text-white shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <ModalTitle className="text-lg font-semibold text-white">Find your portal</ModalTitle>
          <p className="mt-1 text-sm text-gray-400">
            Every college has its own sign-in page. Enter your work email or your college name and
            we&apos;ll take you there.
          </p>
        </div>
        <ModalClose className="text-gray-400 hover:text-white" />
      </div>

      <form onSubmit={search} className="mt-5 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="you@college.edu or college name"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-blue-400/60 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={query.trim().length < 2 || loading}
          className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {results !== null && !error && (
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
              No portal found. Try your college name, or ask your placement cell for your portal
              link.
            </p>
          ) : (
            results.map((c) => (
              <a
                key={c.code}
                href={portalUrl(c.code)}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-3.5 transition-colors hover:border-blue-400/50 hover:bg-white/10"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{c.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {c.code}.myplacements.in{c.city ? ` · ${c.city}` : ''}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-blue-400" />
              </a>
            ))
          )}
        </div>
      )}
    </Modal>
  )
}
