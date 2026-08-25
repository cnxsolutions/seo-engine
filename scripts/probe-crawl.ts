// ─────────────────────────────────────────────────────────────────────────────
// Crawl d'un site et inscription dans l'inventaire
// SEO Engine - Le crawl seul, sans analyse concurrentielle ni embedding
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/analysis-runs fait trois choses : il crawle, il indexe dans le
// magasin vectoriel (un embedding OpenAI par page) et il lance une analyse
// concurrentielle. Quand on veut seulement REMPLIR l'inventaire — apres une
// migration, ou pour voir ce que le site expose — les deux dernieres sont du
// coût pur.
//
// Ce script s'arrete a la premiere : il partage `toSitePagePayloads` avec les
// deux chemins de production, donc il inscrit exactement les memes colonnes.
//
//   npx tsx scripts/probe-crawl.ts                 # tous les sites actifs
//   npx tsx scripts/probe-crawl.ts --site <uuid>   # un seul
//   npx tsx scripts/probe-crawl.ts --dry           # crawle et rapporte, n'ecrit rien
//   npx tsx scripts/probe-crawl.ts --max 100       # plafond de pages (defaut 50)

// Charge .env.local AVANT d'importer quoi que ce soit qui lit process.env :
// lib/supabase.ts exige NEXT_PUBLIC_SUPABASE_URL des son evaluation, et tsx ne
// charge aucun fichier d'environnement de lui-meme.
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { crawlWebsite } from '../lib/analyzer/crawler'
import { toSitePagePayloads } from '../lib/analyzer/to-site-pages'
import { listSites, upsertSitePages } from '../lib/db'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry')
const only = valueOf('--site')
const maxPages = Number(valueOf('--max')) > 0 ? Number(valueOf('--max')) : 50

function valueOf(flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

async function main() {
  const sites = (await listSites()).filter((site) => site.is_active && (!only || site.id === only))

  if (sites.length === 0) {
    console.log('Aucun site actif a crawler.')
    return
  }

  console.log(`\n${sites.length} site(s) — plafond ${maxPages} pages${dryRun ? ' — SIMULATION, aucune ecriture' : ''}\n`)

  for (const site of sites) {
    console.log('='.repeat(72))
    console.log(`${site.name}  (${site.type})  ${site.url}`)
    console.log('='.repeat(72))

    try {
      const result = await crawlWebsite({ siteUrl: site.url, maxPages, followLinks: true })

      const canonical = result.pages.filter((page) => page.canonicalPath).length
      const noindex = result.pages.filter((page) => page.robotsNoindex).length
      const withMeta = result.pages.filter((page) => page.metaDescription).length

      console.log(`  sitemap        : ${result.sitemap.length} URL`)
      console.log(`  pages lues     : ${result.pages.length}${result.truncated ? '  (TRONQUE — le plafond a coupe)' : ''}`)
      console.log(`  meta desc      : ${withMeta}/${result.pages.length}`)
      console.log(`  canonique lue  : ${canonical}/${result.pages.length}`)
      console.log(`  noindex        : ${noindex}`)

      if (result.pages.length === 0) {
        console.log('  -> rien a inscrire\n')
        continue
      }

      if (dryRun) {
        console.log('  -> simulation : rien ecrit\n')
        continue
      }

      const payloads = toSitePagePayloads(site.id, result)
      await upsertSitePages(site.id, payloads)
      console.log(`  -> ${payloads.length} ligne(s) inscrite(s) dans site_pages\n`)
    } catch (error) {
      console.log(`  ECHEC : ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}

main().catch((error) => {
  console.error('Echec :', error instanceof Error ? error.message : error)
  process.exit(1)
})
