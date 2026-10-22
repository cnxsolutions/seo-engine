import { generateJson } from './provider'
import type { PageType, PlanItemBrief } from '@/lib/types'
import {
  AiOutputError,
  DIRECT_ANSWER_RULES,
  FACTUAL_INTEGRITY_RULES,
  READER_FIRST_RULES,
  buildAuthorityRules,
  countHtmlWords,
  countWords,
  estimateMaxOutputTokens,
  firstNonEmpty,
  parseAiJsonObject,
  todayIso,
  type GeneratedPage,
  type PageAnomaly,
} from './openai'
import { createFullRagContextBuilder, type RagGenerationContext } from './full-rag-context'
import { buildExistingAwarenessBlock } from '@/lib/existing/prompt-block'
import { AUDIT_THRESHOLDS } from '@/lib/pipeline/seo-audit'
import type { EditorialAction } from '@/src/core/domain/existing/action'
import type { InventoryEntry, InventoryFreshness } from '@/src/core/domain/existing/inventory'

export interface PageTypeGenerateOptions {
  pageType: PageType
  city: string
  department: string
  businessType: string
  businessName: string
  keywords: string[]
  siteUrl: string
  targetLength?: number
  model?: string
  enableExternalLinks?: boolean
  externalLinkCount?: number
  enableImages?: boolean
  imagePerPage?: number
  pillarSlug?: string
  pillarTitle?: string
  competitorNames?: string[]
  alternativeNames?: string[]
  /**
   * The address this page will have, already written to `generations.slug`.
   *
   * REQUIRED, and required is the point. The slug used to be an OUTPUT of the
   * model, arbitrated against the existing pages only after the page had been
   * paid for; it is now an INPUT, reserved before the first token, with the
   * partial unique index (site_id, slug) as the arbiter. A caller that has
   * nothing to reserve — the cluster route — resolves it with `resolveFreeSlug`
   * and passes the result here.
   */
  reservedSlug: string
  /**
   * The pages of the site closest to this subject, ALREADY sorted by proximity.
   *
   * This module does not sort and does not fetch: it shows the first few. What
   * it replaces was `existingSlugs` and `existingKeywords`, two arrays of bare
   * strings from which no model could say how its page differed — a slug carries
   * neither a title, nor a meta description, nor a promise.
   */
  inventoryNeighbours: readonly InventoryEntry[]
  /**
   * What this generation does to the existing site: create, refresh, or skip.
   */
  action: EditorialAction
  /**
   * How much the list above can be trusted, and since when.
   *
   * Carried alongside the neighbours rather than derived from them, because an
   * empty list has two very different meanings — "this site has no page on the
   * subject" and "we have not looked at this site in two months" — and the
   * prompt must not present the second as the first.
   */
  inventoryFreshness: InventoryFreshness
  planBrief?: PlanItemBrief
  googleContext?: import('@/lib/google/context').GoogleContext | null
  enableRag?: boolean
  // Full RAG integration
  siteId?: string
  campaignId?: string
  /**
   * Why the previous attempt at THIS page was refused, one actionable line per
   * blocking finding (`PipelineReport.reasons`).
   *
   * Set only by the campaign runner when it regenerates a page the gate refused
   * (lib/scheduler/cron.ts). Absent or empty, the prompt is exactly what it was.
   */
  revisionFeedback?: readonly string[]
}

export interface GeneratedSeoPage extends GeneratedPage {
  pageType: PageType
  externalLinks: Array<{ url: string; anchor: string; domain: string; relevance: string }>
  parentSlug?: string
  relatedSlugs: string[]
  /**
   * Always present here (empty when the page is clean), unlike on
   * `GeneratedPage` where legacy rows rebuilt from scalar columns have none.
   */
  anomalies: PageAnomaly[]
  // RAG stats
  ragStats?: {
    buildTimeMs: number
    sourcesUsed: string[]
    keywordsIncluded: number
    examplesFound: number
    linksSuggested: number
  }
  // RAG context for reference
  ragContext?: {
    taxonomy?: string
    competitor?: string
    google?: string
    structure?: string
  }
}

export { AiOutputError }
export type { PageAnomaly }

// ─── Search intent ─────────────────────────────────────────────────────────

/**
 * The four intents Google separates. The page type says what SHAPE the page
 * takes; the intent says what the reader wants from it — and therefore the
 * format, the tone and the CTA. Without it, every page ends up written like an
 * informational article with a generic "contactez-nous" at the bottom.
 */
export type SearchIntent = 'informationnelle' | 'commerciale' | 'transactionnelle' | 'navigationnelle'

