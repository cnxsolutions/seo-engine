import { NextRequest, NextResponse } from 'next/server'
import { analyzeCompetitors } from '@/lib/analyzer/competitive'
import { crawlWebsite, type CrawledPage, type CrawlResult } from '@/lib/analyzer/crawler'
import { createAnalysisRun, getSiteById, upsertSitePages } from '@/lib/db'

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
      await upsertSitePages(site.id, toSitePagePayload(site.id, siteCrawl) as Parameters<typeof upsertSitePages>[1]).catch(() => null)
    }

    const analysisData = await analyzeCompetitors({
      siteCrawl,
      competitorUrls: Array.isArray(competitorUrls) ? competitorUrls : String(competitorUrls).split('\n'),
      businessType,
      businessName,
      targetCities: Array.isArray(targetCities) ? targetCities : splitList(targetCities),
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

function toSitePagePayload(siteId: string, crawlResult: CrawlResult) {
  return crawlResult.pages.map((page: CrawledPage) => ({
    site_id: siteId,
    url: page.url,
    path: page.path,
    title: page.title || null,
    meta_description: page.metaDescription || null,
    h1: page.h1 || null,
    h2s: page.h2s,
    word_count: page.wordCount,
    focus_keyword: page.keywords[0] || null,
    keywords: page.keywords,
    internal_links: page.internalLinks.slice(0, 20),
    external_links: page.externalLinks.slice(0, 10),
    has_schema: page.hasSchema,
    schema_types: page.schemaTypes,
    has_faq: page.hasFaq,
    has_local_business: page.hasLocalBusiness,
    geo_signals: page.geoSignals,
    crawled_at: crawlResult.crawledAt,
  }))
}
