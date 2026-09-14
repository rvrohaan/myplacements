/**
 * lib/roles.ts - who the UI treats as leadership.
 *
 * This mirrors LEADERSHIP_ROLES in backend/app/core/roles.py, which is what the
 * leadership-only endpoints actually enforce. The copy exists so the UI can
 * avoid *offering* something the API would refuse; it is not the check.
 *
 * So the test that matters is the one below asserting the two lists agree. A
 * role missing here hides a page from someone entitled to it; a role added here
 * that the backend does not honour shows a page that 403s on open.
 */
import { describe, expect, it } from 'vitest'

import { LEADERSHIP_ROLES, isLeadership } from '@/lib/roles'
import type { UserRole } from '@/types'

describe('isLeadership', () => {
  it.each(LEADERSHIP_ROLES)('accepts %s', (role) => {
    expect(isLeadership(role)).toBe(true)
  })

  it.each<UserRole>(['placement_officer', 'department_coordinator', 'student'])(
    'rejects %s',
    (role) => {
      expect(isLeadership(role)).toBe(false)
    },
  )

  it('rejects a missing role rather than throwing', () => {
    // The store holds null before /auth/me resolves, and a component may render
    // in that window.
    expect(isLeadership(undefined)).toBe(false)
    expect(isLeadership(null)).toBe(false)
  })
})

describe('the list itself', () => {
  it('matches backend/app/core/roles.py LEADERSHIP_ROLES', () => {
    // Written out literally rather than derived, so changing one side without
    // the other fails here instead of in production.
    expect([...LEADERSHIP_ROLES].sort()).toEqual([
      'deputy_pro_chancellor',
      'principal',
      'pro_chancellor',
      'super_admin',
    ])
  })

  it('does not include the filer roles', () => {
    // Officers and coordinators see their own slice, not the whole college.
    expect(LEADERSHIP_ROLES).not.toContain('placement_officer')
    expect(LEADERSHIP_ROLES).not.toContain('department_coordinator')
  })

  it('does not include students', () => {
    // Students live in the portal and are deliberately outside the staff roles.
    expect(LEADERSHIP_ROLES).not.toContain('student')
  })
})
