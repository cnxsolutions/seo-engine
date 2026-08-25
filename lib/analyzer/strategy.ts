/**
 * SEO Strategy Generator — analyzes crawl results and produces a complete content plan.
 * Uses AI to identify gaps, opportunities, and generate a tailored strategy.
 */

import { generateJson } from '@/lib/ai/provider'
import { getGscPlanningSignals, type GscPlanningSignals } from '@/lib/google/performance'
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
  /**
   * When given, the strategy is confronted with the site's real Search Console
   * data instead of being deduced from the crawl alone. A crawl says what the
   * site contains; only Search Console says what it obtains.
   */
  siteId?: string
  /** Pre-loaded signals; skips the read when the caller already has them. */
  gscSignals?: GscPlanningSignals | null
}

export async function generateSeoStrategy(opts: GenerateStrategyOptions): Promise<SeoStrategy> {
  const { crawlResult, businessType, businessName, targetCities, model = 'gpt-4o' } = opts

  const analysis = analyzeLocally(crawlResult)
  const signals = await resolveSignals(opts)

  const systemPrompt = `Tu es un consultant SEO senior avec 15 ans d'experience en strategie de contenu, SEO local et maillage interne.
Tu analyses des sites web et produis des strategies de contenu actionnables et priorisees.
Tu connais parfaitement les strategies pilier/fille, les pages comparatives, alternatives, et le local pack Google.
Reponds UNIQUEMENT en JSON valide.`

  const userPrompt = buildStrategyPrompt(crawlResult, analysis, { businessType, businessName, targetCities, signals })

  const raw = await generateJson({
    systemPrompt,
    userPrompt,
    model,
    maxTokens: 8000,
    temperature: 0.5,
  })

  try {
    const parsed = JSON.parse(raw) as Partial<SeoStrategy>
    return normalizeStrategy(parsed, analysis, signals)
  } catch {
    throw new Error('Erreur lors de la generation de la strategie SEO (JSON invalide)')
  }
}

async function resolveSignals(opts: GenerateStrategyOptions): Promise<GscPlanningSignals | null> {
  const provided = opts.gscSignals !== undefined
    ? opts.gscSignals
    : opts.siteId
      ? await getGscPlanningSignals(opts.siteId).catch(() => null)
      : null

  return provided && provided.available ? provided : null
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
  opts: { businessType?: string; businessName?: string; targetCities?: string[]; signals: GscPlanningSignals | null }
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
${buildSearchConsoleSection(opts.signals)}
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
8. Si une section "PERFORMANCE REELLE" est presente, elle prime sur le crawl : ce que Google
   montre deja du site vaut plus qu'une deduction faite sur son HTML.
`.trim()
}

/**
 * What the site obtains, next to what it contains.
 *
 * Empty when no Search Console history exists, so a new site produces exactly
 * the strategy prompt it produced before.
 */
function buildSearchConsoleSection(signals: GscPlanningSignals | null): string {
  if (!signals) return ''

  const lines: string[] = [
    '',
    `## PERFORMANCE REELLE (Search Console, ${signals.windowStart} -> ${signals.windowEnd})`,
  ]

  if (signals.strikingDistance.length > 0) {
    lines.push(
      'Requetes en position 5-20 (a renforcer avant toute nouvelle page):',
      ...signals.strikingDistance.slice(0, 12).map((o) => `- "${o.query}" pos. ${o.position}, ${o.impressions} impressions -> ${o.pageUrl}`)
    )
  }

  if (signals.lowCtrPages.length > 0) {
    lines.push(
      'Pages a fort affichage et faible CTR (reecrire title/meta, ne pas reecrire le contenu):',
      ...signals.lowCtrPages.slice(0, 8).map((p) => `- ${p.pageUrl} : ${p.impressions} impressions, CTR ${(p.ctr * 100).toFixed(2)}%, pos. ${p.position}`)
    )
  }

  if (signals.cannibalized.length > 0) {
    lines.push(
      'Cannibalisation interne (consolider, ne pas ajouter):',
      ...signals.cannibalized.slice(0, 8).map((c) => `- "${c.query}" : ${c.pages.length} pages du site en concurrence, garder ${c.winner}`)
    )
  }

  if (signals.deadPages.length > 0) {
    lines.push(`Pages sans aucune impression apres 30 jours: ${signals.deadPages.length} (sujets a abandonner)`)
  }

  return lines.length > 2 ? `${lines.join('\n')}\n` : ''
}

function normalizeStrategy(
  parsed: Partial<SeoStrategy>,
  analysis: LocalAnalysis,
  signals: GscPlanningSignals | null
): SeoStrategy {
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
    // Measured quick wins first: they are the only items on this list backed by
    // an observed impression count rather than by the model's judgement.
    quickWins: [...measuredQuickWins(signals), ...(parsed.quickWins || [])].slice(0, 8),
  }
}

function measuredQuickWins(signals: GscPlanningSignals | null): string[] {
  if (!signals) return []

  const wins: string[] = []

  for (const opportunity of signals.strikingDistance.slice(0, 2)) {
    wins.push(
      `Renforcer ${opportunity.pageUrl} sur "${opportunity.query}" : position ${opportunity.position} pour ${opportunity.impressions} impressions, le top 3 est a portee.`
    )
  }

  for (const page of signals.lowCtrPages.slice(0, 2)) {
    wins.push(
      `Reecrire le title et la meta description de ${page.pageUrl} : ${page.impressions} affichages pour un CTR de ${(page.ctr * 100).toFixed(2)}% en position ${page.position}.`
    )
  }

  if (signals.cannibalized.length > 0) {
    const first = signals.cannibalized[0]
    wins.push(
      `Consolider les ${first.pages.length} pages qui se disputent "${first.query}" vers ${first.winner} (liens internes, canonique ou fusion).`
    )
  }

  return wins
}
