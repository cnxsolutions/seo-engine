// ─────────────────────────────────────────────────────────────────────────────
// La provenance d'un plan de cycle — ce que le planificateur a RÉELLEMENT mesuré
//
// What the planner actually measured, as the plan route reports it:
// `serpEvidence` (the result pages really read) and `signals` (the Search
// Console history). Both are optional by nature — a first cycle has no history,
// a blocked SERP yields nothing — so the shapes below are parsed defensively
// rather than cast. The distinction that matters is three-way, not two-way:
// measured, blind, and "we cannot tell", the last being what a plan re-read from
// the database is.
//
// Sorti du composant de l'onglet Stratégie pour une raison : le comptage des
// briefs « qui citent une mesure » MENTAIT. Il cherchait « search console »
// dans le texte, et la phrase « Décidé sans Search Console : aucune mesure
// d'audience n'était disponible » le contient — chaque brief d'un plan construit
// à l'aveugle était compté comme mesuré, et l'écran annonçait « 3 briefs sur 3
// citent une mesure Search Console » sur un plan qui n'en citait aucune. Une
// fonction pure se teste sans navigateur (./provenance.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

// `import type`, effacé à la compilation : rien de lib/google/ n'atteint le
// bundle client. La forme est celle que `detectCannibalization` produit déjà et
// que `getGscPlanningSignals` transporte — on l'affiche, on ne la recopie pas
// sous un second nom qui divergerait.
import type { CannibalizedQuery } from '@/lib/google/performance'
import type { PlanPreviewItem } from '@/lib/types'

export interface SerpProof {
  query: string
  fetchedAt: string | null
  competitors: number
  medianWordCount: number | null
  commonSections: number
  peopleAlsoAsk: number
}

export interface MeasuredQuery {
  query: string
  pageUrl: string
  position: number
  impressions: number
}

export interface GscProof {
  windowStart: string | null
  windowEnd: string | null
  strikingDistance: MeasuredQuery[]
  lowCtrPages: number
  deadPages: number
  /**
   * LES COUPLES, pas leur nombre.
   *
   * « 3 requêtes cannibalisées » ne permet aucune décision : ni laquelle, ni
   * quelle page tient la place, ni lesquelles la lui disputent. Et le compteur
   * valait 0 dans deux situations opposées — « rien de disputé » et « Search
   * Console n'est pas connectée » — ce qui est exactement la façon dont un
   * tableau de bord finit par rassurer sur ce qu'il n'a pas mesuré.
   */
  cannibalized: CannibalizedQuery[]
}

export interface PlanProvenance {
  /** false when the response said nothing at all about how the plan was built. */
  reported: boolean
  serp: SerpProof[]
  gsc: GscProof | null
}

export const UNKNOWN_PROVENANCE: PlanProvenance = { reported: false, serp: [], gsc: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function size(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in source) return source[key]
  }
  return undefined
}

function parseSerp(raw: unknown): SerpProof[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((entry) => ({
    query: str(entry.query) ?? '—',
    fetchedAt: str(entry.fetchedAt),
    competitors: size(entry.competitors),
    medianWordCount: num(entry.medianWordCount),
    commonSections: size(entry.commonSections),
    peopleAlsoAsk: size(entry.peopleAlsoAsk),
  }))
}

/**
 * La cannibalisation, relue défensivement comme le reste de ce panneau.
 *
 * Une forme absente retombe sur une liste vide, jamais sur une erreur de rendu :
 * ce bloc décrit ce que le plan a mesuré, et il ne doit pas pouvoir casser
 * l'écran qui montre le plan lui-même.
 */
function parseCannibalized(raw: unknown): CannibalizedQuery[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .map((entry) => ({
      query: str(entry.query) ?? '',
      impressions: num(entry.impressions) ?? 0,
      clicks: num(entry.clicks) ?? 0,
      pages: (Array.isArray(entry.pages) ? entry.pages : [])
        .filter(isRecord)
        .map((page) => ({
          pageUrl: str(page.pageUrl) ?? '',
          impressions: num(page.impressions) ?? 0,
          clicks: num(page.clicks) ?? 0,
          position: num(page.position) ?? 0,
        }))
        .filter((page) => page.pageUrl),
      winner: str(entry.winner) ?? '',
      losers: (Array.isArray(entry.losers) ? entry.losers : [])
        .map(str)
        .filter((value): value is string => value !== null),
    }))
    // Un conflit dont on ne sait nommer ni la requête ni la page gagnante n'est
    // pas affichable : le taire vaut mieux qu'une ligne à trous.
    .filter((entry) => entry.query !== '' && entry.winner !== '')
}

