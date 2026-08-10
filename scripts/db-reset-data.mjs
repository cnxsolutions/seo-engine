// ─────────────────────────────────────────────────────────────────────────────
// Data reset
// SEO Engine - Empty every table, keep every definition.
// ─────────────────────────────────────────────────────────────────────────────
//
// A clean slate for testing, without destroying anything irreplaceable. TRUNCATE
// removes rows; the tables, constraints, indexes, functions and triggers stay
// exactly as they are — which matters here because most of this schema was
// created by hand and lives nowhere but in the database and db/000_baseline.sql.
//
// Prints an inventory first: a reset that silently reports nothing looks the same
// whether it emptied ten thousand rows or failed to run.
//
//   node scripts/db-reset-data.mjs               # dry run — inventory only
//   node scripts/db-reset-data.mjs --confirm     # actually truncate
//   node scripts/db-reset-data.mjs --confirm --keep-google

import { connect } from './db-connect.mjs'

const args = new Set(process.argv.slice(2))
const confirmed = args.has('--confirm')
const keepGoogle = args.has('--keep-google')

/**
 * Tables never truncated.
 *
 * `schema_migrations` and friends belong to Supabase's own machinery; emptying
 * them would make the platform think the project was never migrated.
 */
const PROTECTED = new Set(['schema_migrations', 'supabase_migrations'])

const client = await connect()

const { rows: tables } = await client.query(`
  select c.relname as name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname
`)

// ─── Inventory ──────────────────────────────────────────────────────────────
//
// Exact counts, not reltuples: the planner's estimate is stale on a table that
// was just written to, and reporting "0 rows" for a table holding data would
// defeat the point of showing this at all.

const inventory = []
for (const { name } of tables) {
  const { rows } = await client.query(`select count(*)::int as n from public.${JSON.stringify(name)}`)
  inventory.push({ name, rows: rows[0].n })
}

const withRows = inventory.filter((t) => t.rows > 0)
const total = inventory.reduce((sum, t) => sum + t.rows, 0)

console.log(`\n[inventory] ${tables.length} tables, ${total} rows total`)
for (const t of withRows.sort((a, b) => b.rows - a.rows)) {
  console.log(`  ${String(t.rows).padStart(7)}  ${t.name}`)
}
if (withRows.length === 0) console.log('  (already empty)')

// ─── Truncate ───────────────────────────────────────────────────────────────

const targets = inventory
  .map((t) => t.name)
  .filter((name) => !PROTECTED.has(name))
  .filter((name) => !(keepGoogle && name === 'google_connections'))

if (!confirmed) {
  console.log(`\n[dry-run] would truncate ${targets.length} tables. Re-run with --confirm.`)
  await client.end()
  process.exit(0)
}

// One statement for all of them: CASCADE would otherwise complain table by table
// about foreign keys pointing at what is being emptied, and a single TRUNCATE is
// atomic — either every table is clean or none is.
const list = targets.map((name) => `public.${JSON.stringify(name)}`).join(', ')

await client.query('begin')
try {
  await client.query(`truncate table ${list} restart identity cascade`)
  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
}

const { rows: after } = await client.query(`
  select coalesce(sum(n), 0)::int as remaining from (
    ${targets.map((t) => `select count(*)::int as n from public.${JSON.stringify(t)}`).join(' union all ')}
  ) counts
`)

console.log(`\n[reset] truncated ${targets.length} tables — ${after[0].remaining} rows remaining`)
if (keepGoogle) console.log('[reset] google_connections preserved')
else console.log('[reset] google_connections emptied — the site will need reconnecting to Google')

await client.end()
