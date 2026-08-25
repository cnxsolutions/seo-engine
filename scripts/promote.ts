// ─────────────────────────────────────────────────────────────────────────────
// Promote a site's publication branch to production, now
// SEO Engine - Same code path the scheduler uses after each publication.
// ─────────────────────────────────────────────────────────────────────────────
//
//   SITE=taxidriver npx tsx scripts/promote.ts

import { readFileSync } from 'node:fs'
import { promoteToProduction } from '../lib/publishers/promote'

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
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,github_repo,github_token,github_branch`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  )
  const sites = await res.json()
  const wanted = (process.env.SITE || '').toLowerCase()
  const site = wanted
    ? sites.find((s: { name: string; github_repo: string }) =>
        `${s.name} ${s.github_repo}`.toLowerCase().includes(wanted))
    : sites[0]
  if (!site) throw new Error(`aucun site ne correspond a « ${wanted} »`)
  if (!site.github_branch) throw new Error(`${site.name} publie deja sur la branche par defaut`)

  console.log(`site    : ${site.name} · ${site.github_repo}`)
  console.log(`branche : ${site.github_branch}\n`)

  const outcome = await promoteToProduction({
    repoApi: `https://api.github.com/repos/${site.github_repo}`,
    headers: {
      Authorization: `token ${site.github_token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    head: site.github_branch,
    slug: 'rattrapage-des-publications-en-attente',
  })

  console.log('fusionne :', outcome.promoted ? `OUI dans « ${outcome.base} »` : 'NON')
  console.log('verifie  :', outcome.verified ? 'build vert constate' : 'build non consultable (token restreint)')
  if (outcome.reason) console.log('raison   :', outcome.reason)
  process.exit(outcome.promoted ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
