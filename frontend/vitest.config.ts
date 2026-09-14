/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Pin the clock's zone before any worker starts. lib/utils formats timestamps
// for display, so without this the expected strings would depend on where the
// suite happens to run - passing locally in IST and failing in CI on UTC.
// Asia/Kolkata matches the app's LOCAL_TIMEZONE default.
process.env.TZ = 'Asia/Kolkata'

// Kept separate from vite.config.ts so the dev-server config (proxy, allowed
// hosts, port) and the test config can't disturb each other. Vitest prefers
// this file when both are present.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    // Default host for every test: a tenant subdomain, which is where the staff
    // app actually runs. Tests that care use setHost() from src/test/utils.
    environmentOptions: {
      jsdom: { url: 'http://rit.myplacements.in/' },
    },
    setupFiles: ['./src/test/setup.ts'],
    // No `globals`: describe/it/expect are imported explicitly, so test files
    // need no ambient type registration to typecheck.
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // The places where logic lives. Pages come later, in Phase 5.
      include: ['src/lib/**', 'src/store/**', 'src/components/ui/**'],
      exclude: ['**/*.test.*', 'src/test/**'],
    },
  },
})
