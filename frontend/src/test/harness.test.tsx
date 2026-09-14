/**
 * Proves the frontend harness works.
 *
 * Not feature tests - each one pins a property the rest of the suite depends
 * on, and together they are the worked example for how to write the tiers that
 * follow.
 */
import { describe, expect, it } from 'vitest'

import api from '@/lib/api'
import { getSubdomain, isAdminHost } from '@/lib/tenant'
import { useAuthStore } from '@/store/authStore'

import { HttpResponse, http, server } from './server'
import { fakeUser, renderWithProviders, screen, setHost, signIn, signOut } from './utils'

describe('module resolution', () => {
  it('resolves the @ alias to src', () => {
    expect(typeof getSubdomain).toBe('function')
  })
})

describe('host control', () => {
  it('defaults to a tenant subdomain', () => {
    expect(getSubdomain()).toBe('rit')
  })

  it('setHost switches tenant', () => {
    setHost('bmsce.myplacements.in')
    expect(getSubdomain()).toBe('bmsce')
    expect(isAdminHost()).toBe(false)
  })

  it('setHost reaches the admin console', () => {
    setHost('admin.myplacements.in')
    expect(isAdminHost()).toBe(true)
  })

  it('does not leak the host into the next test', () => {
    expect(getSubdomain()).toBe('rit')
  })
})

describe('the mock API', () => {
  it('intercepts requests and sees the interceptor headers', async () => {
    let seen: Headers | undefined
    server.use(
      http.get('/api/health', ({ request }) => {
        seen = request.headers
        return HttpResponse.json({ status: 'ok' })
      }),
    )

    localStorage.setItem('token', 'a-token')
    const { data } = await api.get('/health')

    expect(data).toEqual({ status: 'ok' })
    // Both interceptors in lib/api.ts must have run.
    expect(seen?.get('authorization')).toBe('Bearer a-token')
    expect(seen?.get('x-tenant')).toBe('rit')
  })

  it('starts each test with no token', () => {
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('surfaces error responses to the caller', async () => {
    server.use(
      http.get('/api/companies', () =>
        HttpResponse.json({ detail: 'Insufficient permissions' }, { status: 403 }),
      ),
    )
    await expect(api.get('/companies')).rejects.toMatchObject({
      response: { status: 403 },
    })
  })
})

describe('the auth store', () => {
  it('signIn seeds both the store and localStorage', () => {
    const user = signIn(fakeUser({ role: 'principal' }))
    expect(useAuthStore.getState().user?.role).toBe('principal')
    expect(useAuthStore.getState().token).toBe('test-token')
    expect(localStorage.getItem('token')).toBe('test-token')
    expect(user.email).toBe('officer@rit.example.com')
  })

  it('does not carry a session into the next test', () => {
    // localStorage is cleared by setup.ts; the store needs signOut().
    expect(localStorage.getItem('token')).toBeNull()
    signOut()
    expect(useAuthStore.getState().token).toBeNull()
  })
})

describe('rendering', () => {
  it('mounts a component inside the app providers', () => {
    function Probe() {
      return <p>rendered inside providers</p>
    }
    renderWithProviders(<Probe />)
    expect(screen.getByText('rendered inside providers')).toBeInTheDocument()
  })

  it('unmounts between tests', () => {
    expect(screen.queryByText('rendered inside providers')).not.toBeInTheDocument()
  })
})
