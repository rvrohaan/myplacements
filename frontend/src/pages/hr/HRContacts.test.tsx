/**
 * pages/hr/HRContacts.tsx - the directory of the people who decide whether a
 * company visits.
 *
 * The design decision this page exists to express is that the *two* readings of
 * a relationship stay side by side and are never averaged. `relationship_strength`
 * is an officer's own judgement, typed by hand; `engagement` is what the logged
 * evidence says. A contact an officer rates 5 who has not replied in four months
 * is exactly the disagreement a placement head wants to see, and one merged
 * number would hide it.
 *
 * The other thing worth pinning is that a contact with no history reads as
 * "No history", not as a zero. Zero would rank somebody added this morning below
 * somebody who has ignored the college for a year.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import HRContacts from '@/pages/hr/HRContacts'

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

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Priya Rao',
    designation: 'Talent Acquisition',
    email: 'priya@acme.example',
    mobile: null,
    linkedin: null,
    company_id: 7,
    company_name: 'Acme Corp',
    region: 'South',
    relationship_strength: 3,
    engagement: null,
    last_contacted_at: null,
    last_contacted_by: null,
    next_action: null,
    next_followup_date: null,
    ...overrides,
  }
}

function engagement(overrides: Record<string, unknown> = {}) {
  return {
    score: 82,
    band: 'responsive',
    stale: false,
    total_logged: 6,
    replied: 5,
    awaited: 0,
    overdue_followups: 0,
    ...overrides,
  }
}

const SUMMARY = {
  total: 12,
  overdue: 3,
  due_this_week: 2,
  no_followup: 4,
  never_contacted: 1,
}

/** Stub the directory, capturing the query each request carried. */
function directoryReturns(rows: unknown[], { total = rows.length } = {}) {
  const seen: URLSearchParams[] = []
  server.use(
    http.get('/api/hr-contacts', ({ request }) => {
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
    http.get('/api/hr-contacts/summary', () => HttpResponse.json(SUMMARY)),
    http.get('/api/companies', () => HttpResponse.json([])),
  )
})

describe('the directory', () => {
  it('lists a contact with their company', async () => {
    directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('links the company through to its page', async () => {
    directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    const link = await screen.findByRole('link', { name: 'Acme Corp' })
    expect(link).toHaveAttribute('href', '/companies/7')
  })

  it('offers the ways of reaching somebody that are actually on file', async () => {
    directoryReturns([contact({ email: 'priya@acme.example', mobile: '+91 99999 00000' })])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')
    expect(screen.getByTitle('priya@acme.example')).toHaveAttribute(
      'href',
      'mailto:priya@acme.example',
    )
    expect(screen.getByTitle('+91 99999 00000')).toHaveAttribute('href', 'tel:+91 99999 00000')
  })

  it('shows an empty state rather than an empty table', async () => {
    directoryReturns([])
    renderWithProviders(<HRContacts />)
    expect(await screen.findByText(/no contacts match these filters/i)).toBeInTheDocument()
  })

  it('says so when the directory cannot be loaded', async () => {
    server.use(http.get('/api/hr-contacts', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<HRContacts />)
    expect(await screen.findByText(/could not load the hr directory/i)).toBeInTheDocument()
  })
})

describe('the two readings of a relationship', () => {
  it('shows the officer judgement and the computed score side by side', async () => {
    // The heart of the design: never averaged into one number.
    directoryReturns([contact({ relationship_strength: 5, engagement: engagement({ score: 20, band: 'cold' }) })])
    renderWithProviders(<HRContacts />)

    const row = (await screen.findByText('Priya Rao')).closest('tr')!
    expect(within(row).getByText('20')).toBeInTheDocument()
    expect(within(row).getByLabelText(/relationship strength/i)).toBeInTheDocument()
  })

  it('lets the two disagree without resolving it', async () => {
    // An officer's 5 beside a cold score is the disagreement a head wants to
    // see, so neither is allowed to overwrite the other.
    directoryReturns([contact({ relationship_strength: 5, engagement: engagement({ score: 15, band: 'cold' }) })])
    renderWithProviders(<HRContacts />)

    const row = (await screen.findByText('Priya Rao')).closest('tr')!
    expect(within(row).getByText('cold')).toBeInTheDocument()
    expect(within(row).getByLabelText(/relationship strength/i).getAttribute('aria-label')).toMatch(
      /strength/i,
    )
  })

  it('reads a contact with no history as "No history", not as zero', async () => {
    // Zero would rank somebody added this morning below somebody who has
    // ignored the college for a year.
    directoryReturns([contact({ engagement: null })])
    renderWithProviders(<HRContacts />)

    const row = (await screen.findByText('Priya Rao')).closest('tr')!
    expect(within(row).getByText('No history')).toBeInTheDocument()
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
  })

  it('explains the score rather than asserting it', async () => {
    // The number is a prediction; a head deciding whether to trust it needs the
    // evidence, which travels in the title.
    directoryReturns([contact({ engagement: engagement({ total_logged: 6, replied: 5 }) })])
    renderWithProviders(<HRContacts />)

    await screen.findByText('Priya Rao')
    expect(screen.getByTitle(/6 logged · 5 replied/)).toBeInTheDocument()
  })

  it('flags a relationship nobody has touched in six months', async () => {
    directoryReturns([contact({ engagement: engagement({ stale: true, band: 'slow', score: 40 }) })])
    renderWithProviders(<HRContacts />)
    expect(await screen.findByLabelText('Stale')).toBeInTheDocument()
  })

  it('says "Never" rather than leaving the last-contacted column blank', async () => {
    directoryReturns([contact({ last_contacted_at: null })])
    renderWithProviders(<HRContacts />)
    const row = (await screen.findByText('Priya Rao')).closest('tr')!
    expect(within(row).getByText('Never')).toBeInTheDocument()
  })
})

describe('the summary strip', () => {
  it('shows what needs attention', async () => {
    directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')
    expect(screen.getByText('3')).toBeInTheDocument() // overdue
    expect(screen.getByText('12')).toBeInTheDocument() // total
  })

  it('is a nicety, so its failure does not take the table down', async () => {
    server.use(
      http.get('/api/hr-contacts/summary', () => HttpResponse.json({}, { status: 500 })),
    )
    directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    expect(await screen.findByText('Priya Rao')).toBeInTheDocument()
  })
})

describe('filtering and sorting', () => {
  it('filters by how overdue a follow-up is', async () => {
    const seen = directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')

    await userEvent.click(screen.getByRole('button', { name: 'Overdue' }))

    await waitFor(() => expect(seen[seen.length - 1].get('followup')).toBe('overdue'))
  })

  it('sorts by follow-up date soonest first', async () => {
    // The useful default: the directory is a worklist before it is a record.
    const seen = directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')

    expect(seen[0].get('sort')).toBe('followup')
    expect(seen[0].get('order')).toBe('asc')
  })

  it('sorts a score column strongest first instead', async () => {
    // Ascending would put the coldest contacts at the top of a column whose
    // whole point is finding the warm ones.
    const seen = directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')

    await userEvent.selectOptions(screen.getByDisplayValue(/follow-up date/i), 'engagement')

    await waitFor(() => {
      const last = seen[seen.length - 1]
      expect(last.get('sort')).toBe('engagement')
      expect(last.get('order')).toBe('desc')
    })
  })

  it('searches on the server, debounced', async () => {
    // A directory runs to hundreds of contacts across a college, so the filter
    // has to reach the database rather than the page.
    const seen = directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')

    await userEvent.type(screen.getByPlaceholderText(/search name, email/i), 'priya')

    await waitFor(() => expect(seen[seen.length - 1].get('search')).toBe('priya'), {
      timeout: 2000,
    })
  })

  it('does not fire a request per keystroke', async () => {
    const seen = directoryReturns([contact()])
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')
    const before = seen.length

    await userEvent.type(screen.getByPlaceholderText(/search name, email/i), 'priya')
    await waitFor(() => expect(seen[seen.length - 1].get('search')).toBe('priya'), {
      timeout: 2000,
    })

    // Five characters typed; anything close to five extra requests means the
    // debounce is not doing its job.
    expect(seen.length - before).toBeLessThan(5)
  })

  it('asks for a bounded page', async () => {
    const seen = directoryReturns([contact()], { total: 240 })
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')
    expect(Number(seen[0].get('limit'))).toBeGreaterThan(0)
    expect(seen[0].get('skip')).toBe('0')
  })

  it('takes the unpaged total from the header', async () => {
    directoryReturns([contact()], { total: 240 })
    renderWithProviders(<HRContacts />)
    await screen.findByText('Priya Rao')
    expect(screen.getByText(/240/)).toBeInTheDocument()
  })
})
