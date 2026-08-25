// ─────────────────────────────────────────────────────────────────────────────
// Schema baseline export
// SEO Engine - Reconstruct db/000_baseline.sql from the live database.
// ─────────────────────────────────────────────────────────────────────────────
//
// This exists because `pg_dump` is not installed on the operator's machine and
// the Supabase CLI's own dump requires Docker. It leans on PostgreSQL's
// `pg_get_*def()` functions, which return the server's OWN rendering of a
// constraint, index, function or trigger — so only the column list is composed
// here, and everything else is verbatim.
//
// Why it matters: 13 of the tables this application relies on were created by
// hand in the Supabase dashboard and exist in NO migration. Until this file is
// committed, losing the Supabase project means losing the product — the
// migrations only ALTER those tables, they never create them.
//
//   node scripts/db-baseline.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { connect } from './db-connect.mjs'

const OUT = 'db/000_baseline.sql'

const client = await connect()

// ─── Extensions ─────────────────────────────────────────────────────────────

const extensions = await client.query(`
  select e.extname, n.nspname
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
  order by e.extname
`)

// ─── Tables and columns ─────────────────────────────────────────────────────

const columns = await client.query(`
  select c.relname                                as table_name,
         a.attname                                as column_name,
         a.attnum                                 as ordinal,
         format_type(a.atttypid, a.atttypmod)     as data_type,
         a.attnotnull                             as not_null,
         pg_get_expr(d.adbin, d.adrelid)          as default_expr,
         a.attidentity                            as identity,
         a.attgenerated                           as generated
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attnum > 0
    and not a.attisdropped
  order by c.relname, a.attnum
`)

const byTable = new Map()
for (const row of columns.rows) {
  if (!byTable.has(row.table_name)) byTable.set(row.table_name, [])
  byTable.get(row.table_name).push(row)
}

// ─── Constraints, indexes, functions, triggers ──────────────────────────────
//
// Constraints are emitted as ALTER TABLE rather than inline, so foreign keys do
// not force the tables into dependency order — the same thing pg_dump does.

const constraints = await client.query(`
  select c.relname as table_name, con.conname, con.contype,
         pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class c     on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
  order by case con.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end,
           c.relname, con.conname
`)

// Constraint-backed indexes are already created by their constraint.
const indexes = await client.query(`
  select i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public'
    and not exists (
      select 1 from pg_constraint con
      join pg_class ic on ic.oid = con.conindid
      where ic.relname = i.indexname
    )
  order by i.indexname
`)

const functions = await client.query(`
  select p.proname, pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.deptype = 'e')
  order by p.proname
`)

const triggers = await client.query(`
  select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
  join pg_class c     on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
  order by c.relname, t.tgname
`)

const comments = await client.query(`
  select c.relname as table_name, a.attname as column_name,
         col_description(c.oid, a.attnum) as comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
    and col_description(c.oid, a.attnum) is not null
  order by c.relname, a.attnum
`)

// ─── Render ─────────────────────────────────────────────────────────────────

const quote = (id) => (/^[a-z_][a-z0-9_]*$/.test(id) ? id : `"${id}"`)
const literal = (text) => `'${String(text).replace(/'/g, "''")}'`

function renderColumn(col) {
  let line = `    ${quote(col.column_name)} ${col.data_type}`

  if (col.identity === 'a') line += ' GENERATED ALWAYS AS IDENTITY'
  else if (col.identity === 'd') line += ' GENERATED BY DEFAULT AS IDENTITY'
  else if (col.generated === 's') line += ` GENERATED ALWAYS AS (${col.default_expr}) STORED`
  else if (col.default_expr) line += ` DEFAULT ${col.default_expr}`

  if (col.not_null) line += ' NOT NULL'
  return line
}

const out = []
const stamp = new Date().toISOString().slice(0, 10)

out.push(`-- ─────────────────────────────────────────────────────────────────────────────
-- SEO Engine — schema baseline
-- Generated from the live database on ${stamp} by scripts/db-baseline.mjs
-- ─────────────────────────────────────────────────────────────────────────────
--
-- THE definition of record for every table this application uses. Most of them
-- were created by hand in the Supabase dashboard and appear in no migration:
-- without this file, losing the Supabase project means losing the schema.
--
-- Apply this FIRST on an empty database, then the numbered migrations in order.
-- Data is not included — this is structure only.
--
-- Regenerate after any hand-made change in the dashboard:
--     node scripts/db-baseline.mjs
`)

out.push('\n-- ─── Extensions ─────────────────────────────────────────────────────────────\n')
for (const e of extensions.rows) {
  out.push(`CREATE EXTENSION IF NOT EXISTS ${quote(e.extname)} WITH SCHEMA ${quote(e.nspname)};`)
}

out.push('\n-- ─── Functions ──────────────────────────────────────────────────────────────')
out.push('--\n-- Before the tables: a column default or a trigger may call one.\n')
for (const f of functions.rows) out.push(`${f.definition};\n`)

out.push('\n-- ─── Tables ─────────────────────────────────────────────────────────────────\n')
for (const [table, cols] of [...byTable.entries()].sort()) {
  out.push(`CREATE TABLE IF NOT EXISTS public.${quote(table)} (`)
  out.push(cols.map(renderColumn).join(',\n'))
  out.push(');\n')
}

out.push('\n-- ─── Constraints ────────────────────────────────────────────────────────────')
out.push('--\n-- ALTER TABLE rather than inline, so foreign keys impose no table ordering.\n')
for (const c of constraints.rows) {
  out.push(
    `ALTER TABLE public.${quote(c.table_name)} ` +
      `ADD CONSTRAINT ${quote(c.conname)} ${c.definition};`
  )
}

out.push('\n\n-- ─── Indexes ────────────────────────────────────────────────────────────────')
out.push('--\n-- Constraint-backed indexes are omitted: their constraint already creates them.\n')
for (const i of indexes.rows) {
  out.push(i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') + ';')
}

out.push('\n\n-- ─── Triggers ───────────────────────────────────────────────────────────────\n')
for (const t of triggers.rows) {
  out.push(`DROP TRIGGER IF EXISTS ${quote(t.tgname)} ON public.${quote(t.table_name)};`)
  out.push(`${t.definition};\n`)
}

out.push('\n-- ─── Column comments ────────────────────────────────────────────────────────\n')
for (const c of comments.rows) {
  out.push(
    `COMMENT ON COLUMN public.${quote(c.table_name)}.${quote(c.column_name)} IS ${literal(c.comment)};`
  )
}

mkdirSync('db', { recursive: true })
writeFileSync(OUT, out.join('\n') + '\n', 'utf8')

console.log(`[baseline] ${OUT}`)
console.log(`[baseline] ${byTable.size} tables, ${constraints.rowCount} constraints, ` +
  `${indexes.rowCount} indexes, ${functions.rowCount} functions, ${triggers.rowCount} triggers`)

await client.end()
