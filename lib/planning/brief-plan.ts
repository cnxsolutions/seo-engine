import { buildPageSlug } from '@/lib/seo/slug'
import { DEFAULT_PLANNING_MODEL, generateJson } from '@/lib/ai/provider'
import {
  getGscPlanningSignals,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
  type GscPlanningSignals,
  type StrikingDistanceOpportunity,
} from '@/lib/google/performance'
import { buildSerpEvidence, type SerpEvidence } from '@/lib/serp'
import { getSiteContext } from '@/lib/db'
import { generateEditorialCalendar } from '@/lib/scheduler/editorial'
import type { AnalysisRun, Campaign, PageType, PlanItemBrief } from '@/lib/types'

export interface GenerateBriefPlanOptions {
  campaign: Campaign
  cycleDays: number
  analysisRun?: AnalysisRun | null
  existingSlugs?: string[]
  existingKeywords?: string[]
  /**
   * Search Console signals for the site. Loaded from the site when omitted;
   * pass `null` to plan blind on purpose (tests, sites with no Google account).
   */
  gscSignals?: GscPlanningSignals | null
  /**
   * What the pages currently ranking for this campaign's queries actually look
   * like. Read from the SERP when omitted; pass `null` or `[]` to plan without
   * it (tests, offline runs, or when the result markup has moved).
   */
  serpEvidence?: SerpEvidence[] | null
}

/**
 * Root queries read per plan.
 *
 * One SERP per slot would mean ~30 searches and ~150 competitor page fetches for
 * a single cycle preview — disproportionate for what it adds, since the pages
 * ranking for "plombier troyes" and "plombier troyes urgence" share their
 * structure. Reading the campaign's root queries characterises the whole cluster
 * at a twentieth of the cost.
 */
const SERP_QUERIES_PER_PLAN = 5

export interface BriefPlanResult {
  items: PlanItemBrief[]
  /**
   * null when the site has no usable Search Console history — a first cycle, or
   * a site that was never connected. The plan was then built exactly as before.
   */
  signals: GscPlanningSignals | null
  /**
   * Empty when no SERP could be read. Distinguishing "measured" from "guessed"
   * matters: a caller that reports plan quality must not present a blind plan as
   * an informed one.
   */
  serpEvidence: SerpEvidence[]
}

export async function generateBriefPlan(opts: GenerateBriefPlanOptions): Promise<PlanItemBrief[]> {
  const result = await generateBriefPlanWithSignals(opts)
  return result.items
}

/**
 * Same plan, plus what the real performance data said about the previous cycle.
 *
 * The engine used to plan the cycle N+1 knowing nothing of what cycle N
 * produced: volume without measurement. When Search Console data exists, three
 * facts now steer the plan — queries already ranking 5 to 20 (the cheapest
 * traffic available), pages seen and never clicked (a title problem, not a
 * content problem), and subjects that got zero impression after 30 days (stop
 * insisting). When it does not, nothing changes.
 */
