// ─────────────────────────────────────────────────────────────────────────────
// Local database reset
// SEO Engine - Rebuild the LOCAL Supabase from the repository, from scratch.
// ─────────────────────────────────────────────────────────────────────────────
//
// One source for the schema, the one production was built from:
//
//   1. `supabase db reset`  — an empty database, Supabase's own roles and schemas;
//   2. db/000_baseline.sql  — every table, function and index of record;
//   3. every migration of src/adapters/infrastructure/database/migrations, in
//      order. The baseline already contains most of what they do, so this is
//      also the proof that each one is idempotent, as the project requires;
//   4. db/seed-local.sql    — the demonstration data (fictional sites, inactive
//      campaigns: nothing the local scheduler could publish anywhere);
//   5. the demonstration MEMBERS (DEMO_MEMBERS), one per client: a confirmed
//      Supabase Auth account through the local admin API, then its
//      client_members row. Their sign-in codes land in Mailpit.
//
// There is deliberately NO supabase/migrations directory: two folders of
// migrations would drift at the first change made to only one of them.
//
//   npm run db:local:reset            # steps 1 to 4
//   npm run db:local:reset -- --keep  # steps 3 to 5 only, on the current database:
//                                     # the quick loop while writing a new migration.
//                                     # The baseline is a dump, not a migration, and
//                                     # is never replayed over itself.

import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { connect } from './db-connect.mjs'
import { localStatus, runSupabase } from './supabase.mjs'

export const BASELINE = 'db/000_baseline.sql'
export const MIGRATIONS_DIR = 'src/adapters/infrastructure/database/migrations'
export const SEED = 'db/seed-local.sql'

/**
 * Migrations the baseline fully contains AND that cannot be replayed.
 *
 * 001 is the initial commit's schema (2026-07-11): bare CREATE TABLE, no IF NOT
 * EXISTS. It ran in production long before the baseline was dumped
 * (2026-08-10), so every object it creates is already in 000_baseline.sql — and
 * a migration that ran in production is never edited, even to make it
 * idempotent. Skipping it here is the honest form of that fact. Every OTHER
 * file is replayed on top of the baseline, which is what proves it idempotent.
 */
export const ABSORBED_BY_BASELINE = new Set(['001_schema_federation.sql'])

/**
 * One person per demonstration client (db/seed-local.sql): enough to sign in
 * to each space and to see that neither sees the other. `client` is the md5
 * seed of the client's id.
 */
export const DEMO_MEMBERS = [
  { email: 'marie@martin-batiment.test', client: 'demo-client-a' },
  { email: 'luc@electricite-durand.test', client: 'demo-client-b' },
]

/**
 * The id of a confirmed local Auth account for `email`, created if needed.
 * With --keep the account survives from the previous run: found again, not
 * duplicated.
 */
async function demoUserId(admin, email) {
  const created = await admin.createUser({ email, email_confirm: true })
  if (created.data?.user) return created.data.user.id
  if (created.error?.code !== 'email_exists') throw new Error(`compte ${email} : ${created.error?.message}`)
  const { data, error } = await admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`liste des comptes : ${error.message}`)
  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) throw new Error(`compte ${email} annonce existant mais introuvable`)
  return user.id
}

export async function createDemoMembers(client) {
  const status = localStatus()
  if (!status?.SERVICE_ROLE_KEY) throw new Error('supabase status illisible : la pile locale tourne-t-elle ?')
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(status.API_URL)) {
    throw new Error(`l'API Supabase annoncee n'est pas locale (${status.API_URL}) : refus.`)
  }
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } }).auth.admin

  for (const member of DEMO_MEMBERS) {
    const userId = await demoUserId(admin, member.email)
    await client.query(
      `insert into public.client_members (client_id, user_id, email)
       values (md5($1)::uuid, $2, $3)
       on conflict do nothing`,
      [member.client, userId, member.email],
    )
  }
}

/** The migration files to replay, in the order they were written. */
export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql') && !ABSORBED_BY_BASELINE.has(file))
    .sort()
    .map((file) => `${MIGRATIONS_DIR}/${file}`)
}

/**
 * Run one SQL file in its own transaction, so a failure names the file and the
 * line instead of leaving half a schema behind.
 */
export async function applyFile(client, path) {
  const sql = readFileSync(path, 'utf8')
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
  const concurrent = /create\s+(unique\s+)?index\s+concurrently/i.test(sql)
  try {
    if (!concurrent) await client.query('begin')
    await client.query(sql)
    if (!concurrent) await client.query('commit')
  } catch (error) {
    if (!concurrent) await client.query('rollback').catch(() => {})
    const line = error.position ? sql.slice(0, Number(error.position)).split('\n').length : null
    throw new Error(`${path}${line ? `:${line}` : ''} — ${error.message}`)
  }
}

async function main() {
  const keep = process.argv.includes('--keep')

  if (!keep) {
    console.log('[local] base videe (supabase db reset)…')
    const { status } = runSupabase(['db', 'reset', '--local'])
    if (status !== 0) {
      throw new Error('supabase db reset a echoue : Docker Desktop tourne-t-il, et `npm run db:local:start` a-t-il ete lance ?')
    }
  }

  // connect() refuses anything but 127.0.0.1 here: no flag is read, none is passed.
  const client = await connect({ allow: ['local'], argv: [] })
  try {
    for (const path of [...(keep ? [] : [BASELINE]), ...migrationFiles(), SEED]) {
      await applyFile(client, path)
      console.log(`[local] ${path}`)
    }
    await createDemoMembers(client)
    console.log(`[local] membres de demonstration : ${DEMO_MEMBERS.map((member) => member.email).join(', ')}`)
    const { rows } = await client.query(
      `select count(*)::int as tables from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`
    )
    console.log(`[local] pret : ${rows[0].tables} tables publiques, donnees de demonstration chargees.`)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[local] ECHEC — ${error.message}`)
    process.exit(1)
  })
}
