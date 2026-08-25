// ─────────────────────────────────────────────────────────────────────────────
// Migration runner
// SEO Engine - Apply a migration file to the remote database.
// ─────────────────────────────────────────────────────────────────────────────
//
// Every migration in this project is written to be idempotent (IF NOT EXISTS,
// DROP … IF EXISTS, CREATE OR REPLACE), so re-applying one is a no-op rather
// than an error. That is what makes this safe to run without tracking state:
// the database itself is the record of what has been applied.
//
//   node scripts/db-migrate.mjs 012          # apply migration 012
//   node scripts/db-migrate.mjs 012 --dry    # print the statements, change nothing
//   node scripts/db-migrate.mjs --list       # what exists, and what is applied

import { readdirSync, readFileSync } from 'node:fs'
import { connect } from './db-connect.mjs'

const DIR = 'src/adapters/infrastructure/database/migrations'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const target = args.find((a) => !a.startsWith('--'))

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

if (args.includes('--list') || !target) {
  console.log(`\n${files.length} migrations dans ${DIR}\n`)
  for (const file of files) console.log(`  ${file}`)
  console.log('\nUsage: node scripts/db-migrate.mjs <numero>')
  process.exit(0)
}

const file = files.find((f) => f.startsWith(target))
if (!file) {
  console.error(`Aucune migration ne commence par "${target}". Disponibles :\n  ${files.join('\n  ')}`)
  process.exit(1)
}

const sql = readFileSync(`${DIR}/${file}`, 'utf8')

if (dryRun) {
  console.log(`\n--- ${file} (dry run, rien n'est execute) ---\n`)
  console.log(sql)
  process.exit(0)
}

// CREATE INDEX CONCURRENTLY cannot run inside a transaction block. None of the
// current migrations use it, but wrapping blindly would turn a future one into a
// confusing "cannot run inside a transaction block" error.
const concurrent = /create\s+(unique\s+)?index\s+concurrently/i.test(sql)

const client = await connect()
console.log(`[migrate] applying ${file}${concurrent ? ' (hors transaction : CONCURRENTLY detecte)' : ''}`)

try {
  if (!concurrent) await client.query('begin')
  await client.query(sql)
  if (!concurrent) await client.query('commit')
  console.log(`[migrate] ${file} applied`)
} catch (error) {
  if (!concurrent) await client.query('rollback').catch(() => {})
  console.error(`[migrate] FAILED — ${error.message}`)
  if (error.position) {
    // The server reports a byte offset; turning it into a line number is the
    // difference between "syntax error somewhere" and a place to look.
    const line = sql.slice(0, Number(error.position)).split('\n').length
    console.error(`[migrate] around line ${line}: ${sql.split('\n')[line - 1]?.trim()}`)
  }
  process.exitCode = 1
} finally {
  await client.end()
}