export async function generateBriefPlanWithSignals(opts: GenerateBriefPlanOptions): Promise<BriefPlanResult> {
  const { campaign, cycleDays, analysisRun } = opts
  let existingSlugs = opts.existingSlugs || []
  let existingKeywords = opts.existingKeywords || []

  if ((!opts.existingSlugs || !opts.existingKeywords) && campaign.site_id) {
    const context = await getSiteContext(campaign.site_id).catch(() => null)
    if (context) {
      existingSlugs = opts.existingSlugs || context.usedSlugs
      existingKeywords = opts.existingKeywords || context.usedKeywords
    }
  }

  const signals = await resolveSignals(opts)
  const serpEvidence = await resolveSerpEvidence(opts)

  const frequency = campaign.schedule_frequency || 'daily'
  const frequencyDays: Record<string, number> = {
    manual: 1,
    daily: 1,
    every_2_days: 2,
    every_3_days: 3,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    custom: 1,
  }
  const intervalDays = frequencyDays[frequency] || 1
  const slotCount = Math.min(Math.floor(cycleDays / intervalDays), 60)

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const calendarSlots = generateEditorialCalendar({
    campaign,
    startDate: tomorrow,
    slotCount,
  })

  if (calendarSlots.length === 0) return { items: [], signals, serpEvidence }

  // Aligned with calendarSlots: the highest-potential opportunities go to the
  // earliest dates, because a cycle publishes in date order.
  const opportunities = assignOpportunities(calendarSlots.length, signals)

  console.log(
    `[plan] redaction des briefs : ${calendarSlots.length} creneaux, modele ${DEFAULT_PLANNING_MODEL}` +
      `${signals ? ' + signaux Search Console' : ' (aucun historique Search Console)'}` +
      `${serpEvidence.length ? ` + ${serpEvidence.length} SERP mesurees` : ''}`
  )

  const raw = await generateJson({
    systemPrompt: `Tu es un stratege SEO senior. Tu crees uniquement des briefs editoriaux exploitables par une IA de redaction plus tard.
Tu ne rediges jamais la page, tu ne fournis jamais de HTML, et tu reponds uniquement en JSON valide.`,
    userPrompt: buildPrompt({ campaign, analysisRun, existingSlugs, existingKeywords, calendarSlots, signals, opportunities, serpEvidence }),
    model: DEFAULT_PLANNING_MODEL,
    maxTokens: 7000,
    temperature: 0.45,
  })

  try {
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : parsed.items || parsed.plan || []
    return { items: normalizeBriefs(items, calendarSlots, campaign, signals, opportunities), signals, serpEvidence }
  } catch {
    return { items: fallbackBriefs(calendarSlots, campaign, signals, opportunities), signals, serpEvidence }
  }
}

/**
 * Read the SERP for the campaign's root queries.
 *
 * Never throws and never blocks a plan: every failure mode of lib/serp — a
 * changed markup, a rate limit, no network — collapses to an empty array, and
 * the prompt then omits the section entirely rather than claiming measurements
 * it does not have.
 */
