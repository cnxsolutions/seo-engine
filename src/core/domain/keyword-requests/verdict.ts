// ─────────────────────────────────────────────────────────────────────────────
// The verdict on a keyword request — docs/cadrage.md § 3.1
// ─────────────────────────────────────────────────────────────────────────────
//
// THE ORDER OF THE RULES IS THE POLICY, as in decideEditorialAction, whose
// decision rule 5 reuses rather than copies:
//
//   1. malformed                        → refused at input, never stored (normalize.ts)
//   2. same search as an open request   → attached to it, at submission (024, submit_keyword_requests)
//   3. aimed at by a brief of the cycle → scheduled, linked to that brief
//   4. a query the site already wins    → covered, with the position and the page
//   5. carried by a page of the site    → covered, with the page
//   6. a town outside the campaign      → review (CNX)
//   7. outside the trade, per the model → review (CNX) — never a refusal
//   8. otherwise                        → deferred to the next period (L3; the
//                                         current cycle takes requests from L4)
//
// Rules 3 to 6 are measurements and cost nothing: measuredVerdict runs them
// first, and only a request none of them settles reaches the model
// (fitVerdict). A measurement beats a resemblance; a resemblance beats an
// opinion.
//
// Pure: no Supabase, no Next, no model. `reasons` are the operator's — plain
// French with the figures; the client reads a sentence built from `reasonCode`
// and `evidence` (lib/client-space/labels.ts), never these.

import { decideEditorialAction, WITHOUT_SEARCH_CONSOLE, type ActionInputs } from '../existing/action'
import type { EditorialTarget } from '../existing/identity'
import { normalizeInventoryPath, type InventoryEntry } from '../existing/inventory'
import { containsKeywordPhrase, normalizeForMatch } from '../text/text-utils'
import type { EngineVerdictStatus } from './lifecycle'

// ── What a verdict says ───────────────────────────────────────────────────

export type ReasonCode =
  | 'ALREADY_PLANNED'
  | 'ALREADY_WON'
  | 'ALREADY_COVERED'
  | 'NO_CAMPAIGN'
  | 'CITY_OUT_OF_AREA'
  | 'CITY_ON_NATIONAL'
  | 'OUT_OF_TRADE'
  | 'UNSURE_TRADE'
  | 'OPINION_UNAVAILABLE'
  | 'NEXT_PERIOD'

export type Fit = 'in' | 'out' | 'unsure'

export type Evidence =
  | { kind: 'planned'; day: string | null; planItemId: string }
  | { kind: 'position'; query: string; position: number }
  | { kind: 'page'; url: string }
  | { kind: 'city'; city: string }
  | { kind: 'opinion'; fit: Fit; service: string | null; intent: string | null }

export interface RequestVerdict {
  status: EngineVerdictStatus
  reasonCode: ReasonCode
  reasons: string[]
  evidence: Evidence[]
  /** Rule 3 only: the brief the request is now tied to. */
  plan?: { cyclePlanId: string; planItemId: string; scheduledFor: string | null }
}

// ── What the engine knows when it judges ──────────────────────────────────

export interface RequestSubject {
  keyword: string
  city: string | null
  /** normalizedRequest(keyword, city): the search, comparable. */
  normalized: string
  /** The page this request would become, as decideEditorialAction compares it. */
  target: EditorialTarget
}

export interface CampaignZone {
  national: boolean
  communes: readonly string[]
}

/** A brief of the cycle in progress whose page is not online yet. */
export interface PlannedBrief {
  cyclePlanId: string
  planItemId: string
  day: string | null
  targetKeyword: string
  targetCity: string
  secondaryKeywords: readonly string[]
}

/** A query the site already wins: position ≤ 3 with ≥ 30 impressions (lib/google/performance.ts). */
export interface WonQuery {
  query: string
  pageUrl: string
  position: number
}

export interface VerdictContext {
  /** Null when the site has no campaign: nothing to judge the request against. */
  zone: CampaignZone | null
  plannedBriefs: readonly PlannedBrief[]
  wonQueries: readonly WonQuery[]
  editorial: ActionInputs
  /** Towns the engine recognises in a keyword: the campaign's and the known communes. */
  knownPlaces: readonly string[]
  /** To turn an inventory path into an address the client can open. */
  siteUrl: string
}

export interface FitOpinion {
  fit: Fit
  service: string | null
  city: string | null
  intent: string | null
  reason: string
}

// ── Rules 3 to 6: what can be measured ───────────────────────────────────

