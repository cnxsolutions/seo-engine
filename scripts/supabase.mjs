// ─────────────────────────────────────────────────────────────────────────────
// Supabase CLI
// SEO Engine - The CLI at ONE pinned version, for the workstation and the CI.
// ─────────────────────────────────────────────────────────────────────────────
//
// Not a devDependency, on purpose: the `supabase` npm package downloads a native
// binary in its postinstall, and the Dockerfile runs `npm ci` with the dev
// dependencies in its `deps` stage — every image build would fetch a CLI the
// running application never uses. `npx --yes supabase@<version>` caches it once
// per machine instead, and this constant is the only place the version lives.
//
// 2.x rather than 3.x: 3.0.0 shipped on 2026-11-02, too recent to be the base of
// every test run; 2.122.1 is the last release of the mature line.
//
//   node scripts/supabase.mjs start        (or: npm run db:local:start)
//   node scripts/supabase.mjs status

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const SUPABASE_CLI_VERSION = '2.122.1'

/** Runs the pinned CLI and returns its exit code; output goes straight to the terminal. */
export function runSupabase(args, { capture = false } = {}) {
  // npx is a .cmd shim on Windows and only resolves through a shell. A shell
  // takes ONE command line — handing it an argument array is deprecated
  // (DEP0190) precisely because nothing gets quoted — so the line is built here,
  // each argument quoted.
  const line = ['npx', '--yes', `supabase@${SUPABASE_CLI_VERSION}`, ...args]
    .map((arg) => (/^[\w@./:=-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`))
    .join(' ')
  const result = spawnSync(line, {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: true,
  })
  if (result.error) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runSupabase(process.argv.slice(2)).status)
}
