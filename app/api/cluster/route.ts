import { NextRequest, NextResponse } from 'next/server'
import { generateCluster } from '@/lib/ai/cluster'
import { createGeneration, getSiteContext } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      mainKeyword,
      satelliteKeywords,
      businessType,
      businessName,
      city,
      department = 'Aube',
      siteUrl,
      siteId,
      campaignId,
      model = 'gpt-4o',
      targetLength = 800,
      enableAlternatives = true,
      enableComparatives = true,
      enableLocalPack = true,
      competitorNames = [],
      alternativeNames = [],
    } = body

    if (!mainKeyword || !Array.isArray(satelliteKeywords) || satelliteKeywords.length === 0 || !businessType || !businessName || !city || !siteUrl) {
      return NextResponse.json({ error: 'Parametres cluster incomplets.' }, { status: 400 })
    }

    // Fetch existing site context for deduplication
    let existingContext: Awaited<ReturnType<typeof getSiteContext>> | null = null
    if (siteId) {
      existingContext = await getSiteContext(siteId).catch(() => null)
    }

    const cluster = await generateCluster({
      mainKeyword,
      satelliteKeywords,
      businessType,
      businessName,
      city,
      department,
      siteUrl,
      model,
      targetLength,
      enableAlternatives,
      enableComparatives,
      enableLocalPack,
      competitorNames,
      alternativeNames,
      existingSlugs: existingContext?.usedSlugs || [],
      existingKeywords: existingContext?.usedKeywords || [],
    })

    // Save all pages to database (skip duplicates)
    const allPages = [
      { page: cluster.pillarPage, type: 'pillar', model: 'gpt-4o' },
      ...cluster.satellitePages.map(p => ({ page: p, type: 'child', model: 'gpt-4o-mini' })),
      ...cluster.alternativePages.map(p => ({ page: p, type: 'alternative', model: 'gpt-4o-mini' })),
      ...cluster.comparativePages.map(p => ({ page: p, type: 'comparative', model: 'gpt-4o-mini' })),
      ...(cluster.localPackPage ? [{ page: cluster.localPackPage, type: 'local_pack', model: 'gpt-4o-mini' }] : []),
    ]

    const records = []
    const skipped: string[] = []

    for (const { page, type, model: aiModel } of allPages) {
      // Check for duplicate slug
      const slug = page.slug?.replace(/^\//, '')
      if (slug && existingContext?.usedSlugs.includes(slug)) {
        skipped.push(`${slug} (slug existe déjà)`)
        continue
      }

      try {
        const record = await createGeneration({
          campaign_id: campaignId || null,
          site_id: siteId || null,
          city,
          slug: page.slug,
          title: page.title,
          meta_description: page.metaDescription,
          focus_keyword: page.focusKeyword,
          content: page.htmlContent,
          page_type: type as 'pillar' | 'child' | 'alternative' | 'comparative' | 'local_pack',
          status: 'generated',
          ai_model: aiModel,
        })
        records.push(record)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('unique') || msg.includes('duplicate')) {
          skipped.push(`${page.slug} (doublon BDD)`)
        } else {
          throw e
        }
      }
    }

    return NextResponse.json({
      success: true,
      cluster,
      progress: {
        total: allPages.length,
        saved: records.length,
        skipped: skipped.length,
        skippedDetails: skipped,
        generationIds: records.map((record) => record.id),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
