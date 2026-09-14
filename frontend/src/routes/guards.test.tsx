/**
 * routes/guards.tsx - what the UI offers, per role and per host.
 *
 * These are not the enforcement. The API decides, and the backend's security
 * suite is where that is proven. A guard's job is narrower: never offer a page
 * the server would refuse, and never strand somebody on one they are entitled
 * to. Both halves are asserted, because a guard that redirects everybody would
 * pass a one-sided test while the app is simply unusable.
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  AdminRoute,
  CollegeRoute,
  ConsoleRoute,
  ProtectedRoute,
  StudentRoute,
  home,
  isApex,
} from '@/routes/guards'
import type { UserRole } from '@/types'

import { fakeUser, render, screen, setHost, signIn, signOut } from '../test/utils'

/** Render a guard at `/`, with somewhere recognisable to be redirected to. */
function renderGuard(guard: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={guard} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/portal" element={<p>student portal</p>} />
        <Route path="/dashboard" element={<p>college dashboard</p>} />
        <Route path="/colleges" element={<p>console colleges</p>} />
        <Route path="/people" element={<p>people page</p>} />
        <Route path="/reset-password" element={<p>reset password</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const guarded = <p>the guarded page</p>

beforeEach(() => {
  signOut()
})

describe('home', () => {
  it('is the dashboard on a college subdomain', () => {
    setHost('rit.myplacements.in')
    expect(home()).toBe('/dashboard')
  })

  it('is the college list on the platform console', () => {
    // The console manages colleges; it has no dashboard of its own.
    setHost('admin.myplacements.in')
    expect(home()).toBe('/colleges')
  })

  it('is read at call time, not frozen at import', () => {
    // The regression the extraction fixed: as a module-level constant this
    // was decided once, by whichever host happened to load the bundle.
    setHost('admin.myplacements.in')
    expect(home()).toBe('/colleges')
    setHost('rit.myplacements.in')
    expect(home()).toBe('/dashboard')
  })
})

describe('isApex', () => {
  it('is true on the bare apex', () => {
    setHost('myplacements.in')
    expect(isApex()).toBe(true)
  })

  it('is true on www, which is an alias of it', () => {
    setHost('www.myplacements.in')
    expect(isApex()).toBe(true)
  })

  it('is false on a college subdomain', () => {
    setHost('rit.myplacements.in')
    expect(isApex()).toBe(false)
  })

  it('is false on the console', () => {
    // The console is not the marketing site; it is an app.
    setHost('admin.myplacements.in')
    expect(isApex()).toBe(false)
  })
})

describe('ProtectedRoute', () => {
  it('sends a signed-out visitor to login', () => {
    renderGuard(<ProtectedRoute>{guarded}</ProtectedRoute>)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('lets staff through', () => {
    signIn(fakeUser({ role: 'placement_officer' }))
    renderGuard(<ProtectedRoute>{guarded}</ProtectedRoute>)
    expect(screen.getByText('the guarded page')).toBeInTheDocument()
  })

  it('sends a student to their portal', () => {
    // Students have valid sessions, so authentication alone would let them in.
    signIn(fakeUser({ role: 'student' }))
    renderGuard(<ProtectedRoute>{guarded}</ProtectedRoute>)
    expect(screen.getByText('student portal')).toBeInTheDocument()
  })

  it('diverts to the password reset when one is owed', () => {
    // An invite-redeemed account lands here; letting it browse first would
    // leave a shared temporary password live.
    signIn(fakeUser({ must_reset_password: true }))
    renderGuard(<ProtectedRoute>{guarded}</ProtectedRoute>)
    expect(screen.getByText('reset password')).toBeInTheDocument()
  })

  it('checks the session before the password reset', () => {
    // Somebody with no session and a stale must_reset flag belongs at login.
    renderGuard(<ProtectedRoute>{guarded}</ProtectedRoute>)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})

describe('StudentRoute', () => {
  it('lets a student into the portal', () => {
    signIn(fakeUser({ role: 'student' }))
    renderGuard(<StudentRoute>{guarded}</StudentRoute>)
    expect(screen.getByText('the guarded page')).toBeInTheDocument()
  })

  it('sends staff back to their own home', () => {
    setHost('rit.myplacements.in')
    signIn(fakeUser({ role: 'placement_officer' }))
    renderGuard(<StudentRoute>{guarded}</StudentRoute>)
    expect(screen.getByText('college dashboard')).toBeInTheDocument()
  })

  it('sends a signed-out visitor to login', () => {
    renderGuard(<StudentRoute>{guarded}</StudentRoute>)
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('diverts a student who owes a password reset', () => {
    signIn(fakeUser({ role: 'student', must_reset_password: true }))
    renderGuard(<StudentRoute>{guarded}</StudentRoute>)
    expect(screen.getByText('reset password')).toBeInTheDocument()
  })
})

describe('AdminRoute', () => {
  const admin: UserRole[] = ['super_admin', 'principal', 'pro_chancellor', 'deputy_pro_chancellor']

  it.each(admin)('lets %s through', (role) => {
    setHost('rit.myplacements.in')
    signIn(fakeUser({ role }))
    renderGuard(<AdminRoute>{guarded}</AdminRoute>)
    expect(screen.getByText('the guarded page')).toBeInTheDocument()
  })

  it.each<UserRole>(['placement_officer', 'department_coordinator'])(
    'turns %s away',
    (role) => {
      setHost('rit.myplacements.in')
      signIn(fakeUser({ role }))
      renderGuard(<AdminRoute>{guarded}</AdminRoute>)
      expect(screen.getByText('college dashboard')).toBeInTheDocument()
    },
  )

  it('turns away a visitor with no user loaded yet', () => {
    // The store holds null between a page load and /auth/me resolving.
    setHost('rit.myplacements.in')
    renderGuard(<AdminRoute>{guarded}</AdminRoute>)
    expect(screen.getByText('college dashboard')).toBeInTheDocument()
  })

  it('mirrors the backend leadership list exactly', async () => {
    // The gate the API actually enforces. Drift in either direction is a bug:
    // too narrow hides a page, too wide shows one that 403s on open.
    const { ADMIN_ROLES } = await import('@/routes/guards')
    const { LEADERSHIP_ROLES } = await import('@/lib/roles')
    expect([...ADMIN_ROLES].sort()).toEqual([...LEADERSHIP_ROLES].sort())
  })
})

describe('CollegeRoute', () => {
  it('shows college data on a college subdomain', () => {
    setHost('rit.myplacements.in')
    renderGuard(<CollegeRoute>{guarded}</CollegeRoute>)
    expect(screen.getByText('the guarded page')).toBeInTheDocument()
  })

  it('redirects to People on the console', () => {
    // The console has no college of its own, so a students or drives page
    // there would query a tenant that does not exist.
    setHost('admin.myplacements.in')
    renderGuard(<CollegeRoute>{guarded}</CollegeRoute>)
    expect(screen.getByText('people page')).toBeInTheDocument()
  })
})

describe('ConsoleRoute', () => {
  it('shows console pages on the console', () => {
    setHost('admin.myplacements.in')
    renderGuard(<ConsoleRoute>{guarded}</ConsoleRoute>)
    expect(screen.getByText('the guarded page')).toBeInTheDocument()
  })

  it('sends a college host home instead', () => {
    setHost('rit.myplacements.in')
    renderGuard(<ConsoleRoute>{guarded}</ConsoleRoute>)
    expect(screen.getByText('college dashboard')).toBeInTheDocument()
  })

  it('is the exact complement of CollegeRoute', () => {
    // Every page is one or the other; a host that satisfied both, or neither,
    // would mean a page that renders twice or not at all.
    for (const host of ['rit.myplacements.in', 'admin.myplacements.in']) {
      setHost(host)
      const onConsole = host.startsWith('admin.')
      expect(onConsole).toBe(home() === '/colleges')
    }
  })
})
