// ─────────────────────────────────────────────────────────────────────────────
// Every migration replays without error — the project's idempotence rule, proved
//
// There is no migration table: the database is its own record, which only works
// if applying a file twice changes nothing. `npm run db:local:reset` has already
// applied each file once on top of the baseline; this replays each one AGAIN,
// inside a transaction that is rolled back, so the check leaves no trace.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { connect } from '../scripts/db-connect.mjs'
import { ABSORBED_BY_BASELINE, MIGRATIONS_DIR, migrationFiles } from '../scripts/db-local-reset.mjs'

let db: Client

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
})

afterAll(async () => {
  await db?.end()
})

describe('migrations', () => {
  it('les migrations absorbees par la baseline existent bien', () => {
    const files = new Set(readdirSync(MIGRATIONS_DIR))
    for (const absorbed of ABSORBED_BY_BASELINE) expect(files.has(absorbed)).toBe(true)
  })

  it.each(migrationFiles())('%s se rejoue sans erreur', async (path: string) => {
    const sql = readFileSync(path, 'utf8')
    await db.query('begin')
    try {
      await expect(db.query(sql)).resolves.toBeDefined()
    } finally {
      await db.query('rollback')
    }
  })
})
