// ─────────────────────────────────────────────────────────────────────────────
// Site Inventory
// SEO Engine - Domain
// Ce que le site porte DEJA : un vocabulaire, une horloge injectee
// ─────────────────────────────────────────────────────────────────────────────
//
// Le moteur ecrivait sans savoir ce qui etait en ligne. Quatre bouts de code
// simulaient cette connaissance, chacun a moitie, et aucun ne distinguait les
// deux seuls faits qui comptent : « cette URL est-elle occupee ? » et « ce sujet
// est-il deja couvert ? ». Ce module ne lit rien et n'appelle rien : il dit CE
// QU'EST un inventaire, pour que la lecture (lib/existing/inventory.ts) n'ait
// plus a inventer sa propre forme, et pour qu'une politique pure puisse etre
// testee sur un SiteInventory litteral, sans Supabase.
//
// Ce module n'implemente AUCUN des sept ports de src/core/domain/repositories et
// n'en cree pas un huitieme. Tous ses consommateurs (identite editoriale,
// decision d'action, gate, pipeline, cron, cycle-manager, cluster) recoivent la
// VALEUR SiteInventory : une interface a une methode, une implementation et zero
// site d'usage serait du vocabulaire qui ne sert qu'a lui-meme.
//
// Aucun import : pas de Supabase, pas de lib/, pas d'horloge ambiante. `now` est
// un parametre parce qu'une fraicheur qui lirait Date.now() ne serait testable
// qu'en gelant le temps du processus.

// ─── Normalisation de chemin ────────────────────────────────────────────────

/**
 * Le chemin d'une entree d'inventaire, sous la SEULE forme comparable.
 *
 * C'est le point ou tout se joue. Trois ecrivains produisent des chemins qui
 * doivent tomber sur la meme chaine, sans quoi deux entrees de la meme page ne
 * se voient jamais :
 *
 *  - l'amorcage SQL de la migration 018, `lower('/' || ltrim(g.slug, '/'))` ;
 *  - le crawler, dont les chemins passent par normalizePath()
 *    (lib/pipeline/internal-links.ts) ;
 *  - le moteur lui-meme, qui reserve un slug avant d'ecrire le premier token.
 *
 * Cette fonction est deliberement le jumeau de normalizePath() : le domaine ne
 * peut pas importer lib/ sans inverser sa dependance, donc les deux coexistent
 * et DOIVENT rendre le meme resultat. Le test verrouille la coincidence avec
 * l'expression SQL de 018 ; une divergence future se voit la, pas en production
 * sous la forme d'un amorcage invisible au code.
 *
 * Une chaine vide rend une chaine vide, JAMAIS '/'. Un slug absent n'occupe pas
 * la page d'accueil, et buildKnownPathSet() qui ajoute '/' d'office est
 * precisement ce qu'un inventaire ne doit pas faire : takenPaths est une
 * reservation d'URL, pas un maillage interne.
 */
export function normalizeInventoryPath(value: string | null | undefined): string {
  let path = (value ?? '').trim()
  if (!path) return ''

  // Ancre et parametres de requete d'abord : '/taxi?utm=ads#tarifs' et '/taxi'
  // sont la meme page. Une entree par variante de tracking rendrait la moitie
  // des URL du site « occupees » deux fois et ferait desambiguer un slug libre.
  path = path.split('#')[0].split('?')[0]

  try {
    path = decodeURIComponent(path)
  } catch {
    // Une sequence d'echappement invalide n'est pas une raison de perdre
    // l'entree : on compare la forme brute.
  }

  if (!path.startsWith('/')) path = `/${path}`

  // Le '//taxi-troyes' que le ltrim() de la migration evite cote SQL. Un chemin
  // a double slash ne correspondrait a rien : ni a takenPaths, ni au crawl.
  path = path.replace(/\/{2,}/g, '/')

  // Le slash de queue disparait, sauf sur la racine qui n'est QUE ce slash.
  if (path.length > 1) path = path.replace(/\/+$/, '')

  return path.toLowerCase()
}

