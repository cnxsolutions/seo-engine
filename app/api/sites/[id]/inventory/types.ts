// ─────────────────────────────────────────────────────────────────────────────
// Forme de GET /api/sites/[id]/inventory
// ─────────────────────────────────────────────────────────────────────────────
//
// Declaree une fois, importee par la route qui la produit, par la projection
// partagee (./project) et par les vues qui la rendent — meme patron que
// app/api/generate/feed-types.ts, dont l'en-tete raconte ce qu'a coute une
// seconde declaration de la meme forme : deux `Generation` cote front, tous deux
// derives de la table, dont l'un ne savait pas nommer 'rejected'.
//
// CE QUI N'EST PAS LA, ET POURQUOI
//
//  - `body`, `contentExcerpt`. Le corps d'une page ne quitte JAMAIS la base :
//    aucun ecran n'en affiche un caractere et trois cents pages pesent plusieurs
//    mega-octets. Ce qui remonte est le DRAPEAU `bodyIsExcerpt` — l'aveu qu'une
//    comparaison a porte sur un extrait, pas l'extrait lui-meme.
//  - un nombre de mots. La lecture d'inventaire ne projette pas `word_count`
//    (SITE_PAGE_COLUMNS, lib/existing/inventory.ts) : le champ ne pourrait valoir
//    que `null` sur chaque ligne, c'est-a-dire une colonne « inconnu » que
//    personne n'affiche et que le premier lecteur prendrait pour une mesure a
//    venir.
//
// Module de TYPES PUR : ses seuls imports sont des `import type`, effaces a la
// compilation. Rien d'ici n'atteint un bundle client, et la valeur par defaut de
// la pagination vit dans ./project, avec le code qui la borne.

import type {
  BlindReason,
  InventoryFreshness as InventoryFreshnessFacts,
  InventoryOrigin,
} from '@/src/core/domain/existing/inventory'

/**
 * Le regime de connaissance, DERIVE du domaine au lieu d'y etre recopie.
 *
 * Deux unions jumelles finissent toujours par diverger d'un membre, et le jour
 * ou cela arrive l'ecran ne sait plus nommer l'etat que la lecture vient de
 * calculer. Ce n'est pas une seconde adresse d'import : c'est le meme type, sous
 * le nom que le contrat HTTP lui donne.
 */
export type InventoryFreshness = InventoryFreshnessFacts['state']

/** Pourquoi on ne voit rien. Meme derivation, meme raison. */
export type InventoryBlindReason = BlindReason

/**
 * Une page que le site porte deja, telle que l'interface la rend.
 *
 * Chaque champ nullable porte une distinction que l'ecran doit savoir dire :
 * une meta description absente de la page et une meta description jamais relevee
 * ne sont pas le meme fait, et les afficher toutes deux par un tiret nu est
 * exactement la maniere dont une liste commence a mentir.
 */
export interface InventoryEntryDto {
  /** Normalise par normalizeInventoryPath() : c'est la seule forme comparable. */
  path: string
  /** null quand la page n'est pas en ligne — une adresse reservee n'est pas une page servie. */
  url: string | null
  title: string | null
  metaDescription: string | null
  focusKeyword: string | null
  /** Une page canonisee ailleurs occupe son URL sans etre celle que Google indexe. */
  canonicalPath: string | null
  noindex: boolean
  origin: InventoryOrigin
  /** Renseigne quand le moteur a publie cette page : ouvre le lien vers la generation. */
  generationId: string | null
  /**
   * Seul un extrait de cette page est connu (2000 caracteres au crawl), ou rien
   * du tout pour une ligne 'engine' jamais recrawlee. A AFFICHER : un verdict de
   * similarite calcule contre un extrait ne prouve pas grand-chose, et l'ecran
   * doit pouvoir le dire au lieu de laisser croire a une comparaison complete.
   */
  bodyIsExcerpt: boolean
  /** null quand la ligne ne porte aucune date lisible : une date inventee ferait croire a une observation recente. */
  observedAt: string | null
}

/**
 * Ce que le moteur sait du site, en une poignee de faits.
 *
 * `InventorySummary` est le SEUL resume de fraicheur du produit : les autres
 * contrats (app/api/generate/feed-types.ts) l'importent d'ici plutot que d'en
 * redeclarer les sept champs.
 */
export interface InventorySummary {
  siteId: string
  freshness: InventoryFreshness
  /** Toujours renseigne quand `freshness` vaut 'blind', null sinon. */
  blindReason: InventoryBlindReason | null
  lastCrawledAt: string | null
  /** L'age qui a DECIDE du regime, pas un age recalcule a l'affichage : « analyse il y a 45 jours » a cote d'un regime calcule sur 45,4 est indiagnosticable depuis l'ecran. */
  ageDays: number | null
  /**
   * Pages reellement vues sur le site.
   *
   * `null` quand aucune analyse n'a jamais tourne : « aucun crawl, donc rien a
   * compter » et « le crawl a tourne et n'a rapporte aucune page » sont deux
   * faits differents, et le second vaut bien 0. L'interface affiche « Inconnu »
   * sur le premier — jamais un zero, qui se lirait comme une mesure.
   */
  crawledCount: number | null
  /**
   * Pages que le moteur a publiees. Jamais null : il se compte sur les lignes de
   * `generations`, que la lecture rapporte meme sur un site jamais crawle. Un 0
   * ici est un vrai zero.
   */
  publishedCount: number
  /** Plafond de crawl atteint : l'inventaire est un echantillon, ce qui DURCIT les seuils anti-doublon au lieu de rassurer. */
  truncated: boolean
}

export interface InventoryResponse {
  summary: InventorySummary
  entries: InventoryEntryDto[]
  page: number
  pageSize: number
  /** Nombre d'entrees APRES filtre, jamais la taille de la page rendue. */
  total: number
  /**
   * Present UNIQUEMENT sous `fields=paths`. TOUS les chemins pris, y compris
   * ceux que des generations 'failed' retiennent alors que RIEN n'est en ligne.
   * Toute interface qui rend cet ensemble dit « prise ou reservee », jamais
   * « cette page existe sur le site ».
   */
  takenPaths?: string[]
}
