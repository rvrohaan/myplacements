import type { UserRole } from '@/types'

/**
 * The heads: everyone who sees the whole college rather than their own slice.
 *
 * Mirrors `LEADERSHIP_ROLES` in `backend/app/core/roles.py`, which is what the
 * leadership-only endpoints actually enforce. This copy exists so the UI can
 * avoid *offering* something the API would refuse — it is not the check. The
 * server's is.
 */
export const LEADERSHIP_ROLES: UserRole[] = [
  'super_admin',
  'principal',
  'pro_chancellor',
  'deputy_pro_chancellor',
]

export function isLeadership(role?: UserRole | null): boolean {
  return !!role && LEADERSHIP_ROLES.includes(role)
}