const INTENT_MARKERS: Array<{ intent: SearchIntent; markers: RegExp }> = [
  // Navigational first: "horaires", "adresse" are unambiguous, while "prix" or
  // "avis" also appear inside commercial and transactional queries.
  {
    intent: 'navigationnelle',
    markers: /\b(horaires?|adresse|itineraire|itinéraire|ou\s+se\s+trouve|où\s+se\s+trouve|telephone|téléphone|numero|numéro|coordonnees|coordonnées|ouvert\s+maintenant|acces|accès)\b/i,
  },
  {
    intent: 'transactionnelle',
    markers: /\b(devis|prix|tarifs?|combien\s+coute|combien\s+coûte|pas\s+cher|acheter|commander|reserver|réserver|urgence|urgent|depannage|dépannage|installation|installer|remplacement|rendez-?vous|contact|intervention|24h|7j)\b/i,
  },
  {
    intent: 'commerciale',
    markers: /\b(meilleurs?|comparatif|comparaison|avis|top\s?\d*|classement|alternative|versus|\bvs\b|quel|quelle|choisir|selection|sélection|guide\s+d'achat)\b/i,
  },
  {
    intent: 'informationnelle',
    markers: /\b(comment|pourquoi|qu'est-ce|quest-ce|definition|définition|quand|difference|différence|faut-il|peut-on|guide|etapes|étapes)\b/i,
  },
]

/**
 * Qualify the intent of a page.
 *
 * The plan brief already carries a `search_intent` field, so it wins whenever it
 * is readable. Otherwise the intent is deduced from the target query, and only
 * then does the page type provide a default.
 */
export function resolveSearchIntent(
  briefIntent: string | undefined,
  targetKeyword: string,
  pageType: PageType
): SearchIntent {
  const declared = normalizeDeclaredIntent(briefIntent)
  if (declared) return declared

  for (const { intent, markers } of INTENT_MARKERS) {
    if (markers.test(targetKeyword)) return intent
  }

  return PAGE_TYPE_CONFIG[pageType].defaultIntent
}

function normalizeDeclaredIntent(raw: string | undefined): SearchIntent | null {
  if (!raw) return null
  const value = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

  if (/transaction|achat|conversion|commande|devis/.test(value)) return 'transactionnelle'
  if (/commercial|comparai|comparat|investigation|consideration/.test(value)) return 'commerciale'
  if (/navigation|marque|local\s?pack|contact/.test(value)) return 'navigationnelle'
  if (/information|educat|decouverte|apprentissage/.test(value)) return 'informationnelle'
  return null
}

const INTENT_DIRECTIVES: Record<SearchIntent, string> = {
  informationnelle: `
INTENTION : INFORMATIONNELLE (le lecteur veut comprendre, pas acheter maintenant).
- Format : reponse d'abord, explication ensuite. H2 formules en questions reelles (People Also Ask).
- Ton pedagogique et neutre. Etapes numerotees, definitions courtes, cas de figure concrets.
- Aucun argumentaire commercial dans les 3 premieres sections.
- CTA final unique et non agressif : proposer un accompagnement ou un diagnostic, pas "achetez".
- Pas de prix, pas de promesse commerciale.`,
  commerciale: `
INTENTION : COMMERCIALE (le lecteur compare avant de choisir).
- Format : criteres de choix explicites AVANT toute recommandation, puis tableau comparatif lisible.
- Presenter honnetement avantages ET limites de chaque option, y compris la notre.
- Ne JAMAIS attribuer un defaut, un prix ou un chiffre a un concurrent nomme : en droit francais la
  publicite comparative doit etre objective, verifiable et non denigrante. Comparer des CATEGORIES
  d'offres (artisan independant, grande enseigne, plateforme) plutot que denigrer une marque.
- Conclusion contextuelle : "si votre besoin est X, alors Y" — pas de "nous sommes les meilleurs".
- CTA : demander un conseil / comparer une solution adaptee.`,
  transactionnelle: `
INTENTION : TRANSACTIONNELLE (le lecteur veut passer a l'action maintenant).
- Format : la reponse directe dit ce que le lecteur obtient et comment l'obtenir.
- Infos operationnelles tot dans la page : zone d'intervention, delai, deroule de la prestation,
  ce qui est inclus. Uniquement des elements fournis ; sinon rester qualitatif.
- CTA present 3 fois : apres la reponse directe, au milieu, en fin de page. Verbes d'action.
- Lever les freins dans la FAQ (delai, deroulement, prise en charge, zone couverte).
- Aucun prix chiffre sauf tarif reellement fourni.`,
  navigationnelle: `
INTENTION : NAVIGATIONNELLE (le lecteur cherche a joindre ou situer l'etablissement).
- Format : NAP (nom, adresse, telephone) et horaires en haut de page si ces donnees sont fournies.
- Ajouter acces, zones desservies, points de repere du quartier.
- Contenu court et dense, aucun remplissage editorial avant l'information pratique.
- CTA : appeler / obtenir l'itineraire / prendre rendez-vous.
- Si une donnee NAP n'est pas fournie, ne pas l'inventer : ecrire la section sans elle.`,
}

// ─── Page types ────────────────────────────────────────────────────────────

const PAGE_TYPE_CONFIG: Record<PageType, {
  systemPromptExtra: string
  targetLengthMultiplier: number
  minFaq: number
  requiredSections: string[]
  defaultIntent: SearchIntent
}> = {
  // No "child_links" section, keyword density, streets or "pres de moi" here
  // any more. Asked for a section of links to child pages that did not exist
  // yet, the model wrote one ABOUT them — "Pages locales a creer en priorite",
  // "Les ancres doivent rester naturelles" — in front of the visitor. Linking
  // the cluster is the engine's job (pillar-hub block, lib/seo/smart-linking.ts);
  // the locality lists were the stuffing.
  pillar: {
    systemPromptExtra: `Tu rediges une PAGE PILIER : la page de reference du site sur un sujet large.
Elle donne au lecteur une vue d'ensemble complete et fiable, et le renvoie, par des liens places dans le texte, vers les pages du site qui detaillent chaque point.
Structure: introduction, contexte, sous-sections detaillees, FAQ riche, CTA. Au moins 7 sous-titres H2, dont 3 formules comme les vraies questions des lecteurs.
SLUG LONG-TAIL: format [activite]-[service-complet]-[specialite]-[ville]-[departement] (minimum 6 mots).
Ancrage local: la realite de la ville et du departement (types d'entreprises, contraintes, habitudes), illustree par des situations concretes, plutot qu'une liste de quartiers ou de rues.`,
    targetLengthMultiplier: 2.5,
    minFaq: 6,
    requiredSections: ['hero', 'introduction', 'context', 'detailed_sections', 'faq', 'cta'],
    defaultIntent: 'informationnelle',
  },
  child: {
    systemPromptExtra: `Tu rediges une PAGE FILLE : elle approfondit un aspect precis d'un sujet plus large que le site traite sur une page generale.
Elle lie, dans le texte, cette page generale et, quand c'est utile au lecteur, les pages voisines.
Plus focalisee que la page generale, elle approfondit un angle precis et longue traine.
SLUG LONG-TAIL: format [service-specifique]-[action]-[contexte]-[ville]-[quartier] (minimum 6 mots).
Le title vise une intention specifique, en 60 caracteres maximum ; une question seulement si elle est bien formee.
Le schemaBreadcrumb suit : Accueil > [titre de la page generale] > [titre de cette page].
Ancrage local: un quartier, une commune voisine ou un repere seulement quand il apporte une information utile.`,
    targetLengthMultiplier: 1.0,
    minFaq: 3,
    requiredSections: ['hero', 'content', 'faq', 'cta'],
    defaultIntent: 'informationnelle',
  },
  alternative: {
    systemPromptExtra: `Tu rediges une PAGE ALTERNATIVE ("Alternative a X" ou "X vs Y").
L'objectif est de capter le trafic des personnes cherchant des alternatives a un service/produit concurrent.
Structure: introduction du besoin, presentation des alternatives avec avantages/inconvenients, tableau comparatif, recommandation finale.
SLUG LONG-TAIL: format alternative-a-[concurrent]-[service]-[ville]-[annee] (minimum 6 mots).
Ton objectif et impartial. La comparaison porte sur des criteres factuels et verifiables (perimetre
du service, delai, mode d'intervention, garanties annoncees) — jamais sur des chiffres ou des defauts
attribues a un concurrent nomme, ni sur des avis clients non fournis.
Cibler les intentions: "pas cher", "meilleur rapport qualite prix", "avis clients".`,
    targetLengthMultiplier: 1.5,
    minFaq: 4,
    requiredSections: ['hero', 'why_alternatives', 'comparison_table', 'detailed_alternatives', 'recommendation', 'faq', 'cta'],
    defaultIntent: 'commerciale',
  },
  comparative: {
    systemPromptExtra: `Tu rediges une PAGE COMPARATIVE detaillee (type "A vs B" ou "Comparatif des meilleurs X").
Structure avec tableau comparatif, criteres de comparaison clairs, avantages/inconvenients pour chaque option.
SLUG LONG-TAIL: format comparatif-meilleur-[activite]-[ville]-[critere]-[annee] (minimum 6 mots).
Ton neutre et expert. Les "scores" sont des appreciations qualitatives justifiees par un critere
explicite (ex: "adapte aux interventions urgentes"), JAMAIS des notes chiffrees inventees.
Finir par une recommandation contextuelle (selon le besoin du lecteur).
Cibler: "meilleur X a Y", "top X", "quel X choisir", "X ou Y lequel choisir".`,
    targetLengthMultiplier: 1.8,
    minFaq: 4,
    requiredSections: ['hero', 'criteria', 'comparison_table', 'detailed_comparison', 'scores', 'verdict', 'faq', 'cta'],
    defaultIntent: 'commerciale',
  },
  local_pack: {
    systemPromptExtra: `Tu rediges une PAGE LOCAL PACK optimisee pour le pack local Google (Google Maps / 3-pack).
Rends la page utile a quelqu'un qui est sur place : zones reellement desservies, acces, deroulement d'une intervention dans le secteur.
Le NAP (nom, adresse, telephone), les horaires et la note Google ne sont ecrits QUE s'ils sont fournis
dans les donnees Google Business Profile ci-dessous. Aucune de ces valeurs ne s'invente.
SLUG LONG-TAIL: format [activite]-[quartier-ou-rue]-[ville]-proximite-[service] (minimum 6 mots).
Les recherches "pres de moi", "ouvert maintenant" ou "urgence" se servent par des informations pratiques (zones, disponibilite, delais qualitatifs), jamais en recopiant ces expressions dans le texte.
Le schema LocalBusiness est detaille (geo, openingHours, areaServed) mais ne contient aggregateRating
que si une note et un nombre d'avis reels sont fournis.
Section temoignages: uniquement a partir des avis REELS fournis. Si aucun avis n'est fourni, la
remplacer par une section "Nos engagements" de longueur equivalente, sans citation inventee.
Une section zones desservies nomme au moins 5 quartiers ou communes couverts, chacun avec une precision utile ; ailleurs dans la page, aucune enumeration de lieux.`,
    targetLengthMultiplier: 1.2,
    minFaq: 3,
    requiredSections: ['hero', 'local_info', 'services', 'areas_served', 'testimonials', 'faq', 'cta'],
    defaultIntent: 'transactionnelle',
  },
}

// ─── Length discipline ─────────────────────────────────────────────────────

/**
 * Relative weight of each section in the word budget.
 *
 * A single global word count is an instruction a model does not follow: it
 * writes until the page "feels" finished. A per-section budget is checkable
 * while writing, which is what makes the total reachable.
 */
const SECTION_WEIGHTS: Record<string, number> = {
  hero: 1,
  introduction: 1.5,
  context: 1.8,
  detailed_sections: 4,
  child_links: 0.6,
  content: 4,
  parent_link: 0.5,
  why_alternatives: 1.5,
  comparison_table: 1.5,
  detailed_alternatives: 3,
  recommendation: 1.2,
  criteria: 1.5,
  detailed_comparison: 3,
  scores: 0.8,
  verdict: 1.2,
  local_info: 1.2,
  services: 2,
  areas_served: 1.5,
  testimonials: 0.8,
  faq: 2.5,
  cta: 0.5,
}

export interface SectionBudget {
  section: string
  words: number
}

/**
 * Split the word target across the required sections.
 *
 * The direct answer block is excluded from the split: it is a fixed 50-word
 * cost that sits outside the section structure.
 */
export function buildLengthPlan(totalWords: number, sections: string[]): SectionBudget[] {
  if (sections.length === 0) return []

  const budget = Math.max(0, totalWords - 50)
  const weights = sections.map((section) => SECTION_WEIGHTS[section] ?? 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  return sections.map((section, index) => ({
    section,
    words: Math.max(40, Math.round((budget * weights[index]) / totalWeight / 10) * 10),
  }))
}

function formatLengthPlan(plan: SectionBudget[]): string {
  return plan.map((entry) => `  - ${entry.section} : ~${entry.words} mots`).join('\n')
}

// ─── Generation ────────────────────────────────────────────────────────────

/**
 * How many words the page should actually contain.
 *
 * The brief WINS when it carries a figure, because that figure is a measurement:
 * the planner derives it from the median length of the pages currently ranking
 * for the target query. The campaign's `target_length × pageTypeMultiplier` is a
 * guess about a page type in the abstract, made before anyone looked at the SERP.
 *
 * This ordering is the whole point of reading the SERP. Ignoring the brief is how
 * a query whose competitors run ~1 100 words produced a 2 692-word page: the
 * measurement reached the brief, and the generator overrode it with 800 × 2.5.
 *
 * Over-length is not harmless on a transactional local query — it dilutes the
 * answer, buries the booking intent, and costs tokens for text nobody reads.
 *
 * The multiplier still applies when there is no brief (a manual run, a site with
 * no SERP evidence): a pillar page genuinely warrants more room than a child one.
 */
export function resolveGenerationLength(
  briefWordCount: number | undefined,
  campaignTargetLength: number,
  pageTypeMultiplier: number
): number {
  if (briefWordCount && briefWordCount >= MIN_CREDIBLE_BRIEF_WORDS) {
    return Math.round(briefWordCount)
  }
  return Math.round(campaignTargetLength * pageTypeMultiplier)
}

/**
 * Below this, a brief's word count is treated as noise rather than a measurement.
 *
 * A malformed plan item or a SERP of one-line directory listings can yield a
 * figure so low that honouring it would produce a page too thin to rank at all —
 * the failure mode the quality gate exists to prevent.
 */
const MIN_CREDIBLE_BRIEF_WORDS = 300

export async function generateSeoPage(opts: PageTypeGenerateOptions): Promise<GeneratedSeoPage> {
  const {
    pageType,
    city,
    department,
    businessType,
    businessName,
    keywords,
    siteUrl,
    targetLength = 800,
    model = 'claude-haiku',
    enableExternalLinks = true,
    externalLinkCount = 3,
    enableImages = true,
    imagePerPage = 2,
    pillarSlug,
    pillarTitle,
    competitorNames = [],
    alternativeNames = [],
    planBrief,
    enableRag = true,
    siteId: explicitSiteId,
  } = opts

  const config = PAGE_TYPE_CONFIG[pageType]
  const adjustedLength = resolveGenerationLength(planBrief?.estimated_word_count, targetLength, config.targetLengthMultiplier)
  const mainKeyword = planBrief?.target_keyword || `${businessType} ${city}`
  const searchIntent = resolveSearchIntent(planBrief?.search_intent, mainKeyword, pageType)

  // Build FULL RAG context if RAG is enabled.
  //
  // The gate is `enableRag` alone, deliberately. Gating on `siteId` as well
  // made the URL fallback below unreachable — it sat inside the very block it
  // was supposed to unlock — so any caller that knew the site only by URL
  // silently generated without retrieval.
  let fullRagContext: RagGenerationContext | undefined = undefined
  if (enableRag) {
    try {
      const builder = createFullRagContextBuilder({ enabled: true })
      const resolvedSiteId = explicitSiteId || await getSiteIdFromUrl(opts.siteUrl)
      if (resolvedSiteId) {
        // Get campaign from siteId if not provided
        const campaign = opts.planBrief ? undefined : await getCampaignFromSite(resolvedSiteId)

        fullRagContext = await builder.buildContext({
          siteId: resolvedSiteId,
          campaign: campaign || {
            id: '',
            name: '',
            business_type: businessType,
            business_name: businessName,
            keywords,
            department,
            communes: [city],
            frequency_hours: 24,
            ai_model: model,
            target_length: targetLength,
            is_active: true,
            auto_publish: false,
            publish_status: 'draft' as const,
            site_id: resolvedSiteId,
            created_at: '',
            updated_at: '',
          },
          pageType,
          focusKeyword: mainKeyword,
          secondaryKeywords: keywords,
          city,
          department,
          planBrief,
        })
      }
    } catch (error) {
      console.warn('[generateSeoPage] Full RAG context build failed:', error)
    }
  }

  const systemPrompt = buildSystemPrompt(pageType, config.systemPromptExtra, searchIntent)
  const userPrompt = buildUserPrompt({
    pageType,
    city,
    department,
    businessType,
    businessName,
    keywords,
    siteUrl,
    adjustedLength,
    enableExternalLinks,
    externalLinkCount,
    enableImages,
    imagePerPage,
    minFaq: config.minFaq,
    requiredSections: config.requiredSections,
    pillarSlug,
    pillarTitle,
    competitorNames,
    alternativeNames,
    // ONE block about what the site already carries, built once, here.
    //
    // Two used to travel in this same prompt: the "ANTI-DOUBLON (CRITIQUE)"
    // section below and `buildAntiDuplicateBlock` inside the RAG context, on the
    // same corpus, at two different truncations, under two different headings.
    existingAwareness: buildExistingAwarenessBlock({
      reservedSlug: opts.reservedSlug,
      neighbours: opts.inventoryNeighbours,
      action: opts.action,
      freshness: opts.inventoryFreshness,
    }),
    planBrief,
    googleContext: opts.googleContext || undefined,
    fullRagContext,
    searchIntent,
    revisionFeedback: opts.revisionFeedback,
  })

  const raw = await generateJson({
    systemPrompt,
    userPrompt,
    // The old flat budget (8000 tokens above 1500 words) truncated every pillar
    // page, which is the surest way to land under the length target.
    maxTokens: estimateMaxOutputTokens(adjustedLength),
    model,
    temperature: 0.6,
  })

  const parsed = parseAiJsonObject(raw, `page ${pageType} ${mainKeyword}`)
  return normalizeResponse(parsed, opts, adjustedLength, searchIntent, fullRagContext)
}

export function buildSystemPrompt(pageType: PageType, extra: string, searchIntent: SearchIntent): string {
  // A writer who knows SEO, not an SEO expert who writes. The persona this
  // replaced — "Google Certified Partner", "RankMath 100/100" — wrote the way it
  // was described: for the score, with the strategy showing through the text.
  return `Tu es un redacteur web francophone experimente, qui ecrit pour les clients de l'entreprise avec la precision d'un professionnel du metier.
Tu maitrises le referencement (SEO, GEO, E-E-A-T, schema.org, maillage interne et externe) : il organise la page, il ne se lit jamais dans le texte.

TYPE DE PAGE: ${pageType.toUpperCase()}
${extra}

${INTENT_DIRECTIVES[searchIntent].trim()}

REGLES ABSOLUES:
- Reponds UNIQUEMENT en JSON valide, sans markdown, sans backticks.
- Le contenu est unique et naturel : un professionnel du metier le trouve juste, un client le trouve utile.
- Appuie-toi sur des elements concrets: etapes, cas de figure, contraintes locales, vocabulaire metier.
- Varie les formulations et la structure des phrases.

${READER_FIRST_RULES}

${FACTUAL_INTEGRITY_RULES}
`.trim()
}

export function buildUserPrompt(opts: {
  pageType: PageType
  city: string
  department: string
  businessType: string
  businessName: string
  keywords: string[]
  siteUrl: string
  adjustedLength: number
  enableExternalLinks: boolean
  externalLinkCount: number
  enableImages: boolean
  imagePerPage: number
  minFaq: number
  requiredSections: string[]
  pillarSlug?: string
  pillarTitle?: string
  competitorNames: string[]
  alternativeNames: string[]
  /** Already rendered by lib/existing/prompt-block.ts. Inserted verbatim. */
  existingAwareness: string
  planBrief?: PlanItemBrief
  googleContext?: import('@/lib/google/context').GoogleContext
  fullRagContext?: RagGenerationContext
  searchIntent: SearchIntent
  today?: string
  /** See `PageTypeGenerateOptions.revisionFeedback`. */
  revisionFeedback?: readonly string[]
}): string {
  const mainKeyword = opts.planBrief?.target_keyword || `${opts.businessType} ${opts.city}`
  const year = new Date().getFullYear()
  const isoDate = opts.today ?? todayIso()
  const lengthPlan = buildLengthPlan(opts.adjustedLength, opts.requiredSections)
  const minimumWords = Math.round(opts.adjustedLength * 0.85)
  // Upper bound stated to the model, kept below the gate's 150% warning so a
  // page that follows the prompt never trips it. The instruction used to be a
  // floor with no ceiling — written when the problem was a model that
  // under-wrote — and a model that obeys a floor writes past it indefinitely.
  const maximumWords = Math.round(opts.adjustedLength * 1.25)

  let contextBlock = ''
  if (opts.pageType === 'child' && opts.pillarSlug && opts.pillarTitle) {
    contextBlock = `
- Page generale du sujet : "${opts.pillarTitle}" (slug: /${opts.pillarSlug})
- La lier dans le texte, sur des mots qui disent ce que le lecteur y trouvera.`
  }
  if (opts.pageType === 'alternative' && opts.alternativeNames.length > 0) {
    contextBlock = `
- Alternatives a comparer : ${opts.alternativeNames.join(', ')}
- Notre solution : ${opts.businessName}`
  }
  if (opts.pageType === 'comparative' && opts.competitorNames.length > 0) {
    contextBlock = `
- Elements a comparer : ${opts.competitorNames.join(', ')}
- Inclure notre solution : ${opts.businessName}`
  }

  const externalLinksBlock = opts.enableExternalLinks
    ? `
- Entre 1 et ${opts.externalLinkCount} liens externes vers des sources d'autorite REELLES (sites gouvernementaux, organismes officiels, Wikipedia, federations professionnelles).
- Chaque source appuie une affirmation precise de la page, et "anchor" reprend MOT POUR MOT des mots de cette phrase : le lien y est pose a la publication. Une source qui n'appuie rien n'est pas ajoutee.
- Une URL dont tu n'es pas certain est remplacee par la page d'accueil du domaine officiel. Jamais d'URL inventee.
- Format: {"url": "https://...", "anchor": "texte d'ancrage", "domain": "example.com", "relevance": "pourquoi ce lien est pertinent"}`
    : '- Pas de liens externes.'

  const imagesBlock = opts.enableImages
    ? `
- Proposer ${opts.imagePerPage} suggestions d'images avec alt text optimise SEO.
- Format imageAlts: ["alt text descriptif avec mot-cle"]`
    : '- Pas d\'images requises.'

  const briefBlock = opts.planBrief
    ? `
BRIEF DU PLAN A RESPECTER STRICTEMENT:
- Titre cible: ${opts.planBrief.proposed_title}
- Slug cible: ${opts.planBrief.proposed_slug}
- Mot-cle focus cible: ${opts.planBrief.target_keyword}
- Intention declaree (usage interne): ${opts.planBrief.search_intent}
- Objectif: ${opts.planBrief.page_goal}
- Trame obligatoire: ${opts.planBrief.outline.join(' | ')}
- Regles SEO (a appliquer, jamais a ecrire dans la page): ${opts.planBrief.seo_rules.join(' | ')}
- Entites requises: ${opts.planBrief.required_entities.join(', ')}
- Maillage interne suggere: ${opts.planBrief.internal_link_targets.join(', ')}
- Insights concurrents a exploiter sans copier: ${opts.planBrief.competitor_insights.join(' | ') || 'aucun'}

La trame donne les sujets a couvrir, dans l'ordre : chaque point devient un titre ecrit pour le lecteur. Un point
qui decrit une tache de referencement (maillage, liens, ancres, pages a creer, mots-cles) n'est pas une section :
applique-le par des liens dans le texte, sans en parler.
Tu dois conserver le slug cible et le mot-cle focus cible dans la reponse JSON.`
    : ''

  let googleBlock = ''
  if (opts.googleContext?.gbp) {
    const g = opts.googleContext.gbp
    googleBlock += `
DONNEES GOOGLE BUSINESS PROFILE (REELLES — utiliser comme preuve sociale et coherence NAP):
- Nom officiel: ${g.businessName}
- Adresse: ${g.address}
- Telephone: ${g.phone}
- Horaires: ${g.hours}
- Note Google: ${g.averageRating}/5 (${g.reviewCount} avis)
- Avis clients recents: ${g.topReviews.slice(0, 5).map((r) => `"${r}"`).join(' | ') || 'aucun'}
- Services/categories: ${g.services.join(', ') || 'non renseigne'}
IMPORTANT: Utiliser les VRAIES informations ci-dessus (tel, adresse, horaires) dans le contenu. Ne pas inventer.
`
  } else {
    googleBlock += `
DONNEES GOOGLE BUSINESS PROFILE: AUCUNE.
=> Aucune adresse, aucun telephone, aucun horaire, aucune note et aucun avis client ne doivent
   apparaitre dans la page ni dans les schemas. Ecris les sections concernees sans ces elements.
`
  }
  if (opts.googleContext?.gsc) {
    const s = opts.googleContext.gsc
    googleBlock += `
REQUETES SEARCH CONSOLE DU SITE (donnees internes : elles disent ce que cherchent les visiteurs, elles ne s'ecrivent JAMAIS dans la page):
- Top requetes: ${s.topQueries.slice(0, 8).map((q) => `"${q.query}" (pos ${q.position})`).join(', ')}
- Position moyenne: ${s.averagePosition}
Usage : garde seulement les requetes qui portent sur le sujet de CETTE page et sur sa ville, ignore les autres
(une requete sur une autre ville ou un autre service n'a rien a faire ici). Une requete retenue est un besoin a
traiter, reformule en francais correct : jamais recopiee telle quelle, jamais enumeree, jamais attribuee a la
Search Console, a des positions ou a des "signaux".
`
  }

  // Full RAG Context Block (using ALL sources: Taxonomy, Competitor, Google, RAG examples)
  let ragBlock = ''
  if (opts.fullRagContext) {
    const builder = createFullRagContextBuilder({ enabled: true })
    ragBlock = '\n\n' + builder.formatAsPrompt(opts.fullRagContext)
  }

  return `
Genere une page SEO de type "${opts.pageType}" complete et optimisee pour :

- Type d'activite : ${opts.businessType}
- Business : ${opts.businessName}
- Ville cible : ${opts.city} (${opts.department})
- Site web : ${opts.siteUrl}
- Mots-cles (des sujets, a ecrire en francais correct) : ${opts.keywords.join(', ')}
- Mot-cle focus : "${mainKeyword}"
- Intention de recherche qualifiee : ${opts.searchIntent} (usage interne : elle regle le ton et le format, ne la nomme jamais)
- Longueur cible : ${opts.adjustedLength} a ${maximumWords} mots (mesuree sur les pages qui se positionnent deja)
- Annee : ${year}
- Date de publication : ${isoDate}
- Minimum FAQ : ${opts.minFaq} questions
- Sections requises : ${opts.requiredSections.join(', ')}
${contextBlock}
${briefBlock}
${googleBlock}${ragBlock}

${DIRECT_ANSWER_RULES}

${buildAuthorityRules(opts.businessName, isoDate)}

BUDGET DE LONGUEUR PAR SECTION (a respecter section par section, c'est ainsi qu'on atteint la cible):
${formatLengthPlan(lengthPlan)}
  - bloc de reponse directe : 40 a 60 mots
Total attendu : ${opts.adjustedLength} a ${maximumWords} mots de texte reel (hors balises HTML).
Cette fourchette vient de la longueur MEDIANE des pages qui se positionnent sur la requete cible.
La depasser ne fait pas mieux classer : cela dilue la reponse et enterre l'intention de l'utilisateur.
Couvrir le sujet dans la fourchette, puis s'arreter.

MAILLAGE EXTERNE:
${externalLinksBlock}

IMAGES:
${imagesBlock}

REPONDS EN JSON avec cette structure :
{
  "title": "string (max 65 chars, intention specifique, mot-cle focus inclus ; une question seulement si elle est bien formee, jamais un '?' ajoute a un groupe nominal)",
  "metaDescription": "string (max 155 chars, mot-cle focus + benefice + CTA + localisation)",
  "slug": "recopie exactement le slug reserve annonce plus bas, sans rien y ajouter",
  "focusKeyword": "${mainKeyword}",
  "secondaryKeywords": ["MINIMUM 8 mots-cles: 2 variations geo (quartiers/communes voisines), 2 questions longue-traine, 2 'pres de moi/a proximite', 2 variantes service specifique — metadonnees, pas a placer telles quelles dans le texte"],
  "searchIntent": "${opts.searchIntent}",
  "ogTitle": "string",
  "ogDescription": "string",
  "twitterTitle": "string",
  "twitterDescription": "string",
  "directAnswer": "40 a 60 mots, copie exacte du <p class='reponse-directe'> place juste apres le H1",
  "htmlContent": "HTML complet: H1, reponse directe, toutes les sections requises, bloc auteur, CTA",
  "schemaLocalBusiness": "JSON-LD string. @type OBLIGATOIREMENT un sous-type de LocalBusiness, jamais un Service. Sous-types valides: LocalBusiness, ProfessionalService, AutomotiveBusiness, HomeAndConstructionBusiness, MedicalBusiness, HealthAndBeautyBusiness, FoodEstablishment, Store, LegalService, RealEstateAgent, TravelAgency, LodgingBusiness, EmergencyService, ChildCare, Dentist, Physician, EntertainmentBusiness, SportsActivityLocation, FinancialService, DryCleaningOrLaundry, SelfStorage. Si aucun ne correspond exactement a l'activite, utiliser LocalBusiness. INTERDIT: TaxiService, Service, Product, Organization seule (TaxiService est un Service dans schema.org, pas un LocalBusiness: Google n'en tire aucun resultat enrichi local).",
  "schemaFaqPage": "JSON-LD string",
  "schemaBreadcrumb": "JSON-LD string",
  "schemaArticle": "JSON-LD string (author Organization, publisher, datePublished, dateModified, inLanguage)",
  "author": "${opts.businessName}",
  "datePublished": "${isoDate}",
  "dateModified": "${isoDate}",
  "internalLinks": [{"anchor": "string", "suggestion": "slug de la page cible"}],
  "internalLinksHtml": ["<a href='/url'>ancre</a>"],
  "faqItems": [{"q": "string", "a": "string"}],
  "imageAlts": ["string"],
  "externalLinks": [{"url": "string", "anchor": "string", "domain": "string", "relevance": "string"}],
  "relatedSlugs": ["slugs de pages liees suggerees"],
  "ctaText": "Nous contacter",
  "targetLength": ${opts.adjustedLength},
  "estimatedWordCount": number,
  "readingTimeMinutes": number
}

${opts.existingAwareness}

STRATEGIE LONG-TAIL (OBLIGATOIRE):
- Le TITLE cible une intention longue-traine precise, en 60 caracteres maximum (ex: "Fuite urgente à Troyes : quel plombier appeler ?")
- OBLIGATOIRE dans le contenu:
  * Le sujet du mot-cle focus est decline avec le vocabulaire du metier (synonymes, formulations voisines) plutot que repete a l'identique
  * Au moins 3 sous-titres H2 formules comme les vraies questions des lecteurs
  * Chaque H2-question commence par y repondre directement, en une ou deux phrases, SANS etiquette ("Réponse courte :" est interdit)
  * L'ancrage dans ${opts.city} passe par des situations et des contraintes reelles, pas par une liste de quartiers, de rues ou de codes postaux
- secondaryKeywords DOIT contenir au minimum 8 mots-cles diversifies (metadonnees : ils ne se placent pas tels quels dans le texte)

Contraintes critiques :
1. Le mot-cle focus "${mainKeyword}" apparait dans title, metaDescription, H1, reponse directe, un H2, et le slug —
   partout sauf dans le slug, ce sont ses MOTS qui comptent, ecrits en francais correct (accents, articles,
   majuscules), jamais sa forme brute de requete.
2. Minimum ${opts.minFaq} questions FAQ, coherentes avec faqItems et schemaFaqPage.
3. Le contenu tient dans la fourchette ${opts.adjustedLength} a ${maximumWords} mots.
4. Les liens externes pointent vers des sources REELLES et fiables (pas de liens inventes).
5. Le maillage interne (champ internalLinks) suggere des pages coherentes avec le sujet. Dans le texte, un lien est une ancre descriptive, jamais un commentaire sur le maillage.
6. Schema.org complet et valide, sans aucune propriete inventee.
7. Le slug est celui qui t'est donne. Il est deja reserve : toute autre valeur sera ignoree.
8. Si une page listee ci-dessus traite deja le sujet, VARIER l'angle (sous-intention, geo-specifique, question differente).

${buildAuditChecklist({
    mainKeyword,
    city: opts.city,
    businessName: opts.businessName,
    minFaq: opts.minFaq,
    enableExternalLinks: opts.enableExternalLinks,
    requiredEntities: opts.planBrief?.required_entities ?? [],
  })}

RAPPEL FINAL — LES QUATRE POINTS QUI DECIDENT DE LA VALIDATION DE CETTE PAGE :
1. LONGUEUR : le texte reel de htmlContent (hors balises) doit tenir entre ${opts.adjustedLength} et
   ${maximumWords} mots. En dessous de ${minimumWords} mots la page est REJETEE automatiquement.
   Au-dessus de ${maximumWords} elle est signalee comme diluee. Avant de repondre, verifie chaque
   section contre son budget ci-dessus : developpe celles qui sont courtes avec du contenu utile,
   RESSERRE celles qui debordent — jamais de repetition, de paraphrase ni de remplissage.
2. REPONSE DIRECTE : 40 a 60 mots juste apres le H1, autosuffisante, sans renvoi a la suite,
   recopiee a l'identique dans "directAnswer".
3. AUCUN FAIT INVENTE : pas de chiffre, de prix, de note, d'avis, de source ou de citation qui ne
   figure pas dans les donnees fournies ci-dessus. En cas de doute, supprime l'element.
4. ECRITE POUR LE LECTEUR : aucune donnee interne (requetes, Search Console, positions), aucun mot-cle
   recopie sans ses accents ni ses majuscules, aucune phrase sur la page elle-meme ("cette page pilier",
   "cluster", "maillage"), aucune etiquette repetee ("Réponse courte :"). Relis chaque section en te
   demandant si un client l'aurait trouvee utile ; sinon, reecris-la.
${buildRevisionBlock(opts.revisionFeedback)}`.trim()
}

/**
 * What the pre-publication audit checks, said to the model BEFORE it writes.
 *
 * Every figure comes from `AUDIT_THRESHOLDS` (lib/pipeline/seo-audit.ts), the
 * very constants the gate judges the page with. A prompt that asked for "a
 * question-shaped long title" while the gate refused titles over 70 characters
 * made the first attempt fail by construction and paid a regeneration to learn
 * what the prompt could have said. One source, so the two cannot drift apart.
 */
export function buildAuditChecklist(opts: {
  mainKeyword: string
  city: string
  businessName: string
  minFaq: number
  enableExternalLinks: boolean
  requiredEntities: readonly string[]
}): string {
  const T = AUDIT_THRESHOLDS
  const entities = opts.requiredEntities.filter(Boolean)

  const lines = [
    `- title : entre ${T.titleMin} et ${T.titleComfortMax} caracteres (jamais plus de ${T.titleMax}), avec les mots du mot-cle focus "${opts.mainKeyword}". Une question longue-traine n'est acceptee que si elle tient dans cette longueur.`,
    `- metaDescription : entre ${T.metaComfortMin} et ${T.metaComfortMax} caracteres.`,
    `- Un seul H1, qui contient les mots du mot-cle focus. Hierarchie stricte : H2 puis H3, jamais de niveau saute, jamais de H3 avant le premier H2.`,
    `- Au moins ${T.h2MinLong} H2 (au moins ${T.h2MinShort} si la page fait moins de ${T.h2LongPageWords} mots), dont au moins ${T.questionHeadingsMin} formules en questions.`,
    `- Les mots du mot-cle focus apparaissent dans les ${T.introWords} premiers mots apres le H1. L'expression exacte ne depasse jamais ${Math.round(T.keywordDensityMax * 100)} % des mots, et n'apparait pas dans plus de la moitie des H2.`,
    `- Le premier <p> apres le H1 est la reponse directe : entre ${T.directAnswerMin} et ${T.directAnswerMax} mots, avant tout autre titre.`,
    `- Au moins une liste <ul> ou <ol>, ou un tableau <table>, dans le contenu.`,
    opts.city ? `- "${opts.city}" est nomme au moins ${T.cityMentionsMin} fois dans le texte.` : '',
    `- "${opts.businessName}" est nomme au moins une fois dans le texte.`,
    entities.length >= T.requiredEntitiesMinListed
      ? `- Citer ces entites dans le texte : ${entities.join(', ')}. Chacune dans une phrase qui dit quelque chose d'elle, jamais en enumeration.`
      : '',
    `- Au moins ${opts.minFaq} questions FAQ, avec EXACTEMENT les memes questions dans faqItems et dans schemaFaqPage.`,
    opts.enableExternalLinks ? `- Au moins un lien externe https vers une source reelle et fiable.` : '',
    `- Chaque <img> a un alt non vide ; aucun lien vide ; aucun paragraphe repete ; aucun texte a completer ([VOTRE ...], TODO, lorem ipsum).`,
    `- Paragraphes de ${T.paragraphMaxWords} mots au plus, phrases courtes.`,
    `- Aucune requete recopiee telle quelle : un meme mot ecrit avec et sans ses accents ("creation" a cote de "création"), ou un sigle en minuscules ("seo", "ia", "pme"), fait refuser la page.`,
    `- Aucune phrase sur la page elle-meme ("cette page pilier", "cette page est optimisee") ni sur les donnees Search Console du site.`,
    `- Aucune etiquette repetee en tete de paragraphe ("Réponse courte :", "En bref :").`,
    `- Un title ou un H1 termine par "?" est une vraie question ("Comment… ?", "Quel… ?") ; sinon, pas de point d'interrogation.`,
  ].filter(Boolean)

  return `CONTROLE AVANT PUBLICATION — la page est verifiee automatiquement sur chacun de ces points, et refusee si l'un manque :\n${lines.join('\n')}`
}

/**
 * The corrections a regeneration must make, placed LAST in the prompt.
 *
 * Last on purpose: it is the one part of this prompt that is specific to the
 * attempt, and the end of a long prompt is where an instruction is least likely
 * to be diluted. The address and the focus keyword are pinned explicitly — the
 * slug is already reserved and the keyword comes from the plan, so a model that
 * "fixed" a duplicate by moving either would produce a page the runner cannot
 * store where it was ordered.
 */
export function buildRevisionBlock(feedback: readonly string[] | undefined): string {
  const lines = (feedback ?? []).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return ''

  return `

VERSION PRÉCÉDENTE REFUSÉE — CORRIGE IMPÉRATIVEMENT :
${lines.map(line => `- ${line}`).join('\n')}
Ne change ni l'adresse ni le mot-clé principal.
Si une page existante est citée (doublon, titre ou meta trop proche, même requête), démarque-toi
d'elle : autre angle, autre title, autre meta description, contenu réécrit — jamais une paraphrase.
Toutes les autres consignes ci-dessus restent valables.`
}

// ─── Normalization ─────────────────────────────────────────────────────────

/**
 * Turn a parsed model answer into a page, reporting what is missing.
 *
 * The previous version filled every hole with `?? ''`, so a model that skipped
 * the meta description produced a page that looked complete and shipped with no
 * description at all. Missing fields are now either derived from data we
 * actually hold or reported in `anomalies`; a page with no body is refused
 * outright, because there is nothing to publish.
 */
export function normalizeResponse(
  parsed: unknown,
  opts: PageTypeGenerateOptions,
  adjustedLength: number,
  searchIntent: SearchIntent,
  fullRagContext?: RagGenerationContext
): GeneratedSeoPage {
  const p = (parsed ?? {}) as Partial<GeneratedSeoPage>
  const anomalies: PageAnomaly[] = []
  const context = `page ${opts.pageType} ${opts.city}`

  const htmlContent = firstNonEmpty(p.htmlContent)
  if (!htmlContent) {
    throw new AiOutputError(
      'missing_field',
      context,
      "Reponse IA inexploitable : le champ htmlContent est absent ou vide (aucun contenu d'article a publier)."
    )
  }

  // COPIED, not rebuilt. This line is the whole inversion of the change.
  //
  // The address is already written to `generations.slug`, and the partial unique
  // index (site_id, slug) has already guaranteed it is nobody else's. Running
  // the factory again here could only produce a different answer — the model may
  // have returned another slug, the brief may carry a third — and a page written
  // at one address while another is reserved is a page published on top of
  // something.
  //
  // Nothing creative is lost: `buildPageSlug` was already rerun on every
  // response and never once consulted what the site already served.
  const slug = opts.reservedSlug

  const title = firstNonEmpty(p.title, opts.planBrief?.proposed_title)
  if (!title) {
    anomalies.push({ field: 'title', severity: 'blocking', reason: 'Titre absent de la reponse IA.' })
  }
  const resolvedTitle = title || `${opts.businessType} ${opts.city}`

  // Derived, not invented: reusing the title and the business is the only
  // honest fallback. It is still reported so the gate can ask for a rewrite.
  const metaDescription = firstNonEmpty(p.metaDescription)
  if (!metaDescription) {
    anomalies.push({
      field: 'metaDescription',
      severity: 'blocking',
      reason: 'Meta description absente de la reponse IA (repli derive du titre).',
    })
  }
  const resolvedMeta = metaDescription
    || `${resolvedTitle} — ${opts.businessName} a ${opts.city}.`.slice(0, 155)

  const directAnswer = firstNonEmpty(p.directAnswer)
  if (!directAnswer) {
    anomalies.push({
      field: 'directAnswer',
      severity: 'blocking',
      reason: 'Bloc de reponse directe absent : la page ne peut pas etre reprise comme extrait.',
    })
  } else {
    const answerWords = countWords(directAnswer)
    if (answerWords < 35 || answerWords > 70) {
      anomalies.push({
        field: 'directAnswer',
        severity: 'warning',
        reason: `Reponse directe de ${answerWords} mots, hors cible 40-60.`,
      })
    }
    if (/\b(ci-dessous|plus bas|dans cet article|nous verrons|ci-apres|comme explique)\b/i.test(directAnswer)) {
      anomalies.push({
        field: 'directAnswer',
        severity: 'warning',
        reason: 'Reponse directe non autosuffisante : elle renvoie a la suite de la page.',
      })
    }
  }

  const faqItems = Array.isArray(p.faqItems) ? p.faqItems : []
  const minFaq = PAGE_TYPE_CONFIG[opts.pageType].minFaq
  if (faqItems.length < minFaq) {
    anomalies.push({
      field: 'faqItems',
      severity: 'warning',
      reason: `${faqItems.length} question(s) FAQ pour un minimum de ${minFaq}.`,
    })
  }

  const secondaryKeywords = (Array.isArray(p.secondaryKeywords) ? p.secondaryKeywords : null)
    ?? opts.planBrief?.secondary_keywords
    ?? []
  if (secondaryKeywords.length < 8) {
    anomalies.push({
      field: 'secondaryKeywords',
      severity: 'warning',
      reason: `${secondaryKeywords.length} mot(s)-cle secondaire(s) pour un minimum de 8.`,
    })
  }

  const internalLinks = Array.isArray(p.internalLinks) ? p.internalLinks : []
  if (internalLinks.length === 0) {
    anomalies.push({
      field: 'internalLinks',
      severity: 'warning',
      reason: 'Aucun lien interne suggere : la page reste isolee du maillage.',
    })
  }

  const schemaLocalBusiness = firstNonEmpty(p.schemaLocalBusiness) || '{}'
  const schemaFaqPage = firstNonEmpty(p.schemaFaqPage) || '{}'
  const schemaBreadcrumb = firstNonEmpty(p.schemaBreadcrumb) || '{}'
  const schemaArticle = firstNonEmpty(p.schemaArticle) || '{}'
  for (const [field, value] of Object.entries({ schemaLocalBusiness, schemaFaqPage, schemaBreadcrumb, schemaArticle })) {
    if (value === '{}') {
      anomalies.push({ field, severity: 'warning', reason: 'Schema JSON-LD absent.' })
    }
  }

  const isoDate = todayIso()
  const wordCount = countHtmlWords(htmlContent)

  return {
    title: resolvedTitle,
    metaDescription: resolvedMeta,
    slug,
    focusKeyword: firstNonEmpty(opts.planBrief?.target_keyword, p.focusKeyword)
      || `${opts.businessType} ${opts.city}`,
    secondaryKeywords,
    ogTitle: firstNonEmpty(p.ogTitle, p.title) || resolvedTitle,
    ogDescription: firstNonEmpty(p.ogDescription, p.metaDescription) || resolvedMeta,
    twitterTitle: firstNonEmpty(p.twitterTitle, p.ogTitle, p.title) || resolvedTitle,
    twitterDescription: firstNonEmpty(p.twitterDescription, p.ogDescription, p.metaDescription) || resolvedMeta,
    htmlContent,
    schemaLocalBusiness,
    schemaFaqPage,
    schemaBreadcrumb,
    schemaArticle,
    internalLinks,
    internalLinksHtml: Array.isArray(p.internalLinksHtml) ? p.internalLinksHtml : [],
    faqItems,
    imageAlts: Array.isArray(p.imageAlts) ? p.imageAlts : [],
    ctaText: firstNonEmpty(p.ctaText) || 'Nous contacter',
    targetLength: adjustedLength,
    // Measured instead of self-reported: a model's own word count is guesswork,
    // and this field is what downstream reporting reads.
    estimatedWordCount: wordCount,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 200)),
    directAnswer: directAnswer || undefined,
    author: firstNonEmpty(p.author) || opts.businessName,
    datePublished: firstNonEmpty(p.datePublished) || isoDate,
    dateModified: firstNonEmpty(p.dateModified) || isoDate,
    searchIntent,
    anomalies,
    pageType: opts.pageType,
    externalLinks: Array.isArray(p.externalLinks) ? p.externalLinks : [],
    parentSlug: opts.pillarSlug,
    relatedSlugs: Array.isArray(p.relatedSlugs) ? p.relatedSlugs : [],
    // RAG stats
    ragStats: fullRagContext?.stats,
    // RAG context blocks for reference
    ragContext: fullRagContext ? {
      taxonomy: fullRagContext.promptBlocks.taxonomy || undefined,
      competitor: fullRagContext.promptBlocks.competitor || undefined,
      google: fullRagContext.promptBlocks.google || undefined,
      structure: fullRagContext.promptBlocks.structure || undefined,
    } : undefined,
  }
}

/**
 * True when the page carries a defect that must stop publication.
 *
 * Exposed for the publication gate: the generator reports, it does not decide.
 */
export function hasBlockingAnomaly(page: Pick<GeneratedPage, 'anomalies'>): boolean {
  return (page.anomalies ?? []).some((anomaly) => anomaly.severity === 'blocking')
}

/**
 * Get site ID from URL by querying Supabase
 */
async function getSiteIdFromUrl(siteUrl: string): Promise<string | null> {
  try {
    const { createServiceClient } = await import('@/lib/supabase')
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('sites')
      .select('id')
      .eq('url', siteUrl)
      .maybeSingle()
    return data?.id || null
  } catch {
    return null
  }
}

/**
 * Get campaign from siteId
 */
async function getCampaignFromSite(siteId: string): Promise<import('@/lib/types').Campaign | null> {
  try {
    const { createServiceClient } = await import('@/lib/supabase')
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('campaigns')
      .select('*')
      .eq('site_id', siteId)
      .eq('is_active', true)
      .limit(1)
      .single()
    return data as import('@/lib/types').Campaign | null
  } catch {
    return null
  }
}
