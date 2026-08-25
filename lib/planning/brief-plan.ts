import { buildPageSlug, resolveFreeSlug, type SlugResolution } from '@/lib/seo/slug'
import { DEFAULT_PLANNING_MODEL, generateJson } from '@/lib/ai/provider'
import {
  getGscPlanningSignals,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
  type GscPlanningSignals,
  type StrikingDistanceOpportunity,
} from '@/lib/google/performance'
import { buildSerpEvidence, type SerpEvidence } from '@/lib/serp'
import { loadSiteInventory } from '@/lib/existing/inventory'
import { generateEditorialCalendar } from '@/lib/scheduler/editorial'
import {
  decideEditorialAction,
  WITHOUT_SEARCH_CONSOLE,
  type EditorialAction,
} from '@/src/core/domain/existing/action'
import type { EditorialTarget } from '@/src/core/domain/existing/identity'
import { blindInventory, type SiteInventory } from '@/src/core/domain/existing/inventory'
import type {
  AnalysisRun,
  Campaign,
  PageType,
  PlanItemAction,
  PlanItemBrief,
  SlugResolutionDto,
} from '@/lib/types'

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
 *
 * ET C'EST ICI QUE LE MOTEUR CESSE DE NE SAVOIR DIRE QU'« UNE PAGE DE PLUS ».
 * Chaque sujet du cycle est confronte a l'existant AVANT que le modele ne soit
 * ouvert : ce qui ressort 'refresh' ou 'skip' ne lui est jamais soumis, donc ne
 * coute pas un jeton. Un 'refresh' voyage dans le plan comme une PROPOSITION —
 * il nomme la page visee, sa portee et la preuve qui l'a designee, et il attend
 * un clic humain plus loin dans la chaine. Rien, dans ce module ni en aval de
 * lui, ne supprime, ne fusionne ni ne redirige quoi que ce soit.
 *
 * UNE PANNE DE CONNAISSANCE NE BLOQUE JAMAIS LA PLANIFICATION. Inventaire
 * aveugle, Search Console absente, site inconnu : le plan sort quand meme, en
 * 'create', et chaque item porte la degradation en toutes lettres.
 */
