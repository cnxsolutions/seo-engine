// ─────────────────────────────────────────────────────────────────────────────
// Projection de l'inventaire — ce qui sort, et surtout ce qui ne sort pas
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux invariants de cette projection ne se voient pas a la lecture du code et
// se casseraient en silence :
//
//  1. Le CORPS des pages ne quitte jamais la base. `InventoryEntry.body` porte
//     l'extrait qui sert au comparateur de duplicats ; le rendre dans une
//     reponse HTTP transformerait une liste de cinquante lignes en plusieurs
//     megaoctets, pour un ecran qui n'en affiche pas un caractere. Le test lit
//     les CLES du DTO plutot que d'inspecter une valeur : c'est la seule
//     formulation qui echoue le jour ou quelqu'un ajoute le champ.
//
//  2. « Aucun crawl, donc rien a compter » et « le crawl a tourne et n'a
//     rapporte aucune page » sont deux faits differents. Le second vaut 0. Le
//     premier vaut INCONNU, et l'afficher comme un zero est exactement la
//     maniere dont un tableau de bord commence a mentir.

import { describe, expect, it } from 'vitest'
import type { InventoryEntry, InventoryFreshness, SiteInventory } from '@/src/core/domain/existing/inventory'
import { INVENTORY_PAGE_SIZE, projectInventory } from './project'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function entry(path: string, over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path,
    url: `https://exemple.fr${path}`,
    title: `Titre ${path}`,
    metaDescription: 'Une description existante.',
    focusKeyword: 'taxi troyes',
    canonicalPath: null,
    noindex: false,
    // Volontairement non vide : c'est precisement ce qui ne doit pas ressortir.
    body: 'Le corps complet de la page, plusieurs milliers de caracteres.',
    bodyIsExcerpt: true,
    origin: 'crawl',
    // Une page vue au crawl couvre bien son sujet. Une generation 'failed'
    // occuperait son URL sans le couvrir — d'ou deux faits et non un seul.
    coversTopic: true,
    observedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function freshness(over: Partial<InventoryFreshness> = {}): InventoryFreshness {
  return { state: 'fresh', lastCrawledAt: '2026-08-01T00:00:00.000Z', ageDays: 3, ...over }
}

function inventory(over: Partial<SiteInventory> = {}): SiteInventory {
  const entries = over.entries ?? [entry('/taxi-troyes'), entry('/taxi-sainte-savine')]
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map((e) => e.path)),
    freshness: freshness(),
    crawledCount: entries.length,
    publishedCount: 0,
    truncated: false,
    ...over,
  }
}

// ─── Ce qui ne sort pas ──────────────────────────────────────────────────────

describe('projectInventory — la frontiere de la reponse', () => {
  it('ne fait jamais sortir le corps des pages', () => {
    const result = projectInventory(inventory(), { page: 1, pageSize: 50 })

    expect(result.entries).toHaveLength(2)
    for (const dto of result.entries) {
      // Sur les cles, pas sur la valeur : `body: undefined` passerait un
      // toBeUndefined() tout en serialisant le champ.
      expect(Object.keys(dto)).not.toContain('body')
    }
  })

  it('annonce que la comparaison ne portera que sur un extrait', () => {
    // L'ecran doit pouvoir dire qu'un score de similarite bas ne prouve rien
    // quand seul un extrait de la page est connu.
    const result = projectInventory(inventory(), { page: 1, pageSize: 50 })

    expect(result.entries[0].bodyIsExcerpt).toBe(true)
  })
})

// ─── Inconnu contre zero ─────────────────────────────────────────────────────