async function resolveSerpEvidence(opts: GenerateBriefPlanOptions): Promise<SerpEvidence[]> {
  if (opts.serpEvidence !== undefined) return opts.serpEvidence ?? []

  const { campaign } = opts
  const city = campaign.communes[0] || campaign.department || ''
  const siteHost = hostOfSite(campaign.site?.url)

  const queries = dedupe(
    campaign.keywords
      .map((keyword) => (city && !keyword.toLowerCase().includes(city.toLowerCase()) ? `${keyword} ${city}` : keyword))
      .map((query) => query.trim())
      .filter(Boolean)
  ).slice(0, SERP_QUERIES_PER_PLAN)

  if (queries.length === 0) return []

  const evidence: SerpEvidence[] = []
  console.log(`[plan] lecture SERP : ${queries.length} requetes racines (~4s d'intervalle, puis crawl des concurrents)`)

  // Sequential on purpose: lib/serp serialises its own fetches anyway, and this
  // keeps competitor crawling from fanning out across queries at the same time.
  for (const [index, query] of queries.entries()) {
    const position = `${index + 1}/${queries.length}`
    try {
      const result = await buildSerpEvidence(query, { excludeHost: siteHost ?? undefined })
      if (result) {
        evidence.push(result)
        console.log(
          `[plan]   ${position} "${query}" → ${result.competitors.length} concurrents mesures, ` +
            `mediane ${result.medianWordCount ?? '?'} mots, ${result.commonSections.length} sections communes, ` +
            `${result.peopleAlsoAsk.length} questions PAA`
        )
      } else {
        // Not an error: the SERP could not be read, and the plan is built
        // without it. Saying so is what keeps a blind plan from passing for a
        // measured one.
        console.warn(`[plan]   ${position} "${query}" → aucune preuve SERP, brief construit a l'aveugle`)
      }
    } catch (error) {
      console.warn(`[plan]   ${position} "${query}" → echec : ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`[plan] SERP : ${evidence.length}/${queries.length} requetes exploitables`)
  return evidence
}

function hostOfSite(siteUrl: string | undefined): string | null {
  if (!siteUrl) return null
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Unavailable signals are collapsed to null so every consumer below has a single
 * condition to test, and so an empty Search Console history can never be read as
 * "this site performs badly".
 */
async function resolveSignals(opts: GenerateBriefPlanOptions): Promise<GscPlanningSignals | null> {
  const provided = opts.gscSignals !== undefined
    ? opts.gscSignals
    : opts.campaign.site_id
      ? await getGscPlanningSignals(opts.campaign.site_id).catch(() => null)
      : null

  return provided && provided.available ? provided : null
}

/**
 * Share of a cycle that measured opportunities may take. The rest keeps
 * exploring new subjects: a plan built only on queries the site already ranks
 * for stops discovering anything, and next cycle would have no new data to
 * learn from.
 */
const MAX_OPPORTUNITY_SHARE = 0.6

function assignOpportunities(
  slotCount: number,
  signals: GscPlanningSignals | null
): Array<StrikingDistanceOpportunity | null> {
  if (!signals) return Array.from({ length: slotCount }, () => null)

  // A query already split between several pages is excluded: it needs
  // consolidation, and one more page on it would deepen the split.
  const blocked = new Set(signals.cannibalized.map((entry) => entry.query.toLowerCase()))
  const pool = signals.strikingDistance.filter((opportunity) => !blocked.has(opportunity.query.toLowerCase()))
  const budget = Math.max(1, Math.ceil(slotCount * MAX_OPPORTUNITY_SHARE))

  return Array.from({ length: slotCount }, (_, index) => (index < budget ? pool[index] ?? null : null))
}

function buildPrompt(opts: {
  campaign: Campaign
  analysisRun?: AnalysisRun | null
  existingSlugs: string[]
  existingKeywords: string[]
  calendarSlots: ReturnType<typeof generateEditorialCalendar>
  signals: GscPlanningSignals | null
  opportunities: Array<StrikingDistanceOpportunity | null>
  serpEvidence: SerpEvidence[]
}) {
  const analysis = opts.analysisRun?.analysis_data
  const competitorSummary = analysis?.competitors.map((competitor) => ({
    url: competitor.url,
    topKeywords: competitor.topKeywords.slice(0, 12),
    strengths: competitor.strengths,
    pages: competitor.pages.slice(0, 8).map((page) => ({
      title: page.title,
      h1: page.h1,
      wordCount: page.wordCount,
      keywords: page.keywords,
      hasFaq: page.hasFaq,
      hasSchema: page.hasSchema,
    })),
  })) || []

  const slots = opts.calendarSlots.map((slot, index) => {
    const opportunity = opts.opportunities[index]
    return {
      scheduled_date: slot.scheduled_date,
      page_type: slot.page_type,
      target_keyword_seed: slot.target_keyword,
      target_city: slot.target_city,
      // Present only when Search Console proved this query is within reach.
      ...(opportunity
        ? {
            gsc_opportunity: {
              query: opportunity.query,
              position_actuelle: opportunity.position,
              impressions_30j: opportunity.impressions,
              page_qui_ranke: opportunity.pageUrl,
            },
          }
        : {}),
    }
  })

  return `
Campagne:
- Activite: ${opts.campaign.business_type}
- Business: ${opts.campaign.business_name}
- Site: ${opts.campaign.site?.url || ''}
- Departement: ${opts.campaign.department || 'Aube'}
- Communes: ${opts.campaign.communes.join(', ')}
- Mots-cles de base: ${opts.campaign.keywords.join(', ')}

Analyse du site:
${analysis ? JSON.stringify({
  topKeywords: analysis.site.topKeywords,
  pages: analysis.site.pages.slice(0, 12),
  gaps: analysis.gapAnalysis,
}, null, 1) : 'Aucune analyse disponible'}

Analyse concurrents:
${JSON.stringify(competitorSummary, null, 1)}

Anti-doublon:
- Slugs deja utilises: ${opts.existingSlugs.slice(0, 50).join(', ') || 'aucun'}
- Mots-cles deja cibles: ${opts.existingKeywords.slice(0, 50).join(', ') || 'aucun'}

${buildPerformanceSection(opts.signals)}
${buildSerpSection(opts.serpEvidence)}
Slots a transformer en briefs:
${JSON.stringify(slots, null, 1)}

Objectif:
Pour chaque slot, produire un brief SEO complet. Ce brief servira le jour J a rediger la page avec une autre IA.
Ne redige pas la page. Ne donne pas de HTML.

Regles:
1. proposed_slug doit etre longue traine, 6 a 10 mots, unique, jamais dans les slugs deja utilises.
2. target_keyword doit etre une intention longue traine, differente des mots-cles deja cibles.
3. page_type "pillar": brief autorite topique, trame hub, liens vers pages filles.
4. page_type "child": angle specifique, lien retour pilier et pages soeurs.
5. page_type "alternative": capter "alternative a X", "moins cher que X", "remplacer X".
6. page_type "comparative": capter "meilleur X", "X vs Y", "comparatif".
7. page_type "local_pack": maximiser signaux locaux, quartiers, proximite, ouvert maintenant, avis.
8. outline contient uniquement les H2/H3 attendus, pas les paragraphes.
9. seo_rules contient les contraintes de redaction a respecter plus tard.
10. competitor_insights reprend des observations utiles des concurrents, sans copier leur contenu.
11. Si le slot porte un "gsc_opportunity", la page ne doit PAS cibler la requete telle quelle :
    une page du site la travaille deja. Cible une sous-intention longue traine de cette requete,
    et mets "page_qui_ranke" dans internal_link_targets. C'est ce lien qui fait monter la page
    existante de la position ${STRIKING_DISTANCE_MIN_POSITION}-${STRIKING_DISTANCE_MAX_POSITION} vers le top 3.
12. N'utilise jamais comme target_keyword une requete listee en "requetes interdites".

Reponds avec ce JSON:
{
  "items": [
    {
      "id": "laisser vide ou string",
      "scheduled_date": "YYYY-MM-DD",
      "page_type": "pillar|child|alternative|comparative|local_pack",
      "priority": "high|medium|low",
      "target_city": "ville",
      "target_keyword": "mot-cle focus longue traine",
      "secondary_keywords": ["8 variations minimum"],
      "search_intent": "transactionnelle|informationnelle|locale|comparative|alternative",
      "proposed_title": "titre SEO 50-65 caracteres",
      "proposed_slug": "slug-longue-traine-unique",
      "page_goal": "objectif de la page en une phrase",
      "outline": ["H2: ...", "H2: ...", "H3: ..."],
      "seo_rules": ["regle concrete", "regle concrete"],
      "required_entities": ["quartier", "code postal", "entite locale"],
      "internal_link_targets": ["slug ou role de page cible"],
      "competitor_insights": ["observation concurrentielle utile"],
      "estimated_word_count": 800,
      "rationale": "pourquoi cette page est prioritaire"
    }
  ]
}`.trim()
}

/**
 * The block that turns "what we published" into "what we write next".
 *
 * Returns an empty string when no data exists, so a first cycle produces the
 * exact same prompt it produced before this feedback loop was built.
 */
/**
 * What the pages that actually rank look like.
 *
 * This is the section that turns `estimated_word_count` from an opinion into a
 * measurement. It states the median length of the ranking pages, the sections
 * several of them share, and the questions the SERP itself asks — and says
 * explicitly where those numbers come from, so the model treats them as
 * observations rather than as suggestions it may average away.
 *
 * Emitted only when something was really measured: an empty section is better
 * than a section full of zeroes, which reads as "the competition is weak".
 */
function buildSerpSection(evidence: SerpEvidence[]): string {
  const usable = evidence.filter((e) => e.competitors.length > 0)
  if (usable.length === 0) return ''

  const blocks = usable.map((e) => {
    const lines = [`Requete "${e.query}" (SERP lue le ${e.fetchedAt.slice(0, 10)}) :`]

    if (e.medianWordCount) {
      lines.push(
        `- Longueur MEDIANE des ${e.competitors.length} pages qui rankent : ${e.medianWordCount} mots.` +
          ` C'est une mesure, pas une estimation : cale estimated_word_count dessus (+/- 20%).`
      )
    }

    const lengths = e.competitors.map((c) => `${c.wordCount}`).join(', ')
    lines.push(`- Longueurs observees, de la position 1 vers le bas : ${lengths}.`)

    if (e.commonSections.length) {
      lines.push(
        `- Sections presentes chez plusieurs concurrents (a couvrir dans outline) : ${e.commonSections.join(' | ')}`
      )
    }

    if (e.faqShare >= 0.5) {
      lines.push(`- ${Math.round(e.faqShare * 100)}% des pages qui rankent ont une FAQ : en prevoir une.`)
    }

    if (e.peopleAlsoAsk.length) {
      lines.push(`- Questions posees par Google (reprendre en H2) : ${e.peopleAlsoAsk.slice(0, 6).join(' | ')}`)
    }

    if (e.relatedSearches.length) {
      lines.push(`- Recherches associees (pistes de mots-cles secondaires) : ${e.relatedSearches.slice(0, 8).join(', ')}`)
    }

    return lines.join('\n')
  })

  return `
Ce que la SERP montre reellement (donnees mesurees, pas estimees) :
${blocks.join('\n\n')}

Regle : quand une mesure ci-dessus contredit ton intuition, suis la mesure. Ne propose pas une page
de 800 mots sur une requete ou la mediane observee est 2000, ni l'inverse.
`
}

