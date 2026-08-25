// ─────────────────────────────────────────────────────────────────────────────
// Inventaire de l'existant
// SEO Engine - L'UNIQUE lecture de ce que le site porte deja.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le moteur ecrivait sans savoir ce qui etait en ligne. Quatre bouts de code
// simulaient cette connaissance, chacun a moitie :
//
//   - getSiteContext (lib/db.ts:368) : deux `select('*')`, donc le HTML COMPLET
//     de chaque generation charge en memoire pour n'en tirer qu'une liste de
//     slugs, de mots-cles et de titres. Un site de trois cents pages payait
//     plusieurs mega-octets de transfert par tick pour trois tableaux de
//     chaines.
//   - checkDuplicates, qui rappelle getSiteContext et compare des chaines.
//   - loadSiteLinkContext (lib/pipeline/repository.ts:48) : deux requetes de
//     plus, etroites cette fois, pour la meme population de lignes.
//   - fetchExistingContent de rag-enricher.
//
// Aucune des quatre ne distinguait les deux seuls faits qui comptent : « cette
// URL est-elle occupee ? » et « ce sujet est-il deja couvert ? ». Ce module les
// remplace toutes par une lecture unique, a projection etroite, dont le domaine
// (src/core/domain/existing/inventory.ts) definit la forme.
//
// TROIS REGLES QUE CE FICHIER NE NEGOCIE PAS
//
// 1. JAMAIS `select('*')`, JAMAIS la colonne `content`. C'est le gaspillage
//    qu'on remplace ; le reintroduire annulerait le seul benefice mesurable.
// 2. NE JETTE JAMAIS. Une lecture impossible rend un inventaire aveugle et
//    nomme, pas une exception. Arreter un run entier parce qu'un site est mal
//    configure est exactement le comportement que ce chantier supprime.
// 3. Un chemin ne se compare que normalise, par normalizeInventoryPath() du
//    domaine — la MEME fonction que celle qui ECRIT les chemins
//    (lib/publishing/record.ts) et que celle qui les reserve
//    (lib/existing/reservation.ts). Deux variantes qui divergeraient d'une
//    majuscule feraient porter deux entrees a la meme page, dont aucune ne
//    verrait l'autre.

import { buildKnownPathSet } from '@/lib/pipeline/internal-links'
import { createServiceClient } from '@/lib/supabase'
import { SupabaseVectorStore } from '@/src/adapters/rag/providers/SupabaseVectorStore'
import {
  blindInventory,
  freshnessOf,
  normalizeInventoryPath,
  type InventoryEntry,
  type InventoryOrigin,
  type SiteInventory,
} from '@/src/core/domain/existing/inventory'
import {
  contentTokens,
  cosineSimilarityOfTokens,
  normalizeForMatch,
} from '@/src/core/domain/text/text-utils'
import type { SearchResult } from '@/src/adapters/rag/VectorStore'
import type { InternalLinkTarget } from '@/lib/seo/internal-linking'
import type { Generation, PageType } from '@/lib/types'

// ─── Projections ────────────────────────────────────────────────────────────

/**
 * Ce que l'inventaire lit de `site_pages`, colonne par colonne.
 *
 * Ecrit comme une constante et non en ligne pour que la revue voie d'un coup
 * d'oeil ce qui traverse le reseau. `content_excerpt` est deja plafonne par le
 * crawler (CONTENT_EXCERPT_MAX_CHARS) et par recordPublication : c'est le seul
 * champ volumineux, et il est le corps que la detection lexicale compare.
 *
 * `keywords` ne remplit aucun champ d'InventoryEntry aujourd'hui — c'est la
 * colonne dont getSiteContext tirait `usedKeywords`. Elle reste dans la
 * projection pour que le remplacant lise au moins autant que le remplace ; le
 * jour ou plus personne ne la reclame, elle sort d'ici et de nulle part
 * ailleurs.
 */
// Une seule chaine litterale, jamais une concatenation : le client Supabase
// TYPE la reponse en analysant ce texte, et deux litteraux additionnes lui
// arrivent comme un `string` opaque dont il ne peut plus rien deduire.
const SITE_PAGE_COLUMNS =
  'path,url,title,meta_description,h1,focus_keyword,keywords,content_excerpt,canonical_path,robots_noindex,origin,generation_id,crawled_at'

