import { NextRequest, NextResponse } from 'next/server'
import { analyzeCompetitors } from '@/lib/analyzer/competitive'
import { crawlWebsite } from '@/lib/analyzer/crawler'
import { toSitePagePayloads } from '@/lib/analyzer/to-site-pages'
import { createAnalysisRun, getSiteById, upsertSitePages } from '@/lib/db'
import { indexSitePages } from '@/src/adapters/rag/VectorIndexingService'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      siteId,
      siteUrl,
      businessType,
      businessName,
      targetCities,
      competitorUrls = [],
      maxPages = 50,
    } = body

    const site = siteId ? await getSiteById(siteId) : null
    const targetUrl = normalizeUrl(siteUrl || site?.url || '')
    if (!targetUrl) {
      return NextResponse.json({ error: 'siteUrl ou siteId requis' }, { status: 400 })
    }

    let siteCrawl
    try {
      siteCrawl = await crawlWebsite({
        siteUrl: targetUrl,
        maxPages: Math.min(Number(maxPages) || 50, 50),
        followLinks: true,
      })
    } catch (crawlErr) {
      return NextResponse.json(
        { error: `Impossible de crawler le site cible (${targetUrl}): ${crawlErr instanceof Error ? crawlErr.message : 'erreur inconnue'}` },
        { status: 422 }
      )
    }

    if (siteCrawl.pages.length === 0) {
      return NextResponse.json(
        { error: `Impossible de crawler le site cible (${targetUrl}). Verifiez que l'URL est accessible et que le site n'est pas protege (Cloudflare, maintenance, etc.).` },
        { status: 422 }
      )
    }

    if (site?.id) {
      // L'echec est JOURNALISE, plus avale. `.catch(() => null)` a masque
      // pendant toute la vie du produit un echec d'upsert qui laissait
      // `site_pages` vide : l'analyse repondait 200, l'operateur voyait un
      // succes, et l'inventaire ne se remplissait jamais. Un inventaire vide
      // reste non bloquant — c'est la regle du chantier — mais il cesse d'etre
      // silencieux.
      await upsertSitePages(
        site.id,
        toSitePagePayloads(site.id, siteCrawl) as Parameters<typeof upsertSitePages>[1]
      ).catch((error: unknown) => {
        console.error(
          `[analysis-runs] site_pages non ecrit site=${site.id}:`,
          error instanceof Error ? error.message : error
        )
        return null
      })

      // Feed the vector store. THIS is the crawl path the UI actually calls
      // (app/(dashboard)/strategy/new/page.tsx posts here, not to /api/analyze),
      // so without this line the index stays empty no matter how many crawls run.
      //
      // `indexSitePages` never throws by contract and is nearly free when
      // nothing changed (documents are skipped by content hash), so it is
      // awaited without a try/catch and must never fail the analysis run.
      const indexing = await indexSitePages(site.id, { source: 'crawl' })
      if (indexing.errors.length > 0) {
        console.warn(`[analysis-runs] indexation partielle site=${site.id}:`, indexing.errors.join(' | '))
      }
    }

    const analysisData = await analyzeCompetitors({
      siteCrawl,
      competitorUrls: Array.isArray(competitorUrls) ? competitorUrls : String(competitorUrls).split('\n'),
      businessType,
      businessName,
      targetCities: Array.isArray(targetCities) ? targetCities : splitList(targetCities),
      // Lets the competitive analysis drop "missing" keywords the site already
      // ranks for — those seed campaigns, so a false gap opens a page against
      // the site's own best asset.
      siteId: site?.id || siteId || undefined,
    })

    const analysisRun = await createAnalysisRun({
      site_id: site?.id || siteId || undefined,
      status: 'completed',
      input: {
        siteUrl: targetUrl,
        businessType,
        businessName,
        targetCities: Array.isArray(targetCities) ? targetCities : splitList(targetCities),
        competitorUrls: normalizeCompetitorUrls(competitorUrls),
      },
      analysis_data: analysisData,
    })

    return NextResponse.json({ success: true, analysisRun })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur analyse' },
      { status: 500 }
    )
  }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`
}

function splitList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function normalizeCompetitorUrls(value: unknown) {
  return splitList(value).slice(0, 5).map(normalizeUrl)
}