function buildPerformanceSection(signals: GscPlanningSignals | null): string {
  if (!signals) return ''

  const blocks: string[] = [
    `Donnees Search Console REELLES du site (${signals.windowStart} -> ${signals.windowEnd}).`,
    'Ces chiffres priment sur toute intuition : ils disent ce que Google fait deja de ce site.',
  ]

  if (signals.strikingDistance.length > 0) {
    blocks.push(
      '',
      `A. GISEMENT PRIORITAIRE — requetes ou une page du site est deja en position ${STRIKING_DISTANCE_MIN_POSITION} a ${STRIKING_DISTANCE_MAX_POSITION} :`,
      ...signals.strikingDistance.slice(0, 15).map((opportunity) =>
        `- "${opportunity.query}" : position ${opportunity.position}, ${opportunity.impressions} impressions, ${opportunity.clicks} clics -> ${opportunity.pageUrl}`
      ),
      'Le contenu existe deja et Google le montre. Renforcer coute moins cher que repartir de zero :',
      'ecris une page de sous-intention qui LIE vers l\'URL indiquee, ne redouble pas la requete.'
    )
  }

  if (signals.lowCtrPages.length > 0) {
    blocks.push(
      '',
      'B. PAGES VUES ET IGNOREES — fortes impressions, CTR faible (probleme de title/meta, PAS de contenu) :',
      ...signals.lowCtrPages.slice(0, 10).map((page) =>
        `- ${page.pageUrl} : ${page.impressions} impressions, ${page.clicks} clics (CTR ${(page.ctr * 100).toFixed(2)}%), position ${page.position}, requete principale "${page.topQuery}"`
      ),
      'Aucune nouvelle page a ecrire pour ces sujets : la reponse est une reecriture de title et de meta description.'
    )
  }

  if (signals.deadPages.length > 0) {
    blocks.push(
      '',
      'C. SUJETS SANS DEMANDE — pages publiees depuis plus de 30 jours, zero impression :',
      ...signals.deadPages.slice(0, 10).map((page) =>
        `- ${page.pageUrl}${page.focusKeyword ? ` (mot-cle "${page.focusKeyword}")` : ''}, en ligne depuis ${page.daysLive} jours`
      ),
      'Personne ne cherche ces sujets. N\'en propose plus, ni eux ni leurs variantes proches.'
    )
  }

  if (signals.cannibalized.length > 0) {
    blocks.push(
      '',
      'D. CANNIBALISATION D\'INTENTION — plusieurs pages du site se disputent la meme requete :',
      ...signals.cannibalized.slice(0, 10).map((entry) =>
        `- "${entry.query}" (${entry.impressions} impressions) : ${entry.pages.length} pages en concurrence. A garder: ${entry.winner}. A faire pointer vers elle: ${entry.losers.join(', ')}`
      ),
      'Ces pages s\'affaiblissent mutuellement. INTERDIT d\'en ajouter une de plus sur ces requetes :',
      'le cycle doit consolider vers l\'URL gagnante par des liens internes.'
    )
  }

  if (signals.blockedQueries.length > 0) {
    blocks.push(
      '',
      `Requetes interdites comme target_keyword (cannibalisees ou deja gagnees) : ${signals.blockedQueries.slice(0, 40).join(', ')}`
    )
  }

  return `${blocks.join('\n')}\n`
}