/**
 * Ce que l'inventaire lit de `generations`.
 *
 * `page_type` et `parent_generation_id` ne sont PAS decoratifs : buildLinkGraph
 * (lib/seo/smart-linking.ts:33-36) filtre sur page_type === 'pillar' puis
 * apparie sur parent_generation_id. Les omettre rendrait un graphe de maillage
 * systematiquement vide, sans erreur et sans test rouge.
 *
 * `content` n'y figure pas et n'y figurera pas. Le corps d'une generation vit
 * deja dans `site_pages.content_excerpt` des qu'elle est publiee, en texte et
 * plafonne ; le relire en HTML complet ici serait le bug qu'on repare.
 */
const GENERATION_COLUMNS =
  'id,slug,title,meta_description,focus_keyword,status,published_url,published_at,updated_at,page_type,parent_generation_id'

/**
 * Plafond de crawl au-dela duquel l'inventaire s'avoue incomplet.
 *
 * Ce n'est PAS une limite appliquee a la requete : l'inventaire n'est jamais
 * tronque a la lecture. C'est le nombre de pages a partir duquel on considere
 * que le crawler s'est arrete avant la fin du site, ce qui durcit les seuils en
 * aval au lieu de rassurer a tort.
 */
const DEFAULT_CRAWL_LIMIT = 300

// ─── Lignes brutes ──────────────────────────────────────────────────────────

interface SitePageRow {
  path: string | null
  url: string | null
  title: string | null
  meta_description: string | null
  h1: string | null
  focus_keyword: string | null
  keywords: string[] | null
  content_excerpt: string | null
  canonical_path: string | null
  robots_noindex: boolean | null
  origin: string | null
  generation_id: string | null
  crawled_at: string | null
}

interface GenerationRow {
  id: string
  slug: string | null
  title: string | null
  meta_description: string | null
  focus_keyword: string | null
  status: string | null
  published_url: string | null
  published_at: string | null
  updated_at: string | null
  page_type: string | null
  parent_generation_id: string | null
}

// ─── Lecture ────────────────────────────────────────────────────────────────

export interface LoadInventoryOptions {
  /** Horloge injectee : une fraicheur qui lirait Date.now() ne serait pas rejouable. */
  now?: Date
  /** Plafond de crawl du site, pour decider `truncated`. Defaut : 300. */
  limit?: number
}

/**
 * Tout ce que le moteur sait du site, en quatre requetes paralleles.
 *
 * Les quatre sont etroites et independantes, donc en Promise.all : la lecture
 * coute un aller-retour, pas quatre. Les deux dernieres ne servent qu'a la
 * fraicheur, et elles sont indispensables — sans `analysis_runs`, un site
 * jamais analyse et un site analyse qui n'a rien trouve rendent le meme
 * inventaire vide, et l'operateur lit « lancez une analyse » alors que son
 * analyse a deja tourne et n'a rien rapporte.
 *
 * NE JETTE JAMAIS : une erreur Supabase, une variable d'environnement absente
 * ou un site inconnu rendent un inventaire aveugle, apres un avertissement en
 * console. L'appelant continue de produire en le sachant.
 */
