// ─────────────────────────────────────────────────────────────────────────────
// QA-1 — no public table is readable with the public key
//
// The application reaches Supabase with the SERVICE key only, server-side, and
// that key bypasses RLS. The anon key, though, is published by definition
// (NEXT_PUBLIC_*), and the client space (L1) brings Supabase Auth to the
// browser's doorstep. A table without RLS is readable by anyone holding the
// project URL and that key — `sites` included, with its WordPress passwords and
// GitHub tokens. RLS enabled with NO policy means: nobody but the service key.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { connect } from '../scripts/db-connect.mjs'

let db: Client

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
})

afterAll(async () => {
  await db?.end()
})

describe('RLS', () => {
  it('est active sur chaque table du schema public', async () => {
    const { rows } = await db.query<{ table_name: string }>(`
      select c.relname as table_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and not c.relrowsecurity
       order by c.relname
    `)
    expect(rows.map((row) => row.table_name)).toEqual([])
  })

  it('aucune vue publique ne contourne le RLS (security_invoker obligatoire)', async () => {
    const { rows } = await db.query<{ view_name: string }>(`
      select c.relname as view_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('v', 'm')
         and not coalesce('security_invoker=true' = any (c.reloptions), false)
    `)
    expect(rows.map((row) => row.view_name)).toEqual([])
  })

  it('la cle publique ne lit aucun site, aucune campagne, aucune page', async () => {
    const apiUrl = inject('supabaseApiUrl')
    const anonKey = inject('supabaseAnonKey')

    for (const table of ['sites', 'campaigns', 'generations', 'google_connections']) {
      const response = await fetch(`${apiUrl}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      })
      // 200 with an empty array (RLS, no policy) or a refusal: both mean "nothing
      // leaked". Rows would mean the table is open to the whole internet.
      const body: unknown = response.ok ? await response.json() : []
      expect({ table, rows: body }).toEqual({ table, rows: [] })
    }
  })
})
