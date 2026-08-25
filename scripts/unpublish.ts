// ─────────────────────────────────────────────────────────────────────────────
// Remove a published page and its route entry
// SEO Engine - Undo a publication that should not have happened.
// ─────────────────────────────────────────────────────────────────────────────
//
//   SITE=taxidriver npx tsx scripts/unpublish.ts taxi-troyes

import { readFileSync } from 'node:fs'
import { parseGeneratedRoutes, renderGeneratedRoutes } from '../lib/publishers/routes-file'
import { promoteToProduction } from '../lib/publishers/promote'

const slug = process.argv[2]
if (!slug) { console.error('usage: SITE=<nom> npx tsx scripts/unpublish.ts <slug>'); process.exit(1) }

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
  const auth = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
  const sites = await (await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,github_repo,github_token,github_branch,repo_profile`,
    { headers: auth }
  )).json()
  const wanted = (process.env.SITE || '').toLowerCase()
  const site = wanted
    ? sites.find((s: { name: string; github_repo: string }) => `${s.name} ${s.github_repo}`.toLowerCase().includes(wanted))
    : sites[0]
  if (!site) throw new Error(`aucun site ne correspond a « ${wanted} »`)

  const repoApi = `https://api.github.com/repos/${site.github_repo}`
  const headers = { Authorization: `token ${site.github_token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  const ref = site.github_branch ? `?ref=${encodeURIComponent(site.github_branch)}` : ''
  const branch = site.github_branch ? { branch: site.github_branch } : {}

  const pagePath = `${site.repo_profile?.pageFolder ?? 'src/app'}/${slug}/page.tsx`
  const existing = await fetch(`${repoApi}/contents/${pagePath}${ref}`, { headers, cache: 'no-store' })
  if (existing.ok) {
    const { sha } = await existing.json()
    const res = await fetch(`${repoApi}/contents/${pagePath}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: `seo-engine: retrait de /${slug}`, sha, ...branch }),
    })
    console.log(`page    : ${res.ok ? 'supprimee' : `ECHEC ${res.status}`}  ${pagePath}`)
  } else {
    console.log(`page    : absente  ${pagePath}`)
  }

  const routesFile = site.repo_profile?.contract?.routesFile
  if (routesFile) {
    const registry = await fetch(`${repoApi}/contents/${routesFile}${ref}`, { headers, cache: 'no-store' })
    if (registry.ok) {
      const data = await registry.json()
      const source = Buffer.from(data.content, 'base64').toString('utf-8')
      const kept = parseGeneratedRoutes(source).filter((r) => r.path !== `/${slug}`)
      const rendered = renderGeneratedRoutes(kept, './routes')
      if (rendered !== source) {
        const res = await fetch(`${repoApi}/contents/${routesFile}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `seo-engine: desindexation de /${slug}`,
            content: Buffer.from(rendered).toString('base64'),
            sha: data.sha,
            ...branch,
          }),
        })
        console.log(`registre: ${res.ok ? `entree retiree (${kept.length} restantes)` : `ECHEC ${res.status}`}`)
      } else {
        console.log('registre: entree deja absente')
      }
    }
  }

  if (site.github_branch) {
    const outcome = await promoteToProduction({ repoApi, headers, head: site.github_branch, slug: `retrait-${slug}` })
    console.log(`en ligne: ${outcome.promoted ? `oui, sur « ${outcome.base} »` : `NON — ${outcome.reason}`}`)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
