import { NextRequest, NextResponse } from 'next/server'
import { crawlWebsite } from '@/lib/analyzer/crawler'
import { generateSeoStrategy } from '@/lib/analyzer/strategy'
import { upsertSitePages } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { siteUrl, siteId, businessType, businessName, targetCities, maxPages = 30, model = 'gpt-4o' } = body

    if (!siteUrl) {
      return NextResponse.json({ error: 'siteUrl requis' }, { status: 400 })
    }

    // Normalize URL
    let normalizedUrl = siteUrl.trim()
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    // Step 1: Crawl the website
    const crawlResult = await crawlWebsite({
      siteUrl: normalizedUrl,
      maxPages: Math.min(maxPages, 50),
      followLinks: true,
    })

    if (crawlResult.pages.length === 0) {
      return NextResponse.json(
        { error: 'Impossible de crawler le site. Verifiez l\'URL et que le site est accessible.' },
        { status: 422 }
      )
    }

    // Step 2: Save crawled pages to database if site is linked
    if (siteId) {
      const sitePages = crawlResult.pages.map(page => ({
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

      await upsertSitePages(siteId, sitePages as Parameters<typeof upsertSitePages>[1]).catch(() => null)
    }

    // Step 3: Generate SEO strategy
    const strategy = await generateSeoStrategy({
      crawlResult,
      businessType,
      businessName,
      targetCities: targetCities ? (Array.isArray(targetCities) ? targetCities : [targetCities]) : undefined,
      model,
    })

    return NextResponse.json({
      success: true,
      crawl: {
        pagesFound: crawlResult.totalPages,
        pagesCrawled: crawlResult.pages.length,
        sitemapUrls: crawlResult.sitemap.length,
        crawledAt: crawlResult.crawledAt,
        pages: crawlResult.pages.map(p => ({
          path: p.path,
          title: p.title,
          metaDescription: p.metaDescription,
          h1: p.h1,
          wordCount: p.wordCount,
          keywords: p.keywords.slice(0, 5),
          hasSchema: p.hasSchema,
          hasFaq: p.hasFaq,
        })),
      },
      strategy,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur lors de l\'analyse' },
      { status: 500 }
    )
  }
}
