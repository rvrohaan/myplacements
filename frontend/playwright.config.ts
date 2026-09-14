import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

// The package is ESM ("type": "module"), so __dirname is unavailable.
const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * End-to-end tests: a real browser, the real API, a real Postgres.
 *
 * These exist for what the other tiers cannot reach. Everything below the
 * browser is already covered by 1187 backend tests and 292 component tests, so
 * an E2E spec that re-checks a filter or a validation message is only a slower
 * copy of a test that already exists. What is genuinely untestable elsewhere is
 * the seam: the subdomain deciding the tenant, Vite's proxy rewriting Host so
 * the frontend has to send X-Tenant instead, a real session surviving a page
 * load, and a file actually downloading.
 *
 * The suite runs against its own database (`myplacements_e2e`), dropped and
 * reseeded before every run. It never touches the dev database - see the guard
 * in backend/seed_e2e.py.
 */

const BACKEND_PORT = 8000
const FRONTEND_PORT = 5173
const BACKEND = path.resolve(here, '..', 'backend')
// Windows puts the venv interpreter in Scripts/, Linux in bin/. CI sets
// E2E_PYTHON explicitly; locally the Windows path is the right default.
const PYTHON =
  process.env.E2E_PYTHON ?? path.join(BACKEND, 'venv', 'Scripts', 'python.exe')

/** The tenant under test. *.localhost resolves to 127.0.0.1 with no hosts edit. */
export const TENANT = 'e2e'
export const RIVAL = 'rival'

export function portal(subdomain: string, pathname = '/') {
  return `http://${subdomain}.localhost:${FRONTEND_PORT}${pathname}`
}

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:password@127.0.0.1:5432/myplacements_e2e'

export default defineConfig({
  testDir: './e2e',
  // Serial. The specs share one database and one seed; running them in parallel
  // would make them depend on each other's writes.
  workers: 1,
  fullyParallel: false,
  // A failure here is usually a real one, and a retry that hides it is worse
  // than a red run. CI gets one retry for genuine flake.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: portal(TENANT),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // The real API, pointed at the E2E database rather than the dev one.
      // An absolute, quoted path: the command runs through the platform shell,
      // and cmd.exe will not resolve `venv/Scripts/python.exe` from a cwd.
      command: `"${PYTHON}" -m uvicorn app.main:app --port ${BACKEND_PORT}`,
      cwd: BACKEND,
      url: `http://127.0.0.1:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        SECRET_KEY: 'e2e-secret-not-used-anywhere-real',
        ENVIRONMENT: 'test',
        BASE_DOMAIN: 'myplacements.in',
        // Empty so the AI and email paths stay in their "not configured"
        // branch: an E2E run must not spend credit or send mail.
        ANTHROPIC_API_KEY: '',
        RESEND_API_KEY: '',
        CRON_TOKEN: '',
      },
    },
    {
      command: 'npm run dev',
      cwd: here,
      // localhost, not 127.0.0.1: Vite binds to the hostname, and on Windows
      // that resolves to ::1 first, so polling the IPv4 address never answers.
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
