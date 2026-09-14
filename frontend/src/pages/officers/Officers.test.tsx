/**
 * pages/officers/Officers.tsx - who owns which companies.
 *
 * Allocation is the key to the whole officer access model: an officer reaches
 * exactly the companies allocated to them, so removing one closes a door. That
 * makes removal destructive in a way a table row rarely is - the API enforces
 * the access, but this page is where somebody clicks - and it is why removal
 * asks first and says what will be lost.
 *
 * The role gate here is the UI's half of the same rule the API enforces: an
 * officer may look at their own card, but the allocate and remove controls are
 * leadership's. The server refuses them regardless; the point of the gate is not
 * to offer a button that 403s.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import Officers from '@/pages/officers/Officers'

import { HttpResponse, http, server } from '../../test/server'
import {
  fakeUser,
  renderWithProviders,
  screen,
  setHost,
  signIn,
  userEvent,
  waitFor,
} from '../../test/utils'

function officer(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 11,
    officer_name: 'Meera Iyer',
    email: 'meera@rit.example',
    region: 'South',
    sector_expertise: 'IT',
    target_companies: 20,
    target_offers: 40,
    assignment_count: 3,
    active_count: 2,
    ...overrides,
  }
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 51,
    company_id: 7,
    company_name: 'Acme Corp',
    status: 'active',
    priority: 'normal',
    notes: null,
    assigned_at: '2026-09-01T10:00:00',
    ...overrides,
  }
}

function stubOfficers(rows: unknown[] = [officer()]) {
  server.use(
    http.get('/api/officers', () => HttpResponse.json(rows)),
    http.get('/api/officers/assignable-users', () => HttpResponse.json([])),
  )
}

function stubAssignments(rows: unknown[] = [assignment()]) {
  server.use(http.get('/api/officers/:id/assignments', () => HttpResponse.json(rows)))
}

/** Open the allocation panel for the first officer card. */
async function openAllocations() {
  await userEvent.click(await screen.findByRole('button', { name: /view allocations for/i }))
  return screen.findByText(/^Allocation —/)
}

beforeEach(() => {
  setHost('rit.myplacements.in')
  signIn(fakeUser({ role: 'pro_chancellor' }))
  stubOfficers()
  stubAssignments()
})

describe('the officer list', () => {
  it('lists an officer with what they are carrying', async () => {
    renderWithProviders(<Officers />)
    expect(await screen.findByText('Meera Iyer')).toBeInTheDocument()
    expect(screen.getByText('meera@rit.example')).toBeInTheDocument()
  })

  it('names an officer whose staff record has no name', async () => {
    // The officer card and the user row are separate, and an import can leave
    // one without the other. "Officer #4" beats a blank card.
    stubOfficers([officer({ id: 4, officer_name: null })])
    renderWithProviders(<Officers />)
    expect(await screen.findByText('Officer #4')).toBeInTheDocument()
  })

  it('explains an empty team rather than showing an empty grid', async () => {
    // And says what to do about it, since the fix is on a different page.
    stubOfficers([])
    renderWithProviders(<Officers />)
    expect(await screen.findByText(/no placement officers yet/i)).toBeInTheDocument()
    expect(screen.getByText(/placement officer.*role/i)).toBeInTheDocument()
  })

  it('counts the team in words that agree with the number', async () => {
    stubOfficers([officer()])
    renderWithProviders(<Officers />)
    expect(await screen.findByText('1 placement officer')).toBeInTheDocument()
  })

  it('pluralises for a real team', async () => {
    stubOfficers([officer(), officer({ id: 2, officer_name: 'Ravi K' })])
    renderWithProviders(<Officers />)
    expect(await screen.findByText('2 placement officers')).toBeInTheDocument()
  })

  it('opens a card from the keyboard as well as the mouse', async () => {
    // The cards are divs with a button role, so the keyboard handling is
    // hand-written and easy to lose.
    renderWithProviders(<Officers />)
    const card = await screen.findByRole('button', { name: /view allocations for Meera Iyer/i })
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByText(/^Allocation —/)).toBeInTheDocument()
  })
})