describe('projectInventory — ce que le moteur ne sait pas', () => {
  it('rend un compteur INCONNU quand le site n a jamais ete analyse', () => {
    const result = projectInventory(
      inventory({
        entries: [],
        takenPaths: new Set(),
        crawledCount: 0,
        freshness: freshness({ state: 'blind', blindReason: 'jamais-analyse', lastCrawledAt: null, ageDays: null }),
      }),
      { page: 1, pageSize: 50 },
    )

    expect(result.summary.crawledCount).toBeNull()
    expect(result.summary.blindReason).toBe('jamais-analyse')
  })

  it('rend un vrai ZERO quand le crawl a tourne sans rien trouver', () => {
    const result = projectInventory(
      inventory({
        entries: [],
        takenPaths: new Set(),
        crawledCount: 0,
        freshness: freshness({ state: 'blind', blindReason: 'aucune-page-trouvee' }),
      }),
      { page: 1, pageSize: 50 },
    )

    // Zero, pas null : le crawl a bien mesure, et sa mesure vaut zero.
    expect(result.summary.crawledCount).toBe(0)
  })

  it('compte les pages publiees meme sur un site jamais crawle', () => {
    // publishedCount se lit sur `generations`, que la lecture rapporte toujours.
    const result = projectInventory(
      inventory({
        entries: [],
        takenPaths: new Set(),
        crawledCount: 0,
        publishedCount: 4,
        freshness: freshness({ state: 'blind', blindReason: 'jamais-analyse', lastCrawledAt: null, ageDays: null }),
      }),
      { page: 1, pageSize: 50 },
    )

    expect(result.summary.crawledCount).toBeNull()
    expect(result.summary.publishedCount).toBe(4)
  })

  it('remonte un inventaire tronque, qui durcira les seuils en aval', () => {
    const result = projectInventory(inventory({ truncated: true }), { page: 1, pageSize: 50 })

    expect(result.summary.truncated).toBe(true)
  })
})

// ─── Pagination et filtre ────────────────────────────────────────────────────

describe('projectInventory — pagination', () => {
  it('rend la taille de page REELLEMENT appliquee, bornes comprises', () => {
    // Une interface qui construit ses liens a partir de ce qu'elle a DEMANDE,
    // et non de ce qui a ete servi, saute des lignes des la premiere valeur
    // hors bornes.
    const trop = projectInventory(inventory(), { page: 1, pageSize: 100000 })
    const trop_peu = projectInventory(inventory(), { page: 1, pageSize: 1 })
    const illisible = projectInventory(inventory(), { page: 1, pageSize: Number.NaN })

    expect(trop.pageSize).toBe(100)
    expect(trop_peu.pageSize).toBe(10)
    expect(illisible.pageSize).toBe(INVENTORY_PAGE_SIZE)
  })

  it('fait porter le total sur le filtre, pas sur la page rendue', () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`/page-${i}`))
    const result = projectInventory(inventory({ entries, crawledCount: 30 }), { page: 1, pageSize: 10 })

    expect(result.entries).toHaveLength(10)
    // C'est ce total qui dit a l'ecran qu'une page suivante existe.
    expect(result.total).toBe(30)
  })

  it('ne modifie pas l inventaire que l appelant lui a passe', () => {
    const source = inventory({ entries: [entry('/b'), entry('/a')] })
    const avant = source.entries.map((e) => e.path)

    projectInventory(source, { page: 1, pageSize: 50 })

    expect(source.entries.map((e) => e.path)).toEqual(avant)
  })
})

describe('projectInventory — mode paths', () => {
  it('ne rend aucune entree, seulement les chemins pris et tries', () => {
    // Ce mode existe pour que la validation de slug de /strategy/new ne fasse
    // pas une requete HTTP par caractere frappe.
    const result = projectInventory(
      inventory({ entries: [entry('/z'), entry('/a')], takenPaths: new Set(['/z', '/a']) }),
      { page: 1, pageSize: 50, fields: 'paths' },
    )

    expect(result.entries).toEqual([])
    // Trie : un Set conserve son ordre d'insertion, qui depend de l'ordre des
    // lignes rendues par PostgREST et n'est donc pas stable d'un appel a l'autre.
    expect(result.takenPaths).toEqual(['/a', '/z'])
  })
})