function normalizeBriefs(
  rawItems: Array<Partial<PlanItemBrief>>,
  slots: ReturnType<typeof generateEditorialCalendar>,
  campaign: Campaign,
  signals: GscPlanningSignals | null,
  opportunities: Array<StrikingDistanceOpportunity | null>
): PlanItemBrief[] {
  return slots.map((slot, index) => {
    const item = rawItems[index] || {}
    const opportunity = opportunities[index] ?? null
    const pageType = (item.page_type || slot.page_type || 'child') as PageType
    const city = item.target_city || slot.target_city || campaign.communes[0] || campaign.department || ''
    const proposedKeyword = item.target_keyword
      || subIntentKeyword(opportunity, city)
      || slot.target_keyword
      || `${campaign.business_type} ${city}`.trim()

    // Last line of defence: whatever the model answered, the plan must not open
    // a page on a query the site already splits between several URLs.
    const guard = guardAgainstCannibalization(proposedKeyword, city, signals)
    const targetKeyword = guard.keyword

    const dataRules = [
      ...guard.rules,
      ...(opportunity
        ? [`Requete "${opportunity.query}" en position ${opportunity.position} sur ${opportunity.pageUrl} : traiter une sous-intention et lier vers cette URL, ne pas la concurrencer.`]
        : []),
    ]

    const dataLinks = [
      ...guard.links,
      ...(opportunity ? [opportunity.pageUrl] : []),
    ]

    return {
      id: item.id || createPlanItemId(),
      scheduled_date: item.scheduled_date || slot.scheduled_date,
      page_type: pageType,
      // A measured opportunity outranks any heuristic: it is the only priority
      // on this plan backed by an observed impression count.
      priority: opportunity ? 'high' : (item.priority || priorityFor(pageType, index)),
      target_city: city,
      target_keyword: targetKeyword,
      secondary_keywords: asStringArray(item.secondary_keywords, [
        `${targetKeyword} pres de moi`,
        `${targetKeyword} avis`,
        `${targetKeyword} prix`,
      ]),
      search_intent: item.search_intent || intentFor(pageType),
      proposed_title: item.proposed_title || titleFor(pageType, campaign.business_type, city),
      // The page type never enters the URL, and the slug is not padded to reach
      // a word count: both were doing exactly that, in two different ways.
      proposed_slug: buildPageSlug({
        proposed: item.proposed_slug,
        focusKeyword: item.target_keyword,
        title: item.proposed_title,
        city,
        businessType: campaign.business_type,
      }),
      page_goal: item.page_goal || `Capter une intention ${intentFor(pageType)} sur ${targetKeyword}.`,
      outline: asStringArray(item.outline, defaultOutline(pageType, campaign.business_type, city)),
      seo_rules: [...asStringArray(item.seo_rules, defaultRules(pageType, targetKeyword)), ...dataRules],
      required_entities: asStringArray(item.required_entities, [city, campaign.department || 'Aube']),
      internal_link_targets: dedupe([
        ...asStringArray(item.internal_link_targets, pageType === 'pillar' ? ['pages filles du cluster'] : ['page pilier parente']),
        ...dataLinks,
      ]),
      competitor_insights: asStringArray(item.competitor_insights, []),
      estimated_word_count: item.estimated_word_count || estimatedWords(pageType, campaign.target_length),
      rationale: item.rationale || rationaleFor(pageType, opportunity),
    }
  })
}

