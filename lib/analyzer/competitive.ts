import { crawlWebsite, type CrawledPage, type CrawlResult } from './crawler'
import { generateJson } from '@/lib/ai/provider'
import type { AnalysisRunData } from '@/lib/types'

export interface CompetitiveAnalysisOptions {
  siteCrawl: CrawlResult
  competitorUrls: string[]
  businessType?: string
  businessName?: string
  targetCities?: string[]
}

export async function analyzeCompetitors(opts: CompetitiveAnalysisOptions): Promise<AnalysisRunData> {
  const competitorUrls = normalizeCompetitorUrls(opts.competitorUrls).slice(0, 5)
  const competitors: AnalysisRunData['competitors'] = []

  for (const url of competitorUrls) {
    try {
      const crawl = await crawlWebsite({ siteUrl: url, maxPages: 10, followLinks: true })
      competitors.push({
        url: crawl.siteUrl,
        pagesFound: crawl.totalPages,
        pagesCrawled: crawl.pages.length,
        topKeywords: topKeywords(crawl.pages),
        pages: summarizePages(crawl.pages),
        strengths: detectStrengths(crawl.pages),
      })
    } catch (error) {
      competitors.push({
        url,
        pagesFound: 0,
        pagesCrawled: 0,
        topKeywords: [],
        pages: [],
        strengths: [],
        errors: [error instanceof Error ? error.message : 'Crawl concurrent impossible'],
      })
    }
  }

  const siteData: AnalysisRunData['site'] = {
    url: opts.siteCrawl.siteUrl,
    pagesFound: opts.siteCrawl.totalPages,
    pagesCrawled: opts.siteCrawl.pages.length,
    topKeywords: topKeywords(opts.siteCrawl.pages),
    pages: summarizePages(opts.siteCrawl.pages),
  }

  const gapAnalysis = await buildGapAnalysisWithAI({
    sitePages: opts.siteCrawl.pages,
    siteData,
    competitors,
    businessType: opts.businessType,
    businessName: opts.businessName,
    targetCities: opts.targetCities,
  })

  return { site: siteData, competitors, gapAnalysis }
}

export function summarizePages(pages: CrawledPage[]): AnalysisRunData['site']['pages'] {
  return pages.slice(0, 30).map((page) => ({
    path: page.path,
    title: page.title,
    h1: page.h1,
    wordCount: page.wordCount,
    keywords: page.keywords.slice(0, 8),
    hasFaq: page.hasFaq,
    hasSchema: page.hasSchema,
    geoSignals: page.geoSignals.slice(0, 5),
  }))
}

function normalizeCompetitorUrls(urls: string[]) {
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => url.startsWith('http') ? url : `https://${url}`)
}

function topKeywords(pages: CrawledPage[]) {
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const keyword of page.keywords) {
      const normalized = keyword.toLowerCase()
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([keyword]) => keyword)
}

function detectStrengths(pages: CrawledPage[]) {
  const strengths: string[] = []
  if (pages.some((page) => page.hasFaq)) strengths.push('FAQ presente sur au moins une page')
  if (pages.some((page) => page.hasSchema)) strengths.push('Schema.org present')
  if (pages.some((page) => page.hasLocalBusiness)) strengths.push('Signaux LocalBusiness presents')
  if (pages.some((page) => page.wordCount >= 1200)) strengths.push('Contenus longs detectes')
  if (pages.some((page) => page.internalLinks.length >= 8)) strengths.push('Maillage interne dense')
  return strengths
}

interface GapAnalysisInput {
  sitePages: CrawledPage[]
  siteData: AnalysisRunData['site']
  competitors: AnalysisRunData['competitors']
  businessType?: string
  businessName?: string
  targetCities?: string[]
}

