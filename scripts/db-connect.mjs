// ─────────────────────────────────────────────────────────────────────────────
// Shared Postgres connection for maintenance scripts
// SEO Engine - Reads SUPABASE_DB_URL from .env.local, never from the CLI.
// ─────────────────────────────────────────────────────────────────────────────
//
// The direct host (`db.<ref>.supabase.co`) resolves to IPv6 only on recent
// Supabase projects; machines without IPv6 egress get ENETUNREACH there and must
// go through a regional pooler instead. Rather than make the operator find their
// region, this tries the direct host first and then the plausible poolers.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Client } from 'pg'

/** Parse .env.local without a dependency — one KEY=value per line, # comments. */
export function readEnvLocal(path = '.env.local') {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

/**
 * Candidate connection strings, direct host first.
 *
 * The pooler uses a different username shape (`postgres.<ref>`), so the URL is
 * rebuilt rather than having its host swapped.
 */
function candidates(dbUrl) {
  const url = new URL(dbUrl)
  const password = decodeURIComponent(url.password)
  const ref = url.username.includes('.') ? url.username.split('.')[1] : url.hostname.split('.')[1]

  const poolerHosts = [
    'aws-0-eu-west-3', 'aws-1-eu-west-3',
    'aws-0-eu-central-1', 'aws-1-eu-central-1',
    'aws-0-eu-west-1', 'aws-0-us-east-1',
  ]

  return [
    { label: 'direct', url: dbUrl },
    ...poolerHosts.map((host) => ({
      label: host,
      // 5432 is the session-mode port: transaction mode (6543) rejects the
      // prepared statements and advisory work a schema dump relies on.
      url: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}.pooler.supabase.com:5432/postgres`,
    })),
  ]
}

/** Connect through the first candidate that answers. Throws if none do. */
export async function connect({ quiet = false } = {}) {
  const env = readEnvLocal()
  const dbUrl = env.SUPABASE_DB_URL
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is missing from .env.local')

  const failures = []

  for (const { label, url } of candidates(dbUrl)) {
    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    })

    try {
      await client.connect()
      if (!quiet) console.log(`[db] connected via ${label}`)
      return client
    } catch (error) {
      failures.push(`${label}: ${error.message}`)
      try { await client.end() } catch { /* already down */ }
    }
  }

  throw new Error(`No route to the database.\n  ${failures.join('\n  ')}`)
}

// Run directly: `node scripts/db-connect.mjs` — a pure connectivity check.
//
// `pathToFileURL` rather than string concatenation: on Windows a path is
// `D:\...` and its URL is `file:///D:/...` — three slashes and an escaped drive
// letter — so a hand-built `file://${path}` never matches and the block silently
// never runs.
// `process.argv[1]` is undefined when this module is imported from `node -e`,
// where there is no script path at all — hence the guard before converting it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = await connect()
  const { rows } = await client.query(
    `select current_database() as db,
            (select count(*) from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE') as tables`
  )
  console.log(`[db] database=${rows[0].db} public tables=${rows[0].tables}`)
  await client.end()
}
