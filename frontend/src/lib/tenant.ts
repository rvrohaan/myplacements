// Tenant (college) is identified by the subdomain, e.g. rit.myplacements.in.
// The backend reads this from the Host header in production, but the Vite dev
// proxy rewrites Host to localhost, so we also send it explicitly as X-Tenant
// (see lib/api.ts) derived from the value computed here.

// Hosts that never carry a tenant subdomain.
const BARE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

// Reserved subdomain for the platform console (admin.myplacements.in), where
// super_admins sign in. Not a college.
export const ADMIN_SUBDOMAIN = 'admin'

/** True when the current page is the platform console (admin.*). */
export function isAdminHost(host?: string): boolean {
  return getSubdomain(host) === ADMIN_SUBDOMAIN
}

/** The college subdomain for the current page, or null on the apex/bare host. */
export function getSubdomain(host: string = window.location.hostname): string | null {
  const h = host.split(':', 1)[0].trim().toLowerCase()
  if (!h || BARE_HOSTS.has(h)) return null

  const parts = h.split('.')
  // rit.localhost -> ["rit", "localhost"]; rit.myplacements.in -> ["rit", ...]
  if (h.endsWith('.localhost')) {
    return parts[0] || null
  }
  // Apex (myplacements.in) has no tenant; a real subdomain has an extra label.
  // Anything with 3+ labels (rit.myplacements.in) takes the leftmost as tenant.
  if (parts.length >= 3) {
    return parts[0] || null
  }
  return null
}
