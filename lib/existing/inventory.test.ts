// ─────────────────────────────────────────────────────────────────────────────
// Inventaire de l'existant — tests
// SEO Engine - Aucun reseau, aucune base : un client Supabase simule.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier verrouille les cinq facons dont cette lecture peut mentir sans
// jamais lever d'erreur :
//
// 1. Reprendre le `select('*')` de getSiteContext, et donc rapatrier le HTML
//    complet du site a chaque tick. Le gaspillage est invisible en test comme
//    en production : il ne se voit que sur la facture et sur la latence.
// 2. Laisser la generation ecraser le crawl pour une meme page, et decrire au
//    comparateur ce qu'on a CRU publier plutot que ce que le site sert.
// 3. Perdre page_type et parent_generation_id au premier crawl, ce qui rend un
//    graphe de maillage systematiquement vide — sans erreur, sans test rouge.
// 4. Confondre « rien lu » et « rien trouve ». Les deux rendent un inventaire
//    vide, et ils appellent deux actions opposees de l'operateur.
// 5. Apparier les resultats vectoriels sur `result.id`, l'UUID de la ligne
//    d'embedding, au lieu de `metadata.documentId`. Rien ne resout, tout a
//    l'air de fonctionner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InventoryEntry, SiteInventory } from '@/src/core/domain/existing/inventory'

// ─── Doubles ─────────────────────────────────────────────────────────────────

interface TableAnswer {
  data?: unknown[]
  error?: { message: string } | null
}

interface QueryBuilder {
  select(columns: string): QueryBuilder
  eq(column: string, value: unknown): QueryBuilder
  not(column: string, operator: string, value: unknown): QueryBuilder
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): QueryBuilder
  limit(count: number): QueryBuilder
  then<T>(resolve: (answer: TableAnswer) => T): Promise<T>
}

/** Ce que chaque table repond ce test-ci. */
let tables: Record<string, TableAnswer> = {}
/** Toute projection demandee, table par table : c'est la surface qu'on surveille. */
const observedSelects: Array<{ table: string; columns: string }> = []

/**
 * Un client Supabase reduit a ce que l'inventaire lui demande : une chaine
 * d'appels qui se termine par un `await`. Le builder est lui-meme « thenable »,
 * ce qui est exactement ainsi que PostgREST se comporte.
 */
function makeClient(): QueryBuilder & { from(table: string): QueryBuilder } {
  const client = {
    from(table: string): QueryBuilder {
      const builder: QueryBuilder = {
        select(columns: string) {
          observedSelects.push({ table, columns })
          return builder
        },
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        then<T>(resolve: (answer: TableAnswer) => T) {
          return Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve)
        },
      }
      return builder
    },
  }
  return client as QueryBuilder & { from(table: string): QueryBuilder }
}

vi.mock('@/lib/supabase', () => ({
  // Le cast est celui d'un double de test : le module sous test n'utilise du
  // client que `from().select().eq()...`, et exiger la surface complete de
  // SupabaseClient obligerait a simuler l'authentification et le stockage.
  createServiceClient: () => makeClient() as unknown as SupabaseClient,
}))

interface VectorHit {
  id: string
  content: string
  score: number
  metadata: { documentId: string }
}

let vectorHits: VectorHit[] = []
let vectorFails = false
const vectorQueries: Array<Record<string, unknown>> = []

class VectorStoreDouble {
  async findSimilar(query: Record<string, unknown>): Promise<VectorHit[]> {
    vectorQueries.push(query)
    if (vectorFails) throw new Error('index vectoriel injoignable')
    return vectorHits
  }
}

vi.mock('@/src/adapters/rag/providers/SupabaseVectorStore', () => ({
  SupabaseVectorStore: VectorStoreDouble,
}))

const { deriveLinkContext, loadSiteInventory, nearestExistingEntries } = await import('./inventory')
const { buildLinkGraph } = await import('@/lib/seo/smart-linking')

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-03-01T12:00:00.000Z')
const HIER = '2026-02-28T09:00:00.000Z'

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

function pageRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    path: '/une-page',
    url: 'https://exemple.fr/une-page',
    title: null,
    meta_description: null,
    h1: null,
    focus_keyword: null,
    keywords: [],
    content_excerpt: null,
    canonical_path: null,
    robots_noindex: false,
    origin: 'crawl',
    generation_id: null,
    crawled_at: HIER,
    ...overrides,
  }
}

function generationRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'gen-0',
    slug: 'une-generation',
    title: null,
    meta_description: null,
    focus_keyword: null,
    status: 'published',
    published_url: 'https://exemple.fr/une-generation',
    published_at: HIER,
    updated_at: HIER,
    page_type: null,
    parent_generation_id: null,
    ...overrides,
  }
}