export async function loadSiteInventory(
  siteId: string,
  opts?: LoadInventoryOptions,
): Promise<SiteInventory> {
  const now = opts?.now ?? new Date()
  const crawlLimit = opts?.limit ?? DEFAULT_CRAWL_LIMIT

  let pages: SitePageRow[]
  let generations: GenerationRow[]
  let campaignCrawledAt: string | null
  let hasCompletedRun: boolean

  try {
    const supabase = createServiceClient()

    const [pagesResult, generationsResult, campaignsResult, runsResult] = await Promise.all([
      supabase.from('site_pages').select(SITE_PAGE_COLUMNS).eq('site_id', siteId),
      supabase
        .from('generations')
        .select(GENERATION_COLUMNS)
        .eq('site_id', siteId)
        // Une generation sans slug n'occupe aucune adresse : elle n'a rien a
        // dire a un inventaire dont la clef EST le chemin.
        .not('slug', 'is', null),
      supabase
        .from('campaigns')
        .select('last_crawl_at')
        .eq('site_id', siteId)
        // nullsFirst: false, sans quoi PostgreSQL trie NULLS FIRST en
        // descendant : une campagne qui n'a jamais crawle passerait devant
        // celle qui vient de le faire, et la fraicheur retomberait sur le repli
        // alors qu'une vraie date existe.
        .order('last_crawl_at', { ascending: false, nullsFirst: false })
        .limit(1),
      supabase
        .from('analysis_runs')
        .select('id')
        .eq('site_id', siteId)
        .eq('status', 'completed')
        .limit(1),
    ])

    const failure =
      pagesResult.error ?? generationsResult.error ?? campaignsResult.error ?? runsResult.error
    if (failure) throw new Error(failure.message)

    pages = (pagesResult.data ?? []) as SitePageRow[]
    generations = (generationsResult.data ?? []) as GenerationRow[]
    campaignCrawledAt =
      ((campaignsResult.data ?? []) as Array<{ last_crawl_at: string | null }>)[0]?.last_crawl_at ??
      null
    hasCompletedRun = ((runsResult.data ?? []) as Array<{ id: string }>).length > 0
  } catch (error) {
    // 'jamais-analyse' et non 'aucune-page-trouvee' : on n'a rien lu, donc on
    // ne sait meme pas si une analyse a tourne. Affirmer « analysee, zero
    // page » sur une panne de lecture enverrait l'operateur regarder son
    // sitemap au lieu de sa base.
    console.warn(
      `[inventaire] lecture impossible pour le site ${siteId} : ${messageOf(error)}`,
    )
    return blindInventory(siteId, 'jamais-analyse')
  }

  const byPath = new Map<string, InventoryEntry>()

  // `site_pages` d'abord : c'est la seule source qui porte un corps et une URL
  // reellement observee. La table est UNIQUE (site_id, path), donc aucune
  // collision interne n'est possible ici.
  for (const row of pages) {
    const entry = entryFromSitePage(row)
    if (entry) byPath.set(entry.path, entry)
  }

  // `generations` ensuite, en REMPLISSAGE. Une page que le moteur croit avoir
  // publiee et que le crawl a vue reste decrite par le crawl : le crawl a vu la
  // page reelle, la generation ne connait que ce qu'on a cru publier.
  for (const row of generations) {
    const declared = entryFromGeneration(row)
    if (!declared) continue

    const observed = byPath.get(declared.path)
    byPath.set(declared.path, observed ? inheritLineage(observed, declared) : declared)
  }

  const entries = [...byPath.values()]

  // Les pages VRAIMENT crawlees, pas les lignes 'engine' que recordPublication
  // et l'amorcage de la migration 018 inscrivent dans la meme table. C'est ce
  // compte-la que le plafond du crawler borne.
  const crawledCount = pages.filter(row => originOf(row) === 'crawl').length

  const freshness = freshnessOf(
    campaignCrawledAt ?? latestCrawlOf(pages),
    hasCompletedRun,
    crawledCount,
    now,
  )

  return {
    siteId,
    entries,
    // Surtout pas buildKnownPathSet(), qui ajoute '/' d'office : takenPaths est
    // une reservation d'URL, et la racine n'est reservee par personne.
    takenPaths: new Set(entries.map(entry => entry.path)),
    freshness,
    crawledCount,
    publishedCount: entries.filter(isPublishedByEngine).length,
    truncated: crawledCount >= crawlLimit,
  }
}

// ─── Contexte de maillage ───────────────────────────────────────────────────

/**
 * Combien de pages publiees le lieur peut se voir proposer comme destinations.
 *
 * Le lieur n'injecte une ancre que si son texte figure deja dans la page, donc
 * une longue liste coute quelques passes de regex et rien d'autre — mais c'est
 * quand meme une liste rendue dans un bloc de navigation, et cent entrees
 * « a lire aussi » ne sont pas du maillage interne, c'est un plan de site.
 *
 * Exporte, alors qu'il etait prive dans repository.ts : le plafond est
 * desormais une propriete du contexte que d'autres modules construisent et
 * verifient, plus un detail d'une fonction unique.
 */
