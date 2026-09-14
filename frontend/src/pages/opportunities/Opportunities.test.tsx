/**
 * pages/opportunities/Opportunities.tsx - the page that spends money.
 *
 * "Scan now" runs a live web search billed to the platform, and the list it
 * fills is shared by every tenant. Almost everything worth testing here follows
 * from that.
 *
 * The subtlest behaviour is the one the component comments call out: with the
 * daily scan stopped, an empty list means "nobody has run one", not "the market
 * was quiet". Those are opposite conclusions and the page has to distinguish
 * them, or a placement head decides there is no hiring happening.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import Opportunities from '@/pages/opportunities/Opportunities'

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

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: 'new',
    posting: {
      id: 100,
      company_name: 'Globex',
      role_title: 'Software Intern',
      lead_type: 'internship',
      location: 'Bengaluru',
      work_mode: 'onsite',
      eligibility: 'B.Tech 2026',
      compensation: '₹40,000/month',
      source_name: 'careers.globex.example',
      source_url: 'https://careers.globex.example/1',
      posted_at: '2026-09-13',
      posted_label: null,
      verified: true,
    },
    company_name: 'Globex',
    role_title: 'Software Intern',
    ...overrides,
  }
}

const SETTINGS = { enabled: true, focus: null, schedule_enabled: true }

function stubSummary({ lastScan = null as unknown, scheduled = true } = {}) {
  server.use(
    http.get('/api/job-leads/summary', () =>
      HttpResponse.json({ last_scan: lastScan, schedule_enabled: scheduled }),
    ),
  )
}

function stubLeads(rows: unknown[] = [lead()]) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/job-leads', ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json(rows)
    }),
  )
  return seen
}

beforeEach(() => {
  setHost('rit.myplacements.in')
  signIn(fakeUser({ role: 'pro_chancellor' }))
  stubLeads()
  stubSummary()
  server.use(http.get('/api/job-leads/settings', () => HttpResponse.json(SETTINGS)))
})

describe('the list', () => {
  it('shows an opening worth chasing', async () => {
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText('Globex')).toBeInTheDocument()
    expect(screen.getByText(/software intern/i)).toBeInTheDocument()
  })

  it('asks the server for the tab that is open', async () => {
    const seen = stubLeads()
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')
    expect(seen[0].get('status')).toBe('new')
  })

  it('survives the list failing without taking the page down', async () => {
    // The header still tells a reader when the last scan ran, which is the more
    // useful half when the list is broken.
    server.use(http.get('/api/job-leads', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText(/opportunity radar/i)).toBeInTheDocument()
  })
})

describe('telling "nothing posted" from "nothing ran"', () => {
  it('says the daily scan is stopped', async () => {
    // Ships stopped, because an unattended scan bills the platform every
    // morning whether or not anybody reads the result.
    stubLeads([])
    stubSummary({ scheduled: false })
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText(/daily scan stopped/i)).toBeInTheDocument()
  })

  it('does not say so when the schedule is running', async () => {
    stubLeads([])
    stubSummary({ scheduled: true })
    renderWithProviders(<Opportunities />)
    await screen.findByText(/opportunity radar/i)
    await waitFor(() =>
      expect(screen.queryByText(/daily scan stopped/i)).not.toBeInTheDocument(),
    )
  })

  it('reports what the last scan found', async () => {
    // Without this an empty list is unreadable: it could mean the search ran
    // and found nothing, or that nothing has run since last term.
    stubSummary({
      lastScan: {
        id: 5,
        scan_date: '2026-09-14',
        started_at: '2026-09-14T04:00:00',
        finished_at: '2026-09-14T04:03:00',
        status: 'ok',
        found: 12,
        new_count: 3,
      },
    })
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')
    expect(await screen.findByText(/12|3 new/)).toBeInTheDocument()
  })

  it('still renders when the summary is unavailable', async () => {
    server.use(http.get('/api/job-leads/summary', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText('Globex')).toBeInTheDocument()
  })
})

describe('running a scan', () => {
  it('says what it is doing, because a web search is slow', async () => {
    // Minutes, not milliseconds. A bare spinner reads as a hang and gets the
    // button pressed again - which is a second bill.
    server.use(
      http.post('/api/job-leads/scan', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json({ found: 0, new_count: 0, scan: null })
      }),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/searching career pages/i)
  })

  it('cannot be started twice while one is running', async () => {
    // The clearest way to double a bill.
    server.use(
      http.post('/api/job-leads/scan', async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return HttpResponse.json({ found: 0, new_count: 0, scan: null })
      }),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByRole('button', { name: /searching the web/i })).toBeDisabled()
  })

  it('reports what a scan found', async () => {
    server.use(
      http.post('/api/job-leads/scan', () =>
        HttpResponse.json({ found: 12, new_count: 3, scan: null }),
      ),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByText(/3 new openings found/i)).toBeInTheDocument()
  })

  it('distinguishes "nothing new" from "nothing at all"', async () => {
    // Found twelve, all already on the list, is a different fact from finding
    // nothing - and only one of them means the market was quiet.
    server.use(
      http.post('/api/job-leads/scan', () =>
        HttpResponse.json({ found: 12, new_count: 0, scan: null }),
      ),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByText(/already on your list/i)).toBeInTheDocument()
  })

  it('says so when the search itself found nothing', async () => {
    server.use(
      http.post('/api/job-leads/scan', () =>
        HttpResponse.json({ found: 0, new_count: 0, scan: null }),
      ),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByText(/no openings matched/i)).toBeInTheDocument()
  })

  it('surfaces the reason a scan could not run', async () => {
    // "No API key" and "already scanned today" are both actionable, and a
    // generic failure hides which.
    server.use(
      http.post('/api/job-leads/scan', () =>
        HttpResponse.json({ detail: 'A scan already ran today' }, { status: 409 }),
      ),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))

    expect(await screen.findByText(/a scan already ran today/i)).toBeInTheDocument()
  })

  it('re-enables the button after a failure', async () => {
    server.use(
      http.post('/api/job-leads/scan', () => HttpResponse.json({ detail: 'nope' }, { status: 500 })),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await screen.findByText('nope')

    expect(screen.getByRole('button', { name: /scan now/i })).toBeEnabled()
  })
})

describe('dismissing an opening', () => {
  it('asks first, and says a later scan will not bring it back', async () => {
    // Irreversible in the sense that matters: the dedupe key means the next
    // scan sees it as already known and will not re-surface it.
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByText(/dismiss this opening\?/i)).toBeInTheDocument()
    expect(screen.getByText(/a later scan will not bring it back/i)).toBeInTheDocument()
  })

  it('does nothing when the confirmation is declined', async () => {
    server.use(
      http.post('/api/job-leads/:id/dismiss', () => {
        throw new Error('nothing should have been dismissed')
      }),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByText(/dismiss this opening\?/i)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(screen.queryByText(/dismiss this opening\?/i)).not.toBeInTheDocument(),
    )
  })

  it('takes it out of the queue once confirmed', async () => {
    server.use(
      http.post('/api/job-leads/:id/dismiss', () =>
        HttpResponse.json(lead({ status: 'dismissed' })),
      ),
    )
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    // Two "Dismiss" buttons exist once the dialog is open - the row's and the
    // dialog's. The dialog is the one being confirmed.
    // The confirm uses alertdialog, not dialog - it is asking, not showing.
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByText(/^dismissed\.$/i)).toBeInTheDocument()
  })
})

describe('the role gate', () => {
  it('lets leadership scan and configure', async () => {
    renderWithProviders(<Opportunities />)
    expect(await screen.findByRole('button', { name: /scan now/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
  })

  it('does not offer an officer the scan button', async () => {
    // One national scan a day is shared by every tenant and bills the platform,
    // so starting one is not an officer's decision to make.
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Opportunities />)
    await screen.findByText('Globex')
    expect(screen.queryByRole('button', { name: /scan now/i })).not.toBeInTheDocument()
  })

  it('still lets an officer read the radar', async () => {
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText('Globex')).toBeInTheDocument()
  })

  it('tells an officer who does decide', async () => {
    // A page with no buttons and no explanation reads as broken.
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Opportunities />)
    expect(await screen.findByText(/leadership decides/i)).toBeInTheDocument()
  })
})
