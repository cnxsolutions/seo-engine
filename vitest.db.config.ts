import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Integration tests against the LOCAL Supabase (`npm run test:db`).
 *
 * Prerequisites: Docker Desktop, `npm run db:local:start`, `npm run db:local:reset`.
 * The global setup checks the stack is up and hands the tests its API address and
 * public key, read from the CLI rather than copied into the repository.
 *
 * One file at a time: every file shares the same database, and a test that
 * reads what another one is writing proves nothing.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.db.test.ts'],
    exclude: [...configDefaults.exclude],
    globalSetup: ['./db/test-setup.db.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