async function buildGapAnalysisWithAI(input: GapAnalysisInput): Promise<AnalysisRunData['gapAnalysis']> {
  const { sitePages, siteData, competitors, businessType, businessName, targetCities } = input

  const siteSummary = siteData.pages.slice(0, 20).map((p) => `- ${p.path}: "${p.title}" (${p.wordCount} mots, kw: ${p.keywords.slice(0, 3).join(', ')})`).join('\n')
  const competitorSummary = competitors.map((c) => {
    const pages = c.pages.slice(0, 10).map((p) => `  - "${p.title}" (${p.wordCount} mots)`).join('\n')
    return `${c.url} (${c.pagesCrawled} pages):\n  Keywords: ${c.topKeywords.slice(0, 10).join(', ')}\n  Forces: ${c.strengths.join(', ')}\n${pages}`
  }).join('\n\n')

  const siteHasFaq = sitePages.some((p) => p.hasFaq)
  const siteHasSchema = sitePages.some((p) => p.hasSchema)
  const competitorPages = competitors.flatMap((c) => c.pages)
  const localSignals = [...new Set(competitorPages.flatMap((p) => p.geoSignals))].slice(0, 12)

  const prompt = `Analyse SEO concurrentielle pour un site de type "${businessType || 'service local'}" (${businessName || 'non specifie'}).
Villes cibles: ${targetCities?.join(', ') || 'non precisees'}

## PAGES DU SITE ANALYSE:
${siteSummary}

## CONCURRENTS:
${competitorSummary}

## CONTEXTE TECHNIQUE:
- Site a FAQ: ${siteHasFaq ? 'oui' : 'non'}
- Site a Schema.org: ${siteHasSchema ? 'oui' : 'non'}
- Signaux geo concurrents: ${localSignals.join(', ') || 'aucun'}

## CONSIGNES:
Analyse les gaps entre le site et ses concurrents. Identifie:
1. Les mots-cles/expressions SEO que les concurrents ciblent mais PAS le site (expressions de 2-4 mots pertinentes pour le business, pas des mots generiques)
2. Les angles de contenu exploitables (types de pages manquantes, sujets non couverts)
3. Les opportunites locales specifiques

Reponds en JSON avec cette structure exacte:
{
  "missingKeywords": ["expression 2-4 mots pertinente", ...], (max 20, uniquement des expressions utiles pour le SEO local)
  "suggestedAngles": ["description actionnable d'un angle de contenu", ...], (max 12, des idees precises de pages a creer)
  "contentPatterns": ["observation sur les patterns de contenu des concurrents", ...], (max 5)
  "technicalGaps": ["gap technique a combler", ...], (max 5)
  "localOpportunities": ["opportunite locale specifique", ...] (max 10)
}`

  try {
    const raw = await generateJson({
      systemPrompt: 'Tu es un consultant SEO senior specialise en SEO local. Tu analyses les gaps concurrentiels et proposes des recommandations actionnables. Reponds UNIQUEMENT en JSON valide.',
      userPrompt: prompt,
      model: 'gpt-4o-mini',
      maxTokens: 2000,
      temperature: 0.4,
    })

    const parsed = JSON.parse(raw) as Partial<AnalysisRunData['gapAnalysis']>
    return {
      missingKeywords: (parsed.missingKeywords || []).slice(0, 30),
      suggestedAngles: (parsed.suggestedAngles || []).slice(0, 12),
      contentPatterns: (parsed.contentPatterns || []).slice(0, 5),
      technicalGaps: (parsed.technicalGaps || []).slice(0, 5),
      localOpportunities: (parsed.localOpportunities || localSignals).slice(0, 12),
    }
  } catch {
    return buildGapAnalysisFallback(sitePages, competitors, localSignals, siteHasFaq, siteHasSchema)
  }
}

function buildGapAnalysisFallback(
  sitePages: CrawledPage[],
  competitors: AnalysisRunData['competitors'],
  localSignals: string[],
  siteHasFaq: boolean,
  siteHasSchema: boolean
): AnalysisRunData['gapAnalysis'] {
  const siteKeywords = new Set(topKeywords(sitePages))
  const competitorKeywords = new Set(competitors.flatMap((c) => c.topKeywords))
  const missingKeywords = [...competitorKeywords].filter((k) => !siteKeywords.has(k)).slice(0, 30)
  const competitorPages = competitors.flatMap((c) => c.pages)
  const competitorsUseFaq = competitorPages.some((p) => p.hasFaq)
  const competitorsUseSchema = competitorPages.some((p) => p.hasSchema)

  return {
    missingKeywords,
    contentPatterns: [
      competitorPages.some((p) => p.wordCount >= 1200) ? 'Concurrents avec contenus longs (>1200 mots)' : '',
      competitorPages.some((p) => /tarif|prix|devis/i.test(`${p.title} ${p.h1}`)) ? 'Pages tarifaires chez les concurrents' : '',
    ].filter(Boolean),
    localOpportunities: localSignals,
    technicalGaps: [
      !siteHasFaq && competitorsUseFaq ? 'FAQ absente (presente chez concurrents)' : '',
      !siteHasSchema && competitorsUseSchema ? 'Schema.org a ajouter' : '',
    ].filter(Boolean),
    suggestedAngles: missingKeywords.filter((k) => k.includes(' ')).slice(0, 8),
  }
}
