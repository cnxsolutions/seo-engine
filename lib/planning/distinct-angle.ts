// ─────────────────────────────────────────────────────────────────────────────
// Angle distinct
// SEO Engine - Planning
// Un sujet deja couvert devient une page NEUVE sur un autre angle, ou rien
// ─────────────────────────────────────────────────────────────────────────────
//
// DECISION DU PROPRIETAIRE, 2026-10-17 : « Je ne veux pas de mise a jour. Les
// pages deja redigees, on ne reprend pas leur slug. »
//
// Le planificateur ne propose donc plus JAMAIS de rafraichir une page existante.
// Le domaine (src/core/domain/existing/action.ts) continue de dire qu'un sujet
// est deja couvert — c'est une mesure, et elle reste juste — mais sa reponse
// 'refresh' n'est plus executee : elle devient la page a NE PAS concurrencer.
// Le creneau reste une creation, sur un angle distinct (autre service, autre
// question, autre intention, autre commune), avec son propre mot-cle et sa
// propre adresse libre. S'il n'existe pas d'angle distinct, le creneau est
// ecarte, et il le dit.
//
// PURETE. Ce module ne lit rien et n'appelle rien : ni base, ni modele, ni
// horloge. C'est ce qui permet de tester chaque regle sur des litteraux, et
// c'est pourquoi il vit a cote de brief-plan.ts plutot que dedans — ce dernier
// importe la base, le SERP et le modele.

import type { GscPlanningSignals } from '@/lib/google/performance'
import type { EditorialAction } from '@/src/core/domain/existing/action'
import { normalizeInventoryPath, type SiteInventory } from '@/src/core/domain/existing/inventory'
import { contentTokens, jaccardIndex, normalizeForMatch } from '@/src/core/domain/text/text-utils'

// ─── La page a ne pas concurrencer ──────────────────────────────────────────

/**
 * Ce qu'un creneau doit eviter : la page existante qui couvre deja son sujet.
 *
 * Tout ce qu'il faut pour le dire au modele, au lecteur du plan et a la garde
 * finale — sans relire l'inventaire a chaque etape.
 */
export interface AvoidedPage {
  /** Chemin normalise de la page existante : l'adresse qu'aucun brief ne reprend. */
  path: string
  /** L'URL publique quand l'inventaire la connait, le chemin sinon. */
  url: string
  title: string | null
  /** Son mot-cle principal, ou a defaut le sujet du creneau qui l'a designee. */
  focusKeyword: string
  /** Le sujet seme par le calendrier, lu dans la commune du creneau. */
  subject: string
  /** Tout ce qu'un brief de ce creneau ne doit pas viser : mot-cle de la page et sujet seme. */
  keywords: string[]
  /** Pourquoi le sujet est juge couvert, en clair — la preuve du domaine, sans ses consignes de mise a jour. */
  reasons: string[]
}

type RefreshVerdict = Extract<EditorialAction, { kind: 'refresh' }>

/**
 * Le verdict 'refresh' du domaine, relu comme « page a ne pas concurrencer ».
 *
 * Le verdict ne porte que le chemin de la page visee : son URL, son titre et
 * son mot-cle sont repris de l'inventaire, sur le meme chemin normalise.
 */
export function avoidedPageOf(
  verdict: RefreshVerdict,
  inventory: SiteInventory,
  subject: string,
): AvoidedPage {
  const path = normalizeInventoryPath(verdict.targetPath) || verdict.targetPath
  const entry = inventory.entries.find(candidate => normalizeInventoryPath(candidate.path) === path)
  const focusKeyword = (entry?.focusKeyword ?? '').trim() || subject

  return {
    path,
    url: entry?.url || path,
    title: (entry?.title ?? '').trim() || null,
    focusKeyword,
    subject,
    keywords: dedupeByMeaning([focusKeyword, subject]),
    reasons: factualReasons(verdict.evidence),
  }
}

/**
 * Les phrases de la preuve qui CONSEILLENT une mise a jour, retirees.
 *
 * La preuve du domaine melange des faits (« meme mot-cle principal que… »,
 * « position 7.4 sur… ») et la consigne qu'il en tirait (« mettre a jour cette
 * page… »). Les faits expliquent pourquoi le sujet est couvert ; la consigne,
 * affichee a cote d'une page NEUVE, contredirait la decision du proprietaire.
 * Si le domaine change sa formulation, la phrase passe simplement : le test
 * « aucune consigne de mise a jour » le signalera.
 */
const REFRESH_ADVICE_PREFIXES = [
  'mettre a jour cette page',
  'seuls le titre et la meta description sont reecrits',
  'portee limitee aux metadonnees',
]

export function factualReasons(evidence: readonly string[]): string[] {
  return evidence.filter(line => {
    const normalized = normalizeForMatch(line)
    return !REFRESH_ADVICE_PREFIXES.some(prefix => normalized.startsWith(prefix))
  })
}

// ─── L'equivalence de deux mots-cles ────────────────────────────────────────