function fallbackBriefs(
  slots: ReturnType<typeof generateEditorialCalendar>,
  campaign: Campaign,
  signals: GscPlanningSignals | null,
  opportunities: Array<StrikingDistanceOpportunity | null>
) {
  return normalizeBriefs([], slots, campaign, signals, opportunities)
}

/**
 * Deterministic keyword for a slot carrying a measured opportunity, used when
 * the model answered nothing usable.
 *
 * Adding the city creates a genuinely different intent from the query the
 * existing page ranks on. When the query already names the city there is no
 * such variation available, so this returns null and the previous default
 * applies — inventing a near-duplicate would be the cannibalization this whole
 * module exists to avoid.
 */
function subIntentKeyword(opportunity: StrikingDistanceOpportunity | null, city: string): string | null {
  if (!opportunity) return null

  const query = opportunity.query.trim()
  if (!query) return null
  if (!city) return null
  if (normalizeText(query).includes(normalizeText(city))) return null

  return `${query} ${city}`
}

function guardAgainstCannibalization(
  keyword: string,
  city: string,
  signals: GscPlanningSignals | null
): { keyword: string; rules: string[]; links: string[] } {
  if (!signals || signals.cannibalized.length === 0) return { keyword, rules: [], links: [] }

  const normalized = normalizeText(keyword)
  const collision = signals.cannibalized.find((entry) => normalizeText(entry.query) === normalized)
  if (!collision) return { keyword, rules: [], links: [] }

  const differentiated = city && !normalized.includes(normalizeText(city)) ? `${keyword} ${city}` : keyword

  return {
    keyword: differentiated,
    rules: [
      `Cannibalisation detectee sur "${collision.query}" (${collision.pages.length} pages du site en concurrence). Ne pas retraiter cette requete frontalement : lier vers ${collision.winner}, qui doit rester la page de reference.`,
    ],
    links: [collision.winner],
  }
}

