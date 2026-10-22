import { buildPageSlug, resolveFreeSlug, type SlugResolution } from '@/lib/seo/slug'
import { DEFAULT_PLANNING_MODEL, generateJson } from '@/lib/ai/provider'
import {
  getGscPlanningSignals,
  STRIKING_DISTANCE_MAX_POSITION,
  STRIKING_DISTANCE_MIN_POSITION,
  type GscPlanningSignals,
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
import {
  avoidedPageOf,
  avoidPromptLine,
  cannibalizationReasons,
  distinctAngleNote,
  distinctAngleRule,
  keywordGuardsOf,
  keywordInContext,
  noDistinctAngleReason,
  reusesAvoidedAddress,
  type AvoidedPage,
} from './distinct-angle'
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
 * produced: volume without measurement. When Search Console data exists, it now
 * tells the plan which queries the site's pages ALREADY carry (ranking 5 to 20,
 * split between pages, already won, or seen and never clicked) — so that no new
 * page competes with them — and which subjects got zero impression after 30
 * days (stop insisting). When it does not, nothing changes.
 *
 * AUCUNE MISE A JOUR, JAMAIS (decision du proprietaire, 2026-10-17 : « Je ne
 * veux pas de mise a jour. Les pages deja redigees, on ne reprend pas leur
 * slug. »). Chaque sujet du cycle est confronte a l'existant AVANT que le
 * modele ne soit ouvert :
 *  - un sujet bloque par Search Console ressort 'skip' et ne lui est jamais
 *    soumis ;
 *  - un sujet qu'une page du site couvre deja (le 'refresh' du domaine) reste
 *    une CREATION, mais sur un angle distinct : le modele recoit la page a ne
 *    pas concurrencer, et le brief qu'il rend est ecarte s'il en reprend le
 *    mot-cle ou l'adresse (lib/planning/distinct-angle.ts).
 * Aucune page existante n'est reecrite, supprimee, fusionnee ni redirigee.
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

  // Occupation et couverture sont deux faits : une generation 'failed' garde son
  // adresse (existingSlugs, takenPaths) mais ne couvre pas son sujet. Ses
  // mots-cles restent donc libres — la garde finale de normalizeBriefs refuse
  // tout mot-cle de cette liste, elle ne doit pas refuser un sujet jamais ecrit.
  const existingSlugs = opts.existingSlugs ?? inventory.entries.map(entry => entry.path.replace(/^\//, ''))
  const existingKeywords =
    opts.existingKeywords ??
    dedupe(
      inventory.entries
        .filter(entry => entry.coversTopic)
        .map(entry => (entry.focusKeyword ?? '').toLowerCase())
    )

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

  // Les requetes Search Console ne sont plus distribuees comme cibles des
  // creneaux. Une requete en position 5-20 est, par definition, deja portee par
  // une page du site : y envoyer une page neuve la concurrencerait, et la
  // reecriture de la page qui la porte n'est plus une option. Elles restent
  // dans le prompt, comme requetes a NE PAS viser, et dans la garde finale.

  // ── LA DECISION, AVANT LE PREMIER JETON ───────────────────────────────────
  //
  // Chaque creneau est confronte a l'existant avant que le modele ne soit
  // ouvert. Ce qui en sort 'skip' ne lui est PAS soumis : le moteur cesse de
  // payer une page pour decouvrir ensuite qu'il ne fallait pas l'ecrire. Un
  // sujet deja couvert lui est soumis AVEC la page a ne pas concurrencer.
  const decisionContext = {
    campaign,
    inventory,
    signals,
    // Les communes desservies, resolues UNE fois : c'est ce qui permet au
    // comparateur d'identite de voir que « Taxi Troyes » et « Taxi Reims » sont
    // le meme titre a la ville pres.
    cityTokens: campaignCityNames(campaign),
  }

  const subjects = calendarSlots.map(slot => decideForSlot(slot, decisionContext))

  const toWrite = subjects.filter(subject => subject.action.kind === 'create')
  const distinctCount = toWrite.filter(subject => subject.avoid !== null).length
  const skipCount = subjects.length - toWrite.length

  console.log(
    `[plan] decision avant depense : ${toWrite.length} page(s) a ecrire dont ${distinctCount} sur un angle distinct, ` +
      `${skipCount} ecarte(s)` +
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

  const items = normalizeBriefs({ subjects, rawItems, campaign, takenPaths, inventory, signals, existingKeywords })

  // Le modele a pu rendre un sujet qui ne se distingue pas de la page a eviter,
  // ou qui reprend un mot-cle deja porte : ces creneaux tombent apres la
  // redaction, et il faut les voir.
  const kept = items.filter(item => item.action?.kind === 'create').length
  const lateSkips = items.length - kept - skipCount
  if (lateSkips > 0) {
    console.log(
      `[plan] apres redaction : ${kept} page(s) retenue(s), ${lateSkips} creneau(x) ecarte(s) ` +
        `(angle non distinct, mot-cle deja porte ou adresse occupee)`
    )
  }

  return { items, signals, serpEvidence }
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
      subjects: opts.subjects,
      signals: opts.signals,
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
export type PlanSlot = ReturnType<typeof generateEditorialCalendar>[number]

/**
 * Un creneau, son sujet de depart, et ce que le moteur a decide d'en faire.
 *
 * `seedKeyword` est le sujet SEME PAR LE CALENDRIER, pas celui que le modele
 * proposera : c'est sur lui que le verdict est rendu, puisqu'il est le seul
 * connu avant la depense. Le modele affine ensuite le sujet — et la page qu'il
 * produira repassera de toute facon devant le gate de duplicat, qui la compare
 * a l'existant pour de vrai.
 *
 * `action` ne peut PAS etre 'refresh', et c'est le type qui le garantit : le
 * planificateur ne propose plus aucune mise a jour (decision du proprietaire,
 * 2026-10-17). Un sujet que le site couvre deja reste 'create' et porte dans
 * `avoid` la page existante qu'il ne doit pas concurrencer.
 */
export interface PlannedSubject {
  slot: PlanSlot
  pageType: PageType
  city: string
  seedKeyword: string
  action: Exclude<EditorialAction, { kind: 'refresh' }>
  /** La page existante qui couvre deja le sujet seme ; null quand rien ne le couvre. */
  avoid: AvoidedPage | null
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
 * Creer, creer sur un angle distinct, ou ecarter — pour UN creneau, avant tout
 * appel au modele.
 *
 * La page confrontee a l'existant est celle que ce creneau produirait :
 * l'adresse que la fabrique de slug lui donnerait, le titre que le repli lui
 * donnerait, son mot-cle seme. La meta description manque, et c'est exact — elle
 * n'est pas encore ecrite. Le comparateur d'identite le sait : une comparaison
 * sans corps ni meta se declare PARTIELLE, et un score bas n'y prouve rien.
 *
 * Le verdict 'refresh' du domaine n'est plus execute (decision du proprietaire,
 * 2026-10-17). Il reste une MESURE juste — « une page du site couvre deja ce
 * sujet » — et c'est sous cette forme qu'il voyage : le creneau reste une
 * creation, et la page designee devient celle qu'il ne doit pas concurrencer.
 * Un 'skip' (requete bloquee par Search Console) reste un 'skip'.
 */
export function decideForSlot(
  slot: PlanSlot,
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

  const verdict = decideEditorialAction(target, {
    gsc: signals ?? NO_SEARCH_CONSOLE,
    inventory,
    cityTokens,
  })

  if (verdict.kind === 'refresh') {
    return {
      slot,
      pageType,
      city,
      seedKeyword,
      action: { kind: 'create' },
      avoid: avoidedPageOf(verdict, inventory, keywordInContext(seedKeyword, city, cityTokens)),
    }
  }

  return { slot, pageType, city, seedKeyword, action: verdict, avoid: null }
}

/** Les communes de la campagne et son departement : ce qu'on retire d'un mot-cle pour en lire le sujet. */
function campaignCityNames(campaign: Campaign): string[] {
  return dedupe([...campaign.communes, campaign.department ?? ''])
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

// `assignOpportunities` used to live here.
//
// It handed the striking-distance queries (a page of the site already ranking
// 5-20) to the earliest slots as their target, on the theory that a new
// sub-intent page linking to the ranking one would push it up. With no refresh
// any more (owner's decision, 2026-10-17), that theory collapses: a query in
// striking distance is, by definition, already carried by an existing page, and
// a new page aimed at it competes with that page. These queries now reach the
// model as queries NOT to target (buildPerformanceSection), and the final guard
// of normalizeBriefs refuses a brief that targets one anyway.

/** Exporte pour les tests : le prompt est pur, seul l'appel au modele ne l'est pas. */
export function buildPrompt(opts: {
  campaign: Campaign
  analysisRun?: AnalysisRun | null
  existingSlugs: string[]
  existingKeywords: string[]
  subjects: readonly PlannedSubject[]
  signals: GscPlanningSignals | null
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

  // `creneau` numerote les slots tels que le modele les voit : c'est par ce
  // numero que les lignes « deja couvert » ci-dessous designent leur slot, et
  // c'est dans cet ordre que normalizeBriefs relit les items rendus.
  const slots = opts.subjects.map((subject, index) => ({
    creneau: index + 1,
    scheduled_date: subject.slot.scheduled_date,
    page_type: subject.slot.page_type,
    target_keyword_seed: subject.slot.target_keyword,
    target_city: subject.slot.target_city,
    ...(subject.avoid ? { deja_couvert_par: subject.avoid.url } : {}),
  }))

  const avoidLines = opts.subjects.flatMap((subject, index) =>
    subject.avoid ? [avoidPromptLine(index + 1, subject.avoid)] : []
  )

  const avoidSection = avoidLines.length > 0
    ? `
Creneaux dont le sujet de depart est DEJA couvert par une page du site (cette page n'est PAS mise a jour,
et le brief ne doit pas la concurrencer) :
${avoidLines.join('\n')}
`
    : ''

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

Anti-doublon (pages DEJA en ligne sur le site, qui ne seront ni mises a jour ni remplacees):
- Slugs deja utilises: ${opts.existingSlugs.slice(0, 50).join(', ') || 'aucun'}
- Mots-cles deja cibles: ${opts.existingKeywords.slice(0, 50).join(', ') || 'aucun'}

${buildPerformanceSection(opts.signals)}
${buildSerpSection(opts.serpEvidence)}
Slots a transformer en briefs (les sujets bloques par Search Console ont deja ete retires avant cet appel) :
${JSON.stringify(slots, null, 1)}
${avoidSection}
Objectif:
Pour chaque slot, produire un brief SEO complet pour une page NEUVE. Ce brief servira le jour J a rediger
la page avec une autre IA. Reponds avec exactement un item par slot, dans l'ordre de la liste.
Ne redige pas la page. Ne donne pas de HTML. Ne propose jamais de mettre a jour une page existante.

Regles:
1. proposed_slug dit ce que la page traite, en 7 mots maximum, et jamais un slug deja utilise.
   La longue traine decrit la REQUETE, pas l'adresse : un slug rallonge pour atteindre un compte
   de mots est tronque a la fabrication, et c'est son dernier mot — celui qui distinguait la page
   de sa soeur — qui tombe.
2. target_keyword doit etre une intention longue traine, differente des mots-cles deja cibles.
3. page_type "pillar": vue d'ensemble qui fait autorite sur le sujet. Les liens vers les pages filles se placent
   dans le texte des sections : jamais un point de la trame qui en parle.
4. page_type "child": angle specifique, lien retour pilier et pages soeurs.
5. page_type "alternative": capter "alternative a X", "moins cher que X", "remplacer X".
6. page_type "comparative": capter "meilleur X", "X vs Y", "comparatif".
7. page_type "local_pack": informations pratiques pour quelqu'un sur place (zones reellement desservies, acces,
   disponibilite, avis reels s'il y en a).
8. outline contient uniquement les H2/H3 attendus, pas les paragraphes, ecrits pour le lecteur : ce qu'il veut
   savoir. Jamais une tache de referencement ("Maillage interne vers…", "Pages a creer", "Mots-cles a cibler",
   "Intention de recherche") : la page publiee en ferait un titre visible.
9. seo_rules contient les contraintes de redaction a respecter plus tard. Aucune ne demande de placer un mot-cle
   tel quel, d'enumerer des lieux ni de citer des donnees Search Console.
10. competitor_insights reprend des observations utiles des concurrents, sans copier leur contenu.
11. Les slugs et mots-cles listes en "Anti-doublon" appartiennent a des pages existantes : ne les reutilise
    JAMAIS comme target_keyword ni comme proposed_slug, ni tels quels ni paraphrases (pluriel, ordre des
    mots, mots vides, synonyme, nom de la ville ajoute ou retire). Une page neuve qui reprend le sujet
    d'une page existante la concurrence : elle sera ecartee.
12. N'utilise jamais comme target_keyword une requete listee en "requetes interdites", ni une requete
    deja portee par une page existante (sections A, B et D ci-dessus), ni une reformulation proche.
13. Un creneau signale "deja couvert" recoit un sujet DIFFERENT et complementaire de la page citee, avec
    son propre target_keyword et son propre proposed_slug ; mets l'URL de cette page dans
    internal_link_targets. S'il n'existe vraiment aucun angle distinct, garde le sujet seme : le creneau
    sera ecarte plutot que de concurrencer la page.
14. required_entities : 3 a 5 entites au plus, celles dont la page a besoin pour etre utile (une commune, un
    organisme, un repere qui compte pour le sujet). Chacune devra etre citee dans le texte : une liste de
    quartiers ou de rues pour faire local deviendrait une enumeration plaquee dans la page.

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
      "required_entities": ["entite utile au sujet", "3 a 5 au plus"],
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
      `A. Requêtes déjà portées par une page existante — NE PAS les viser, ne pas écrire une page concurrente.`,
      `   Une page du site y est deja en position ${STRIKING_DISTANCE_MIN_POSITION} a ${STRIKING_DISTANCE_MAX_POSITION} :`,
      ...signals.strikingDistance.slice(0, 15).map((opportunity) =>
        `- "${opportunity.query}" : position ${opportunity.position}, ${opportunity.impressions} impressions, ${opportunity.clicks} clics -> ${opportunity.pageUrl}`
      ),
      'Ces requetes appartiennent a la page indiquee, qui ne sera pas mise a jour. Aucun target_keyword ne les',
      'reprend, ni telles quelles ni reformulees : une page neuve sur l\'une d\'elles prendrait ses signaux a la page',
      'qui la porte. Une page neuve d\'un AUTRE sujet peut seulement lier vers ces URL.'
    )
  }

  if (signals.lowCtrPages.length > 0) {
    blocks.push(
      '',
      'B. PAGES VUES ET IGNOREES — fortes impressions, CTR faible (contexte seulement) :',
      ...signals.lowCtrPages.slice(0, 10).map((page) =>
        `- ${page.pageUrl} : ${page.impressions} impressions, ${page.clicks} clics (CTR ${(page.ctr * 100).toFixed(2)}%), position ${page.position}, requete principale "${page.topQuery}"`
      ),
      'Ces pages existent et portent deja leur requete principale : aucune page neuve sur ces requetes ni sur',
      'leurs variantes proches.'
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
      'une page neuve d\'un autre sujet peut lier vers l\'URL gagnante, jamais la concurrencer.'
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
 * Turn decisions into briefs — l'adresse d'une page neuve PROUVEE libre, un
 * sujet ecarte qui dit pourquoi. Jamais une mise a jour : ce module n'en
 * produit plus aucune (decision du proprietaire, 2026-10-17).
 *
 * `takenPaths` is mutated as the plan is built, and that is the point: two
 * sibling slots of the same cycle produce the same address far more often than
 * a slot collides with a page already online, and a set refreshed only between
 * cycles would catch the rare case and miss the common one. The keyword guards
 * grow the same way: a brief retained in this plan protects its keyword from
 * the slots that follow it.
 *
 * Une adresse qui ne se libere pas ne fait plus DISPARAITRE son creneau : elle
 * le fait basculer en 'skip', avec le motif. Aucun suffixe numerique — `-2`
 * n'est pas une desambiguation, c'est un aveu — mais un creneau evanoui etait la
 * seule decision du plan que personne ne pouvait relire. Elle est desormais
 * ecrite dans l'item, et elle ne coute toujours aucun jeton.
 *
 * LA GARDE FINALE porte sur le mot-cle que le modele a VRAIMENT rendu, pas sur
 * le sujet seme : un creneau deja couvert dont le brief reprend le mot-cle de la
 * page a eviter, ou tout brief qui reprend un mot-cle de l'existant, une requete
 * qu'une page du site porte deja en Search Console ou le mot-cle d'un autre
 * creneau retenu, est ecarte avec son motif plutot que d'ecrire une page
 * concurrente.
 *
 * `rawItems` est aligne sur les SEULS sujets soumis au modele, dans leur ordre.
 * C'est pourquoi son compteur avance dans la branche 'create' et nulle part
 * ailleurs : le lire par l'index du creneau decalerait tous les briefs des le
 * premier sujet ecarte.
 *
 * Exporte pour les tests : rien ici n'appelle le modele ni la base.
 */
export function normalizeBriefs(input: {
  subjects: readonly PlannedSubject[]
  rawItems: ReadonlyArray<Partial<PlanItemBrief>>
  campaign: Campaign
  takenPaths: Set<string>
  inventory: SiteInventory
  signals: GscPlanningSignals | null
  /** Les mots-cles deja cibles par le site — les memes que ceux montres au modele. */
  existingKeywords: readonly string[]
}): PlanItemBrief[] {
  const { subjects, rawItems, campaign, takenPaths, inventory, signals } = input
  const briefs: PlanItemBrief[] = []
  const cityNames = campaignCityNames(campaign)
  const guards = keywordGuardsOf(input.existingKeywords, signals)
  let written = 0

  subjects.forEach((subject, index) => {
    const { action, avoid } = subject

    if (action.kind === 'skip') {
      briefs.push(skipBrief(subject, action.reasons, campaign, index))
      return
    }

    const item = rawItems[written++] ?? {}
    const fields = fieldsOf(subject, item, campaign)

    // L'adresse de la page a eviter est deja dans takenPaths — c'est une page
    // de l'inventaire. La redire ne coute rien et ne depend plus de la facon
    // dont l'appelant a construit l'ensemble.
    if (avoid) takenPaths.add(avoid.path)

    // Le mot-cle tel que la page le portera, dans sa commune : c'est lui qui
    // est compare a l'existant, aux requetes Search Console et aux creneaux
    // deja retenus.
    const names = dedupe([...cityNames, fields.city])
    const keyword = keywordInContext(fields.targetKeyword, fields.city, names)
    const conflict = cannibalizationReasons({ keyword, avoid, guards, cityNames: names })

    if (conflict) {
      console.warn(
        `[plan] creneau du ${item.scheduled_date || subject.slot.scheduled_date} ecarte : ${conflict[0]}`
      )
      briefs.push(skipBrief(subject, conflict, campaign, index))
      return
    }

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

      // Ecarte, et surtout PAS bascule en rafraichissement : le planificateur
      // n'en propose plus aucun, et reprendre l'adresse d'une page existante
      // est exactement ce que le proprietaire a exclu.
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

    // Defensif : l'adresse de la page a eviter est reservee, resolveFreeSlug ne
    // peut donc pas la rendre. Si l'ensemble venait un jour a l'oublier, le
    // creneau tomberait ici plutot que d'ecraser la page existante.
    if (avoid && reusesAvoidedAddress(`/${resolution.slug}`, avoid)) {
      briefs.push(skipBrief(subject, [noDistinctAngleReason(avoid), ...avoid.reasons], campaign, index))
      return
    }

    // Reserved for the rest of THIS plan as soon as it is retained. Without
    // this line the second sibling of a cycle would be told the address is free
    // by the very set that just handed it to the first.
    takenPaths.add(`/${resolution.slug}`)
    guards.push({ keyword, origin: 'cycle' })

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
        // jamais comme un plan informe. La page voisine aussi : un lecteur doit
        // voir pourquoi ce sujet-la, et pas celui que le calendrier avait seme.
        rationale:
          (item.rationale || rationaleFor(fields.pageType)) +
          (avoid ? ` ${distinctAngleNote(avoid)}` : '') +
          degradationSuffix(inventory, signals),
        extraRules: avoid ? [distinctAngleRule(avoid)] : [],
        extraLinks: avoid ? [avoid.url] : [],
      })
    )
  })

  return briefs
}

// `refreshBrief` and `scopeRules` used to live here: they turned a 'refresh'
// verdict into a brief that reused the existing page's address. The planner no
// longer proposes any refresh (owner's decision, 2026-10-17), so nothing builds
// such a brief any more. Refresh plan items written before that date are still
// readable downstream: `PlanItemAction` keeps its 'refresh' branch.

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
    fields: fieldsOf(subject, {}, campaign),
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
 * Sans reponse du modele, le sujet seme. Sur un creneau deja couvert, ce repli
 * reprend precisement le sujet de la page a eviter — et c'est voulu : la garde
 * finale l'ecarte, faute d'angle distinct, au lieu de l'ecrire quand meme.
 */
function fieldsOf(
  subject: PlannedSubject,
  item: Partial<PlanItemBrief>,
  campaign: Campaign
): BriefFields {
  const pageType = item.page_type || subject.pageType
  const city = item.target_city || subject.city
  const targetKeyword = item.target_keyword || subject.seedKeyword

  return {
    pageType,
    city,
    targetKeyword,
    requiredEntities: asStringArray(item.required_entities, [city, campaign.department || 'Aube']),
    searchIntent: item.search_intent || intentFor(pageType),
  }
}

/**
 * Le brief lui-meme, ecrit UNE fois pour la page neuve et le sujet ecarte.
 *
 * Les deux partagent tout sauf leur adresse, leur objectif et leur motif : les
 * separer en deux fabriques aurait fait diverger leurs valeurs par defaut, alors
 * que ce sont les memes briefs lus par les memes ecrans.
 *
 * `action` exclut 'refresh' par son type : ce module ne fabrique plus aucune
 * mise a jour (decision du proprietaire, 2026-10-17).
 */
function buildBrief(draft: {
  subject: PlannedSubject
  campaign: Campaign
  index: number
  fields: BriefFields
  item: Partial<PlanItemBrief>
  action: Exclude<PlanItemAction, { kind: 'refresh' }>
  slug: string
  rationale: string
  pageGoal?: string
  extraRules?: string[]
  /** Pages a lier en plus de celles du modele : la page existante a ne pas concurrencer. */
  extraLinks?: string[]
}): PlanItemBrief {
  const { subject, campaign, index, fields, item, action } = draft
  const { pageType, city, targetKeyword, requiredEntities, searchIntent } = fields

  return {
    id: item.id || createPlanItemId(),
    scheduled_date: item.scheduled_date || subject.slot.scheduled_date,
    page_type: pageType,
    priority: action.kind === 'skip' ? 'low' : item.priority || priorityFor(pageType, index),
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
    ],
    required_entities: requiredEntities,
    internal_link_targets: dedupe([
      ...asStringArray(item.internal_link_targets, pageType === 'pillar' ? ['pages filles du cluster'] : ['page pilier parente']),
      ...(draft.extraLinks ?? []),
    ]),
    competitor_insights: asStringArray(item.competitor_insights, []),
    estimated_word_count:
      action.kind === 'skip' ? 0 : item.estimated_word_count || estimatedWords(pageType, campaign.target_length),
    rationale: draft.rationale,
    action,
  }
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
 * dit pas se lit comme un plan mesure. Les items 'skip' portent deja ces
 * mentions, ecrites par le domaine avec leur preuve : les redire ici les
 * compterait deux fois, donc seule la page neuve les recoit.
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
        `le moteur ne sait pas quelles pages ce site porte deja, le sujet n'a pas pu etre confronte a l'existant.`
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

// `subIntentKeyword` used to live here: it derived a fallback keyword from the
// striking-distance query assigned to a slot. No query is assigned any more
// (see the note that replaced `assignOpportunities`), so it had nothing to read.
//
// `guardAgainstCannibalization` used to live here too. It compared two strings
// for exact equality and pasted the town on the end when they matched — an
// exact match almost never happens, and the town-suffixed keyword was one a
// sibling slot had every chance of carrying. Its successor is the final guard of
// normalizeBriefs (lib/planning/distinct-angle.ts): a normalised, city- and
// stopword-insensitive comparison of the keyword the model actually returned
// against the site's keywords, the queries Search Console already credits to one
// of its pages, and the briefs retained earlier in the same plan.

function rationaleFor(pageType: PageType): string {
  return `Page ${pageType} planifiee pour renforcer la couverture longue traine.`
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
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
  // Read by the visitor when the model returns no title of its own: accented,
  // and no "pres de moi" — a query, not something a page says about itself.
  if (pageType === 'local_pack') return `${businessType} à ${city} et alentours`
  if (pageType === 'comparative') return `Quel ${businessType} choisir à ${city} ?`
  if (pageType === 'alternative') return `Alternative de ${businessType} à ${city}`
  return `${businessType} à ${city} : guide complet`
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
  return ['H2: Le besoin, en pratique', 'H2: Méthode et critères de choix', 'H2: Conseils pratiques', 'H2: FAQ']
}

function defaultRules(pageType: PageType, keyword: string) {
  return [
    `Reprendre le sujet "${keyword}", ecrit en francais correct, dans le title, le H1, l'introduction et un H2.`,
    'Inclure au moins 3 formulations longue traine naturelles.',
    'Ajouter une FAQ structuree.',
    pageType === 'local_pack'
      ? "Donner les informations pratiques de proximite : zones desservies, acces, avis reels s'il y en a."
      : 'Prevoir un maillage interne coherent.',
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

