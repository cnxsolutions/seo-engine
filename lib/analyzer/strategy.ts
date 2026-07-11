/**
 * SEO Strategy Generator — analyzes crawl results and produces a complete content plan.
 * Uses AI to identify gaps, opportunities, and generate a tailored strategy.
 */

import { generateJson } from '@/lib/ai/provider'
import type { CrawlResult } from './crawler'
import type { PageType } from '@/lib/types'

export interface SeoAudit {
  strengths: string[]
  weaknesses: string[]
  opportunities: string[]
  threats: string[]
  scores: {
    technical: number
    content: number
    localSeo: number
    linking: number
    overall: number
  }
}

export interface ContentPlanItem {
  pageType: PageType
  title: string
  targetKeyword: string
  secondaryKeywords: string[]
  targetCity?: string
  parentSlug?: string
  priority: 'high' | 'medium' | 'low'
  estimatedImpact: string
  rationale: string
}

export interface SeoStrategy {
  audit: SeoAudit
  businessProfile: {
    detectedType: string
    detectedName: string
    detectedCities: string[]
    detectedServices: string[]
    competitors: string[]
  }
  contentPlan: ContentPlanItem[]
  clusterMap: Array<{
    pillar: ContentPlanItem
    children: ContentPlanItem[]
  }>
  schedule: {
    recommendedFrequency: string
    totalPages: number
    estimatedDuration: string
    phasedPlan: Array<{
      phase: string
      weeks: string
      pages: number
      focus: string
    }>
  }
  quickWins: string[]
}

export interface GenerateStrategyOptions {
  crawlResult: CrawlResult
  businessType?: string
  businessName?: string
  targetCities?: string[]
  model?: string
}

export async function generateSeoStrategy(opts: GenerateStrategyOptions): Promise<SeoStrategy> {
  const { crawlResult, businessType, businessName, targetCities, model = 'gpt-4o' } = opts

  const analysis = analyzeLocally(crawlResult)

  const systemPrompt = `Tu es un consultant SEO senior avec 15 ans d'experience en strategie de contenu, SEO local et maillage interne.
Tu analyses des sites web et produis des strategies de contenu actionnables et priorisees.
Tu connais parfaitement les strategies pilier/fille, les pages comparatives, alternatives, et le local pack Google.
Reponds UNIQUEMENT en JSON valide.`

  const userPrompt = buildStrategyPrompt(crawlResult, analysis, { businessType, businessName, targetCities })

  const raw = await generateJson({
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 8000,
    temperature: 0.5,
  })

  try {
    const parsed = JSON.parse(raw) as Partial<SeoStrategy>
    return normalizeStrategy(parsed, analysis)
  } catch {
    throw new Error('Erreur lors de la generation de la strategie SEO (JSON invalide)')
  }
}

interface LocalAnalysis {
  existingTopics: string[]
  existingCities: string[]
  avgWordCount: number
  hasLocalSeo: boolean
  hasSchema: boolean
  hasFaq: boolean
  internalLinkDensity: number
  missingElements: string[]
  topKeywords: string[]
  pageCount: number
  thinPages: number
  orphanPages: number
}

function analyzeLocally(crawl: CrawlResult): LocalAnalysis {
  const pages = crawl.pages
  const existingTopics: Set<string> = new Set()
  const existingCities: Set<string> = new Set()
  let totalWordCount = 0
  let localSeoCount = 0
  let schemaCount = 0
  let faqCount = 0
  let totalInternalLinks = 0
  let thinPages = 0

  const allInternalLinks = new Set<string>()

  for (const page of pages) {
    totalWordCount += page.wordCount
    if (page.hasLocalBusiness) localSeoCount++
    if (page.hasSchema) schemaCount++
    if (page.hasFaq) faqCount++
    totalInternalLinks += page.internalLinks.length

    if (page.wordCount < 300) thinPages++

    page.keywords.forEach((kw) => existingTopics.add(kw))
    page.geoSignals.forEach((geo) => existingCities.add(geo))
    page.internalLinks.forEach((link) => allInternalLinks.add(link))
  }

  // Orphan pages: pages that no other page links to
  const linkedUrls = allInternalLinks
  const orphanPages = pages.filter((p) => !linkedUrls.has(p.url) && p.path !== '/').length

  const missingElements: string[] = []
  if (localSeoCount === 0) missingElements.push('Schema LocalBusiness absent')
  if (faqCount === 0) missingElements.push('Aucune page avec FAQ structuree')
  if (thinPages > pages.length * 0.3) missingElements.push('Trop de pages fines (< 300 mots)')
  if (schemaCount < pages.length * 0.5) missingElements.push('Schema.org absent sur la majorite des pages')
  if (orphanPages > 3) missingElements.push(`${orphanPages} pages orphelines (pas de lien interne entrant)`)

  const allKeywords: Map<string, number> = new Map()
  for (const page of pages) {
    for (const kw of page.keywords) {
      allKeywords.set(kw, (allKeywords.get(kw) || 0) + 1)
    }
  }
  const topKeywords = [...allKeywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([kw]) => kw)

  return {
    existingTopics: [...existingTopics].slice(0, 30),
    existingCities: [...existingCities].slice(0, 10),
    avgWordCount: pages.length > 0 ? Math.round(totalWordCount / pages.length) : 0,
    hasLocalSeo: localSeoCount > 0,
    hasSchema: schemaCount > 0,
    hasFaq: faqCount > 0,
    internalLinkDensity: pages.length > 0 ? Math.round(totalInternalLinks / pages.length) : 0,
    missingElements,
    topKeywords,
    pageCount: pages.length,
    thinPages,
    orphanPages,
  }
}

