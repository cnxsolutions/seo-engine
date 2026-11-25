// ─────────────────────────────────────────────────────────────────────────────
// The demonstration data can publish nowhere
//
// `npm run dev` starts the scheduler against the local database. These are the
// three facts that keep it from writing to a real site or spending tokens on its
// own; a seed edited without them would turn every dev session into a risk.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { connect } from '../scripts/db-connect.mjs'

let db: Client

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
})

afterAll(async () => {
  await db?.end()
})

describe('donnees de demonstration', () => {
  it('existent : trois sites, une periode en cours', async () => {
    const { rows } = await db.query<{ sites: number; executing: number }>(`
      select (select count(*)::int from public.sites) as sites,
             (select count(*)::int from public.cycle_plans where status = 'executing') as executing
    `)
    expect(rows[0]).toEqual({ sites: 3, executing: 1 })
  })

  it('aucun site ne porte de quoi publier, et tous sont en .test', async () => {
    const { rows } = await db.query<{ name: string }>(`
      select name from public.sites
       where url !~ '^https?://[a-z0-9.-]+\\.test(/|$)'
          or coalesce(wp_app_password, '') <> ''
          or coalesce(github_token, '') <> ''
    `)
    expect(rows).toEqual([])
  })

  it('aucune campagne active ni renouvelee automatiquement', async () => {
    const { rows } = await db.query<{ name: string }>(`
      select name from public.campaigns where is_active or coalesce(cycle_auto_renew, true)
    `)
    expect(rows).toEqual([])
  })
})
