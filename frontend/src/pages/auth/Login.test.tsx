/**
 * pages/auth/Login.tsx - the front door, which is three doors.
 *
 * The same page serves a college subdomain (staff or student), the platform
 * console, and a host that matches no college at all. Which one it is comes
 * entirely from the URL, so most of what is worth testing is "given this host,
 * what does the page offer".
 *
 * The other half is the error copy. It is deliberately vague about which
 * credential was wrong, because naming the field would tell an attacker which
 * accounts exist - the same reasoning behind the API's uniform 401.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Login from '@/pages/auth/Login'
import { useAuthStore } from '@/store/authStore'

import { HttpResponse, http, server } from '../../test/server'
import {
  fakeUser,
  renderWithProviders,
  screen,
  setHost,
  signOut,
  userEvent,
  waitFor,
} from '../../test/utils'

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

type Branding = { name: string; code: string; logo_url: string | null }

/** The branding lookup fires on every college host; stub it by default. */
function brandingReturns(body: Branding | { detail: string }, status = 200) {
  server.use(http.get('/api/colleges/current', () => HttpResponse.json(body, { status })))
}

function loginReturns(user = fakeUser(), status = 200) {
  server.use(
    http.post('/api/auth/login', () =>
      status === 200
        ? HttpResponse.json({ access_token: 'tok', token_type: 'bearer', user })
        : HttpResponse.json({ detail: 'Invalid credentials' }, { status }),
    ),
  )
}

beforeEach(() => {
  navigate.mockClear()
  signOut()
  setHost('rit.myplacements.in')
  brandingReturns({ name: 'RIT', code: 'rit', logo_url: null })
})

// --- branding ---------------------------------------------------------------

describe('branding', () => {
  it('shows the college name once the lookup resolves', async () => {
    // It renders before anyone signs in, so it has to come from the subdomain.
    renderWithProviders(<Login />)
    expect(await screen.findByRole('heading', { name: 'RIT' })).toBeInTheDocument()
  })

  it('warns when the subdomain matches no college', async () => {
    // Far more useful than a blank form: the address itself is the mistake.
    brandingReturns({ detail: 'Unknown college' }, 404)
    renderWithProviders(<Login />)
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument()
  })

  it('does not look up a college on the platform console', async () => {
    // admin.* is not a tenant; asking would 404 and show a false warning.
    setHost('admin.myplacements.in')
    server.use(
      http.get('/api/colleges/current', () => {
        throw new Error('the console must not ask for college branding')
      }),
    )
    renderWithProviders(<Login />)
    expect(await screen.findByText('Platform Console')).toBeInTheDocument()
  })

  it('does not look up a college on the apex', async () => {
    setHost('myplacements.in')
    server.use(
      http.get('/api/colleges/current', () => {
        throw new Error('the apex carries no tenant')
      }),
    )
    renderWithProviders(<Login />)
    expect(await screen.findByRole('heading', { name: 'MyPlacement.AI' })).toBeInTheDocument()
  })
})

// --- which doors are offered ------------------------------------------------

describe('the staff / student toggle', () => {
  it('is offered on a college portal', async () => {
    renderWithProviders(<Login />)
    expect(await screen.findByRole('button', { name: 'student' })).toBeInTheDocument()
  })

  it('is not offered on the console', async () => {
    // Students have no business on the platform console.
    setHost('admin.myplacements.in')
    renderWithProviders(<Login />)
    await screen.findByText('Platform Console')
    expect(screen.queryByRole('button', { name: 'student' })).not.toBeInTheDocument()
  })

  it('is not offered on the apex', async () => {
    setHost('myplacements.in')
    renderWithProviders(<Login />)
    await screen.findByRole('heading', { name: 'MyPlacement.AI' })
    expect(screen.queryByRole('button', { name: 'student' })).not.toBeInTheDocument()
  })

  it('swaps the email field for a roll number', async () => {
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: 'student' }))

    expect(screen.getByLabelText(/roll number/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })
})

// --- validation -------------------------------------------------------------