/**
 * Seuil de Jaccard au-dela duquel deux mots-cles sont le meme sujet.
 *
 * 0.8 sur des sacs de mots de deux a six termes : un mot ajoute a un mot-cle de
 * cinq ne change pas la page (« renovation salle bain complete » + « prix »),
 * un mot ajoute a un mot-cle de deux en fait une autre (« plombier » +
 * « urgence »).
 */
export const KEYWORD_EQUIVALENCE_THRESHOLD = 0.8

/**
 * Deux mots-cles visent-ils la meme requete ?
 *
 * Normalises (casse, accents, ponctuation), puis compares comme sacs de mots
 * THEMATIQUES : mots vides, mots de deux lettres et noms de communes retires,
 * pluriel en « s » ramene au singulier. Egaux, ou Jaccard >= 0.8.
 *
 * UNE EXCEPTION, et elle est voulue : deux mots-cles qui nomment chacun une
 * commune, sans commune commune, ne sont PAS equivalents. « taxi troyes » et
 * « taxi reims » sont deux pages locales distinctes, et c'est precisement
 * l'angle « autre commune de la campagne » que le prompt propose au modele.
 * Sans elle, la garde ecarterait toutes les pages de commune d'un metier des
 * que la premiere existe. Un mot-cle qui ne nomme AUCUNE commune reste, lui,
 * equivalent a sa variante localisee : « plombier » couvre deja « plombier
 * troyes » sur le site d'un plombier troyen.
 */
export function keywordsAreEquivalent(a: string, b: string, cityNames: readonly string[] = []): boolean {
  const left = normalizeForMatch(a)
  const right = normalizeForMatch(b)
  if (!left || !right) return false
  if (left === right) return true

  const phrases = cityPhrases(cityNames)
  const citiesLeft = citiesNamedIn(left, phrases)
  const citiesRight = citiesNamedIn(right, phrases)
  if (citiesLeft.length > 0 && citiesRight.length > 0 && !citiesLeft.some(city => citiesRight.includes(city))) {
    return false
  }

  const tokensLeft = topicalTokens(left, phrases)
  const tokensRight = topicalTokens(right, phrases)
  if (tokensLeft.size === 0 || tokensRight.size === 0) return tokensLeft.size === tokensRight.size

  return jaccardIndex(tokensLeft, tokensRight) >= KEYWORD_EQUIVALENCE_THRESHOLD
}

/**
 * Le mot-cle tel que la page le portera vraiment : dans sa commune.
 *
 * Un mot-cle sans commune sur un brief de Troyes vise « … troyes » — la fabrique
 * de slug ajoute d'ailleurs la ville a l'adresse. Le comparer nu ferait juger
 * equivalents deux creneaux « plombier » de deux communes differentes.
 */
export function keywordInContext(keyword: string, city: string, cityNames: readonly string[] = []): string {
  const trimmed = (keyword ?? '').trim()
  const town = (city ?? '').trim()
  if (!trimmed || !town) return trimmed

  const named = citiesNamedIn(normalizeForMatch(trimmed), cityPhrases([...cityNames, town]))
  return named.length > 0 ? trimmed : `${trimmed} ${town}`
}

// ─── La garde finale, sur le mot-cle que le modele a vraiment propose ───────

/**
 * Un mot-cle qu'une page neuve ne doit pas reprendre, et d'ou il vient.
 *
 * - 'site' : le mot-cle principal d'une page deja en ligne ;
 * - 'search-console' : une requete pour laquelle une page du site ranke deja
 *   (position 5-20, cannibalisee, deja gagnee, ou vue et pas cliquee) ;
 * - 'cycle' : le mot-cle d'un autre creneau retenu dans CE plan.
 */
export interface KeywordGuard {
  keyword: string
  origin: 'site' | 'search-console' | 'cycle'
}

/** Les gardes connues avant le premier brief : l'existant et Search Console. */
export function keywordGuardsOf(
  existingKeywords: readonly string[],
  signals: GscPlanningSignals | null,
): KeywordGuard[] {
  const guards: KeywordGuard[] = existingKeywords
    .map(keyword => (keyword ?? '').trim())
    .filter(Boolean)
    .map(keyword => ({ keyword, origin: 'site' as const }))

  if (signals) {
    const carried = [
      ...signals.strikingDistance.map(opportunity => opportunity.query),
      ...signals.cannibalized.map(conflict => conflict.query),
      ...signals.blockedQueries,
      ...signals.lowCtrPages.map(page => page.topQuery),
    ]
    for (const query of dedupeByMeaning(carried)) guards.push({ keyword: query, origin: 'search-console' })
  }

  return guards
}

/**
 * Les motifs d'ecarter une page neuve, ou null quand elle peut s'ecrire.
 *
 * La page a eviter passe en premier : son motif nomme l'URL exacte que le
 * creneau aurait concurrencee, ce qu'une garde generique ne sait pas dire.
 */
