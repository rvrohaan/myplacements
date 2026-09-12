/**
 * The pieces of the daily digest that two pages need.
 *
 * The full digest (pages/daily/DailyDigest) is where a leader goes to read a
 * whole day; the dashboard panel (pages/dashboard/DigestPanel) puts today's
 * headline and the items wanting a reply on the page they already land on. Both
 * render the same escalation card, the same nudge buttons and the same deltas,
 * so those live here rather than being written twice and drifting apart.
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bell, CheckCircle2, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import type { DailyDigest as DailyDigestData } from '@/types'

export const TOTAL_LABELS: Array<[keyof DailyDigestData['totals'], string]> = [
  ['calls', 'Calls'],
  ['meetings', 'Meetings'],
  ['companies_touched', 'Companies touched'],
  ['new_companies', 'New companies'],
  ['drives_conducted', 'Drives run'],
  ['offers', 'Offers'],
]

/**
 * The two writes a leader makes from a digest: nudging someone who has not filed,
 * and acknowledging or replying to an update. `reload` re-reads the digest so the
 * card reflects what was just sent.
 */
export function useDigestActions(reload: () => void) {
  const toast = useToast()

  const remind = async (userId: number, name: string) => {
    try {
      const r = await api.post(`/daily-updates/remind/${userId}`)
      if (r.data?.email_status === 'sent') toast.success(`Reminder sent to ${name}.`)
      else toast.info(`No email could be sent to ${name} — check their address or the mail setup.`)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not send the reminder.')
    }
  }

  const review = async (updateId: number, note: string | null) => {
    try {
      await api.post(`/daily-updates/${updateId}/review`, { note })
      toast.success(note ? 'Reply sent.' : 'Marked as seen.')
      reload()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? 'Could not save your response.')
    }
  }

  return { remind, review }
}

/** Today against the trailing average, so the number has somewhere to stand. */
export function Delta({ value, baseline }: { value: number; baseline: number }) {
  const diff = value - baseline
  if (!baseline && !value) return <span className="text-xs text-gray-400">&mdash;</span>
  if (Math.abs(diff) < 0.5) {
    return <span className="text-xs text-gray-400">same as usual</span>
  }
  const up = diff > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? 'text-teal-600' : 'text-amber-600'}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? '+' : ''}
      {diff.toFixed(diff % 1 === 0 ? 0 : 1)} vs avg
    </span>
  )
}

export function NotFiledList({
  people,
  onRemind,
}: {
  people: DailyDigestData['attention']['not_filed']
  onRemind: (userId: number, name: string) => void
}) {
  if (people.length === 0) {
    return <p className="text-sm text-gray-500">Everyone has filed.</p>
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {people.map((person) => (
        <li
          key={person.user_id}
          className="inline-flex items-center gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-800 rounded-lg pl-3 pr-1.5 py-1"
        >
          {person.name}
          <button
            type="button"
            onClick={() => onRemind(person.user_id, person.name)}
            className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 hover:bg-rose-100 px-2 py-1 rounded"
          >
            <Bell className="w-3 h-3" aria-hidden="true" />
            Remind
          </button>
        </li>
      ))}
    </ul>
  )
}

export function StandingChip({ to, label, count }: { to: string; label: string; count: number }) {
  if (!count) return null
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-lg px-2.5 py-1.5"
    >
      <span className="font-semibold tabular-nums">{count}</span> {label}
    </Link>
  )
}

export function EscalationCard({
  item,
  onReview,
}: {
  item: DailyDigestData['attention']['escalations'][number]
  onReview: (id: number, note: string | null) => void
}) {
  const [replying, setReplying] = useState(false)
  const [note, setNote] = useState('')
  // A draft of the reply, written from this escalation. Shown as ghost text in
  // the empty box; Tab or the button below accepts it. Null means there is none
  // to offer - no API key, a model hiccup - and the box is simply empty.
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const drafted = useRef(false)

  const startReply = () => {
    setReplying(true)
    // Drafting costs an API call, so ask once per card: cancelling and reopening
    // the box reuses the draft already fetched rather than paying for it again.
    if (drafted.current) return
    drafted.current = true
    setDrafting(true)
    api
      .post(`/daily-updates/${item.update_id}/suggest-reply`)
      .then((r) => setSuggestion(r.data?.suggestion ?? null))
      .catch(() => setSuggestion(null))
      .finally(() => setDrafting(false))
  }

  const acceptSuggestion = () => {
    if (!suggestion) return
    setNote(suggestion)
    boxRef.current?.focus()
  }

  // Tab accepts the draft only while the box is still empty, so once there is
  // anything to send Tab goes back to doing what it should and reaches the Send
  // button. The button below does the same thing for anyone not using Tab.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || note !== '' || !suggestion) return
    e.preventDefault()
    acceptSuggestion()
  }

  const placeholder = drafting
    ? 'Drafting a suggestion…'
    : suggestion ?? `Reply to ${item.name ?? 'this update'}…`

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        {item.name ?? 'Unknown'}
      </p>
      <p className="mt-1 text-sm text-amber-900">{item.escalation_note}</p>
      {item.reviewed ? (
        <p className="mt-2 text-xs text-amber-700 inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Acknowledged
        </p>
      ) : replying ? (
        <div className="mt-2 space-y-2">
          <textarea
            ref={boxRef}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            placeholder={placeholder}
            aria-describedby={suggestion && !note ? `suggest-${item.update_id}` : undefined}
            className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {suggestion && !note && (
            <button
              type="button"
              id={`suggest-${item.update_id}`}
              onClick={acceptSuggestion}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 px-2.5 py-1 rounded-lg"
            >
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              Use this draft
              <kbd className="ml-0.5 px-1 py-px font-sans text-[10px] border border-amber-300 rounded bg-amber-50">
                Tab
              </kbd>
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReview(item.update_id, note.trim() || null)}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
            >
              Send reply
            </button>
            <button
              type="button"
              onClick={() => setReplying(false)}
              className="text-xs font-medium text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
            >
              Cancel
            </button>
          </div>
          {suggestion && (
            <p className="text-[11px] text-amber-700/80">
              Drafted for you — read it before sending.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onReview(item.update_id, null)}
            className="text-xs font-medium text-amber-800 bg-white border border-amber-300 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
          >
            Acknowledge
          </button>
          <button
            type="button"
            onClick={startReply}
            className="text-xs font-medium text-amber-800 hover:bg-amber-100 px-3 py-1.5 rounded-lg"
          >
            Reply
          </button>
        </div>
      )}
    </div>
  )
}