// ─── Une entree ─────────────────────────────────────────────────────────────

/** D'ou vient la connaissance de cette page : observee, ou publiee par nous. */
export type InventoryOrigin = 'crawl' | 'engine'

/**
 * Une page que le site porte deja, quelle que soit la maniere dont on l'a apprise.
 *
 * Une ligne 'engine' issue de l'amorcage SQL de 018 n'a ni corps, ni h1, ni
 * word_count : elle sert au takenPaths et aux comparaisons d'identite, jamais a
 * la detection lexicale de duplicat. C'est un fait a connaitre avant de conclure
 * que la detection « ne marche pas » sur un site fraichement amorce.
 */
export interface InventoryEntry {
  /** Normalise par normalizeInventoryPath(). Jamais un chemin brut. */
  path: string
  url: string
  title: string | null
  metaDescription: string | null
  focusKeyword: string | null
  /** Une page canonisee ailleurs n'occupe pas fermement son URL. */
  canonicalPath: string | null
  /** Une page desindexee ne cannibalise rien. */
  noindex: boolean
  /** Ne quitte JAMAIS la base par une reponse HTTP : sert au seul comparateur. */
  body: string
  /**
   * Vrai pour une ligne site_pages (le crawler plafonne son extrait) ET pour
   * toute ligne 'engine' amorcee par 018, qui n'a pas de corps du tout. Le
   * verdict qui en decoule AVOUE son asymetrie plutot que de la taire.
   */
  bodyIsExcerpt: boolean
  origin: InventoryOrigin
  generationId?: string
  /**
   * pageType et parentGenerationId ne sont pas decoratifs : le graphe de
   * maillage filtre sur pageType === 'pillar' puis apparie sur
   * parentGenerationId. Les omettre rendrait un graphe SYSTEMATIQUEMENT vide,
   * sans erreur et sans test rouge, et le maillage pilier/enfant disparaitrait
   * du produit en silence.
   */
  pageType?: string
  parentGenerationId?: string | null
  /**
   * Faux quand l'URL est prise mais le sujet libre : une generation 'failed' a
   * peut-etre ecrit la page a distance, elle n'a certainement pas couvert son
   * sujet. Occupation et couverture sont deux faits, pas un seul.
   */
  coversTopic: boolean
  /** Jamais absent : sans date, la fraicheur est indecidable. */
  observedAt: string
}

// ─── Fraicheur ──────────────────────────────────────────────────────────────

/**
 * Au-dela : l'inventaire est vieux mais utilisable. On genere en le durcissant.
 */
export const STALE_AFTER_DAYS = 15

/**
 * Au-dela : l'inventaire ne dit plus rien de fiable sur le site d'aujourd'hui.
 * 'blind' n'est PAS un motif de refus — jamais. La degradation se nomme pour
 * que l'operateur la voie et decide ; arreter le moteur parce qu'une source
 * externe manque est le comportement que ce chantier existe pour supprimer.
 */
export const BLIND_AFTER_DAYS = 45

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Pourquoi on ne voit rien. Les trois cas appellent trois phrases differentes
 * dans l'interface, et deux d'entre eux appellent deux actions differentes :
 * lancer une premiere analyse, ou aller regarder pourquoi elle n'a rien trouve.
 */
export type BlindReason = 'jamais-analyse' | 'aucune-page-trouvee' | 'crawl-trop-vieux'

export interface InventoryFreshness {
  state: 'fresh' | 'stale' | 'blind'
  /** Toujours renseigne quand state vaut 'blind', absent sinon. */
  blindReason?: BlindReason
  lastCrawledAt: string | null
  /** Entier de jours, jamais negatif. null quand aucune date lisible n'existe. */
  ageDays: number | null
}