export function cannibalizationReasons(input: {
  /** Le mot-cle final, deja lu dans sa commune (keywordInContext). */
  keyword: string
  avoid: AvoidedPage | null
  guards: readonly KeywordGuard[]
  cityNames: readonly string[]
}): string[] | null {
  const { keyword, avoid, guards, cityNames } = input

  if (avoid && avoid.keywords.some(avoided => keywordsAreEquivalent(keyword, avoided, cityNames))) {
    return [noDistinctAngleReason(avoid), ...avoid.reasons]
  }

  const guard = guards.find(candidate => keywordsAreEquivalent(keyword, candidate.keyword, cityNames))
  return guard ? [guardReason(keyword, guard)] : null
}

/** L'adresse retenue est-elle celle de la page a eviter ? */
export function reusesAvoidedAddress(path: string, avoid: AvoidedPage | null): boolean {
  if (!avoid) return false
  const normalized = normalizeInventoryPath(path)
  return normalized !== '' && normalized === avoid.path
}

// ─── Ce que le plan dit, en toutes lettres ──────────────────────────────────

export function noDistinctAngleReason(avoid: AvoidedPage): string {
  return `Aucun angle distinct de ${avoid.url} n'a été proposé : le créneau est écarté plutôt que de concurrencer la page existante.`
}

/** La mention ajoutee au motif d'une page neuve ecrite a cote d'une page existante. */
export function distinctAngleNote(avoid: AvoidedPage): string {
  return `Angle distinct de ${avoid.url}, qui couvre déjà « ${avoid.focusKeyword} ».`
}

/**
 * La consigne transmise au redacteur, le jour J.
 *
 * Le brief est le seul canal entre le plan et la redaction : sans cette ligne,
 * le generateur ne saurait pas qu'une page voisine porte deja le sujet.
 */
export function distinctAngleRule(avoid: AvoidedPage): string {
  return `Page complémentaire de ${avoid.url} (« ${avoid.focusKeyword} ») : ne pas reprendre ce mot-clé ni ses variantes proches, ne pas réécrire ce que cette page couvre déjà, et lier vers elle.`
}

/** La ligne du prompt qui demande au modele un autre sujet pour CE creneau. */
export function avoidPromptLine(slotNumber: number, avoid: AvoidedPage): string {
  const page = avoid.title
    ? `(« ${avoid.title} », mot-clé « ${avoid.focusKeyword} »)`
    : `(mot-clé « ${avoid.focusKeyword} »)`

  return (
    `Créneau ${slotNumber} : le sujet « ${avoid.subject} » est déjà couvert par ${avoid.url} ${page}. ` +
    'Propose un sujet DIFFÉRENT et complémentaire pour ce créneau (autre service, autre question, autre intention, ' +
    'autre quartier ou commune de la campagne), avec son propre target_keyword et son propre proposed_slug. ' +
    `N'utilise jamais l'adresse ${avoid.path} ni un mot-clé équivalent.`
  )
}

function guardReason(keyword: string, guard: KeywordGuard): string {
  switch (guard.origin) {
    case 'site':
      return `« ${keyword} » reprend le mot-clé « ${guard.keyword} », déjà ciblé par une page du site : le créneau est écarté plutôt que de la concurrencer.`
    case 'search-console':
      return `« ${keyword} » reprend la requête « ${guard.keyword} », pour laquelle une page du site ranke déjà en Search Console : le créneau est écarté plutôt que de la concurrencer.`
    case 'cycle':
      return `« ${keyword} » reprend « ${guard.keyword} », déjà visé par un autre créneau de ce cycle : le créneau est écarté plutôt que de publier deux pages concurrentes.`
  }
}

// ─── Interne ────────────────────────────────────────────────────────────────

/** Les noms de communes normalises, du plus long au plus court. */
function cityPhrases(cityNames: readonly string[]): string[] {
  const phrases = new Set(cityNames.map(name => normalizeForMatch(name ?? '')).filter(Boolean))
  return [...phrases].sort((a, b) => b.length - a.length)
}

/** Les communes nommees en toutes lettres, sur un texte deja normalise. */
function citiesNamedIn(normalized: string, phrases: readonly string[]): string[] {
  const haystack = ` ${normalized} `
  return phrases.filter(phrase => haystack.includes(` ${phrase} `))
}

/** Le sac de mots qui porte le SUJET : sans communes, sans mots vides, au singulier. */
function topicalTokens(normalized: string, phrases: readonly string[]): Set<string> {
  let text = ` ${normalized} `
  for (const phrase of phrases) {
    const needle = ` ${phrase} `
    while (text.includes(needle)) text = text.replace(needle, ' ')
  }
  return new Set(contentTokens(text).map(singular))
}

function singular(token: string): string {
  return token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token
}

/** Dedoublonne par forme normalisee, en gardant la premiere graphie rencontree. */
function dedupeByMeaning(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const value of values) {
    const key = normalizeForMatch(value ?? '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    kept.push(value.trim())
  }
  return kept
}