function buildStrategyPrompt(
  crawl: CrawlResult,
  analysis: LocalAnalysis,
  opts: { businessType?: string; businessName?: string; targetCities?: string[] }
): string {
  const pageSummaries = crawl.pages.slice(0, 25).map((p) => ({
    path: p.path,
    title: p.title.slice(0, 80),
    h1: p.h1.slice(0, 60),
    wordCount: p.wordCount,
    hasSchema: p.hasSchema,
    hasFaq: p.hasFaq,
    h2Count: p.h2s.length,
    internalLinks: p.internalLinks.length,
    geoSignals: p.geoSignals.slice(0, 3),
  }))

  return `
Analyse ce site web et genere une strategie SEO complete.

## Informations du site
- URL: ${crawl.siteUrl}
- Pages indexees: ${crawl.totalPages}
- Pages crawlees: ${crawl.pages.length}
${opts.businessType ? `- Type d'activite: ${opts.businessType}` : '- Type d\'activite: A DETECTER depuis le contenu'}
${opts.businessName ? `- Nom du business: ${opts.businessName}` : '- Nom du business: A DETECTER'}
${opts.targetCities?.length ? `- Villes cibles: ${opts.targetCities.join(', ')}` : '- Villes cibles: A DETECTER depuis les signaux geo'}

## Analyse technique
- Nombre total de pages: ${analysis.pageCount}
- Longueur moyenne du contenu: ${analysis.avgWordCount} mots
- Pages fines (< 300 mots): ${analysis.thinPages}
- Pages orphelines: ${analysis.orphanPages}
- Densite moyenne de liens internes: ${analysis.internalLinkDensity} liens/page
- Schema.org present: ${analysis.hasSchema ? 'Oui (partiel)' : 'Non'}
- LocalBusiness: ${analysis.hasLocalSeo ? 'Oui' : 'Non'}
- FAQ structuree: ${analysis.hasFaq ? 'Oui' : 'Non'}
- Problemes detectes: ${analysis.missingElements.join(', ') || 'Aucun critique'}

## Mots-cles existants (top)
${analysis.topKeywords.join(', ')}

## Villes/signaux geo detectes
${analysis.existingCities.join(', ') || 'Aucun signal geo detecte'}

## Pages crawlees (echantillon)
${JSON.stringify(pageSummaries, null, 1)}

## GENERE en JSON:
{
  "audit": {
    "strengths": ["string - max 5"],
    "weaknesses": ["string - max 5"],
    "opportunities": ["string - max 5"],
    "threats": ["string - max 3"],
    "scores": {
      "technical": 0-100,
      "content": 0-100,
      "localSeo": 0-100,
      "linking": 0-100,
      "overall": 0-100
    }
  },
  "businessProfile": {
    "detectedType": "type d'activite detecte",
    "detectedName": "nom detecte",
    "detectedCities": ["villes detectees ou suggerees"],
    "detectedServices": ["services/prestations detectes"],
    "competitors": ["concurrents probables sur cette thematique locale"]
  },
  "contentPlan": [
    {
      "pageType": "pillar|child|alternative|comparative|local_pack",
      "title": "titre SEO propose",
      "targetKeyword": "mot-cle focus",
      "secondaryKeywords": ["mots-cles secondaires"],
      "targetCity": "ville cible ou null",
      "parentSlug": "slug du pilier parent ou null",
      "priority": "high|medium|low",
      "estimatedImpact": "pourquoi cette page est importante",
      "rationale": "justification SEO"
    }
  ],
  "clusterMap": [
    {
      "pillar": { ... meme format que contentPlan item ... },
      "children": [ ... pages filles associees ... ]
    }
  ],
  "schedule": {
    "recommendedFrequency": "every_2_days|daily|every_3_days|weekly",
    "totalPages": nombre,
    "estimatedDuration": "X semaines",
    "phasedPlan": [
      {
        "phase": "Phase 1 - Quick Wins",
        "weeks": "Semaines 1-2",
        "pages": nombre,
        "focus": "description du focus"
      }
    ]
  },
  "quickWins": ["actions rapides a fort impact - max 5"]
}

REGLES:
1. Le contentPlan doit avoir entre 15 et 40 pages, priorisees par impact SEO.
2. Commencer par les pages Local Pack (rankent vite) et les piliers (autorite topique).
3. Chaque cluster a 1 pilier + 3 a 5 pages filles.
4. Inclure au moins 2 pages alternatives et 2 pages comparatives si pertinent.
5. Les villes cibles doivent couvrir la zone d'activite detectee.
6. Le planning doit etre realiste (pas plus de 1 page/jour en rythme de croisiere).
7. Les quick wins sont des actions faisables en < 1 semaine avec impact mesurable.
`.trim()
}

function normalizeStrategy(parsed: Partial<SeoStrategy>, analysis: LocalAnalysis): SeoStrategy {
  return {
    audit: parsed.audit || {
      strengths: [],
      weaknesses: analysis.missingElements,
      opportunities: [],
      threats: [],
      scores: { technical: 50, content: 50, localSeo: 30, linking: 40, overall: 42 },
    },
    businessProfile: parsed.businessProfile || {
      detectedType: 'Non detecte',
      detectedName: 'Non detecte',
      detectedCities: analysis.existingCities,
      detectedServices: [],
      competitors: [],
    },
    contentPlan: parsed.contentPlan || [],
    clusterMap: parsed.clusterMap || [],
    schedule: parsed.schedule || {
      recommendedFrequency: 'every_2_days',
      totalPages: 20,
      estimatedDuration: '6 semaines',
      phasedPlan: [],
    },
    quickWins: parsed.quickWins || [],
  }
}
