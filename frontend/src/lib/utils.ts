import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCTC(ctc?: number): string {
  if (!ctc) return 'N/A'
  return `₹${ctc} LPA`
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return 'N/A'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * A backend timestamp as a local date and time.
 *
 * The API sends naive UTC ("2026-09-12T11:54:20.44") with no offset, which JS
 * would otherwise read as local time and show four and a half hours early in
 * IST. The trailing Z says what the string actually means.
 */
export function formatDateTime(ts?: string): string {
  if (!ts) return 'N/A'
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * A backend timestamp as a short relative age ("4m", "2h", "3d").
 *
 * Applies the same trailing-Z fix as formatDateTime: without it every
 * notification would read as hours in the future.
 */
export function timeAgo(ts?: string): string {
  if (!ts) return ''
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  // Clamp at zero: a client clock a few seconds behind the server must not
  // render "in 3 seconds".
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return formatDate(iso)
}

export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  priority: 'bg-blue-100 text-blue-700',
  new: 'bg-gray-100 text-gray-700',
  dormant: 'bg-yellow-100 text-yellow-700',
  blacklisted: 'bg-red-100 text-red-700',
  placed: 'bg-green-100 text-green-700',
  unplaced: 'bg-orange-100 text-orange-700',
  opted_out: 'bg-gray-100 text-gray-700',
  higher_studies: 'bg-purple-100 text-purple-700',
  upcoming: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
  registered: 'bg-gray-100 text-gray-700',
  shortlisted: 'bg-blue-100 text-blue-700',
  attended: 'bg-indigo-100 text-indigo-700',
  in_process: 'bg-sky-100 text-sky-700',
  aptitude_cleared: 'bg-cyan-100 text-cyan-700',
  technical_cleared: 'bg-teal-100 text-teal-700',
  hr_cleared: 'bg-violet-100 text-violet-700',
  selected: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-amber-100 text-amber-700',
  // Company role openings
  open: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  filled: 'bg-blue-100 text-blue-700',
  closed: 'bg-gray-100 text-gray-700',
  // Officer assignment workflow
  accepted: 'bg-blue-100 text-blue-700',
  escalated: 'bg-red-100 text-red-700',
  // Communication response state
  awaited: 'bg-yellow-100 text-yellow-700',
  received: 'bg-green-100 text-green-700',
  no_response: 'bg-red-100 text-red-700',
  // Training progress
  enrolled: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  dropped: 'bg-red-100 text-red-700',
}