function rationaleFor(pageType: PageType, opportunity: StrikingDistanceOpportunity | null): string {
  if (opportunity) {
    return `Requete mesuree a ${opportunity.impressions} impressions et position ${opportunity.position} en Search Console : gain de places atteignable en renforcant ${opportunity.pageUrl}.`
  }
  return `Page ${pageType} planifiee pour renforcer la couverture longue traine.`
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function asStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).filter(Boolean)
    : fallback
}

function priorityFor(pageType: PageType, index: number): PlanItemBrief['priority'] {
  if (pageType === 'pillar' || pageType === 'local_pack' || index < 2) return 'high'
  if (pageType === 'alternative' || pageType === 'comparative') return 'medium'
  return 'low'
}

function intentFor(pageType: PageType) {
  const map: Record<PageType, string> = {
    pillar: 'informationnelle et transactionnelle',
    child: 'longue traine specifique',
    alternative: 'alternative',
    comparative: 'comparative',
    local_pack: 'locale',
  }
  return map[pageType]
}

function titleFor(pageType: PageType, businessType: string, city: string) {
  if (pageType === 'local_pack') return `${businessType} pres de moi a ${city}`
  if (pageType === 'comparative') return `Quel ${businessType} choisir a ${city} ?`
  if (pageType === 'alternative') return `Alternative de ${businessType} a ${city}`
  return `${businessType} a ${city} : guide complet`
}

function defaultOutline(pageType: PageType, businessType: string, city: string) {
  if (pageType === 'local_pack') {
    return [
      `H2: Pourquoi choisir un ${businessType} proche de ${city} ?`,
      'H2: Zones desservies et delais',
      'H2: Avis, preuves et garanties',
      'H2: FAQ locale',
    ]
  }
  if (pageType === 'comparative') {
    return ['H2: Criteres de comparaison', 'H2: Tableau comparatif', 'H2: Avantages et limites', 'H2: Recommandation finale']
  }
  if (pageType === 'alternative') {
    return ['H2: Pourquoi chercher une alternative ?', 'H2: Options possibles', 'H2: Comparaison des solutions', 'H2: FAQ']
  }
  return ['H2: Besoin et intention de recherche', 'H2: Methode et criteres', 'H2: Conseils pratiques', 'H2: FAQ']
}

function defaultRules(pageType: PageType, keyword: string) {
  return [
    `Inclure le mot-cle "${keyword}" dans title, H1, introduction et un H2.`,
    'Inclure au moins 3 formulations longue traine naturelles.',
    'Ajouter une FAQ structuree.',
    pageType === 'local_pack' ? 'Renforcer les signaux de proximite, quartiers et avis.' : 'Prevoir un maillage interne coherent.',
  ]
}

function estimatedWords(pageType: PageType, baseLength: number) {
  const map: Record<PageType, number> = {
    pillar: Math.max(baseLength * 2, 1800),
    child: baseLength,
    alternative: Math.max(baseLength + 300, 1100),
    comparative: Math.max(baseLength + 500, 1300),
    local_pack: Math.max(baseLength + 200, 1000),
  }
  return map[pageType]
}

function createPlanItemId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

