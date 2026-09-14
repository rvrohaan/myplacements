import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

// The package is ESM ("type": "module"), so __dirname is unavailable.
const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Reset the E2E database before the run.
 *
 * Deliberately its own process rather than an API call: the suite needs the
 * database in a known state *including* the rows no endpoint would create, and
 * a seed that went through the API could only ever set up what the API already
 * allows.
 *
 * backend/seed_e2e.py refuses any database whose name does not end in `_e2e`,
 * so a mistyped URL fails loudly instead of dropping the dev database.
 */
export default function globalSetup() {
  const backend = path.resolve(here, '..', '..', 'backend')
  // Same split as playwright.config.ts: Scripts/ on Windows, bin/ elsewhere.
  const python =
    process.env.E2E_PYTHON ?? path.join(backend, 'venv', 'Scripts', 'python.exe')

  execFileSync(python, ['seed_e2e.py'], {
    cwd: backend,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: '.' },
  })
}