describe('validation', () => {
  it('asks for the email before calling the API', async () => {
    // No handler is registered for login, so a request would fail the test.
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/enter the email address/i)).toBeInTheDocument()
  })

  it('rejects an address that is not one', async () => {
    renderWithProviders(<Login />)
    await userEvent.type(await screen.findByLabelText(/email/i), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'pw')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/doesn’t look like an email/i)).toBeInTheDocument()
  })

  it('asks for the roll number in student mode', async () => {
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: 'student' }))
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/enter your roll number/i)).toBeInTheDocument()
  })

  it('clears the message as soon as the field is corrected', async () => {
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }))
    await screen.findByText(/enter the email address/i)

    await userEvent.type(screen.getByLabelText(/email/i), 'h')

    expect(screen.queryByText(/enter the email address/i)).not.toBeInTheDocument()
  })
})

// --- signing in -------------------------------------------------------------

describe('signing in', () => {
  async function fillStaff() {
    await userEvent.type(await screen.findByLabelText(/email/i), 'head@rit.example.com')
    await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'a-password')
  }

  it('sends staff to the dashboard', async () => {
    loginReturns(fakeUser({ role: 'principal' }))
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'))
    expect(useAuthStore.getState().token).toBe('tok')
  })

  it('sends a console sign-in to the college list', async () => {
    // The console manages colleges; it has no dashboard of its own.
    setHost('admin.myplacements.in')
    loginReturns(fakeUser({ role: 'super_admin' }))
    renderWithProviders(<Login />)
    await screen.findByText('Platform Console')
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/colleges'))
  })

  it('sends a student to their portal', async () => {
    server.use(
      http.post('/api/auth/student/login', () =>
        HttpResponse.json({ access_token: 'tok', token_type: 'bearer', user: fakeUser({ role: 'student' }) }),
      ),
    )
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: 'student' }))
    await userEvent.type(screen.getByLabelText(/roll number/i), '1RV001')
    await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'a-password')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/portal'))
  })

  it('diverts to the password reset when one is owed', async () => {
    // An invite-redeemed account. Browsing first would leave the shared
    // temporary password live.
    loginReturns(fakeUser({ must_reset_password: true }))
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/reset-password'))
  })

  it('reports a failure without naming which credential was wrong', async () => {
    // The same reasoning as the API's uniform 401: saying "no such account"
    // would confirm which addresses exist.
    loginReturns(fakeUser(), 401)
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/email and password don’t match/i)
    expect(alert).not.toHaveTextContent(/no account|not found|unknown/i)
  })

  it('phrases the failure for whichever door was used', async () => {
    server.use(
      http.post('/api/auth/student/login', () =>
        HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }),
      ),
    )
    renderWithProviders(<Login />)
    await userEvent.click(await screen.findByRole('button', { name: 'student' }))
    await userEvent.type(screen.getByLabelText(/roll number/i), '1RV001')
    await userEvent.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/roll number and password/i)
  })

  it('leaves no session behind after a failure', async () => {
    loginReturns(fakeUser(), 401)
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await screen.findByRole('alert')

    expect(useAuthStore.getState().token).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('re-enables the button after a failure so it can be retried', async () => {
    loginReturns(fakeUser(), 401)
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
  })

  it('clears the previous error when the toggle is switched', async () => {
    loginReturns(fakeUser(), 401)
    renderWithProviders(<Login />)
    await fillStaff()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: 'student' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// --- the password field -----------------------------------------------------

describe('the password field', () => {
  it('is masked to begin with', async () => {
    renderWithProviders(<Login />)
    expect(await screen.findByLabelText(/password/i, { selector: 'input' })).toHaveAttribute('type', 'password')
  })

  it('can be revealed and hidden again', async () => {
    // Typed on a shared lab machine as often as a private one, so it is a
    // deliberate toggle rather than a default.
    renderWithProviders(<Login />)
    const field = await screen.findByLabelText(/password/i, { selector: 'input' })

    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(field).toHaveAttribute('type', 'text')

    await userEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(field).toHaveAttribute('type', 'password')
  })

  it('tells assistive tech which state it is in', async () => {
    renderWithProviders(<Login />)
    await screen.findByLabelText(/password/i, { selector: 'input' })
    expect(screen.getByRole('button', { name: /show password/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
