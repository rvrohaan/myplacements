/**
 * lib/utils.ts - the display formatters.
 *
 * The substance here is `formatDateTime` and `timeAgo`. The API sends naive UTC
 * with no offset ("2026-09-12T11:54:20.44"), which JavaScript reads as *local*
 * time - so in IST every timestamp would render four and a half hours early and
 * every notification would claim to be from the future. Both functions patch
 * that by appending a Z, and that patch is what these tests pin.
 *
 * Assertions avoid the exact month abbreviation: Node's ICU data spells it
 * "Sep" or "Sept" depending on version, which is not something the app cares
 * about. The timezone is pinned in vitest.config.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatCTC, formatDate, formatDateTime, timeAgo } from '@/lib/utils'

// 11:54 UTC is 17:24 IST on the same day.
const NAIVE_UTC = '2026-09-12T11:54:20.44'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatCTC', () => {
  it('renders a package in lakhs per annum', () => {
    expect(formatCTC(12)).toBe('₹12 LPA')
  })

  it('keeps a fractional package', () => {
    expect(formatCTC(7.5)).toBe('₹7.5 LPA')
  })

  it('says N/A when no package is recorded', () => {
    expect(formatCTC(undefined)).toBe('N/A')
  })

  it('says N/A for an unpaid or unrecorded zero', () => {
    // Falsy, so zero takes the same path as undefined. Worth stating because a
    // genuine unpaid internship would also render as N/A rather than ₹0 LPA.
    expect(formatCTC(0)).toBe('N/A')
  })
})

describe('formatDate', () => {
  it('renders day, month and year', () => {
    const out = formatDate(NAIVE_UTC)
    expect(out).toMatch(/^12 \w+ 2026$/)
  })

  it('says N/A when there is no date', () => {
    expect(formatDate(undefined)).toBe('N/A')
    expect(formatDate('')).toBe('N/A')
  })
})

describe('formatDateTime', () => {
  it('reads a naive backend timestamp as UTC, not as local time', () => {
    // The whole point. Without the appended Z this would read 11:54 as IST and
    // render 11:54 am - four and a half hours early, every time.
    expect(formatDateTime(NAIVE_UTC)).toContain('05:24')
    expect(formatDateTime(NAIVE_UTC)).not.toContain('11:54')
  })

  it('treats a naive timestamp exactly like the same instant marked Z', () => {
    // Stated relationally so it holds whatever the runner's locale does.
    expect(formatDateTime(NAIVE_UTC)).toBe(formatDateTime(`${NAIVE_UTC}Z`))
  })

  it('leaves an explicit UTC marker alone rather than doubling it', () => {
    expect(formatDateTime('2026-09-12T11:54:20Z')).toContain('05:24')
  })

  it('respects an explicit offset instead of overriding it', () => {
    // +00:00 is the same instant as Z; appending another Z would make the
    // string unparsable and fall through to N/A.
    expect(formatDateTime('2026-09-12T11:54:20+00:00')).toBe(formatDateTime(`${NAIVE_UTC}Z`))
  })

  it('says N/A when there is no timestamp', () => {
    expect(formatDateTime(undefined)).toBe('N/A')
  })

  it('says N/A for an unparsable timestamp rather than Invalid Date', () => {
    // "Invalid Date" rendered into a table is worse than an honest N/A.
    expect(formatDateTime('not a timestamp')).toBe('N/A')
  })
})

describe('timeAgo', () => {
  function at(iso: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('reads the backend timestamp as UTC', () => {
    // Same Z fix. Without it, a notification logged a minute ago would be read
    // as 5h30m in the future and clamp to "just now" forever.
    at('2026-09-12T12:54:30Z')
    expect(timeAgo(NAIVE_UTC)).toBe('1h')
  })

  it('says just now inside the first minute', () => {
    at('2026-09-12T11:54:50Z')
    expect(timeAgo(NAIVE_UTC)).toBe('just now')
  })

  it('counts whole minutes', () => {
    at('2026-09-12T12:19:30Z')
    expect(timeAgo(NAIVE_UTC)).toBe('25m')
  })

  it('switches to hours at sixty minutes', () => {
    at('2026-09-12T12:54:30Z')
    expect(timeAgo(NAIVE_UTC)).toBe('1h')
  })

  it('switches to days at twenty-four hours', () => {
    at('2026-09-13T11:54:30Z')
    expect(timeAgo(NAIVE_UTC)).toBe('1d')
  })

  it('falls back to a date past a week', () => {
    at('2026-09-25T11:54:30Z')
    expect(timeAgo(NAIVE_UTC)).toMatch(/^12 \w+ 2026$/)
  })

  it('clamps a future timestamp to just now', () => {
    // A client clock a few seconds behind the server must not render
    // "in 3 seconds" next to a notification that has already arrived.
    at('2026-09-12T11:54:00Z')
    expect(timeAgo(`${NAIVE_UTC}Z`)).toBe('just now')
  })

  it('returns an empty string when there is no timestamp', () => {
    // Empty, not "N/A": this sits inline beside a notification title.
    expect(timeAgo(undefined)).toBe('')
    expect(timeAgo('')).toBe('')
  })

  it('returns an empty string for an unparsable timestamp', () => {
    expect(timeAgo('nonsense')).toBe('')
  })
})
