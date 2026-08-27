// ─────────────────────────────────────────────────────────────────────────────
// Choisir un sujet que le site ne couvre pas deja
// ─────────────────────────────────────────────────────────────────────────────
//
// Le cas reel qui a motive ce module : une campagne de taxi a Troyes declare
// ["taxi troyes", "taxi aube", "taxi cpam troyes"]. Sans brief, le moteur
// retombait sur « Taxi Troyes » — le terme de la page d'accueil — et produisait
// le slug « taxi-troyes », que le gate signalait aussitot en cannibalisation.
// Deux des trois mots-cles etaient pourtant libres.

import { describe, expect, it } from 'vitest'
import type { InventoryEntry, SiteInventory } from './inventory'
import { pickLeastCoveredKeyword } from './keyword-choice'

function entry(over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/une-page',
    url: 'https://exemple.fr/une-page',
    title: null,
    metaDescription: null,
    focusKeyword: null,
    canonicalPath: null,
    noindex: false,
    body: '',
    bodyIsExcerpt: true,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-08-26T00:00:00.000Z',
    ...over,
  } as InventoryEntry
}

function inventory(entries: InventoryEntry[]): SiteInventory {
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map(e => e.path)),
    freshness: { state: 'fresh', lastCrawledAt: '2026-08-26T00:00:00.000Z', ageDays: 0 },
    crawledCount: entries.length,
    publishedCount: 0,
    truncated: false,
  } as SiteInventory
}

const KEYWORDS = ['taxi troyes', 'taxi aube', 'taxi cpam troyes']

describe('pickLeastCoveredKeyword — le cas de production', () => {
  it('ecarte le mot-cle que la page d accueil vise deja', () => {
    const choice = pickLeastCoveredKeyword(
      KEYWORDS,
      inventory([entry({ path: '/', title: 'Taxi Troyes 24/7 : reservation' })]),
      'Taxi Troyes'
    )

    expect(choice.keyword).toBe('taxi aube')
    expect(choice.origin).toBe('libre')
  })

  it('ne se laisse pas tromper par une colonne focus_keyword vide', () => {
    // Les pages ecrites a la main par le proprietaire n'ont presque jamais de
    // focus_keyword renseigne : le titre est le seul signal disponible.
    const choice = pickLeastCoveredKeyword(
      ['taxi troyes'],
      inventory([entry({ path: '/', title: 'Reserver un taxi a Troyes', focusKeyword: null })]),
      'repli'
    )

    expect(choice.origin).toBe('moins-couvert')
    expect(choice.coveredBy).toEqual(['/'])
  })
})

describe('pickLeastCoveredKeyword — ce qui couvre, et ce qui ne couvre pas', () => {
  it('reconnait une couverture par focus_keyword exact', () => {
    const choice = pickLeastCoveredKeyword(
      ['taxi aube'],
      inventory([entry({ path: '/aube', focusKeyword: 'Taxi Aube' })]),
      'repli'
    )

    expect(choice.coveredBy).toEqual(['/aube'])
  })

  it('ne compte PAS une page desindexee : elle n occupe rien dans l index', () => {
    const choice = pickLeastCoveredKeyword(
      ['taxi troyes'],
      inventory([entry({ path: '/', title: 'Taxi Troyes', noindex: true })]),
      'repli'
    )

    expect(choice.origin).toBe('libre')
    expect(choice.coveredBy).toEqual([])
  })

  it('ne compte PAS une page canonisee ailleurs', () => {
    const choice = pickLeastCoveredKeyword(
      ['taxi troyes'],
      inventory([entry({ path: '/doublon', title: 'Taxi Troyes', canonicalPath: '/' })]),
      'repli'
    )

    expect(choice.origin).toBe('libre')
  })

  it('exige TOUS les mots du sujet dans le titre, pas un seul', () => {
    // « Taxi Bar-sur-Aube » ne couvre pas « taxi cpam troyes » : sinon le
    // moindre titre contenant « taxi » fermerait tous les sujets du site.
    const choice = pickLeastCoveredKeyword(
      ['taxi cpam troyes'],
      inventory([entry({ path: '/bar-sur-aube', title: 'Taxi Bar-sur-Aube' })]),
      'repli'
    )

    expect(choice.origin).toBe('libre')
  })
})

describe('pickLeastCoveredKeyword — quand tout est pris', () => {
  it('rend le MOINS couvert plutot que rien, et le dit', () => {
    const choice = pickLeastCoveredKeyword(
      ['taxi troyes', 'taxi aube'],
      inventory([
        entry({ path: '/a', focusKeyword: 'taxi troyes' }),
        entry({ path: '/b', focusKeyword: 'taxi troyes' }),
        entry({ path: '/c', focusKeyword: 'taxi aube' }),
      ]),
      'repli'
    )

    expect(choice.keyword).toBe('taxi aube')
    expect(choice.origin).toBe('moins-couvert')
    expect(choice.coveredBy).toEqual(['/c'])
  })

  it('respecte l ordre du proprietaire a couverture egale', () => {
    // L'ordre de la liste porte sa priorite : rien ne justifie de preferer le
    // second quand les deux sont aussi couverts.
    const choice = pickLeastCoveredKeyword(
      ['taxi troyes', 'taxi aube'],
      inventory([
        entry({ path: '/a', focusKeyword: 'taxi troyes' }),
        entry({ path: '/b', focusKeyword: 'taxi aube' }),
      ]),
      'repli'
    )

    expect(choice.keyword).toBe('taxi troyes')
  })

  it('avoue le repli quand la campagne ne declare aucun mot-cle', () => {
    const choice = pickLeastCoveredKeyword([], inventory([]), 'Taxi Troyes')

    expect(choice).toEqual({ keyword: 'Taxi Troyes', origin: 'repli', coveredBy: [] })
  })

  it('ignore les entrees vides plutot que de les choisir', () => {
    const choice = pickLeastCoveredKeyword(['  ', '', 'taxi aube'], inventory([]), 'repli')

    expect(choice.keyword).toBe('taxi aube')
  })
})