export const MAX_LINK_CANDIDATES = 40

export interface SiteLinkContext {
  /**
   * Chemins normalises de toutes les pages qui existent vraiment, plus la
   * racine que buildKnownPathSet ajoute : un lien vers l'accueil est le lien
   * interne le plus frequent d'une page generee, et aucun crawl n'est
   * necessaire pour savoir qu'il resout.
   */
  knownPaths: Set<string>
  /** Generations publiees, assez de chaque ligne pour buildLinkGraph. */
  publishedGenerations: Generation[]
  /** Destinations reelles et existantes que le lieur peut proposer. */
  candidates: InternalLinkTarget[]
  counts: { crawledPages: number; publishedGenerations: number }
}

/**
 * Le contexte de maillage, DERIVE de l'inventaire deja charge.
 *
 * loadSiteLinkContext refaisait deux requetes sur exactement la meme population
 * de lignes que loadSiteInventory venait de lire. La forme de sortie est
 * identique au point-virgule pres pour que ses appelants ne changent pas de
 * contrat ; ce qui disparait, c'est l'aller-retour.
 *
 * Pure : aucun reseau, aucune horloge. Un test la nourrit d'un SiteInventory
 * litteral.
 */
export function deriveLinkContext(inventory: SiteInventory): SiteLinkContext {
  // SEULES les pages qu'un visiteur peut atteindre entrent ici.
  //
  // L'inventaire, lui, porte AUSSI les adresses reservees par des generations
  // qui ne sont pas en ligne — c'est tout son interet pour la reservation de
  // slug. Les verser au maillage ferait exactement le contraire de ce que
  // lib/pipeline/internal-links.ts existe pour empecher : des liens vers des
  // pages qui n'existent pas, gardes parce que knownPaths affirme qu'elles
  // existent.
  const online = inventory.entries.filter(isOnline)

  const knownPaths = buildKnownPathSet(online.map(entry => entry.path))

  // Du plus recent au plus ancien, comme le faisait l'ORDER BY updated_at DESC
  // de la requete remplacee : le plafond de candidats tombe alors sur les pages
  // les plus fraiches, pas sur les premieres arrivees.
  const published = online
    .filter(isPublishedByEngine)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))

  const publishedGenerations = published.map(toGeneration)

  const candidates: InternalLinkTarget[] = []
  const seenHrefs = new Set<string>()

  const pushCandidate = (anchor: string | null | undefined, href: string) => {
    const text = (anchor || '').trim()
    // Une ancre plus courte que ca correspond a la moitie de la page par
    // accident ; le lieur transformerait un « eau » egare en lien.
    if (text.length < 8) return
    if (!href) return
    if (seenHrefs.has(href)) return
    seenHrefs.add(href)
    candidates.push({ anchor: text, href })
  }

  for (const entry of published) pushCandidate(entry.title || entry.focusKeyword, entry.path)
  for (const entry of online) {
    if (isPublishedByEngine(entry)) continue
    pushCandidate(entry.title || entry.focusKeyword, entry.path)
  }

  return {
    knownPaths,
    publishedGenerations,
    candidates: candidates.slice(0, MAX_LINK_CANDIDATES),
    counts: {
      crawledPages: inventory.crawledCount,
      publishedGenerations: publishedGenerations.length,
    },
  }
}

// ─── Voisinage semantique ───────────────────────────────────────────────────

/** Clef documentaire d'une page crawlee, telle que VectorIndexingService l'ecrit. */
const PAGE_DOCUMENT_PREFIX = 'page:'
/** Clef documentaire d'une generation, meme source. */
const GENERATION_DOCUMENT_PREFIX = 'generation:'