describe('allocations', () => {
  it('lists what an officer holds', async () => {
    renderWithProviders(<Officers />)
    await openAllocations()
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('allocates a company and reports it', async () => {
    let body: unknown
    server.use(
      http.post('/api/officers/:id/assignments', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({}, { status: 201 })
      }),
      http.get('/api/companies', () =>
        HttpResponse.json([{ id: 9, name: 'Globex' }]),
      ),
    )
    renderWithProviders(<Officers />)
    await openAllocations()

    await userEvent.type(screen.getByPlaceholderText(/search unassigned companies/i), 'glo')
    await userEvent.click(await screen.findByText('Globex'))
    await userEvent.click(screen.getByRole('button', { name: /assign/i }))

    await waitFor(() => expect(body).toMatchObject({ company_id: 9 }))
    expect(await screen.findByText(/company allocated/i)).toBeInTheDocument()
  })

  it('surfaces the reason the server refused an allocation', async () => {
    // A company can already be owned - single-owner is a rule the API enforces,
    // and a generic "try again" would send the user round in circles.
    server.use(
      http.post('/api/officers/:id/assignments', () =>
        HttpResponse.json({ detail: 'Already allocated to Ravi K' }, { status: 400 }),
      ),
      http.get('/api/companies', () => HttpResponse.json([{ id: 9, name: 'Globex' }])),
    )
    renderWithProviders(<Officers />)
    await openAllocations()

    await userEvent.type(screen.getByPlaceholderText(/search unassigned companies/i), 'glo')
    await userEvent.click(await screen.findByText('Globex'))
    await userEvent.click(screen.getByRole('button', { name: /assign/i }))

    expect(await screen.findByText(/already allocated to ravi k/i)).toBeInTheDocument()
  })

  it('will not submit with no company chosen', async () => {
    server.use(
      http.post('/api/officers/:id/assignments', () => {
        throw new Error('nothing should have been posted')
      }),
    )
    renderWithProviders(<Officers />)
    await openAllocations()
    expect(screen.getByRole('button', { name: /assign/i })).toBeDisabled()
  })
})

describe('removing an allocation', () => {
  it('asks first, and says what will be lost', async () => {
    // Removal closes the officer's access to that company and discards the
    // notes on it, which is not obvious from a row with an X on it.
    renderWithProviders(<Officers />)
    await openAllocations()
    await screen.findByText('Acme Corp')

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))

    expect(await screen.findByText(/remove this allocation\?/i)).toBeInTheDocument()
    expect(screen.getByText(/notes on this allocation will be lost/i)).toBeInTheDocument()
  })

  it('does nothing when the confirmation is declined', async () => {
    server.use(
      http.delete('/api/officers/:id/assignments/:aid', () => {
        throw new Error('nothing should have been deleted')
      }),
    )
    renderWithProviders(<Officers />)
    await openAllocations()
    await screen.findByText('Acme Corp')

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    await screen.findByText(/remove this allocation\?/i)
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(screen.queryByText(/remove this allocation\?/i)).not.toBeInTheDocument(),
    )
  })

  it('removes it once confirmed', async () => {
    let deleted = false
    server.use(
      http.delete('/api/officers/:id/assignments/:aid', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithProviders(<Officers />)
    await openAllocations()
    await screen.findByText('Acme Corp')

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    await userEvent.click(await screen.findByRole('button', { name: /remove allocation/i }))

    await waitFor(() => expect(deleted).toBe(true))
    expect(await screen.findByText(/allocation removed/i)).toBeInTheDocument()
  })

  it('surfaces the reason a removal failed', async () => {
    server.use(
      http.delete('/api/officers/:id/assignments/:aid', () =>
        HttpResponse.json({ detail: 'This company has a drive next week' }, { status: 400 }),
      ),
    )
    renderWithProviders(<Officers />)
    await openAllocations()
    await screen.findByText('Acme Corp')

    await userEvent.click(screen.getByRole('button', { name: /remove/i }))
    await userEvent.click(await screen.findByRole('button', { name: /remove allocation/i }))

    expect(await screen.findByText(/drive next week/i)).toBeInTheDocument()
  })
})

describe('the role gate', () => {
  it('offers leadership the management controls', async () => {
    renderWithProviders(<Officers />)
    expect(await screen.findByRole('button', { name: /add officer/i })).toBeInTheDocument()
  })

  it('does not offer an officer a button the API would refuse', async () => {
    // The API enforces this regardless; the gate exists so nobody is shown a
    // control that 403s when they press it.
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Officers />)
    await screen.findByText('Meera Iyer')
    expect(screen.queryByRole('button', { name: /add officer/i })).not.toBeInTheDocument()
  })

  it('does not offer an officer the allocate form', async () => {
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Officers />)
    await openAllocations()
    expect(
      screen.queryByPlaceholderText(/search unassigned companies/i),
    ).not.toBeInTheDocument()
  })

  it('still lets an officer read their own allocations', async () => {
    // Seeing their own book is the whole point of the page for them.
    signIn(fakeUser({ role: 'placement_officer' }))
    renderWithProviders(<Officers />)
    await openAllocations()
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })
})
