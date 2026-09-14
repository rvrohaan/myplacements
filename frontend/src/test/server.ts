/**
 * The mock API. Tests add their own handlers with `server.use(...)`; anything
 * not stubbed fails the test (see setup.ts).
 *
 * Deliberately empty by default. A shared pile of default handlers drifts away
 * from the real API and hides the fact that a test depends on a given call.
 */
import { setupServer } from 'msw/node'

export const server = setupServer()

export { http, HttpResponse } from 'msw'
