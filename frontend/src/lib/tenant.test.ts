/**
 * lib/tenant.ts - which college the browser is looking at.
 *
 * This is the frontend half of a rule the backend also implements in
 * app/core/tenant.py. The two must agree: the value computed here is sent as
 * the X-Tenant header, so a disagreement means the UI shows one college's
 * branding while the API answers for another. The table below is deliberately
 * the same shape as the backend's, so a divergence is visible side by side.
 *
 * Note the frontend is the *convenience* copy, not the enforcement. The server
 * decides; this only decides what to ask for.
 */
import { describe, expect, it } from 'vitest'

import { ADMIN_SUBDOMAIN, getSubdomain, isAdminHost } from '@/lib/tenant'

describe('getSubdomain', () => {
  it.each([
    // The real shapes, production and dev.
    ['rit.myplacements.in', 'rit'],
    ['admin.myplacements.in', 'admin'],
    ['rit.localhost', 'rit'],
    ['admin.localhost', 'admin'],
    // No tenant: the apex is the marketing site, bare hosts are dev.
    ['myplacements.in', null],
    ['localhost', null],
    ['127.0.0.1', null],
    ['0.0.0.0', null],
    // Only the leftmost label counts.
    ['rit.staging.myplacements.in', 'rit'],
    ['a.b.c.myplacements.in', 'a'],
    // Case is not significant in a hostname.
    ['RIT.MyPlacements.IN', 'rit'],
    // www is an alias of the apex, not a college.
    ['www.myplacements.in', null],
    // Nothing to read.
    ['', null],
  ])('reads %s as %s', (host, expected) => {
    expect(getSubdomain(host)).toBe(expected)
  })

  it('keeps a hyphenated college code intact', () => {
    // College.code is a DNS label, so hyphens are legal and common.
    expect(getSubdomain('st-josephs.myplacements.in')).toBe('st-josephs')
  })

  it('defaults to the current page host', () => {
    // vitest.config.ts starts jsdom on rit.myplacements.in.
    expect(getSubdomain()).toBe('rit')
  })
})

describe('isAdminHost', () => {
  it('recognises the platform console', () => {
    expect(isAdminHost('admin.myplacements.in')).toBe(true)
  })

  it('recognises the console in dev too', () => {
    expect(isAdminHost('admin.localhost')).toBe(true)
  })

  it.each(['rit.myplacements.in', 'myplacements.in', 'www.myplacements.in', 'localhost'])(
    'does not mistake %s for the console',
    (host) => {
      // App.tsx gates the Colleges and Platform pages on this, so a false
      // positive would offer a college admin pages that do not apply to them.
      expect(isAdminHost(host)).toBe(false)
    },
  )

  it('exports the reserved subdomain it checks against', () => {
    expect(ADMIN_SUBDOMAIN).toBe('admin')
  })
})

describe('agreement with the backend', () => {
  // These cases are the ones where the two implementations could plausibly
  // drift. They mirror tests/unit/test_tenant.py exactly; if either side
  // changes, one of the two suites should go red.
  it.each([
    ['rit.myplacements.in', 'rit'],
    ['myplacements.in', null],
    ['www.myplacements.in', null],
    ['admin.myplacements.in', 'admin'],
    ['a.b.c.myplacements.in', 'a'],
    ['localhost', null],
  ])('%s resolves the same on both sides', (host, expected) => {
    expect(getSubdomain(host)).toBe(expected)
  })
})