function entry(overrides: Partial<InventoryEntry> & { path: string }): InventoryEntry {
  return {
    url: `https://exemple.fr${overrides.path}`,
    title: null,
    metaDescription: null,
    focusKeyword: null,
    canonicalPath: null,
    noindex: false,
    body: '',
    bodyIsExcerpt: false,
    origin: 'engine',
    coversTopic: true,
    observedAt: HIER,
    ...overrides,
  }
}

function inventoryOf(entries: InventoryEntry[]): SiteInventory {
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map(item => item.path)),
    freshness: { state: 'fresh', lastCrawledAt: HIER, ageDays: 1 },
    crawledCount: entries.filter(item => item.origin === 'crawl').length,
    publishedCount: entries.filter(item => item.generationId && item.url).length,
    truncated: false,
  }
}

let warned: string[] = []

beforeEach(() => {
  tables = {}
  observedSelects.length = 0
  vectorHits = []
  vectorFails = false
  vectorQueries.length = 0
  warned = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── La projection ───────────────────────────────────────────────────────────

describe('loadSiteInventory — la projection', () => {
  it('ne demande jamais le contenu complet ni toutes les colonnes', async () => {
    await loadSiteInventory('site-1', { now: NOW })

    // Les quatre lectures, et pas une de plus.
    expect(observedSelects.map(read => read.table).sort()).toEqual([
      'analysis_runs',
      'campaigns',
      'generations',
      'site_pages',
    ])

    for (const read of observedSelects) {
      expect(read.columns).not.toContain('*')
      // Colonne par colonne, sans quoi `content_excerpt` — qui est legitime —
      // ferait passer l'assertion pour un echec.
      expect(read.columns.split(',')).not.toContain('content')
    }
  })

  it('selectionne page_type et parent_generation_id, sans quoi le maillage disparait', async () => {
    await loadSiteInventory('site-1', { now: NOW })

    const generations = observedSelects.find(read => read.table === 'generations')
    expect(generations?.columns.split(',')).toContain('page_type')
    expect(generations?.columns.split(',')).toContain('parent_generation_id')
  })
})

// ─── La fusion ───────────────────────────────────────────────────────────────

describe('loadSiteInventory — la fusion des deux sources', () => {
  it('laisse le crawl decrire la page, et lui fait heriter de la lignee de la generation', async () => {
    tables = {
      site_pages: {
        data: [
          pageRow({
            path: '/taxi-troyes',
            title: 'Taxi a Troyes, ce que le crawl a vu',
            content_excerpt: 'Un texte reellement servi par le site.',
            crawled_at: daysAgo(2),
          }),
        ],
      },
      generations: {
        data: [
          generationRow({
            id: 'gen-pilier',
            // Majuscules et slash de tete : la normalisation a la lecture n'est
            // pas facultative, c'est elle qui fait tomber les deux sources sur
            // la meme clef.
            slug: '/Taxi-Troyes',
            title: 'Taxi a Troyes, ce qu on a cru publier',
            page_type: 'pillar',
          }),
        ],
      },
    }

    const inventory = await loadSiteInventory('site-1', { now: NOW })

    expect(inventory.entries).toHaveLength(1)
    const [merged] = inventory.entries
    expect(merged.title).toBe('Taxi a Troyes, ce que le crawl a vu')
    expect(merged.body).toBe('Un texte reellement servi par le site.')
    expect(merged.origin).toBe('crawl')
    // Sans cet heritage, buildLinkGraph ne retrouverait plus aucun pilier des
    // le premier crawl du site.
    expect(merged.pageType).toBe('pillar')
    expect(merged.generationId).toBe('gen-pilier')
  })

  it('garde l adresse d une generation echouee et libere son sujet', async () => {
    tables = {
      generations: {
        data: [
          generationRow({
            id: 'gen-echec',
            slug: 'taxi-sainte-savine',
            status: 'failed',
            published_url: null,
            published_at: null,
          }),
        ],
      },
    }

    const inventory = await loadSiteInventory('site-1', { now: NOW })

    expect(inventory.takenPaths.has('/taxi-sainte-savine')).toBe(true)
    expect(inventory.entries[0].coversTopic).toBe(false)
    // Elle n'est pas en ligne : la proposer au lieur fabriquerait un lien mort.
    expect(inventory.publishedCount).toBe(0)
  })

  it('ne compte comme crawlees que les pages reellement visitees', async () => {
    tables = {
      site_pages: {
        data: [
          pageRow({ path: '/a', crawled_at: daysAgo(3) }),
          pageRow({ path: '/b', crawled_at: daysAgo(3) }),
          // Inscrite a la publication par recordPublication : sa `crawled_at`
          // est une date de mise en ligne, pas une date de visite.
          pageRow({ path: '/c', origin: 'engine', crawled_at: daysAgo(1) }),
        ],
      },
    }

    const inventory = await loadSiteInventory('site-1', { now: NOW })

    expect(inventory.entries).toHaveLength(3)
    expect(inventory.crawledCount).toBe(2)
    expect(inventory.freshness.lastCrawledAt).toBe(daysAgo(3))
  })

  it('s avoue tronque des que le plafond de crawl est atteint', async () => {
    tables = {
      site_pages: { data: [pageRow({ path: '/a' }), pageRow({ path: '/b' })] },
    }

    const inventory = await loadSiteInventory('site-1', { now: NOW, limit: 2 })

    expect(inventory.truncated).toBe(true)
    // L'inventaire lui-meme n'est jamais tronque : le plafond qualifie la
    // connaissance, il ne coupe pas les entrees.
    expect(inventory.entries).toHaveLength(2)
  })
})

// ─── L'absence, et la panne ──────────────────────────────────────────────────

describe('loadSiteInventory — quand il n y a rien a lire', () => {
  it('distingue un site jamais analyse d un site analyse sans resultat', async () => {
    const jamais = await loadSiteInventory('site-1', { now: NOW })
    expect(jamais.entries).toHaveLength(0)
    expect(jamais.freshness.state).toBe('blind')
    expect(jamais.freshness.blindReason).toBe('jamais-analyse')

    tables = { analysis_runs: { data: [{ id: 'run-1' }] } }
    const analyse = await loadSiteInventory('site-1', { now: NOW })
    expect(analyse.freshness.blindReason).toBe('aucune-page-trouvee')

    // Un inventaire vide LEGITIME ne s'annonce pas comme un incident.
    expect(warned).toHaveLength(0)
  })

  it('rend un inventaire aveugle et le SIGNALE quand Supabase refuse', async () => {
    tables = {
      site_pages: { error: { message: 'relation "site_pages" does not exist' } },
      analysis_runs: { data: [{ id: 'run-1' }] },
    }

    const inventory = await loadSiteInventory('site-1', { now: NOW })

    // Ne jette pas : un run entier ne s'arrete pas sur un site mal configure.
    expect(inventory.entries).toHaveLength(0)
    expect(inventory.freshness.state).toBe('blind')
    // Et ne se confond pas avec le vide legitime du test precedent : celui-ci
    // laisse une trace, et n'affirme rien sur les analyses passees, dont il ne
    // sait justement rien.
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('relation "site_pages" does not exist')
    expect(inventory.freshness.blindReason).toBe('jamais-analyse')
  })
})

// ─── Le contexte de maillage ─────────────────────────────────────────────────

describe('deriveLinkContext', () => {
  it('reconstruit le graphe pilier/enfant, et le perd sans la lignee', async () => {
    const avecLignee = inventoryOf([
      entry({
        path: '/taxi-troyes',
        title: 'Taxi conventionne a Troyes',
        generationId: 'gen-pilier',
        pageType: 'pillar',
        observedAt: daysAgo(1),
      }),
      entry({
        path: '/taxi-gare-de-troyes',
        title: 'Taxi gare de Troyes',
        generationId: 'gen-enfant',
        pageType: 'child',
        parentGenerationId: 'gen-pilier',
        observedAt: daysAgo(2),
      }),
    ])

    const graphe = buildLinkGraph(deriveLinkContext(avecLignee).publishedGenerations)
    expect(graphe).toHaveLength(1)
    expect(graphe[0].children).toHaveLength(1)
    expect(graphe[0].children[0].slug).toBe('taxi-gare-de-troyes')

    // Exactement la regression qu'une projection incomplete aurait provoquee en
    // silence : les memes pages, sans page_type ni parent_generation_id.
    const sansLignee = inventoryOf([
      entry({ path: '/taxi-troyes', title: 'Taxi conventionne a Troyes', generationId: 'gen-pilier' }),
      entry({ path: '/taxi-gare-de-troyes', title: 'Taxi gare de Troyes', generationId: 'gen-enfant' }),
    ])
    expect(buildLinkGraph(deriveLinkContext(sansLignee).publishedGenerations)).toHaveLength(0)
  })

  it('produit des destinations reelles a partir des pages de l inventaire', () => {
    const inventory = inventoryOf([
      entry({
        path: '/taxi-troyes',
        title: 'Taxi conventionne a Troyes',
        generationId: 'gen-1',
        observedAt: daysAgo(1),
      }),
      entry({
        path: '/transport-medical-assis',
        title: 'Transport medical assis',
        origin: 'crawl',
        url: 'https://exemple.fr/transport-medical-assis',
      }),
      // Ancre trop courte : le lieur transformerait un mot de trois lettres en
      // lien au milieu d'une phrase.
      entry({ path: '/vtc', title: 'VTC', origin: 'crawl' }),
    ])

    const context = deriveLinkContext(inventory)

    expect(context.candidates.map(candidate => candidate.href)).toEqual([
      '/taxi-troyes',
      '/transport-medical-assis',
    ])
    // La racine existe toujours, sans qu'aucun crawl ait a le prouver.
    expect(context.knownPaths.has('/')).toBe(true)
    expect(context.knownPaths.has('/vtc')).toBe(true)
    expect(context.counts).toEqual({ crawledPages: 2, publishedGenerations: 1 })
  })

  it('n offre jamais au lieur une page qui n est pas en ligne', () => {
    const context = deriveLinkContext(
      inventoryOf([
        entry({
          path: '/taxi-a-venir',
          title: 'Taxi a Sainte-Savine, page en attente',
          generationId: 'gen-attente',
          // Generee, pas publiee : aucune URL. Un lien vers elle serait mort.
          url: '',
        }),
      ]),
    )

    expect(context.publishedGenerations).toHaveLength(0)
    expect(context.candidates).toHaveLength(0)
    // Et surtout pas dans knownPaths : un chemin qui y figure fait GARDER par
    // le pipeline tout lien qui pointe dessus. L'adresse est reservee dans
    // l'inventaire, elle ne resout pas encore sur le site.
    expect(context.knownPaths.has('/taxi-a-venir')).toBe(false)
  })
})

// ─── Le voisinage semantique ─────────────────────────────────────────────────

describe('nearestExistingEntries', () => {
  const inventory = inventoryOf([
    entry({ path: '/taxi-troyes', title: 'Taxi conventionne a Troyes', generationId: 'gen-1' }),
    entry({ path: '/taxi-sainte-savine', title: 'Taxi a Sainte-Savine', generationId: 'gen-2' }),
  ])

  it('apparie sur metadata.documentId, jamais sur l identifiant d embedding', async () => {
    vectorHits = [
      {
        // L'UUID de la ligne vector_embeddings, que la RPC vector_search rend
        // sous le nom `id`. Il ne designe AUCUNE entree d'inventaire.
        id: '0f9c6a1e-2f5b-4f2e-9b7a-1d3c5e7a9b11',
        content: 'peu importe',
        score: 0.61,
        metadata: { documentId: 'page:/Taxi-Troyes' },
      },
    ]

    const proches = await nearestExistingEntries('site-1', 'taxi conventionne', inventory, 3)

    expect(proches.map(item => item.path)).toEqual(['/taxi-troyes'])
    // Et la preuve que l'appariement ne pouvait pas venir de `id` : aucune
    // entree ne porte cet UUID, ni comme chemin ni comme generationId.
    const uuid = vectorHits[0].id
    expect(inventory.entries.some(item => item.path === uuid || item.generationId === uuid)).toBe(
      false,
    )
  })

  it('resout aussi une clef de generation', async () => {
    vectorHits = [
      {
        id: 'ba0d9d5a-2c1f-4a6b-9a2e-6a0f3b8c1d22',
        content: 'peu importe',
        score: 0.58,
        metadata: { documentId: 'generation:gen-2' },
      },
    ]

    const proches = await nearestExistingEntries('site-1', 'sainte savine', inventory, 3)
    expect(proches.map(item => item.path)).toEqual(['/taxi-sainte-savine'])
  })

  it('ne fixe jamais contentTypeKey', async () => {
    await nearestExistingEntries('site-1', 'taxi conventionne', inventory, 3)

    expect(vectorQueries).toHaveLength(1)
    // Les pages crawlees sont indexees sous 'page' et les generations sous
    // 'post' : fixer une valeur ferait disparaitre la moitie du corpus.
    expect(vectorQueries[0].contentTypeKey).toBeUndefined()
    expect(vectorQueries[0]).toMatchObject({ content: 'taxi conventionne', siteId: 'site-1' })
  })

  it('retombe sur un tri lexical quand l index vectoriel tombe, sans jeter', async () => {
    vectorFails = true

    const proches = await nearestExistingEntries('site-1', 'taxi sainte savine', inventory, 1)

    expect(proches).toHaveLength(1)
    expect(proches[0].path).toBe('/taxi-sainte-savine')
    expect(warned).toHaveLength(1)
  })

  it('ne rend jamais une liste vide en silence quand le sujet est vide', async () => {
    const proches = await nearestExistingEntries('site-1', '   ', inventory, 2)

    // Aucun embedding n'a ete achete pour l'apprendre.
    expect(vectorQueries).toHaveLength(0)
    expect(proches).toHaveLength(2)
    // Deterministe : departage par chemin, donc rejouable a l'identique.
    expect(proches.map(item => item.path)).toEqual(['/taxi-sainte-savine', '/taxi-troyes'])
  })
})
