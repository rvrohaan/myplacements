/**
 * Helpers every frontend test may need.
 */
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { ConfirmProvider } from '@/components/ui/confirm'
import { ToastProvider } from '@/components/ui/toast'
import { useAuthStore } from '@/store/authStore'
import type { User, UserRole } from '@/types'

// Captured before any test redefines it, so resetHost() can put it back.
const ORIGINAL_LOCATION = window.location

/**
 * Point the page at a host.
 *
 * The tenant is the subdomain, so half the app's behaviour keys off this.
 * jsdom's `window.location` is read-only, hence the redefine; `assign`/`replace`
 * become spies so a redirect can be asserted instead of navigating.
 *
 * Undone after every test by setup.ts - a host that leaked into the next test
 * would change which tenant it runs as, silently.
 */
export function setHost(host: string): void {
  const url = new URL(`http://${host}/`)
  const stub = {
    ...window.location,
    hostname: url.hostname,
    host: url.host,
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    assign: vi.fn(),
    replace: vi.fn(),
  }
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: stub,
  })
}

/** Put the real location back. Called automatically after each test. */
export function resetHost(): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  })
}

/** A User shaped like the API returns one. Override whatever the test is about. */
export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'officer@rit.example.com',
    full_name: 'Test Officer',
    role: 'placement_officer' as UserRole,
    college_id: 1,
    is_active: true,
    must_reset_password: false,
    ...overrides,
  } as User
}

/** Put a signed-in user in the store and the token in localStorage, as login does. */
export function signIn(user: User = fakeUser(), token = 'test-token'): User {
  localStorage.setItem('token', token)
  useAuthStore.setState({ user, token })
  return user
}

/** Clear the session. `setup.ts` clears storage; this clears the store too. */
export function signOut(): void {
  useAuthStore.setState({ user: null, token: null })
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  )
}

/**
 * Render inside the providers every page assumes exist. Use plain `render` from
 * RTL for a leaf component that needs none of them.
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: Providers, ...options })
}

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
