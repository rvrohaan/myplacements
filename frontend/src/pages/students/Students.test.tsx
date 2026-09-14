/**
 * pages/students/Students.tsx - the most-used page in the app.
 *
 * Server-paged and filtered, which is where the interesting behaviour is: every
 * filter change is a fresh request, and the requests can come back out of order.
 * The page guards against that with a request id, and a regression there would
 * be near-invisible in use - the list would occasionally show the results of a
 * filter the user had already moved on from.
 *
 * Also worth pinning: the two failures are handled differently on purpose. The
 * list failing is worth a toast; the filter dropdowns failing is not, because
 * every other filter still works.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import Students from '@/pages/students/Students'

import { HttpResponse, http, server } from '../../test/server'
import {
  fakeUser,
  renderWithProviders,
  screen,
  setHost,
  signIn,
  userEvent,
  waitFor,
  within,
} from '../../test/utils'

function student(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    full_name: 'Asha Rao',
    roll_number: '1RV001',
    branch: 'CSE',
    batch_year: 2026,
    cgpa: 8.5,
    backlogs: 0,
    skills: 'Python, SQL',
    placement_status: 'unplaced',
    placement_ctc: null,
    risk_category: 'medium',
    readiness_score: 70,
    login_enabled: false,
    ...overrides,
  }
}

/** Stub the list, capturing the query each request carried. */
function listReturns(rows: unknown[], { total = rows.length } = {}) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/students', ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json(rows, { headers: { 'X-Total-Count': String(total) } })
    }),
  )
  return seen
}

beforeEach(() => {
  setHost('rit.myplacements.in')
  signIn(fakeUser({ role: 'pro_chancellor' }))
  server.use(
    http.get('/api/students/filter-options', () =>
      HttpResponse.json({ branches: ['CSE', 'ECE'], batch_years: [2026, 2025] }),
    ),
  )
})

describe('the list', () => {
  it('renders a student', async () => {
    listReturns([student()])
    renderWithProviders(<Students />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(screen.getByText('1RV001')).toBeInTheDocument()
  })

  it('shows an empty state rather than an empty table', async () => {
    listReturns([])
    renderWithProviders(<Students />)
    expect(await screen.findByText('No students found')).toBeInTheDocument()
  })

  it('renders a student with nothing recorded', async () => {
    // Imported rows routinely arrive with half the fields blank; an em-dash is
    // the honest rendering, and "null" on screen is the bug it prevents.
    listReturns([student({ full_name: null, cgpa: null, skills: null })])
    renderWithProviders(<Students />)
    const row = (await screen.findByText('1RV001')).closest('tr')!
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('says so when the list cannot be loaded', async () => {
    server.use(http.get('/api/students', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<Students />)
    expect(await screen.findByText(/could not load students/i)).toBeInTheDocument()
  })

  it('survives the filter options failing', async () => {
    // Non-fatal by design: the dropdowns stay empty and every other filter
    // still works, so this must not take the page down with it.
    server.use(
      http.get('/api/students/filter-options', () => HttpResponse.json({}, { status: 500 })),
    )
    listReturns([student()])
    renderWithProviders(<Students />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
  })
})

describe('paging', () => {
  it('takes the unpaged total from the header', async () => {
    // The body is one page; X-Total-Count is how many there are altogether.
    listReturns([student()], { total: 120 })
    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')
    expect(screen.getByText(/120/)).toBeInTheDocument()
  })

  it('asks for a bounded page', async () => {
    const seen = listReturns([student()])
    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')
    expect(Number(seen[0].get('limit'))).toBeGreaterThan(0)
    expect(seen[0].get('skip')).toBe('0')
  })

  it('falls back to the row count when the header is missing', async () => {
    // A proxy that strips the header must not make the count read as zero.
    server.use(http.get('/api/students', () => HttpResponse.json([student()])))
    renderWithProviders(<Students />)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
  })
})

describe('filtering', () => {
  it('sends the search term to the server', async () => {
    const seen = listReturns([student()])
    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')

    await userEvent.type(screen.getByPlaceholderText(/search by name/i), 'asha')

    await waitFor(() => expect(seen[seen.length - 1]?.get('search')).toBe('asha'))
  })

  it('sorts on the server, not in the browser', async () => {
    // The page holds one page of a cohort that can run to thousands, so sorting
    // what happens to be loaded would sort the wrong set.
    const seen = listReturns([student()])
    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')

    await userEvent.click(screen.getByRole('button', { name: /branch/i }))

    await waitFor(() => expect(seen[seen.length - 1]?.get('sort')).toBe('branch'))
  })

  it('defaults to roll number order', async () => {
    // The order a college keeps its own lists in.
    const seen = listReturns([student()])
    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')
    expect(seen[0].get('sort')).toBe('roll_number')
    expect(seen[0].get('order')).toBe('asc')
  })
})

describe('out-of-order responses', () => {
  it('ignores a slow earlier response that lands after a newer one', async () => {
    // The guard that matters. Type fast enough and the request for "a" can
    // return after the one for "ab"; without the request id the list would
    // settle on results for a filter the user has already moved past.
    let releaseStale: () => void = () => {}
    server.use(
      http.get('/api/students', async ({ request }) => {
        const term = new URL(request.url).searchParams.get('search') ?? ''
        const rows = (name: string) =>
          HttpResponse.json([student({ full_name: name })], {
            headers: { 'X-Total-Count': '1' },
          })
        if (term === 'a') {
          // Held open until the newer request has already rendered.
          await new Promise<void>((resolve) => {
            releaseStale = resolve
          })
          return rows('Stale Result')
        }
        return rows(term === 'ab' ? 'Fresh Result' : 'Asha Rao')
      }),
    )

    renderWithProviders(<Students />)
    await screen.findByText('Asha Rao')

    await userEvent.type(screen.getByPlaceholderText(/search by name/i), 'ab')
    await screen.findByText('Fresh Result')

    releaseStale()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
    expect(screen.getByText('Fresh Result')).toBeInTheDocument()
  })
})
