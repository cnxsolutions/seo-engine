// ─────────────────────────────────────────────────────────────────────────────
// Global setup of `npm run test:db`
// Fails in one readable line when the local Supabase is not there, and passes
// its API address and public key to the tests through `provide`.
// ─────────────────────────────────────────────────────────────────────────────

import type { TestProject } from 'vitest/node'
import { runSupabase } from '../scripts/supabase.mjs'

interface LocalStatus {
  API_URL: string
  ANON_KEY: string
  DB_URL: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseApiUrl: string
    supabaseAnonKey: string
  }
}

export default function setup(project: TestProject): void {
  const { status, stdout } = runSupabase(['status', '-o', 'json'], { capture: true })
  // The CLI prints a version notice after the JSON on some runs: keep the object only.
  const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)
  if (status !== 0 || !json) {
    throw new Error('Supabase local arrete : lancer Docker Desktop, puis `npm run db:local:start` et `npm run db:local:reset`.')
  }

  const local = JSON.parse(json) as LocalStatus
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(local.API_URL)) {
    throw new Error(`L'API Supabase annoncee n'est pas locale (${local.API_URL}) : refus.`)
  }

  project.provide('supabaseApiUrl', local.API_URL)
  project.provide('supabaseAnonKey', local.ANON_KEY)
}
