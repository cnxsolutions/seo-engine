// ─────────────────────────────────────────────────────────────────────────────
// Global setup of `npm run test:db`
// Fails in one readable line when the local Supabase is not there, and passes
// its addresses and keys to the tests through `provide` (db/env.db.ts turns
// them into the environment lib/supabase.ts reads).
// ─────────────────────────────────────────────────────────────────────────────

import type { TestProject } from 'vitest/node'
import { localStatus } from '../scripts/supabase.mjs'

interface LocalStatus {
  API_URL: string
  ANON_KEY: string
  SERVICE_ROLE_KEY: string
  MAILPIT_URL: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseApiUrl: string
    supabaseAnonKey: string
    supabaseServiceKey: string
    mailpitUrl: string
  }
}

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/

export default function setup(project: TestProject): void {
  const local = localStatus() as LocalStatus | null
  if (!local) {
    throw new Error('Supabase local arrete : lancer Docker Desktop, puis `npm run db:local:start` et `npm run db:local:reset`.')
  }

  // The service key bypasses every RLS: these tests must never hold a hosted one.
  for (const url of [local.API_URL, local.MAILPIT_URL]) {
    if (!LOCAL.test(url)) throw new Error(`Adresse annoncee non locale (${url}) : refus.`)
  }

  project.provide('supabaseApiUrl', local.API_URL)
  project.provide('supabaseAnonKey', local.ANON_KEY)
  project.provide('supabaseServiceKey', local.SERVICE_ROLE_KEY)
  project.provide('mailpitUrl', local.MAILPIT_URL)
}
