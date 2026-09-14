/**
 * Runs before every test file.
 *
 * Three guarantees: jest-dom matchers exist, no test reaches the network
 * unmocked, and nothing (DOM, localStorage, the auth store) carries over from
 * the previous test.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'
import { resetHost } from './utils'

beforeAll(() => {
  // An unhandled request is a bug in the test, not something to pass through:
  // it means a component called an endpoint nobody stubbed.
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetHost()
  localStorage.clear()
  sessionStorage.clear()
})

afterAll(() => {
  server.close()
})
