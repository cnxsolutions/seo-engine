// ─────────────────────────────────────────────────────────────────────────────
// Shared Postgres connection for maintenance scripts
// SEO Engine - The LOCAL Supabase by default; production only when named.
// ─────────────────────────────────────────────────────────────────────────────
//
// Development, tests and acceptance run against the local Supabase (`npm run
// db:local:start`). Until 2026-11-25 these scripts read SUPABASE_DB_URL from
// .env.local — the same file `npm run dev` reads — so the one URL that pointed
// a migration at production also pointed the dev server's scheduler there.
//
// Now:
//   - no flag              -> the local database, and NOTHING else: a non-local
//                             host is refused even if someone edits the constant;
//   - --prod=<project-ref> -> production, read from .env.prod-db (ignored by git
//                             like every .env*), and only if the ref typed on the
//                             command line is the ref of that URL. Typing the ref
//                             is the point: it makes the operator read which
//                             project is about to change.
//
// `.env.prod-db` and not `.env.production.local`: Next.js loads the latter by
// itself in any production build, and a local `npm run build && npm start` would
// then run the scheduler against the client sites.
//
// The direct host (`db.<ref>.supabase.co`) resolves to IPv6 only on recent
// Supabase projects; machines without IPv6 egress get ENETUNREACH there and must
// go through a regional pooler instead. Rather than make the operator find their
// region, production tries the direct host first and then the plausible poolers.

import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Client } from 'pg'

/** What `supabase start` serves, identical on every machine and in the CI. */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** The only file that holds the production connection string. */
export const PROD_ENV_FILE = '.env.prod-db'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Parse a dotenv file without a dependency — one KEY=value per line, # comments. */
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
 * Which database the command line asks for.
 *
 * `--prod` alone is accepted as a request, so that the refusal can name the ref
 * to type; it never connects by itself.
 */
export function parseTarget(argv = process.argv.slice(2)) {
  const flag = argv.find((arg) => arg === '--prod' || arg.startsWith('--prod='))
  if (!flag) return { target: 'local', ref: null }
  return { target: 'prod', ref: flag.includes('=') ? flag.slice('--prod='.length) : '' }
}

/** The Supabase project ref of a connection string, direct or pooled. */
export function projectRef(dbUrl) {
  const url = new URL(dbUrl)
  return url.username.includes('.') ? url.username.split('.')[1] : url.hostname.split('.')[1]
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
  const ref = projectRef(dbUrl)

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

async function connectLocal(quiet) {
  if (!LOCAL_HOSTS.has(new URL(LOCAL_DB_URL).hostname)) {
    throw new Error(`LOCAL_DB_URL ne pointe pas sur cette machine : refus.`)
  }
  const client = new Client({ connectionString: LOCAL_DB_URL, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => {})
    throw new Error(
      `Supabase local injoignable (${error.message}).\n` +
        `  Lancer Docker Desktop, puis : npm run db:local:start`
    )
  }
  if (!quiet) console.log('[db] base LOCALE (127.0.0.1:54322)')
  return client
}

async function connectProd(ref, quiet) {
  if (!existsSync(PROD_ENV_FILE)) {
    throw new Error(
      `${PROD_ENV_FILE} absent : la production n'est joignable que par ce fichier.\n` +
        `  Y poser une ligne SUPABASE_DB_URL=postgresql://… (chaine de connexion du projet hebergé).`
    )
  }
  const dbUrl = readEnvLocal(PROD_ENV_FILE).SUPABASE_DB_URL
  if (!dbUrl) throw new Error(`SUPABASE_DB_URL manque dans ${PROD_ENV_FILE}`)

  const expected = projectRef(dbUrl)
  if (ref !== expected) {
    throw new Error(
      `PRODUCTION visee : projet « ${expected} ».\n` +
        `  Pour confirmer, relancer avec --prod=${expected}`
    )
  }

  const failures = []
  for (const { label, url } of candidates(dbUrl)) {
    const client = new Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    })

    try {
      await client.connect()
      if (!quiet) console.log(`[db] base de PRODUCTION « ${expected} » (via ${label})`)
      return client
    } catch (error) {
      failures.push(`${label}: ${error.message}`)
      try { await client.end() } catch { /* already down */ }
    }
  }

  throw new Error(`No route to the database.\n  ${failures.join('\n  ')}`)
}

/**
 * Connect to the database the command line names.
 *
 * `allow` is what the calling script accepts: a script that empties tables
 * passes `['local']`, and `--prod` is then refused before any connection exists.
 */
export async function connect({ quiet = false, allow = ['local', 'prod'], argv = process.argv.slice(2) } = {}) {
  const { target, ref } = parseTarget(argv)
  if (!allow.includes(target)) {
    throw new Error(
      target === 'prod'
        ? `Ce script ne s'execute jamais contre la production.`
        : `Ce script ne s'execute que contre la production : --prod=<ref-du-projet>.`
    )
  }
  return target === 'prod' ? connectProd(ref, quiet) : connectLocal(quiet)
}

// Run directly: `node scripts/db-connect.mjs [--prod=<ref>]` — a pure connectivity check.
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
    `select current_database() as db, current_setting('server_version') as version,
            (select count(*) from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE') as tables`
  )
  console.log(`[db] database=${rows[0].db} postgres=${rows[0].version} public tables=${rows[0].tables}`)
  await client.end()
}
