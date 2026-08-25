// ─────────────────────────────────────────────────────────────────────────────
// Projection de l'inventaire — filtre, tri, pagination, et rien d'autre
// ─────────────────────────────────────────────────────────────────────────────
//
// Module SIBLING de la route, pas un export de plus sur route.ts : le depot a
// deja tranche la question avec app/api/dashboard/metrics.ts, importe par
// app/api/dashboard/route.ts ET par app/(dashboard)/dashboard/page.tsx. Un
// composant serveur qui importerait `route.ts` tirerait dans son graphe le
// module de route entier, son `export const dynamic` et NextRequest.
//
// La route HTTP et l'ecran serveur appellent LA MEME fonction. Deux
// implementations du meme filtre divergeraient, et la premiere divergence
// visible serait une page N+1 qui reaffiche des lignes de la page N.
//
// PURE : aucune IO, aucune horloge, aucun acces a l'environnement. Un test la
// nourrit d'un SiteInventory litteral. La fraicheur, elle, a deja ete decidee
// par freshnessOf() avec une horloge injectee ; on la RECOPIE, on ne la
// recalcule pas.

import {
  normalizeInventoryPath,
  type InventoryEntry,
  type InventoryOrigin,
  type SiteInventory,
} from '@/src/core/domain/existing/inventory'
import type { InventoryEntryDto, InventoryResponse, InventorySummary } from './types'

/** Taille de page par defaut, et seule valeur que la route n'a pas a connaitre. */
export const INVENTORY_PAGE_SIZE = 50

/**
 * Bornes de la taille de page.
 *
 * Le plancher evite qu'un `pageSize=1` transforme un inventaire de trois cents
 * pages en trois cents allers-retours ; le plafond evite qu'un `pageSize=100000`
 * rende l'inventaire entier au nom de la pagination.
 */
const MIN_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

export interface ProjectInventoryOptions {
  page: number
  pageSize: number
  /** Filtre libre sur le chemin ET le titre. */
  q?: string
  origin?: InventoryOrigin
  /**
   * `paths` rend UNIQUEMENT l'ensemble des chemins pris, sans aucune entree.
   *
   * Sans ce mode, la validation de slug de /strategy/new devrait interroger
   * cette route a chaque frappe : une requete HTTP par caractere pour une
   * comparaison qui tient en memoire.
   */
  fields?: 'paths'
}

/**
 * L'inventaire tel qu'il se rend, a une page donnee.
 *
 * `page` et `pageSize` sont rendus TELS QU'ILS ONT ETE APPLIQUES, bornes
 * compris : une interface qui construit ses liens de pagination a partir de ce
 * qu'elle a demande, et non de ce qui a ete servi, saute des lignes des la
 * premiere valeur hors bornes.
 */
export function projectInventory(
  inventory: SiteInventory,
  opts: ProjectInventoryOptions,
): InventoryResponse {
  const pageSize = clampPageSize(opts.pageSize)
  const summary = summarize(inventory)

  if (opts.fields === 'paths') {
    // Trie pour que deux lectures successives rendent le meme tableau : un
    // ensemble JavaScript conserve son ordre d'insertion, qui depend de l'ordre
    // des lignes rendues par PostgREST.
    return {
      summary,
      entries: [],
      page: 1,
      pageSize,
      total: 0,
      takenPaths: [...inventory.takenPaths].sort(),
    }
  }

  const matching = inventory.entries.filter(entry => matches(entry, opts))

  // Copie avant tri : `inventory.entries` est declare `readonly`, et trier la
  // valeur que l'appelant nous a passee modifierait son inventaire sous ses
  // pieds.
  const ordered = [...matching].sort(byRecencyThenPath)

  const page = clampPage(opts.page)
  const offset = (page - 1) * pageSize

  return {
    summary,
    entries: ordered.slice(offset, offset + pageSize).map(toDto),
    page,
    pageSize,
    // Le total porte sur ce que le FILTRE a retenu, pas sur la page rendue :
    // c'est lui qui dit s'il existe une page suivante.
    total: ordered.length,
  }
}

// ─── Resume ─────────────────────────────────────────────────────────────────