/**
 * Les pages de l'inventaire les plus proches d'un sujet.
 *
 * COUT DECLARE : le chemin vectoriel achete un embedding OpenAI par appel
 * (findSimilar -> generateEmbedding). C'est un aller-retour facture par page
 * generee. Il est assume parce qu'un comparateur purement lexical ne voit pas
 * qu'« un taxi conventionne CPAM » et « transport medical assis » sont la meme
 * page ; il n'est pas gratuit pour autant.
 *
 * DEUX PIEGES, tous deux verifies dans le code appele :
 *
 * 1. Le mapping se fait sur `metadata.documentId`, JAMAIS sur `result.id`. La
 *    fonction RPC vector_search (db/000_baseline.sql:205-206) rend `ve.id`,
 *    c'est-a-dire l'UUID de la ligne vector_embeddings — pas la clef
 *    documentaire. Un mapping sur `id` ne resoudrait jamais une seule entree et
 *    la detection de duplicat tournerait a vide en donnant l'illusion de
 *    fonctionner.
 * 2. Aucun `contentTypeKey`. findSimilar le transmet tel quel au filtre SQL, et
 *    les pages crawlees sont indexees sous 'page' quand les generations le sont
 *    sous 'post' : fixer une valeur ferait disparaitre la moitie du corpus.
 *
 * Ne jette jamais, et ne rend jamais une liste vide en silence : index
 * indisponible, sujet vide ou clef irresolue retombent sur un tri lexical
 * deterministe de l'inventaire.
 */
export async function nearestExistingEntries(
  siteId: string,
  topic: string,
  inventory: SiteInventory,
  limit: number,
): Promise<InventoryEntry[]> {
  const wanted = Math.max(0, limit)
  if (wanted === 0) return []

  const resolved = await vectorNeighbours(siteId, topic, inventory, wanted)
  return resolved.length > 0 ? resolved : lexicalNeighbours(topic, inventory, wanted)
}

async function vectorNeighbours(
  siteId: string,
  topic: string,
  inventory: SiteInventory,
  limit: number,
): Promise<InventoryEntry[]> {
  // findSimilar rend [] immediatement sur un contenu vide : autant ne pas
  // ouvrir de client ni payer d'embedding pour l'apprendre.
  if (!topic.trim()) return []

  try {
    const store = new SupabaseVectorStore(createServiceClient())
    const results = await store.findSimilar({ content: topic, siteId, limit })
    return resolveDocuments(results, inventory, limit)
  } catch (error) {
    console.warn(
      `[inventaire] voisinage vectoriel indisponible pour le site ${siteId} : ${messageOf(error)}`,
    )
    return []
  }
}

/** Des clefs documentaires vers les entrees d'inventaire qu'elles designent. */
function resolveDocuments(
  results: readonly SearchResult[],
  inventory: SiteInventory,
  limit: number,
): InventoryEntry[] {
  const byPath = new Map<string, InventoryEntry>()
  const byGenerationId = new Map<string, InventoryEntry>()
  for (const entry of inventory.entries) {
    byPath.set(entry.path, entry)
    if (entry.generationId) byGenerationId.set(entry.generationId, entry)
  }

  const found: InventoryEntry[] = []
  const seen = new Set<string>()

  for (const result of results) {
    const documentId = result.metadata?.documentId
    if (!documentId) continue

    let entry: InventoryEntry | undefined
    if (documentId.startsWith(PAGE_DOCUMENT_PREFIX)) {
      // La clef est construite sur `row.path` BRUT (VectorIndexingService.ts:454),
      // qui n'est pas passe par la normalisation : '/Taxi-Troyes' indexe doit
      // retrouver '/taxi-troyes' inventorie.
      entry = byPath.get(normalizeInventoryPath(documentId.slice(PAGE_DOCUMENT_PREFIX.length)))
    } else if (documentId.startsWith(GENERATION_DOCUMENT_PREFIX)) {
      entry = byGenerationId.get(documentId.slice(GENERATION_DOCUMENT_PREFIX.length))
    }

    if (!entry || seen.has(entry.path)) continue
    seen.add(entry.path)
    found.push(entry)
    if (found.length >= limit) break
  }

  return found
}

/**
 * Le repli quand l'index vectoriel ne repond pas — ou ne resout rien.
 *
 * Deterministe de bout en bout, jusqu'au departage par chemin : deux appels
 * successifs sur le meme inventaire rendent la meme liste, sans quoi une page
 * serait jugee duplicate un jour et originale le lendemain.
 */
