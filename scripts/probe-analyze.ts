// ─────────────────────────────────────────────────────────────────────────────
// Full analysis dry-run against the connected repository
// SEO Engine - Runs the real analyzer, stores nothing.
// ─────────────────────────────────────────────────────────────────────────────
//
// Shows the profile the engine would store AND the page.tsx it would commit,
// without touching the database or the client's repository.
//
//   npx tsx scripts/probe-analyze.ts

import { readFileSync } from 'node:fs'
import { analyzeNextJsRepo } from '../lib/publishers/nextjs-analyzer'
import { buildScaffold, EMPTY_CHROME } from '../lib/publishers/scaffold'

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const raw = readFileSync('.env.local', 'utf-8')
  for (const line of raw.split('\n')) {
    const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const env = readEnv()

  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?type=eq.nextjs&select=name,url,github_repo,github_token,github_branch`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  )
  // Two sites are connected now. SITE picks one by name or repository.
  const sites = await res.json()
  const wanted = (process.env.SITE || '').toLowerCase()
  const site = wanted
    ? sites.find((s: { name: string; github_repo: string }) =>
        `${s.name} ${s.github_repo}`.toLowerCase().includes(wanted))
    : sites[0]
  if (!site) throw new Error(`aucun site ne correspond a « ${wanted} »`)
  console.log(`site  : ${site.name} · ${site.github_repo} · branche ${site.github_branch || '(defaut)'}\n`)

  const profile = await analyzeNextJsRepo(
    site.github_repo,
    site.github_token,
    site.github_branch || undefined
  )

  console.log('router          :', profile.router)
  console.log('dossier pages   :', profile.pageFolder)
  console.log('sitemap         :', profile.sitemapPath, `(${profile.sitemapFormat})`)
  console.log('page exemple    :', profile.samplePagePath)
  console.log('composants vus  :', profile.sharedComponents.length)
  console.log('charpente avant :', profile.chrome?.before.join(', ') || '(aucune)')
  console.log('charpente apres :', profile.chrome?.after.join(', ') || '(aucune)')
  console.log('pages comparees :', profile.chrome?.sampleCount ?? 0)
  console.log('props lues      :', Object.keys(profile.componentProps ?? {}).join(', ') || '(aucune)')
  console.log('classe wrapper  :', profile.chrome?.wrapperClass ?? '(aucune)')
  console.log('layout enveloppe:', profile.layoutShell?.wraps ? `oui — ${profile.layoutShell.components.join(', ') || 'sans composant'}${profile.layoutShell.hasMain ? ' + <main>' : ''}` : 'non')
  console.log('gabarit LLM     :', profile.publishTemplate ? `${profile.publishTemplate.length} car.` : 'aucun')
  console.log('erreur gabarit  :', profile.templateError ?? '—')

  const scaffold = buildScaffold(
    {
      title: 'Taxi gare de Troyes',
      metaDescription: 'Taxi depuis la gare de Troyes, 24h/24.',
      ogTitle: 'Taxi gare de Troyes',
      ogDescription: 'Taxi depuis la gare.',
      slug: 'taxi-gare-troyes',
      htmlContent: '<h1>Taxi gare de Troyes</h1><p>Contenu.</p>',
      schemaJson: '{"@type":"FAQPage"}',
      componentName: 'TaxiGareTroyesPage',
      pageUrl: `${String(site.url).replace(/\/$/, '')}/taxi-gare-troyes`,
    },
    profile.chrome ?? EMPTY_CHROME,
    profile.layoutShell
  )

  console.log(`\n─── page.tsx qui serait commite (${scaffold.fidelity}) ───\n`)
  console.log(scaffold.content)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
