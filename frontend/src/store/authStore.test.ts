/**
 * store/authStore.ts and lib/api.ts - the session, and what carries it.
 *
 * The token lives in two places on purpose: zustand's persisted store drives
 * what renders, and `localStorage` is what the axios interceptor reads on every
 * request. They have to be written together or the app renders as signed in
 * while every call goes out unauthenticated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

import { HttpResponse, http, server } from '../test/server'
import { fakeUser, setHost } from '../test/utils'

function tokenResponse(overrides = {}) {
  return HttpResponse.json({
    access_token: 'a-fresh-token',
    token_type: 'bearer',
    user: { ...fakeUser(), ...overrides },
  })
}

beforeEach(() => {
  useAuthStore.setState({ user: null, token: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('login', () => {
  it('stores the token in the store and in localStorage', () => {
    // Both, or the UI and the interceptor disagree about who is signed in.
    server.use(http.post('/api/auth/login', () => tokenResponse()))
    return useAuthStore
      .getState()
      .login('head@rit.example.com', 'pw')
      .then(() => {
        expect(useAuthStore.getState().token).toBe('a-fresh-token')
        expect(localStorage.getItem('token')).toBe('a-fresh-token')
      })
  })

  it('returns the user so the caller can route on their role', async () => {
    server.use(http.post('/api/auth/login', () => tokenResponse({ role: 'student' })))
    const user = await useAuthStore.getState().login('x@y.com', 'pw')
    expect(user.role).toBe('student')
  })

  it('sends the credentials as the API expects them', async () => {
    let body: unknown
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        body = await request.json()
        return tokenResponse()
      }),
    )
    await useAuthStore.getState().login('head@rit.example.com', 'secret')
    expect(body).toEqual({ email: 'head@rit.example.com', password: 'secret' })
  })

  it('leaves no session behind when the credentials are wrong', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }),
      ),
    )
    await expect(useAuthStore.getState().login('x@y.com', 'wrong')).rejects.toBeDefined()
    expect(useAuthStore.getState().token).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })
})

describe('studentLogin', () => {
  it('posts the roll number to the student endpoint', async () => {
    let body: unknown
    server.use(
      http.post('/api/auth/student/login', async ({ request }) => {
        body = await request.json()
        return tokenResponse({ role: 'student' })
      }),
    )
    await useAuthStore.getState().studentLogin('1RV001', 'pw')
    expect(body).toEqual({ roll_number: '1RV001', password: 'pw' })
  })

  it('lands a session exactly like staff login does', async () => {
    server.use(http.post('/api/auth/student/login', () => tokenResponse({ role: 'student' })))
    await useAuthStore.getState().studentLogin('1RV001', 'pw')
    expect(localStorage.getItem('token')).toBe('a-fresh-token')
  })
})

describe('acceptInvite', () => {
  it('signs you in, so the new password is not typed twice', async () => {
    server.use(http.post('/api/auth/invite/tok/accept', () => tokenResponse()))
    await useAuthStore.getState().acceptInvite('tok', 'a-new-password')
    expect(useAuthStore.getState().token).toBe('a-fresh-token')
  })

  it('escapes a token that would otherwise break the URL', async () => {
    // The token is URL-safe base64, but a hand-pasted link can carry anything,
    // and an unescaped slash would silently address a different route.
    let path = ''
    server.use(
      http.post('/api/auth/invite/*', ({ request }) => {
        path = new URL(request.url).pathname
        return tokenResponse()
      }),
    )
    await useAuthStore.getState().acceptInvite('a/b c', 'pw')
    expect(path).toContain('a%2Fb%20c')
  })
})

describe('resetPassword', () => {
  it('updates the stored user without disturbing the token', async () => {
    useAuthStore.setState({ user: fakeUser({ must_reset_password: true }), token: 'keep-me' })
    localStorage.setItem('token', 'keep-me')
    server.use(
      http.post('/api/auth/reset-password', () =>
        HttpResponse.json(fakeUser({ must_reset_password: false })),
      ),
    )

    await useAuthStore.getState().resetPassword('a-new-password')

    expect(useAuthStore.getState().user?.must_reset_password).toBe(false)
    expect(useAuthStore.getState().token).toBe('keep-me')
  })
})

describe('logout', () => {
  it('clears both places the session is held', () => {
    useAuthStore.setState({ user: fakeUser(), token: 'a-token' })
    localStorage.setItem('token', 'a-token')

    useAuthStore.getState().logout()

    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })
})

describe('derived state', () => {
  it('reports a session only when a token is held', () => {
    expect(useAuthStore.getState().isAuthenticated()).toBe(false)
    useAuthStore.setState({ token: 'a-token' })
    expect(useAuthStore.getState().isAuthenticated()).toBe(true)
  })

  it('reports a required reset from the user, not the token', () => {
    useAuthStore.setState({ user: fakeUser({ must_reset_password: true }), token: 't' })
    expect(useAuthStore.getState().mustResetPassword()).toBe(true)
  })

  it('reports no required reset when nobody is signed in', () => {
    expect(useAuthStore.getState().mustResetPassword()).toBe(false)
  })
})

describe('the request interceptor', () => {
  it('attaches the bearer token', async () => {
    let auth: string | null = null
    server.use(
      http.get('/api/health', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({})
      }),
    )
    localStorage.setItem('token', 'a-token')
    await api.get('/health')
    expect(auth).toBe('Bearer a-token')
  })

  it('sends no authorization header when signed out', async () => {
    let auth: string | null = 'unset'
    server.use(
      http.get('/api/health', ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({})
      }),
    )
    await api.get('/health')
    expect(auth).toBeNull()
  })

  it('names the tenant explicitly', async () => {
    // The dev proxy rewrites Host, so the backend cannot infer the college
    // from it - the frontend has to say.
    let tenant: string | null = null
    server.use(
      http.get('/api/health', ({ request }) => {
        tenant = request.headers.get('x-tenant')
        return HttpResponse.json({})
      }),
    )
    setHost('bmsce.myplacements.in')
    await api.get('/health')
    expect(tenant).toBe('bmsce')
  })

  it('sends no tenant header on the apex', async () => {
    let tenant: string | null = 'unset'
    server.use(
      http.get('/api/health', ({ request }) => {
        tenant = request.headers.get('x-tenant')
        return HttpResponse.json({})
      }),
    )
    setHost('myplacements.in')
    await api.get('/health')
    expect(tenant).toBeNull()
  })
})

describe('the response interceptor', () => {
  it('clears a stale session and redirects on a 401', async () => {
    // An expired token must not leave the app rendering a signed-in shell over
    // an API that refuses everything.
    setHost('rit.myplacements.in')
    localStorage.setItem('token', 'an-expired-token')
    server.use(
      http.get('/api/companies', () => HttpResponse.json({ detail: 'nope' }, { status: 401 })),
    )

    await expect(api.get('/companies')).rejects.toBeDefined()

    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.href).toContain('/login')
  })

  it('leaves the login page alone on its own 401', async () => {
    // The 401 from login itself carries no token. Redirecting would hard-reload
    // the page and reset the staff/student tab the user had chosen.
    setHost('rit.myplacements.in')
    const before = window.location.href
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ detail: 'Invalid credentials' }, { status: 401 }),
      ),
    )

    await expect(api.post('/auth/login', {})).rejects.toBeDefined()

    expect(window.location.href).toBe(before)
  })

  it('passes other errors through untouched', async () => {
    // A 403 is a role problem, not a session problem; the page shows it.
    localStorage.setItem('token', 'a-good-token')
    server.use(
      http.get('/api/reports', () => HttpResponse.json({ detail: 'nope' }, { status: 403 })),
    )

    await expect(api.get('/reports')).rejects.toMatchObject({ response: { status: 403 } })

    expect(localStorage.getItem('token')).toBe('a-good-token')
  })
})
