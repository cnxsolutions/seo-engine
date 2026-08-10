// ─────────────────────────────────────────────────────────────────────────────
// Print the two files to paste into the connected site
// SEO Engine - Proposed to a human, never committed by the engine.
// ─────────────────────────────────────────────────────────────────────────────
//
//   npx tsx scripts/contract-files.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildContractFiles } from '../lib/publishers/contract-source'
import { EMPTY_CHROME } from '../lib/publishers/scaffold'

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
    const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const env = readEnv()
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,repo_profile&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  )
  const [site] = await res.json()
  // Re-analyse rather than trust the stored profile: the point of this script is
  // to show what the site would get NOW, and a stale profile is what produced an
  // adapter without a FAQ section.
  const fresh = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=github_repo,github_token,github_branch&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  )
  const [creds] = await fresh.json()
  const { analyzeNextJsRepo } = await import('../lib/publishers/nextjs-analyzer')
  const profile = await analyzeNextJsRepo(creds.github_repo, creds.github_token, creds.github_branch || undefined)
  void site

  const files = buildContractFiles({
    adapterFolder: `${profile.srcPrefix ?? 'src/'}components/seo-engine`,
    pageFolder: profile.pageFolder ?? 'src/app',
    srcPrefix: profile.srcPrefix ?? 'src/',
    chrome: profile.chrome ?? EMPTY_CHROME,
    componentProps: profile.componentProps ?? {},
    layoutShell: profile.layoutShell,
  })

  // Written to disk as well as listed: the adapter is around ninety lines, which
  // is more than anyone wants to copy out of a terminal.
  // Outside the project by default. Written under the repo, these files are
  // picked up by this project's own tsconfig, and `tsc` then fails on imports
  // that only resolve in the OTHER repository.
  const out = process.argv[2] || join(tmpdir(), 'contrat-seo-engine')
  for (const file of files) {
    const target = join(out, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf-8')
    console.log(`\n${target}`)
    console.log(`  → ${file.why}`)
  }

  console.log('\nReste UNE ligne que le moteur ne peut pas ecrire a ta place :')
  console.log("  dans src/lib/seo/routes.ts, importe GENERATED_ROUTES depuis './routes.generated'")
  console.log('  et etale-le dans ROUTES : ...GENERATED_ROUTES')
  console.log('  Sans elle, les pages publiees existent mais restent hors du sitemap.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