function lexicalNeighbours(
  topic: string,
  inventory: SiteInventory,
  limit: number,
): InventoryEntry[] {
  const wanted = normalizeForMatch(topic)
  const topicTokens = contentTokens(topic)

  return inventory.entries
    .map(entry => ({
      entry,
      // Le mot-cle principal identique est le signal fort : deux pages qui le
      // partagent se cannibalisent, quel que soit leur titre.
      sameFocusKeyword: wanted !== '' && normalizeForMatch(entry.focusKeyword ?? '') === wanted,
      titleSimilarity: cosineSimilarityOfTokens(topicTokens, contentTokens(entry.title ?? '')),
    }))
    .sort((a, b) => {
      if (a.sameFocusKeyword !== b.sameFocusKeyword) return a.sameFocusKeyword ? -1 : 1
      if (b.titleSimilarity !== a.titleSimilarity) return b.titleSimilarity - a.titleSimilarity
      return a.entry.path.localeCompare(b.entry.path)
    })
    .slice(0, limit)
    .map(scored => scored.entry)
}

// ─── Construction des entrees ───────────────────────────────────────────────

function entryFromSitePage(row: SitePageRow): InventoryEntry | null {
  const path = normalizeInventoryPath(row.path ?? '')
  if (!path) return null

  return {
    path,
    url: row.url ?? '',
    // Le H1 en repli du <title> : une page crawlee sans balise title garde un
    // titre affiche, et le comparateur d'identite a besoin de quelque chose a
    // comparer.
    title: row.title ?? row.h1 ?? null,
    metaDescription: row.meta_description ?? null,
    focusKeyword: row.focus_keyword ?? null,
    canonicalPath: row.canonical_path ? normalizeInventoryPath(row.canonical_path) : null,
    noindex: row.robots_noindex === true,
    body: row.content_excerpt ?? '',
    // Vrai meme pour une ligne 'engine' : le crawler plafonne son extrait et
    // recordPublication plafonne le sien. Le verdict de duplicat qui en decoule
    // AVOUE sa comparaison partielle plutot que de la taire.
    bodyIsExcerpt: true,
    origin: originOf(row),
    generationId: row.generation_id ?? undefined,
    coversTopic: true,
    observedAt: row.crawled_at ?? '',
  }
}

function entryFromGeneration(row: GenerationRow): InventoryEntry | null {
  const path = normalizeInventoryPath(row.slug)
  if (!path) return null

  return {
    path,
    // Vide tant que la page n'est pas en ligne. C'est aussi ce qui distingue,
    // plus bas, une generation publiee d'une generation qui attend : l'entree
    // ne porte pas de statut, elle porte une URL ou rien.
    url: row.published_url ?? '',
    title: row.title ?? null,
    metaDescription: row.meta_description ?? null,
    focusKeyword: row.focus_keyword ?? null,
    canonicalPath: null,
    noindex: false,
    // La colonne `content` n'est pas lue, donc pas de corps. bodyIsExcerpt reste
    // faux : ce qu'on sait ici — titre, meta, mot-cle — on le sait EXACTEMENT,
    // puisqu'on l'a ecrit. Rien n'est tronque, il manque simplement le corps.
    body: '',
    bodyIsExcerpt: false,
    origin: 'engine',
    generationId: row.id,
    pageType: row.page_type ?? undefined,
    parentGenerationId: row.parent_generation_id ?? null,
    // Une ligne 'failed' garde son SLUG dans l'inventaire et libere son SUJET.
    // Ce ne sont pas la meme question : une adresse que le site sert deja ne
    // doit jamais etre reproposee, quoi qu'il soit arrive a notre tentative ;
    // le sujet, lui, merite un second essai sous une autre URL.
    coversTopic: row.status !== 'failed',
    observedAt: row.published_at ?? row.updated_at ?? '',
  }
}

/**
 * Ce que l'entree observee emprunte a sa generation homonyme.
 *
 * Sans cet emprunt, le maillage pilier/enfant disparait au PREMIER crawl : la
 * page revient decrite par `site_pages`, qui ne porte ni page_type ni
 * parent_generation_id, et buildLinkGraph ne trouve plus aucun pilier.
 *
 * `generationId` n'est herite que d'une generation reellement mise en ligne.
 * L'heriter d'une homonyme 'failed' donnerait au maillage un pilier dont
 * l'identifiant designe une page qui n'a jamais existe.
 */