export async function generateBriefPlanWithSignals(opts: GenerateBriefPlanOptions): Promise<BriefPlanResult> {
  const { campaign, cycleDays, analysisRun } = opts

  // L'existant D'ABORD. Tout ce qui suit — le verdict de chaque sujet, l'adresse
  // de chaque page, le brief lui-meme — se prend contre cette lecture, et elle
  // est faite une seule fois.
  const inventory = await resolveInventory(campaign)
  const takenPaths = new Set<string>(inventory.takenPaths)

  const existingSlugs = opts.existingSlugs ?? inventory.entries.map(entry => entry.path.replace(/^\//, ''))
  const existingKeywords =
    opts.existingKeywords ?? dedupe(inventory.entries.map(entry => (entry.focusKeyword ?? '').toLowerCase()))

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

  // ── LA DECISION, AVANT LE PREMIER JETON ───────────────────────────────────
  //
  // Chaque creneau est confronte a l'existant avant que le modele ne soit
  // ouvert. Ce qui en sort 'refresh' ou 'skip' ne lui est PAS soumis : le
  // moteur cesse de payer une page pour decouvrir ensuite qu'il ne fallait pas
  // l'ecrire. Un sujet a rafraichir n'a pas besoin d'un brief neuf — il a
  // besoin d'une cible, d'une portee et d'une preuve, et les trois sont deja
  // rendues ici.
  const decisionContext = {
    campaign,
    inventory,
    signals,
    // Les communes desservies, resolues UNE fois : c'est ce qui permet au
    // comparateur d'identite de voir que « Taxi Troyes » et « Taxi Reims » sont
    // le meme titre a la ville pres.
    cityTokens: dedupe([...campaign.communes, campaign.department ?? '']),
  }

  const subjects = calendarSlots.map((slot, index) =>
    decideForSlot(slot, opportunities[index] ?? null, decisionContext)
  )

  const toWrite = subjects.filter(subject => subject.action.kind === 'create')
  const refreshCount = subjects.filter(subject => subject.action.kind === 'refresh').length
  const skipCount = subjects.length - toWrite.length - refreshCount

  console.log(
    `[plan] decision avant depense : ${toWrite.length} page(s) a ecrire, ` +
      `${refreshCount} mise(s) a jour proposee(s), ${skipCount} sujet(s) ecarte(s)` +
      `${inventory.freshness.state !== 'fresh' ? ` — inventaire ${inventory.freshness.state}` : ''}` +
      `${signals ? '' : ` — ${WITHOUT_SEARCH_CONSOLE}`}`
  )

  const rawItems = toWrite.length === 0
    ? []
    : await writeBriefs({
        campaign,
        analysisRun,
        existingSlugs,
        existingKeywords,
        subjects: toWrite,
        signals,
        serpEvidence,
      })

  return {
    items: normalizeBriefs({ subjects, rawItems, campaign, takenPaths, inventory, signals }),
    signals,
    serpEvidence,
  }
}

/**
 * Tout ce que le moteur sait du site, ou l'aveu qu'il n'en sait rien.
 *
 * `loadSiteInventory` ne jette jamais — un site illisible revient aveugle — et
 * une campagne sans site revient aveugle elle aussi, par le meme chemin plutot
 * que par une branche a part. C'est ce qui rend la suite ecrite UNE fois : la
 * decision, la reservation d'adresse et la degradation nommee n'ont jamais a se
 * demander si un inventaire existe.
 *
 * AUCUN CRAWL N'EST DECLENCHE ICI, et c'est delibere. Le crawl incremental d'un
 * cycle appartient a lib/scheduler/cycle-manager.ts, qui le lance juste avant
 * d'appeler ce planificateur ; le refaire ici crawlerait deux fois le meme site
 * a cinq lignes d'intervalle sur le chemin principal, et ferait attendre un site
 * entier a une requete d'ecran sur les deux autres. Une fraicheur insuffisante
 * n'est donc pas reparee ici : elle est NOMMEE, dans la console et dans chaque
 * item du plan.
 */
async function resolveInventory(campaign: Campaign): Promise<SiteInventory> {
  const inventory = campaign.site_id
    ? await loadSiteInventory(campaign.site_id)
    : blindInventory('', 'jamais-analyse')

  // Nomme, jamais fatal. Un plan bati sur une vue vieillie du site reste un
  // plan ; un plan bati sur une vue vieillie que personne n'a mentionnee est la
  // facon dont le moteur finit par proposer une page publiee la semaine
  // derniere.
  if (inventory.freshness.state !== 'fresh') {
    console.warn(
      `[plan] inventaire ${inventory.freshness.state}` +
        `${inventory.freshness.blindReason ? ` (${inventory.freshness.blindReason})` : ''}` +
        `${inventory.freshness.ageDays !== null ? `, ${inventory.freshness.ageDays} jour(s)` : ''}` +
        ` : ${inventory.takenPaths.size} adresse(s) connue(s), des pages publiees depuis peuvent manquer.`
    )
  }

  return inventory
}

/**
 * Demander au modele les briefs des SEULS sujets a ecrire.
 *
 * Rend un tableau vide sur une reponse illisible : le plan sort alors avec ses
 * briefs de repli, exactement comme avant. Seule l'analyse de la reponse est
 * gardee — un modele injoignable reste une panne, pas un plan silencieusement
 * vide.
 */
async function writeBriefs(opts: {
  campaign: Campaign
  analysisRun?: AnalysisRun | null
  existingSlugs: string[]
  existingKeywords: string[]
  subjects: readonly PlannedSubject[]
  signals: GscPlanningSignals | null
  serpEvidence: SerpEvidence[]
}): Promise<Array<Partial<PlanItemBrief>>> {
  console.log(
    `[plan] redaction des briefs : ${opts.subjects.length} creneaux, modele ${DEFAULT_PLANNING_MODEL}` +
      `${opts.signals ? ' + signaux Search Console' : ' (aucun historique Search Console)'}` +
      `${opts.serpEvidence.length ? ` + ${opts.serpEvidence.length} SERP mesurees` : ''}`
  )

  const raw = await generateJson({
    systemPrompt: `Tu es un stratege SEO senior. Tu crees uniquement des briefs editoriaux exploitables par une IA de redaction plus tard.
Tu ne rediges jamais la page, tu ne fournis jamais de HTML, et tu reponds uniquement en JSON valide.`,
    userPrompt: buildPrompt({
      campaign: opts.campaign,
      analysisRun: opts.analysisRun,
      existingSlugs: opts.existingSlugs,
      existingKeywords: opts.existingKeywords,
      calendarSlots: opts.subjects.map(subject => subject.slot),
      signals: opts.signals,
      opportunities: opts.subjects.map(subject => subject.opportunity),
      serpEvidence: opts.serpEvidence,
    }),
    model: DEFAULT_PLANNING_MODEL,
    maxTokens: 7000,
    temperature: 0.45,
  })

  try {
    return itemsOf(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

/** Les trois formes de reponse deja tolerees, sans `any` pour les lire. */
function itemsOf(parsed: unknown): Array<Partial<PlanItemBrief>> {
  if (Array.isArray(parsed)) return parsed as Array<Partial<PlanItemBrief>>

  if (parsed !== null && typeof parsed === 'object') {
    const envelope = parsed as { items?: unknown; plan?: unknown }
    if (Array.isArray(envelope.items)) return envelope.items as Array<Partial<PlanItemBrief>>
    if (Array.isArray(envelope.plan)) return envelope.plan as Array<Partial<PlanItemBrief>>
  }

  return []
}

// ─── Ce que le plan decide, sujet par sujet ─────────────────────────────────

/** Un creneau du calendrier, tel que generateEditorialCalendar le rend. */
type PlanSlot = ReturnType<typeof generateEditorialCalendar>[number]

/**
 * Un creneau, son sujet de depart, et ce que le moteur a decide d'en faire.
 *
 * `seedKeyword` est le sujet SEME PAR LE CALENDRIER, pas celui que le modele
 * proposera : c'est sur lui que le verdict est rendu, puisqu'il est le seul
 * connu avant la depense. Le modele ne peut ensuite affiner que le sujet d'un
 * creneau deja juge libre — et la page qu'il produira repassera de toute facon
 * devant le gate de duplicat, qui la compare a l'existant pour de vrai.
 */
interface PlannedSubject {
  slot: PlanSlot
  opportunity: StrikingDistanceOpportunity | null
  pageType: PageType
  city: string
  seedKeyword: string
  action: EditorialAction
}

/**
 * Search Console absente, dite comme telle plutot que devinee.
 *
 * `decideEditorialAction` exige des signaux ; il n'exige pas qu'ils existent.
 * `available: false` est ce qui lui fait sauter les trois regles de mesure et
 * porter WITHOUT_SEARCH_CONSOLE dans sa preuve, au lieu de lire une absence de
 * donnee comme une absence de concurrence.
 */
const NO_SEARCH_CONSOLE: GscPlanningSignals = {
  available: false,
  windowStart: '',
  windowEnd: '',
  strikingDistance: [],
  lowCtrPages: [],
  deadPages: [],
  cannibalized: [],
  blockedQueries: [],
}

/**
 * Creer, rafraichir ou ecarter — pour UN creneau, avant tout appel au modele.
 *
 * La page confrontee a l'existant est celle que ce creneau produirait :
 * l'adresse que la fabrique de slug lui donnerait, le titre que le repli lui
 * donnerait, son mot-cle seme. La meta description manque, et c'est exact — elle
 * n'est pas encore ecrite. Le comparateur d'identite le sait : une comparaison
 * sans corps ni meta se declare PARTIELLE, et un score bas n'y prouve rien.
 */
function decideForSlot(
  slot: PlanSlot,
  opportunity: StrikingDistanceOpportunity | null,
  context: {
    campaign: Campaign
    inventory: SiteInventory
    signals: GscPlanningSignals | null
    cityTokens: readonly string[]
  },
): PlannedSubject {
  const { campaign, inventory, signals, cityTokens } = context
  const pageType = (slot.page_type || 'child') as PageType
  const city = slot.target_city || campaign.communes[0] || campaign.department || ''
  const seedKeyword = slot.target_keyword || `${campaign.business_type} ${city}`.trim()

  const target: EditorialTarget = {
    path: `/${buildPageSlug({ focusKeyword: seedKeyword, city, businessType: campaign.business_type })}`,
    title: titleFor(pageType, campaign.business_type, city),
    metaDescription: '',
    focusKeyword: seedKeyword,
  }

  const action = decideEditorialAction(target, {
    gsc: signals ?? NO_SEARCH_CONSOLE,
    inventory,
    cityTokens,
  })

  return { slot, opportunity, pageType, city, seedKeyword, action }
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
Slots a transformer en briefs (ce sont les SEULS sujets qu'aucune page du site ne couvre deja :
ceux que le site traite deja ont ete retires avant cet appel, ne les reintroduis pas):
${JSON.stringify(slots, null, 1)}

Objectif:
Pour chaque slot, produire un brief SEO complet. Ce brief servira le jour J a rediger la page avec une autre IA.
Ne redige pas la page. Ne donne pas de HTML.

Regles:
1. proposed_slug dit ce que la page traite, en 7 mots maximum, et jamais un slug deja utilise.
   La longue traine decrit la REQUETE, pas l'adresse : un slug rallonge pour atteindre un compte
   de mots est tronque a la fabrication, et c'est son dernier mot — celui qui distinguait la page
   de sa soeur — qui tombe.
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

/**
 * Turn decisions into briefs — l'adresse d'une page neuve PROUVEE libre, la
 * cible d'une mise a jour nommee, un sujet ecarte qui dit pourquoi.
 *
 * `takenPaths` is mutated as the plan is built, and that is the point: two
 * sibling slots of the same cycle produce the same address far more often than
 * a slot collides with a page already online, and a set refreshed only between
 * cycles would catch the rare case and miss the common one.
 *
 * Une adresse qui ne se libere pas ne fait plus DISPARAITRE son creneau : elle
 * le fait basculer en 'skip', avec le motif. Aucun suffixe numerique — `-2`
 * n'est pas une desambiguation, c'est un aveu — mais un creneau evanoui etait la
 * seule decision du plan que personne ne pouvait relire. Elle est desormais
 * ecrite dans l'item, et elle ne coute toujours aucun jeton.
 *
 * `rawItems` est aligne sur les SEULS sujets soumis au modele, dans leur ordre.
 * C'est pourquoi son compteur avance dans la branche 'create' et nulle part
 * ailleurs : le lire par l'index du creneau decalerait tous les briefs des le
 * premier sujet ecarte.
 */
function normalizeBriefs(input: {
  subjects: readonly PlannedSubject[]
  rawItems: ReadonlyArray<Partial<PlanItemBrief>>
  campaign: Campaign
  takenPaths: Set<string>
  inventory: SiteInventory
  signals: GscPlanningSignals | null
}): PlanItemBrief[] {
  const { subjects, rawItems, campaign, takenPaths, inventory, signals } = input
  const briefs: PlanItemBrief[] = []
  let written = 0

  subjects.forEach((subject, index) => {
    const { action } = subject

    if (action.kind === 'refresh') {
      briefs.push(refreshBrief(subject, action, campaign, index))
      return
    }

    if (action.kind === 'skip') {
      briefs.push(skipBrief(subject, action.reasons, campaign, index))
      return
    }

    const item = rawItems[written++] ?? {}
    const fields = fieldsOf(subject, item, campaign, subIntentKeyword(subject.opportunity, subject.city))

    // The page type never enters the URL, and the slug is not padded to reach a
    // word count: both were doing exactly that, in two different ways.
    //
    // Disambiguators, in editorial order rather than technical order: a district
    // named by the brief tells two sibling pages apart far better than the trade
    // does, and the trade is the same word on every page of the campaign.
    //
    // `fields.targetKeyword` and not `item.target_keyword`: the slug used to
    // fall back to the business type and the town whenever the model omitted its
    // keyword, which handed EVERY slot of the cycle the same address.
    const resolution = resolveFreeSlug(
      {
        proposed: item.proposed_slug,
        focusKeyword: fields.targetKeyword,
        title: item.proposed_title,
        city: fields.city,
        businessType: campaign.business_type,
      },
      takenPaths,
      dedupe([fields.requiredEntities[0] ?? '', fields.searchIntent, campaign.business_type])
    )

    if (resolution.status === 'collision') {
      const reason =
        `L'adresse ${resolution.occupiedBy} est deja occupee et aucun desambiguateur ` +
        `n'en libere d'autre pour ${fields.city || 'cette commune'}.`

      console.warn(
        `[plan] creneau du ${item.scheduled_date || subject.slot.scheduled_date} ecarte : ${reason}`
      )

      // Ecarte, et surtout PAS bascule en rafraichissement. La page qui occupe
      // cette adresse n'a pas ete jugee proche du sujet — ou l'inventaire etait
      // trop vieux pour qu'on en juge — et decider ici de la reecrire
      // contournerait la garde de fraicheur qui existe precisement pour empecher
      // qu'on propose d'ecraser une page qu'on ne connait plus.
      briefs.push(
        skipBrief(
          subject,
          [
            reason,
            "Aucun suffixe numerique n'est ajoute : « -2 » ne distingue pas deux pages, il declare qu'elles sont la meme.",
          ],
          campaign,
          index
        )
      )
      return
    }

    if (resolution.status === 'disambiguated') {
      console.warn(
        `[plan] ${resolution.from} etait occupee : le creneau du ` +
          `${item.scheduled_date || subject.slot.scheduled_date} devient /${resolution.slug} ` +
          `(desambigue par "${resolution.token}").`
      )
    }

    // Reserved for the rest of THIS plan as soon as it is retained. Without
    // this line the second sibling of a cycle would be told the address is free
    // by the very set that just handed it to the first.
    takenPaths.add(`/${resolution.slug}`)

    briefs.push(
      buildBrief({
        subject,
        campaign,
        index,
        fields,
        item,
        action: { kind: 'create', slug: slugDtoFor(resolution, inventory) },
        slug: resolution.slug,
        // La degradation est nommee DANS l'item : un plan bati sans Search
        // Console ou sans inventaire sort quand meme, mais il ne se presente
        // jamais comme un plan informe.
        rationale:
          (item.rationale || rationaleFor(fields.pageType, subject.opportunity)) +
          degradationSuffix(inventory, signals),
      })
    )
  })

  return briefs
}

/**
 * Le brief d'une mise a jour : une cible, une portee, une preuve.
 *
 * RIEN NE PART SEUL D'ICI. Cet item ne declenche aucune ecriture : il porte
 * l'adresse de la page visee et les phrases qui l'ont designee, pour qu'un
 * humain lise les deux avant de cliquer. Le moteur ne supprime pas, ne fusionne
 * pas et ne redirige pas — les pages perdantes d'une cannibalisation sont
 * NOMMEES dans `evidence` et rien d'autre ne leur arrive.
 */
function refreshBrief(
  subject: PlannedSubject,
  action: Extract<EditorialAction, { kind: 'refresh' }>,
  campaign: Campaign,
  index: number
): PlanItemBrief {
  const fields = fieldsOf(subject, {}, campaign, null)

  return buildBrief({
    subject,
    campaign,
    index,
    fields,
    item: {},
    action,
    // L'adresse d'une mise a jour est celle de la page visee : on ne CHOISIT
    // pas l'URL d'une page qui existe deja, on la reprend. Rien n'est ajoute a
    // takenPaths — cette adresse y figure deja, c'est meme ce qui l'a designee.
    slug: action.targetPath.replace(/^\//, ''),
    rationale: action.evidence.join(' '),
    extraRules: scopeRules(action),
    pageGoal:
      action.scope === 'metadata'
        ? `Reecrire le titre et la meta description de ${action.targetPath} sur ${fields.targetKeyword}.`
        : `Mettre a jour le contenu de ${action.targetPath} sur ${fields.targetKeyword}.`,
  })
}

/**
 * Le brief d'un sujet ecarte : une ligne qui ne produira rien, et qui le dit.
 *
 * Elle reste dans le plan au lieu d'en disparaitre, parce qu'un creneau evanoui
 * est une decision que personne ne peut relire. Elle ne reserve aucune adresse
 * et n'annonce aucun mot : `proposed_slug` est vide et le compte de mots est
 * nul, faute de quoi le plan facturerait une page qu'il a refuse d'ecrire.
 */
function skipBrief(
  subject: PlannedSubject,
  reasons: readonly string[],
  campaign: Campaign,
  index: number
): PlanItemBrief {
  return buildBrief({
    subject,
    campaign,
    index,
    fields: fieldsOf(subject, {}, campaign, null),
    item: {},
    action: { kind: 'skip', reasons: [...reasons] },
    slug: '',
    rationale: reasons.join(' '),
    pageGoal: "Sujet ecarte : aucune page n'est prevue pour ce creneau.",
  })
}

/** Ce que le creneau et la reponse du modele disent du sujet, resolu une fois. */
interface BriefFields {
  pageType: PageType
  city: string
  targetKeyword: string
  requiredEntities: string[]
  searchIntent: string
}

/**
 * `fallbackKeyword` n'est passe que sur une page NEUVE : c'est la sous-intention
 * derivee d'une opportunite mesuree, utile quand le modele n'a rien repondu.
 * Une mise a jour, elle, garde le sujet du creneau — celui sur lequel le verdict
 * a ete rendu.
 */
function fieldsOf(
  subject: PlannedSubject,
  item: Partial<PlanItemBrief>,
  campaign: Campaign,
  fallbackKeyword: string | null
): BriefFields {
  const pageType = item.page_type || subject.pageType
  const city = item.target_city || subject.city
  const targetKeyword = item.target_keyword || fallbackKeyword || subject.seedKeyword

  return {
    pageType,
    city,
    targetKeyword,
    requiredEntities: asStringArray(item.required_entities, [city, campaign.department || 'Aube']),
    searchIntent: item.search_intent || intentFor(pageType),
  }
}

/**
 * Le brief lui-meme, ecrit UNE fois pour les trois verdicts.
 *
 * Les trois partagent tout sauf leur adresse, leur objectif et leur motif : les
 * separer en trois fabriques aurait fait diverger les valeurs par defaut de la
 * page neuve et celles de la mise a jour, alors que ce sont les memes briefs
 * lus par le meme generateur.
 */
function buildBrief(draft: {
  subject: PlannedSubject
  campaign: Campaign
  index: number
  fields: BriefFields
  item: Partial<PlanItemBrief>
  action: PlanItemAction
  slug: string
  rationale: string
  pageGoal?: string
  extraRules?: string[]
}): PlanItemBrief {
  const { subject, campaign, index, fields, item, action } = draft
  const { pageType, city, targetKeyword, requiredEntities, searchIntent } = fields

  // Lier vers la page qui ranke n'a de sens que sur une page NEUVE. Quand c'est
  // cette page-la qu'on met a jour, se lier a soi-meme n'apporte rien, et lui
  // demander de « ne pas la concurrencer » serait absurde.
  const opportunity = action.kind === 'create' ? subject.opportunity : null

  const dataRules = opportunity
    ? [`Requete "${opportunity.query}" en position ${opportunity.position} sur ${opportunity.pageUrl} : traiter une sous-intention et lier vers cette URL, ne pas la concurrencer.`]
    : []

  return {
    id: item.id || createPlanItemId(),
    scheduled_date: item.scheduled_date || subject.slot.scheduled_date,
    page_type: pageType,
    // A measured opportunity outranks any heuristic: it is the only priority
    // on this plan backed by an observed impression count.
    priority:
      action.kind === 'skip'
        ? 'low'
        : subject.opportunity
          ? 'high'
          : item.priority || priorityFor(pageType, index),
    target_city: city,
    target_keyword: targetKeyword,
    secondary_keywords: asStringArray(item.secondary_keywords, [
      `${targetKeyword} pres de moi`,
      `${targetKeyword} avis`,
      `${targetKeyword} prix`,
    ]),
    search_intent: searchIntent,
    proposed_title: item.proposed_title || titleFor(pageType, campaign.business_type, city),
    proposed_slug: draft.slug,
    page_goal:
      item.page_goal || draft.pageGoal || `Capter une intention ${intentFor(pageType)} sur ${targetKeyword}.`,
    outline: asStringArray(item.outline, defaultOutline(pageType, campaign.business_type, city)),
    seo_rules: [
      ...asStringArray(item.seo_rules, defaultRules(pageType, targetKeyword)),
      ...(draft.extraRules ?? []),
      ...dataRules,
    ],
    required_entities: requiredEntities,
    internal_link_targets: dedupe([
      ...asStringArray(item.internal_link_targets, pageType === 'pillar' ? ['pages filles du cluster'] : ['page pilier parente']),
      ...(opportunity ? [opportunity.pageUrl] : []),
    ]),
    competitor_insights: asStringArray(item.competitor_insights, []),
    estimated_word_count:
      action.kind === 'skip' ? 0 : item.estimated_word_count || estimatedWords(pageType, campaign.target_length),
    rationale: draft.rationale,
    action,
    ...(action.kind === 'refresh'
      ? {
          refresh_target_path: action.targetPath,
          refresh_scope: action.scope,
          ...(action.targetGenerationId ? { refresh_target_generation_id: action.targetGenerationId } : {}),
        }
      : {}),
  }
}

/**
 * Ce que la portee autorise a reecrire, dit au generateur.
 *
 * Le brief est le seul canal entre la decision et la redaction : sans cette
 * ligne, une mise a jour de portee 'metadata' arriverait au generateur comme
 * n'importe quelle page et il reecrirait le corps qui obtient deja les
 * impressions.
 */
function scopeRules(action: Extract<EditorialAction, { kind: 'refresh' }>): string[] {
  return action.scope === 'metadata'
    ? [`Portee de la mise a jour : title et meta description UNIQUEMENT. Le corps de ${action.targetPath} n'est pas reecrit.`]
    : [`Cette page met a jour ${action.targetPath} : reprendre ce que cette page couvre deja et le completer, jamais partir d'un sujet different.`]
}

/**
 * Ce que la resolution d'adresse a le droit de PROMETTRE.
 *
 * Sur un inventaire aveugle, `takenPaths` ne contient que les adresses posees
 * par ce plan-ci : dire « libre » reviendrait a certifier une verification qui
 * n'a pas eu lieu. Le statut le dit, et l'ecran peut alors refuser le badge
 * vert plutot que l'afficher a tort.
 */
function slugDtoFor(
  resolution: Exclude<SlugResolution, { status: 'collision' }>,
  inventory: SiteInventory
): SlugResolutionDto {
  if (inventory.freshness.state === 'blind') {
    return {
      status: 'unverified',
      reason:
        `Inventaire aveugle${inventory.freshness.blindReason ? ` (${inventory.freshness.blindReason})` : ''} : ` +
        `les adresses deja occupees par ce site n'ont pas pu etre lues, celle-ci n'a donc pas ete verifiee.`,
    }
  }

  return resolution.status === 'disambiguated'
    ? { status: 'disambiguated', from: resolution.from, token: resolution.token }
    : { status: 'free' }
}

/**
 * La panne de connaissance, NOMMEE dans l'item qui en decoule.
 *
 * Une source absente ne bloque jamais le plan — mais un plan degrade qui ne le
 * dit pas se lit comme un plan mesure. Les items 'refresh' et 'skip' portent
 * deja ces mentions, ecrites par le domaine avec leur preuve : les redire ici
 * les compterait deux fois, donc seule la page neuve les recoit.
 */
function degradationSuffix(inventory: SiteInventory, signals: GscPlanningSignals | null): string {
  const notes: string[] = []

  if (!signals) {
    notes.push(
      `Decide ${WITHOUT_SEARCH_CONSOLE} : aucune mesure d'audience n'etait disponible, l'absence de donnee ne vaut pas absence de concurrence.`
    )
  }

  if (inventory.freshness.state === 'blind') {
    notes.push(
      `Inventaire aveugle${inventory.freshness.blindReason ? ` (${inventory.freshness.blindReason})` : ''} : ` +
        `le moteur ne sait pas quelles pages ce site porte deja, aucune mise a jour ne pouvait etre proposee.`
    )
  } else if (inventory.freshness.state === 'stale') {
    notes.push(
      inventory.freshness.ageDays === null
        ? "Inventaire d'age inconnu : des pages publiees depuis peuvent manquer."
        : `Inventaire vieux de ${inventory.freshness.ageDays} jour(s) : des pages publiees depuis peuvent manquer.`
    )
  }

  return notes.length === 0 ? '' : ` ${notes.join(' ')}`
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

// `guardAgainstCannibalization` used to live here.
//
// It called itself a last line of defence, and what it actually did was compare
// two strings for exact equality and paste the town on the end when they
// matched. Two facts made it worthless: an exact string match between a model's
// keyword and a Search Console query almost never happens, and appending the
// town produces a keyword that a page of the same cycle, in the same town, has
// every chance of carrying too.
//
// What replaces it is not a smarter comparison, it is a different question. The
// blocked queries still reach the model through `buildPerformanceSection`, and
// the ADDRESS — the one thing a published page can never take back — is now
// proven free against the inventory before the brief is written at all.

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