/**
 * L'etat de la connaissance, a une date donnee.
 *
 * `hasCompletedRun` porte a lui seul la distinction que la base ne sait pas
 * exprimer : un site JAMAIS analyse et un site analyse qui n'a rendu AUCUNE
 * page ne sont pas le meme fait. Le premier attend un crawl, le second a
 * repondu « rien » — et c'est generalement un sitemap injoignable ou un site
 * entierement rendu cote client, deux problemes que seul l'operateur peut
 * regler.
 *
 * `now` est un parametre : la fraicheur est la seule chose de ce module qui
 * depende du temps, et elle doit rester rejouable a n'importe quelle date.
 */
export function freshnessOf(
  lastCrawledAt: string | null,
  hasCompletedRun: boolean,
  crawledCount: number,
  now: Date,
): InventoryFreshness {
  const observedAt = parseTimestamp(lastCrawledAt)

  // Aucune date lisible : on n'echo PAS la chaine recue. Une date qu'on ne sait
  // pas lire affichee telle quelle ferait croire a une analyse recente.
  if (observedAt === null) {
    return blindFreshness(hasCompletedRun ? 'aucune-page-trouvee' : 'jamais-analyse', null, null)
  }

  // L'age affiche est celui qui decide : un « analyse il y a 45 jours » a cote
  // d'un etat 'blind' calcule sur 45,4 jours est une contradiction que personne
  // ne peut diagnostiquer depuis l'ecran.
  const ageDays = Math.max(0, Math.floor((now.getTime() - observedAt) / MS_PER_DAY))

  // Analyse, mais zero page : le crawl a bien tourne, il n'a rien rapporte.
  if (crawledCount <= 0) {
    return blindFreshness('aucune-page-trouvee', lastCrawledAt, ageDays)
  }

  if (ageDays > BLIND_AFTER_DAYS) {
    return blindFreshness('crawl-trop-vieux', lastCrawledAt, ageDays)
  }

  return {
    state: ageDays > STALE_AFTER_DAYS ? 'stale' : 'fresh',
    lastCrawledAt,
    ageDays,
  }
}

// ─── L'inventaire d'un site ─────────────────────────────────────────────────

export interface SiteInventory {
  siteId: string
  entries: readonly InventoryEntry[]
  /**
   * Les chemins normalises de TOUTES les entrees, y compris celles dont
   * coversTopic est faux. Une URL reservee par une generation 'failed' reste
   * reservee : le sujet est libre, l'adresse ne l'est pas forcement.
   *
   * A NE PAS construire avec buildKnownPathSet(), qui ajoute '/' d'office :
   * inoffensif pour une collision de slug, faux dans tout compteur montre a
   * l'operateur et faux dans une reponse d'API.
   */
  takenPaths: ReadonlySet<string>
  freshness: InventoryFreshness
  crawledCount: number
  publishedCount: number
  /** Plafond de crawl atteint : durcit les seuils en aval, ne rassure jamais. */
  truncated: boolean
}

/**
 * L'inventaire qu'on rend quand on ne sait rien — lecture impossible, site
 * jamais analyse, crawl vide.
 *
 * Il existe pour que la lecture ne jette JAMAIS : un appelant qui recoit un
 * inventaire aveugle continue de produire en le sachant, la ou une exception
 * arreterait le run entier au premier site mal configure.
 *
 * `truncated` reste faux : rien n'a ete tronque, il n'y a simplement rien. La
 * degradation est deja nommee par freshness.blindReason, et la surdeclarer
 * ailleurs ferait durcir des seuils pour la mauvaise raison.
 */
export function blindInventory(siteId: string, reason: BlindReason): SiteInventory {
  return {
    siteId,
    entries: [],
    takenPaths: new Set<string>(),
    freshness: blindFreshness(reason, null, null),
    crawledCount: 0,
    publishedCount: 0,
    truncated: false,
  }
}

// ─── Interne ────────────────────────────────────────────────────────────────

function blindFreshness(
  reason: BlindReason,
  lastCrawledAt: string | null,
  ageDays: number | null,
): InventoryFreshness {
  return { state: 'blind', blindReason: reason, lastCrawledAt, ageDays }
}

/** Rend null sur une date absente OU illisible : les deux se traitent pareil. */
function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}
