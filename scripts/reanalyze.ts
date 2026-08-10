// ─────────────────────────────────────────────────────────────────────────────
// Re-analyse every connected Next.js site and store the profile
// SEO Engine - Same code path as the button, without needing the dev server.
// ─────────────────────────────────────────────────────────────────────────────
//
//   npx tsx scripts/reanalyze.ts            # every site
//   SITE=renovation npx tsx scripts/reanalyze.ts

import { readFileSync } from 'node:fs'
import { analyzeNextJsRepo } from '../lib/publishers/nextjs-analyzer'

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const env = readEnv()
  const base = env.NEXT_PUBLIC_SUPABASE_URL
  const auth = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }

  const res = await fetch(
    `${base}/rest/v1/sites?type=eq.nextjs&github_repo=not.is.null&select=id,name,github_repo,github_token,github_branch`,
    { headers: auth }
  )
  const all = await res.json()
  const wanted = (process.env.SITE || '').toLowerCase()
  const sites = wanted
    ? all.filter((s: { name: string; github_repo: string }) =>
        `${s.name} ${s.github_repo}`.toLowerCase().includes(wanted))
    : all

  for (const site of sites) {
    process.stdout.write(`${site.name} … `)
    try {
      const profile = await analyzeNextJsRepo(site.github_repo, site.github_token, site.github_branch || undefined)
      const write = await fetch(`${base}/rest/v1/sites?id=eq.${site.id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ repo_profile: profile }),
      })
      if (!write.ok) throw new Error(`ecriture refusee (${write.status})`)

      const chrome = [...(profile.chrome?.before ?? []), ...(profile.chrome?.after ?? [])]
      const shell = profile.layoutShell
      console.log('ok')
      console.log(`   pages       : ${profile.pageFolder} · ${profile.chrome?.sampleCount ?? 0} comparees`)
      console.log(`   charpente   : ${chrome.join(', ') || '(aucune)'}`)
      console.log(`   layout      : ${shell?.wraps ? `${shell.components.join(', ') || 'sans composant'}${shell.hasMain ? ' + <main>' : ''}` : 'transparent'}`)
      console.log(`   props lues  : ${Object.keys(profile.componentProps ?? {}).length}`)
      console.log(`   contrat     : ${profile.contract?.present ? `v${profile.contract.version}` : 'non'}`)
    } catch (error) {
      console.log('ECHEC')
      console.log(`   ${error instanceof Error ? error.message : error}`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