function inheritLineage(observed: InventoryEntry, declared: InventoryEntry): InventoryEntry {
  return {
    ...observed,
    generationId: observed.generationId ?? (declared.url ? declared.generationId : undefined),
    pageType: observed.pageType ?? declared.pageType,
    parentGenerationId: observed.parentGenerationId ?? declared.parentGenerationId,
  }
}

/**
 * Une page qu'un visiteur peut atteindre aujourd'hui.
 *
 * L'entree ne porte pas de statut : elle porte une URL, ou rien. Une ligne
 * `site_pages` en a toujours une — le crawler l'a visitee, ou recordPublication
 * ne l'a inscrite qu'une fois la page en ligne. Une generation n'en a une que
 * publiee.
 */
function isOnline(entry: InventoryEntry): boolean {
  return entry.url.trim() !== ''
}

/**
 * Une entree que le moteur a publiee et dont il connait la ligne generations.
 *
 * Les trois conditions comptent. Sans `generationId`, buildLinkGraph n'a pas de
 * quoi apparier un enfant a son pilier. Sans `url`, la page n'est pas en ligne
 * et la proposer au lieur fabriquerait un lien mort — exactement ce que
 * lib/pipeline/internal-links.ts existe pour empecher. Sans `coversTopic`, la
 * ligne est un echec qui retient son adresse et rien de plus.
 */
function isPublishedByEngine(
  entry: InventoryEntry,
): entry is InventoryEntry & { generationId: string } {
  return Boolean(entry.generationId) && isOnline(entry) && entry.coversTopic
}

const PAGE_TYPES: readonly string[] = [
  'pillar',
  'child',
  'alternative',
  'comparative',
  'local_pack',
]

function toPageType(value: string | undefined): PageType | undefined {
  if (!value || !PAGE_TYPES.includes(value)) return undefined
  return value as PageType
}

/**
 * L'entree rendue sous la forme que buildLinkGraph attend.
 *
 * `city` et `ai_model` sont des champs obligatoires de Generation que le graphe
 * ne lit pas : ils sont laisses VIDES plutot que devines, et le type n'est pas
 * force par un cast. Un futur lecteur voit ainsi que cette valeur ne les
 * connait pas, la ou un `as unknown as Generation` lui aurait laisse croire a
 * une ligne complete.
 */
function toGeneration(entry: InventoryEntry & { generationId: string }): Generation {
  return {
    id: entry.generationId,
    slug: entry.path.replace(/^\//, ''),
    title: entry.title ?? undefined,
    focus_keyword: entry.focusKeyword ?? undefined,
    page_type: toPageType(entry.pageType),
    parent_generation_id: entry.parentGenerationId ?? undefined,
    city: '',
    status: 'published',
    ai_model: '',
    created_at: entry.observedAt,
    updated_at: entry.observedAt,
  }
}

// ─── Fraicheur ──────────────────────────────────────────────────────────────

/**
 * Le repli de `campaigns.last_crawl_at` : la derniere visite REELLE du crawler.
 *
 * Seules les lignes d'origine 'crawl' comptent. Une ligne 'engine' porte dans
 * `crawled_at` sa date de PUBLICATION, pas une date de visite : la retenir
 * ferait passer pour « analyse hier » un site que personne n'a jamais crawle,
 * ce qui est exactement le mensonge que la fraicheur existe pour empecher.
 */
function latestCrawlOf(pages: readonly SitePageRow[]): string | null {
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY

  for (const row of pages) {
    if (originOf(row) !== 'crawl' || !row.crawled_at) continue
    const ms = Date.parse(row.crawled_at)
    if (Number.isNaN(ms) || ms <= latestMs) continue
    latestMs = ms
    latest = row.crawled_at
  }

  return latest
}

function originOf(row: SitePageRow): InventoryOrigin {
  return row.origin === 'engine' ? 'engine' : 'crawl'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