function summarize(inventory: SiteInventory): InventorySummary {
  const { freshness } = inventory

  // « Aucun crawl, donc rien a compter » et « le crawl a tourne et n'a rapporte
  // aucune page » sont deux faits differents. Le second vaut 0 et s'affiche ; le
  // premier vaut INCONNU. Les confondre est exactement la maniere dont un
  // tableau de bord commence a mentir.
  //
  // La condition porte AUSSI sur le compte : un site sans date de crawl lisible
  // mais dont des pages ont ete relevees a bien quelque chose a compter, et
  // effacer ce nombre au nom de l'honnetete serait la meme faute a l'envers.
  const nothingToCount = freshness.blindReason === 'jamais-analyse' && inventory.crawledCount === 0

  return {
    siteId: inventory.siteId,
    freshness: freshness.state,
    blindReason: freshness.blindReason ?? null,
    lastCrawledAt: freshness.lastCrawledAt,
    ageDays: freshness.ageDays,
    crawledCount: nothingToCount ? null : inventory.crawledCount,
    publishedCount: inventory.publishedCount,
    truncated: inventory.truncated,
  }
}

// ─── Filtre ─────────────────────────────────────────────────────────────────

function matches(entry: InventoryEntry, opts: ProjectInventoryOptions): boolean {
  if (opts.origin && entry.origin !== opts.origin) return false

  const needle = (opts.q ?? '').trim().toLowerCase()
  if (!needle) return true

  return entry.path.includes(pathNeedle(needle)) || (entry.title ?? '').toLowerCase().includes(needle)
}

/**
 * Ce qu'on cherche dans un chemin.
 *
 * Passe par normalizeInventoryPath — LA normalisation qui a produit les chemins
 * de l'inventaire — pour qu'un « /Taxi/ » colle a « /taxi ». Le slash de tete
 * que cette fonction ajoute d'office est ensuite retire : sans cela, taper
 * « troyes » chercherait « /troyes » et ne trouverait jamais « /taxi-troyes »,
 * ce qui ferait conclure a un filtre casse.
 */
function pathNeedle(needle: string): string {
  return normalizeInventoryPath(needle).replace(/^\//, '')
}

// ─── Tri ────────────────────────────────────────────────────────────────────

/**
 * Du plus recemment observe au plus ancien, departage par chemin.
 *
 * Le departage n'est pas cosmetique : sans ordre TOTAL, deux entrees de meme
 * date peuvent s'echanger entre deux appels, et la page N+1 reaffiche alors une
 * ligne de la page N pendant qu'une autre disparait.
 *
 * `observedAt` peut etre vide — une ligne sans date lisible. La comparaison
 * lexicale d'ISO 8601 (celle-la meme que deriveLinkContext applique deja) la
 * range naturellement en fin de liste, ce qui est sa place : on ne sait pas
 * quand on l'a vue.
 */
function byRecencyThenPath(a: InventoryEntry, b: InventoryEntry): number {
  if (a.observedAt !== b.observedAt) return b.observedAt.localeCompare(a.observedAt)
  return a.path.localeCompare(b.path)
}

// ─── Projection d'une entree ────────────────────────────────────────────────

/**
 * Champ par champ, JAMAIS par `...entry`.
 *
 * Un spread embarquerait `body` — le corps de la page — dans chaque reponse
 * HTTP, sans une erreur de compilation puisque le DTO n'est verifie que sur les
 * champs qu'il declare. C'est le seul endroit du chantier ou cette faute est
 * possible, et l'ecrire en toutes lettres est ce qui l'empeche.
 */
function toDto(entry: InventoryEntry): InventoryEntryDto {
  return {
    path: entry.path,
    // Le domaine ecrit '' pour « pas en ligne ». Un ecran teste une valeur
    // nulle, pas une chaine vide, et rendrait sinon un lien vers nulle part.
    url: entry.url.trim() || null,
    title: entry.title,
    metaDescription: entry.metaDescription,
    focusKeyword: entry.focusKeyword,
    canonicalPath: entry.canonicalPath,
    noindex: entry.noindex,
    origin: entry.origin,
    generationId: entry.generationId ?? null,
    bodyIsExcerpt: entry.bodyIsExcerpt,
    observedAt: entry.observedAt || null,
  }
}

// ─── Bornes ─────────────────────────────────────────────────────────────────

/**
 * Un parametre absent, vide ou illisible arrive ici en NaN : la route le PARSE,
 * elle ne le decide pas. C'est ce qui garde une seule definition du defaut.
 */
function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return INVENTORY_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.trunc(value)))
}

function clampPage(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}
