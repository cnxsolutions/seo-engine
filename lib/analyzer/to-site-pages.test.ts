// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'un crawl a le droit d'envoyer a `upsertSitePages`
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux invariants, tous deux constates en production sur des sites reels :
//
//  1. UN SEUL payload par chemin. PostgreSQL refuse qu'un ON CONFLICT DO UPDATE
//     touche deux fois la meme ligne dans un seul ordre, et le lot ENTIER
//     echoue. Le crawler produit des doublons — il memorise les URL visitees
//     avant redirection et rapporte celles d'arrivee — donc une page d'accueil
//     atteinte avec et sans « www » ressort deux fois sous le chemin « / ».
//
//  2. Les colonnes de la migration 018 sont ecrites. Elles manquaient dans le
//     mapping de /api/analysis-runs, c'est-a-dire dans le chemin de crawl que
//     l'interface appelle : `canonical_path`, `robots_noindex` et `origin`
//     restaient vides, et l'inventaire ne pouvait plus distinguer une page
//     canonisee ailleurs d'une vraie concurrente.

import { describe, expect, it } from 'vitest'
import type { CrawledPage, CrawlResult } from './crawler'
import { toSitePagePayloads } from './to-site-pages'

function page(over: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://exemple.fr/taxi-troyes',
    path: '/taxi-troyes',
    title: 'Taxi Troyes',
    metaDescription: 'Une description.',
    h1: 'Taxi Troyes',
    h2s: ['Tarifs'],
    wordCount: 800,
    keywords: ['taxi troyes', 'reservation'],
    internalLinks: [],
    externalLinks: [],
    hasSchema: false,
    schemaTypes: [],
    hasFaq: false,
    hasLocalBusiness: false,
    geoSignals: [],
    textExcerpt: 'Le texte de la page.',
    canonicalPath: '/taxi-troyes',
    robotsNoindex: false,
    ...over,
  } as CrawledPage
}

function crawl(pages: CrawledPage[]): CrawlResult {
  return {
    siteUrl: 'https://exemple.fr',
    pages,
    sitemap: [],
    totalPages: pages.length,
    crawledAt: '2026-08-24T10:00:00.000Z',
    truncated: false,
  } as CrawlResult
}

describe('toSitePagePayloads — ce que l upsert exige', () => {
  it('ne rend jamais deux payloads pour le meme chemin', () => {
    // Le cas reel : l accueil atteint avec et sans « www ».
    const payloads = toSitePagePayloads(
      'site-1',
      crawl([
        page({ url: 'https://www.exemple.fr/', path: '/', title: 'Accueil' }),
        page({ url: 'https://www.exemple.fr/', path: '/', title: 'Accueil' }),
        page({ url: 'https://exemple.fr/tarifs', path: '/tarifs' }),
      ])
    )

    expect(payloads).toHaveLength(2)
    expect(new Set(payloads.map((p) => p.path)).size).toBe(2)
  })

  it('garde la DERNIERE occurrence, celle qu on vient de lire', () => {
    const payloads = toSitePagePayloads(
      'site-1',
      crawl([
        page({ path: '/', title: 'Ancienne lecture' }),
        page({ path: '/', title: 'Lecture la plus recente' }),
      ])
    )

    expect(payloads).toHaveLength(1)
    expect(payloads[0].title).toBe('Lecture la plus recente')
  })

  it('preserve l ordre des chemins distincts', () => {
    const payloads = toSitePagePayloads(
      'site-1',
      crawl([page({ path: '/a' }), page({ path: '/b' }), page({ path: '/c' })])
    )

    expect(payloads.map((p) => p.path)).toEqual(['/a', '/b', '/c'])
  })
})

describe('toSitePagePayloads — les colonnes de la migration 018', () => {
  it('ecrit la canonique et la directive robots relevees au crawl', () => {
    const payloads = toSitePagePayloads(
      'site-1',
      crawl([page({ canonicalPath: '/autre-page', robotsNoindex: true })])
    )

    expect(payloads[0].canonical_path).toBe('/autre-page')
    expect(payloads[0].robots_noindex).toBe(true)
  })

  it('marque la ligne comme vue par le CRAWL, pas produite par le moteur', () => {
    // Ecrit et non omis : sans cela, une page publiee par le moteur puis revue
    // par le crawler resterait 'engine' pour toujours, donc hors du compte de
    // pages crawlees et hors du repli de fraicheur.
    const payloads = toSitePagePayloads('site-1', crawl([page()]))

    expect(payloads[0].origin).toBe('crawl')
    expect(payloads[0].crawled_at).toBe('2026-08-24T10:00:00.000Z')
  })

  it('porte le corps de la page, pas seulement ses titres', () => {
    // Sans lui, l embedding se construit sur le titre et les H2 — un sommaire.
    const payloads = toSitePagePayloads('site-1', crawl([page({ textExcerpt: 'Le corps.' })]))

    expect(payloads[0].content_excerpt).toBe('Le corps.')
  })
})
