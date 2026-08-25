// ─────────────────────────────────────────────────────────────────────────────
// Republish already-published pages with the current rules
// SEO Engine - Repair what shipped before the fixes.
// ─────────────────────────────────────────────────────────────────────────────
//
// Three defects reached production and none of them heal on their own:
//   - slugs padded with filler and carrying the internal page type;
//   - the direct answer printed twice, as intro and again as the first body
//     paragraph;
//   - one row marked `published` whose URL answers 404.
//
// This republishes from the STORED payload rather than regenerating: the article
// was reviewed and accepted, only the packaging was wrong. No model is called
// and no money is spent.
//
//   npx tsx scripts/republish.ts --dry     # say what would change
//   npx tsx scripts/republish.ts           # do it

import { readFileSync } from 'node:fs'
import { publishToNextJs } from '../lib/publishers/nextjs'
import { promoteToProduction } from '../lib/publishers/promote'
import { parseGeneratedRoutes, renderGeneratedRoutes } from '../lib/publishers/routes-file'
import { buildPageSlug } from '../lib/seo/slug'
import type { GeneratedPage } from '../lib/ai/openai'
import type { PageType } from '../lib/types'

const DRY = process.argv.includes('--dry')

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

  const rows = await (await fetch(
    `${base}/rest/v1/generations?status=eq.published&page_payload=not.is.null&select=id,slug,city,focus_keyword,title,page_type,site_id,page_payload&order=created_at.asc`,
    { headers: auth }
  )).json()

  const sites = await (await fetch(
    `${base}/rest/v1/sites?type=eq.nextjs&select=id,name,url,github_repo,github_token,github_branch,repo_profile`,
    { headers: auth }
  )).json()

  const touched = new Set<string>()

  for (const row of rows) {
    const site = sites.find((s: { id: string }) => s.id === row.site_id)
    if (!site?.github_repo) continue

    // The stored slug carries the old padding, so it is NOT the source.
    //
    // Two candidates, tried in order. The focus keyword is the query itself and
    // has never been padded — but a head term like "Taxi Troyes" collapses to
    // `/taxi-troyes`, which this site already serves as a hand-written page. The
    // publisher refuses that, and the title's angle is the honest fallback:
    // "Comment choisir un taxi selon le trajet" is exactly what distinguishes
    // this page from the one already there.
    const candidates = [
      buildPageSlug({ focusKeyword: row.focus_keyword, city: row.city }),
      buildPageSlug({ title: row.title, city: row.city }),
    ].filter((value, index, all) => all.indexOf(value) === index)

    console.log(`\n── ${site.name}`)
    console.log(`   avant : /${row.slug}`)
    if (DRY) {
      console.log(`   apres : /${candidates[0]}`)
      if (candidates[1]) console.log(`   repli : /${candidates[1]}`)
      continue
    }

    let result: Awaited<ReturnType<typeof publishToNextJs>> | null = null
    let slug = ''
    for (const candidate of candidates) {
      slug = candidate
      result = await publishToNextJs({
        githubRepo: site.github_repo,
        githubToken: site.github_token,
        page: { ...(row.page_payload as GeneratedPage), slug },
        siteUrl: site.url,
        repoProfile: site.repo_profile,
        branch: site.github_branch || undefined,
        pageType: (row.page_type as PageType) ?? undefined,
        // Promoted once at the end instead of per page: one merge, one deploy.
        autoPromote: false,
      })
      if (result.success) break
      console.log(`   /${candidate} refuse — ${result.error}`)
    }

    if (!result?.success) {
      console.log(`   ABANDON : aucun slug utilisable, la page reste en l'etat`)
      continue
    }
    console.log(`   apres : /${slug}`)
    console.log(`   publie en mode « ${result.mode} » · sitemap ${result.sitemapUpdated ? 'oui' : 'non'}`)
    touched.add(site.id)

    if (slug !== row.slug) {
      await removeStalePage(site, row.slug)
      console.log(`   ancienne page supprimee`)
    }

    await fetch(`${base}/rest/v1/generations?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ slug, published_url: result.pageUrl }),
    })
  }

  if (DRY) return

  for (const siteId of touched) {
    const site = sites.find((s: { id: string }) => s.id === siteId)
    if (!site.github_branch) continue
    const outcome = await promoteToProduction({
      repoApi: `https://api.github.com/repos/${site.github_repo}`,
      headers: githubHeaders(site.github_token),
      head: site.github_branch,
      slug: 'republication',
    })
    console.log(`\n${site.name} → ${outcome.promoted ? `en ligne sur « ${outcome.base} »` : `NON promu : ${outcome.reason}`}`)
  }
}

function githubHeaders(token: string) {
  return {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  }
}

/**
 * Delete the page committed under the previous slug, and drop its route.
 *
 * Leaving it behind would serve the same article at two URLs — duplicate content
 * the engine created itself — and leave a dead entry in the sitemap once the
 * file is gone.
 */
async function removeStalePage(
  site: { github_repo: string; github_token: string; github_branch?: string; repo_profile?: { pageFolder?: string; contract?: { routesFile?: string | null } } },
  oldSlug: string
): Promise<void> {
  const repoApi = `https://api.github.com/repos/${site.github_repo}`
  const headers = githubHeaders(site.github_token)
  const ref = site.github_branch ? `?ref=${encodeURIComponent(site.github_branch)}` : ''
  const pagePath = `${site.repo_profile?.pageFolder ?? 'src/app'}/${oldSlug}/page.tsx`

  const existing = await fetch(`${repoApi}/contents/${pagePath}${ref}`, { headers, cache: 'no-store' })
  if (existing.ok) {
    const { sha } = await existing.json()
    await fetch(`${repoApi}/contents/${pagePath}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        message: `seo-engine: retrait de /${oldSlug} (slug corrige)`,
        sha,
        ...(site.github_branch ? { branch: site.github_branch } : {}),
      }),
    })
  }

  const routesFile = site.repo_profile?.contract?.routesFile
  if (!routesFile) return

  const registry = await fetch(`${repoApi}/contents/${routesFile}${ref}`, { headers, cache: 'no-store' })
  if (!registry.ok) return
  const data = await registry.json()
  const source = Buffer.from(data.content, 'base64').toString('utf-8')
  const kept = parseGeneratedRoutes(source).filter((route) => route.path !== `/${oldSlug}`)
  const rendered = renderGeneratedRoutes(kept, './routes')
  if (rendered === source) return

  await fetch(`${repoApi}/contents/${routesFile}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `seo-engine: desindexation de /${oldSlug}`,
      content: Buffer.from(rendered).toString('base64'),
      sha: data.sha,
      ...(site.github_branch ? { branch: site.github_branch } : {}),
    }),
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