/** The verdict of a request the measurements settle, or null when the model must be asked. */
export function measuredVerdict(subject: RequestSubject, context: VerdictContext): RequestVerdict | null {
  const verdict =
    plannedVerdict(subject, context) ??
    wonVerdict(subject, context) ??
    coveredVerdict(subject, context) ??
    zoneVerdict(context.zone, namedCities(subject, context.knownPlaces))
  return verdict ? withDataNotes(verdict, context) : null
}

/** The town the client chose, then the known towns its search names — each once. */
function namedCities(subject: RequestSubject, knownPlaces: readonly string[]): string[] {
  const cities = [...(subject.city ? [subject.city] : []), ...detectPlaces(subject.normalized, knownPlaces)]
  const seen = new Set<string>()
  return cities.filter((city) => {
    const key = normalizeForMatch(city)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Rules 6 to 8: once the model has given its opinion ────────────────────

/**
 * The model's opinion decides between CNX and the next period — never a
 * refusal (décision 6). No opinion (model unreachable, answer unreadable) is
 * not an « in »: CNX looks.
 */
export function fitVerdict(subject: RequestSubject, context: VerdictContext, opinion: FitOpinion | null): RequestVerdict {
  return withDataNotes(opinionVerdict(subject, context, opinion), context)
}

function opinionVerdict(subject: RequestSubject, context: VerdictContext, opinion: FitOpinion | null): RequestVerdict {
  if (!opinion) {
    return review('OPINION_UNAVAILABLE', ["L'avis automatique sur le métier n'a pas pu être obtenu : la demande attend un regard humain."])
  }
  const opinionEvidence: Evidence = { kind: 'opinion', fit: opinion.fit, service: opinion.service, intent: opinion.intent }

  if (opinion.city && context.zone) {
    const zone = zoneVerdict(context.zone, [opinion.city])
    if (zone) return { ...zone, reasons: [...zone.reasons, `Ville reconnue par le modèle : ${opinion.city}.`], evidence: [...zone.evidence, opinionEvidence] }
  }
  if (opinion.fit !== 'in') {
    return {
      ...review(opinion.fit === 'out' ? 'OUT_OF_TRADE' : 'UNSURE_TRADE', [
        `Avis du modèle : ${opinion.fit === 'out' ? 'hors métier' : 'incertain'} — ${opinion.reason}`,
      ]),
      evidence: [opinionEvidence],
    }
  }
  return {
    status: 'deferred',
    reasonCode: 'NEXT_PERIOD',
    reasons: [
      `Recevable${opinion.service ? ` (service reconnu : ${opinion.service})` : ''}. Gardée pour le plan de la période suivante, où elle passe en priorité.`,
    ],
    evidence: [opinionEvidence],
  }
}

// ── Rule 3 — already aimed at by a brief of the cycle ─────────────────────

function plannedVerdict(subject: RequestSubject, context: VerdictContext): RequestVerdict | null {
  const brief = context.plannedBriefs.find((candidate) => briefSearches(candidate).includes(subject.normalized))
  if (!brief) return null
  return {
    status: 'scheduled',
    reasonCode: 'ALREADY_PLANNED',
    reasons: [`Déjà visée par un brief de la période en cours${brief.day ? `, prévu le ${brief.day}` : ''} : « ${brief.targetKeyword} ».`],
    evidence: [{ kind: 'planned', day: brief.day, planItemId: brief.planItemId }],
    plan: { cyclePlanId: brief.cyclePlanId, planItemId: brief.planItemId, scheduledFor: brief.day },
  }
}

/** Every search a brief aims at: its keyword (with its town when it lacks it), and its secondary keywords. */
function briefSearches(brief: PlannedBrief): string[] {
  const main = brief.targetCity && !containsKeywordPhrase(brief.targetKeyword, brief.targetCity)
    ? `${brief.targetKeyword} ${brief.targetCity}`
    : brief.targetKeyword
  return [brief.targetKeyword, main, ...brief.secondaryKeywords].map(normalizeForMatch).filter(Boolean)
}

// ── Rule 4 — a query the site already wins ────────────────────────────────

function wonVerdict(subject: RequestSubject, context: VerdictContext): RequestVerdict | null {
  const won = context.wonQueries.find((query) => normalizeForMatch(query.query) === subject.normalized)
  if (!won) return null
  const position = Math.max(1, Math.round(won.position))
  return {
    status: 'covered',
    reasonCode: 'ALREADY_WON',
    reasons: [`Search Console : « ${won.query} » est déjà en position ${won.position.toFixed(1)} sur ${won.pageUrl}. Une page de plus lui prendrait ses signaux.`],
    evidence: [
      { kind: 'position', query: won.query, position },
      { kind: 'page', url: won.pageUrl },
    ],
  }
}

// ── Rule 5 — a page of the site already carries it ────────────────────────

/**
 * Two ways, the fact first. A live page whose focus keyword IS the search
 * answers it whatever the freshness of the inventory: a covered request
 * rewrites nothing (no update, owner's decision of 2026-10-17), so the
 * caution decideEditorialAction applies to a blind inventory — never
 * overwrite what it cannot see — has nothing to protect here.
 *
 * Then decideEditorialAction, unchanged: a 'refresh' names the page that
 * already carries the subject, a 'skip' a query several pages fight over.
 */
function coveredVerdict(subject: RequestSubject, context: VerdictContext): RequestVerdict | null {
  const { inventory, gsc } = context.editorial
  const same = inventory.entries.find(
    (entry) => isLive(entry) && entry.coversTopic && normalizeForMatch(entry.focusKeyword ?? '') === subject.normalized,
  )
  if (same) {
    const url = addressOf(same, context.siteUrl)
    return covered([`La page ${url} vise déjà cette recherche comme mot-clé principal.`], url)
  }

  const action = decideEditorialAction(subject.target, context.editorial)
  if (action.kind === 'refresh') {
    const entry = inventory.entries.find((candidate) => normalizeInventoryPath(candidate.path) === normalizeInventoryPath(action.targetPath))
    return covered(action.evidence, entry ? addressOf(entry, context.siteUrl) : absolute(action.targetPath, context.siteUrl))
  }
  if (action.kind === 'skip') {
    const conflict = gsc.cannibalized.find((query) => normalizeForMatch(query.query) === subject.normalized)
    return covered(action.reasons, conflict?.winner ?? null)
  }
  return null
}

function covered(reasons: readonly string[], url: string | null): RequestVerdict {
  return {
    status: 'covered',
    reasonCode: 'ALREADY_COVERED',
    reasons: [...reasons],
    evidence: url ? [{ kind: 'page', url }] : [],
  }
}

function isLive(entry: InventoryEntry): boolean {
  if (entry.noindex) return false
  const canonical = normalizeInventoryPath(entry.canonicalPath)
  return !canonical || canonical === normalizeInventoryPath(entry.path)
}

function addressOf(entry: InventoryEntry, siteUrl: string): string {
  return entry.url || absolute(entry.path, siteUrl)
}

function absolute(path: string, siteUrl: string): string {
  try {
    return new URL(path, siteUrl).toString()
  } catch {
    return path
  }
}

// ── Rule 6 — the zone of the campaign ─────────────────────────────────────

/**
 * The towns named in a search, longest first: « Rosières-près-Troyes » is one
 * town, not Rosières plus Troyes — a place inside a longer place found in the
 * same search is dropped.
 */
export function detectPlaces(normalizedSearch: string, knownPlaces: readonly string[]): string[] {
  const found = [...new Set(knownPlaces.map((place) => place.trim()).filter(Boolean))]
    .filter((place) => containsKeywordPhrase(normalizedSearch, place))
    .sort((a, b) => normalizeForMatch(b).length - normalizeForMatch(a).length)
  return found.filter((place, index) => !found.slice(0, index).some((longer) => containsKeywordPhrase(longer, place)))
}

function zoneVerdict(zone: CampaignZone | null, cities: readonly string[]): RequestVerdict | null {
  if (!zone) {
    return review('NO_CAMPAIGN', ["Aucune campagne sur ce site : rien à quoi confronter la demande."])
  }
  if (cities.length === 0) return null
  if (zone.national) {
    return {
      ...review('CITY_ON_NATIONAL', [`La demande vise ${cities[0]}, sur une campagne nationale : une page locale est un choix à faire avec le client.`]),
      evidence: [{ kind: 'city', city: cities[0] }],
    }
  }
  const served = new Set(zone.communes.map(normalizeForMatch))
  const outside = cities.find((city) => !served.has(normalizeForMatch(city)))
  if (!outside) return null
  return {
    ...review('CITY_OUT_OF_AREA', [`${outside} n'est pas dans les communes de la campagne (${zone.communes.join(', ')}).`]),
    evidence: [{ kind: 'city', city: outside }],
  }
}

// ── Shared ────────────────────────────────────────────────────────────────

function review(reasonCode: ReasonCode, reasons: string[]): RequestVerdict {
  return { status: 'review', reasonCode, reasons, evidence: [] }
}

/** A missing measurement is not a zero: the verdict says what it was decided without. */
function withDataNotes(verdict: RequestVerdict, context: VerdictContext): RequestVerdict {
  if (context.editorial.gsc.available) return verdict
  return {
    ...verdict,
    reasons: [...verdict.reasons, `Décidé ${WITHOUT_SEARCH_CONSOLE} : les règles de position n'ont pas pu être appliquées.`],
  }
}