function parseGsc(raw: unknown): GscProof | null {
  if (!isRecord(raw)) return null
  // `available: false` is the module's way of saying "draw no conclusion".
  if (raw.available === false) return null

  const strikingDistance = (Array.isArray(raw.strikingDistance) ? raw.strikingDistance : [])
    .filter(isRecord)
    .map((entry) => ({
      query: str(entry.query) ?? '',
      pageUrl: str(entry.pageUrl) ?? '',
      position: num(entry.position) ?? 0,
      impressions: num(entry.impressions) ?? 0,
    }))
    .filter((entry) => entry.query && entry.pageUrl)

  return {
    windowStart: str(raw.windowStart),
    windowEnd: str(raw.windowEnd),
    strikingDistance,
    lowCtrPages: size(raw.lowCtrPages),
    deadPages: size(raw.deadPages),
    cannibalized: parseCannibalized(raw.cannibalized),
  }
}

/** Reads provenance off a response body, or off the plan it carries. */
export function readProvenance(payload: unknown): PlanProvenance {
  if (!isRecord(payload)) return UNKNOWN_PROVENANCE

  const rawSerp = pick(payload, ['serpEvidence', 'serp_evidence'])
  const rawSignals = pick(payload, ['signals', 'gscSignals', 'gsc_signals'])

  if (rawSerp === undefined && rawSignals === undefined) {
    return isRecord(payload.plan) ? readProvenance(payload.plan) : UNKNOWN_PROVENANCE
  }

  return { reported: true, serp: parseSerp(rawSerp), gsc: parseGsc(rawSignals) }
}

export type ProvenanceGrade = 'measured' | 'partial' | 'blind' | 'unknown'

export function gradeOf(provenance: PlanProvenance): ProvenanceGrade {
  if (!provenance.reported) return 'unknown'
  const serp = provenance.serp.some((proof) => proof.competitors > 0)
  const gsc = provenance.gsc !== null
  if (serp && gsc) return 'measured'
  if (serp || gsc) return 'partial'
  return 'blind'
}

// ─── La seule trace de mesure qu'un plan relu conserve ──────────────────────
//
// `normalizeBriefs` (lib/planning/brief-plan.ts) writes a Search Console
// citation into `rationale` and into `seo_rules` whenever a brief was built on a
// measured opportunity — « Requete mesuree a 120 impressions et position 7.3 en
// Search Console », « Requete "x" en position 8.4 sur … ». The domain writes the
// same kind of figures into the evidence of an action. Counting those citations
// says something real about a plan re-read from the database — but it is a
// trace, not proof that the SERP were read, and it is labelled as such.
//
// UNE CITATION, C'EST UN CHIFFRE. Le nom de l'outil ne prouve rien : le même
// planificateur écrit « Decide sans Search Console : aucune mesure d'audience
// n'etait disponible » sur chaque brief construit à l'aveugle, et le domaine
// « l'absence de donnee ne vaut pas absence de cannibalisation ». Une phrase
// n'est donc comptée que si elle porte une grandeur Search Console CHIFFRÉE
// (impressions, clics, position, CTR) ET qu'elle ne dit pas l'absence de
// mesure. Si la formulation amont change, ce comptage sous-estime — la seule
// façon sûre de se tromper : il ne peut jamais faire passer un plan aveugle
// pour un plan mesuré.

/** Minuscules, sans accents, apostrophes typographiques ramenées à `'`. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
}

/** Une grandeur Search Console accompagnée de son chiffre. */
const MEASURED_FIGURES: RegExp[] = [
  // « 120 impressions », « 3 clic(s) », « 1 200 impressions »
  /\d[\d\s.,]*\s*(?:impressions?|impression\(s\)|clics?|clic\(s\))(?![a-z])/,
  // « en position 7.3 », « et position 12 », « a position 4 » (« à » sans accent)
  /\b(?:en|et|a)\s+position\s+\d/,
  // « position moyenne de 8,1 »
  /\bposition\s+moyenne\s+(?:de\s+)?\d/,
  // « CTR 1,2 % », « (CTR 0.80%) »
  /\bctr\s*:?\s*\d/,
]

/** Une phrase qui dit qu'il n'y avait RIEN à mesurer ne cite aucune mesure. */
const ABSENCE_OF_MEASUREMENT =
  /sans search console|aucune mesure|aucun historique|aucune donnee|n'etait disponible|pas connectee|non connectee|indisponible/

/** Une phrase par élément ; un point décimal (« 7.3 ») ne coupe rien. */
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

export function sentenceCitesMeasurement(sentence: string): boolean {
  const text = normalize(sentence)
  if (ABSENCE_OF_MEASUREMENT.test(text)) return false
  return MEASURED_FIGURES.some((pattern) => pattern.test(text))
}

/** Tout ce qu'un brief dit de ses raisons : sa justification, ses règles, la preuve de son verdict. */
function evidenceOf(item: PlanPreviewItem): string[] {
  const action = item.action
  const fromAction = action?.kind === 'refresh' ? action.evidence : action?.kind === 'skip' ? action.reasons : []
  return [item.rationale ?? '', ...(item.seo_rules ?? []), ...(fromAction ?? [])]
}

export function citesMeasurement(item: PlanPreviewItem): boolean {
  return evidenceOf(item).some((text) => sentencesOf(text).some(sentenceCitesMeasurement))
}

export function countMeasuredBriefs(items: readonly PlanPreviewItem[]): number {
  return items.filter(citesMeasurement).length
}
