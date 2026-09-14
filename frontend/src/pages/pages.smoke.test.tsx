/**
 * Every major page renders on an empty college.
 *
 * Breadth rather than depth. The single most common way one of these breaks is
 * not a subtle logic error - it is a page that throws on data it has never seen,
 * and "no data yet" is the state every college is in on its first morning.
 * Reading `.length` of a list the API omitted, or `.toFixed()` on a null
 * average, takes the whole screen down and the only symptom is a blank page.
 *
 * So each page here is mounted against an API that answers everything with
 * nothing, and asked only to survive and say something. The pages with real
 * state machines get their own files; this catches the failure those would
 * never reach.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DailyUpdate from '@/pages/daily/DailyUpdate'
import HRContacts from '@/pages/hr/HRContacts'
import Officers from '@/pages/officers/Officers'
import Opportunities from '@/pages/opportunities/Opportunities'
import Reports from '@/pages/reports/Reports'
import Students from '@/pages/students/Students'

import { HttpResponse, http, server } from '../test/server'
import { fakeUser, renderWithProviders, screen, setHost, signIn, waitFor } from '../test/utils'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Object-shaped endpoints. Everything else answers with an empty list. */
const OBJECT_ENDPOINTS: Record<string, Json> = {
  '/api/students/filter-options': { branches: [], batch_years: [] },
  '/api/hr-contacts/summary': { total: 0, buckets: [], engagement: [], channels: [] },
  '/api/job-leads/settings': { enabled: false, scheduled: false, focus: null, last_scan: null },
  '/api/daily-updates/settings': { cutoff: '19:00', enabled: true },
  // `derived` is read field by field and `prompts` is mapped over, so both
  // have to be present even when the officer has done nothing yet - an empty
  // day is not a missing day.
  '/api/daily-updates/today': {
    existing: null,
    kind: 'officer',
    derived: {},
    prompts: [],
    date: '2026-09-14',
    cutoff: '19:00',
    deadline_passed: false,
  },
  '/api/colleges/current': { name: 'RIT', code: 'rit', logo_url: null },
  // The catalogue is an object, and its `reports` list is static in code rather
  // than drawn from the database - so one entry here is the empty-college
  // state, and an empty list would be testing something that cannot happen.
  '/api/reports': {
    batch_years: [],
    months: [],
    reports: [
      { id: 'branch-wise', name: 'Branch-wise placement', description: 'x', params: ['batch_year'] },
    ],
  },
}

const PAGES: Array<[string, () => JSX.Element]> = [
  ['Students', Students],
  ['HR contacts', HRContacts],
  ['Officers', Officers],
  ['Opportunities', Opportunities],
  ['Daily update', DailyUpdate],
  ['Reports', Reports],
]

beforeEach(() => {
  setHost('rit.myplacements.in')
  signIn(fakeUser({ role: 'pro_chancellor' }))
  server.use(
    http.get('*/api/*', ({ request }) => {
      const { pathname } = new URL(request.url)
      if (pathname in OBJECT_ENDPOINTS) {
        return HttpResponse.json(OBJECT_ENDPOINTS[pathname])
      }
      return HttpResponse.json([], { headers: { 'X-Total-Count': '0' } })
    }),
  )
})

describe.each(PAGES)('%s', (name, Page) => {
  it('renders without throwing on an empty college', async () => {
    // React logs the error before rethrowing, so a crash is noisy as well as
    // fatal; silence the log and let the assertion do the talking.
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderWithProviders(<Page />)
      await waitFor(() => expect(document.body.textContent).not.toBe(''))
      expect(document.body.textContent!.trim().length).toBeGreaterThan(0)
    } finally {
      onError.mockRestore()
    }
  })

  it('settles rather than spinning forever', async () => {
    // A page that leaves its skeleton up when the answer was "nothing" reads
    // as broken, and is the other half of how empty data goes wrong.
    renderWithProviders(<Page />)
    await waitFor(
      () => {
        expect(screen.queryByText(/^loading/i)).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })
})

describe('an API that is entirely down', () => {
  it.each(PAGES)('%s still renders', async (name, Page) => {
    // Not hypothetical: a backend deploy is exactly this for thirty seconds,
    // and a white screen is a much worse answer than an error message.
    server.use(http.get('*/api/*', () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderWithProviders(<Page />)
      await waitFor(() => expect(document.body.textContent!.trim().length).toBeGreaterThan(0))
    } finally {
      onError.mockRestore()
    }
  })
})
