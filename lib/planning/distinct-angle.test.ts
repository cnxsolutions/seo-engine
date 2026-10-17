// ─────────────────────────────────────────────────────────────────────────────
// Angle distinct — tests
// SEO Engine - Planning
// ─────────────────────────────────────────────────────────────────────────────
//
// Decision du proprietaire, 2026-10-17 : aucune mise a jour. Un sujet deja
// couvert devient une page neuve sur un angle distinct, ou il est ecarte. Ces
// tests verrouillent les deux regles pures dont tout le reste depend :
// l'equivalence de deux mots-cles, et le motif d'ecarter une page neuve.

import { describe, it, expect } from 'vitest'
import type { GscPlanningSignals } from '@/lib/google/performance'
import type { EditorialAction } from '@/src/core/domain/existing/action'
import type { InventoryEntry, SiteInventory } from '@/src/core/domain/existing/inventory'
import {
  KEYWORD_EQUIVALENCE_THRESHOLD,
  avoidedPageOf,
  avoidPromptLine,
  cannibalizationReasons,
  factualReasons,
  keywordGuardsOf,
  keywordInContext,
  keywordsAreEquivalent,
  reusesAvoidedAddress,
  type AvoidedPage,
} from './distinct-angle'

const COMMUNES = ['Troyes', 'Sainte-Savine', 'Reims', 'Aube']

// ─── Fixtures ───────────────────────────────────────────────────────────────

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/plombier-troyes',
    url: 'https://exemple.fr/plombier-troyes',
    title: 'Plombier a Troyes',
    metaDescription: 'Plombier a Troyes, intervention rapide.',
    focusKeyword: 'plombier troyes',
    canonicalPath: null,
    noindex: false,
    body: 'Un corps de page deja en ligne.',
    bodyIsExcerpt: true,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
  }
}

function inventory(entries: readonly InventoryEntry[]): SiteInventory {
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map(item => item.path)),
    freshness: { state: 'fresh', lastCrawledAt: '2026-10-10T00:00:00.000Z', ageDays: 7 },
    crawledCount: entries.length,
    publishedCount: 0,
    truncated: false,
  }
}

function refresh(overrides: Partial<Extract<EditorialAction, { kind: 'refresh' }>> = {}) {
  return {
    kind: 'refresh' as const,
    targetPath: '/plombier-troyes',
    scope: 'content' as const,
    evidence: [
      "Meme mot-cle principal que https://exemple.fr/plombier-troyes : « plombier troyes ».",
      "Mettre a jour cette page plutot que d'en ajouter une seconde sur le meme sujet.",
    ],
    ...overrides,
  }
}

function avoided(overrides: Partial<AvoidedPage> = {}): AvoidedPage {
  return {
    path: '/plombier-troyes',
    url: 'https://exemple.fr/plombier-troyes',
    title: 'Plombier a Troyes',
    focusKeyword: 'plombier troyes',
    subject: 'plombier Troyes',
    keywords: ['plombier troyes'],
    reasons: ['Meme mot-cle principal que https://exemple.fr/plombier-troyes : « plombier troyes ».'],
    ...overrides,
  }
}

function gsc(overrides: Partial<GscPlanningSignals> = {}): GscPlanningSignals {
  return {
    available: true,
    windowStart: '2026-07-19',
    windowEnd: '2026-10-16',
    strikingDistance: [],
    lowCtrPages: [],
    deadPages: [],
    cannibalized: [],
    blockedQueries: [],
    ...overrides,
  }
}

// ─── L'equivalence ──────────────────────────────────────────────────────────

describe('keywordsAreEquivalent', () => {
  it('ignore la casse, les accents, la ponctuation et les mots vides', () => {
    expect(keywordsAreEquivalent('Plombier à Troyes', 'plombier troyes', COMMUNES)).toBe(true)
    expect(keywordsAreEquivalent('Dépannage chauffe-eau', 'depannage chauffe eau', COMMUNES)).toBe(true)
    expect(keywordsAreEquivalent('le plombier pour les urgences', 'plombier urgence', COMMUNES)).toBe(true)
  })

  it("ignore l'ordre des mots et le pluriel en « s »", () => {
    expect(keywordsAreEquivalent('troyes plombier', 'plombier troyes', COMMUNES)).toBe(true)
    expect(keywordsAreEquivalent('plombiers troyes', 'plombier troyes', COMMUNES)).toBe(true)
  })

  it('retire les noms de communes : un mot-cle sans commune couvre sa variante localisee', () => {
    expect(keywordsAreEquivalent('plombier', 'plombier troyes', COMMUNES)).toBe(true)
    expect(keywordsAreEquivalent('plombier sainte-savine', 'plombier', COMMUNES)).toBe(true)
  })

  it("deux communes differentes nommees de part et d'autre font deux pages distinctes", () => {
    // C'est l'angle « autre commune de la campagne » que le prompt propose :
    // le juger equivalent ecarterait toutes les pages de commune d'un metier.
    expect(keywordsAreEquivalent('taxi troyes', 'taxi reims', COMMUNES)).toBe(false)
    expect(keywordsAreEquivalent('plombier Sainte-Savine', 'plombier troyes', COMMUNES)).toBe(false)
  })

  it(`applique le seuil de Jaccard ${KEYWORD_EQUIVALENCE_THRESHOLD}`, () => {
    // {renovation, salle, bain, complete, prix} contre ses 4 premiers : 4/5 = 0.8.
    expect(
      keywordsAreEquivalent('renovation salle de bain complete prix', 'renovation salle de bain complete', COMMUNES)
    ).toBe(true)
    // {renovation, salle, bain} contre {renovation, salle, bain, prix} : 3/4 = 0.75.
    expect(keywordsAreEquivalent('renovation salle de bain prix', 'renovation salle de bain', COMMUNES)).toBe(false)
  })

  it('une vraie sous-intention reste un autre sujet', () => {
    expect(keywordsAreEquivalent('plombier urgence troyes', 'plombier troyes', COMMUNES)).toBe(false)
    expect(keywordsAreEquivalent('debouchage canalisation troyes', 'plombier troyes', COMMUNES)).toBe(false)
  })

  it('un mot-cle vide ne vaut rien', () => {
    expect(keywordsAreEquivalent('', 'plombier troyes', COMMUNES)).toBe(false)
    expect(keywordsAreEquivalent('plombier troyes', '   ', COMMUNES)).toBe(false)
  })
})

describe('keywordInContext', () => {
  it("ajoute la commune du creneau a un mot-cle qui n'en nomme aucune", () => {
    expect(keywordInContext('plombier', 'Troyes', COMMUNES)).toBe('plombier Troyes')
  })

  it('laisse intact un mot-cle qui nomme deja une commune, meme une autre', () => {
    expect(keywordInContext('plombier troyes urgence', 'Troyes', COMMUNES)).toBe('plombier troyes urgence')
    expect(keywordInContext('plombier reims', 'Troyes', COMMUNES)).toBe('plombier reims')
  })

  it('ne touche a rien sans commune', () => {
    expect(keywordInContext('plombier', '', COMMUNES)).toBe('plombier')
  })
})

// ─── La page a eviter ───────────────────────────────────────────────────────

describe('avoidedPageOf', () => {
  it("reprend l'URL, le titre et le mot-cle de la page dans l'inventaire", () => {
    const page = avoidedPageOf(refresh(), inventory([entry()]), 'plombier Troyes')

    expect(page.path).toBe('/plombier-troyes')
    expect(page.url).toBe('https://exemple.fr/plombier-troyes')
    expect(page.title).toBe('Plombier a Troyes')
    expect(page.focusKeyword).toBe('plombier troyes')
    expect(page.subject).toBe('plombier Troyes')
    // Le mot-cle de la page et le sujet seme sont le meme sens : un seul garde.
    expect(page.keywords).toEqual(['plombier troyes'])
  })

  it('retire de la preuve les consignes de mise a jour, garde les faits', () => {
    const page = avoidedPageOf(refresh(), inventory([entry()]), 'plombier Troyes')

    expect(page.reasons).toEqual([
      "Meme mot-cle principal que https://exemple.fr/plombier-troyes : « plombier troyes ».",
    ])
  })

  it("se rabat sur le sujet et le chemin quand l'inventaire ne connait pas la page", () => {
    const page = avoidedPageOf(refresh({ targetPath: '/Inconnue/' }), inventory([]), 'plombier Troyes')

    expect(page.path).toBe('/inconnue')
    expect(page.url).toBe('/inconnue')
    expect(page.title).toBeNull()
    expect(page.focusKeyword).toBe('plombier Troyes')
  })
})

describe('factualReasons', () => {
  it('retire les trois consignes de mise a jour connues du domaine', () => {
    expect(
      factualReasons([
        'Titre proche a 0.91 de « Plombier a Troyes ».',
        "Mettre a jour cette page plutot que d'en ajouter une seconde sur le meme sujet.",
        'Seuls le titre et la meta description sont reecrits : le corps de la page, lui, ne fait pas doublon.',
        'Portee limitee aux metadonnees : le corps, qui obtient deja ces impressions, reste intact.',
      ])
    ).toEqual(['Titre proche a 0.91 de « Plombier a Troyes ».'])
  })
})

// ─── La garde finale ────────────────────────────────────────────────────────

describe('cannibalizationReasons', () => {
  it("ecarte un creneau deja couvert dont le brief reprend le mot-cle de la page a eviter", () => {
    const reasons = cannibalizationReasons({
      keyword: 'Plombiers à Troyes',
      avoid: avoided(),
      guards: [],
      cityNames: COMMUNES,
    })

    expect(reasons?.[0]).toBe(
      "Aucun angle distinct de https://exemple.fr/plombier-troyes n'a été proposé : le créneau est écarté plutôt que de concurrencer la page existante."
    )
    // La preuve suit : le lecteur voit pourquoi le sujet etait deja couvert.
    expect(reasons).toContain('Meme mot-cle principal que https://exemple.fr/plombier-troyes : « plombier troyes ».')
  })

  it('laisse passer un creneau deja couvert qui a trouve un angle distinct', () => {
    expect(
      cannibalizationReasons({
        keyword: 'detartrage chauffe-eau Troyes',
        avoid: avoided(),
        guards: [],
        cityNames: COMMUNES,
      })
    ).toBeNull()
  })

  it("laisse passer l'angle « autre commune de la campagne »", () => {
    expect(
      cannibalizationReasons({
        keyword: 'plombier Sainte-Savine',
        avoid: avoided(),
        guards: [],
        cityNames: COMMUNES,
      })
    ).toBeNull()
  })

  it("ecarte TOUTE page neuve qui reprend un mot-cle de l'existant, meme sans page a eviter", () => {
    const reasons = cannibalizationReasons({
      keyword: 'Ramonage Troyes',
      avoid: null,
      guards: keywordGuardsOf(['ramonage troyes'], null),
      cityNames: COMMUNES,
    })

    expect(reasons).toEqual([
      '« Ramonage Troyes » reprend le mot-clé « ramonage troyes », déjà ciblé par une page du site : le créneau est écarté plutôt que de la concurrencer.',
    ])
  })

  it('ecarte une page neuve qui vise une requete deja portee en Search Console', () => {
    const guards = keywordGuardsOf(
      [],
      gsc({
        strikingDistance: [
          { query: 'fuite eau troyes', pageUrl: 'https://exemple.fr/fuite', position: 8, impressions: 300, clicks: 4 },
        ],
      })
    )

    const reasons = cannibalizationReasons({
      keyword: "fuites d'eau Troyes",
      avoid: null,
      guards,
      cityNames: COMMUNES,
    })

    expect(reasons?.[0]).toContain('« fuite eau troyes »')
    expect(reasons?.[0]).toContain('Search Console')
  })

  it('laisse passer un mot-cle neuf', () => {
    expect(
      cannibalizationReasons({
        keyword: 'adoucisseur eau Troyes',
        avoid: null,
        guards: keywordGuardsOf(['plombier troyes', 'ramonage troyes'], null),
        cityNames: COMMUNES,
      })
    ).toBeNull()
  })
})

describe('keywordGuardsOf', () => {
  it("rassemble les mots-cles du site et toutes les requetes que Search Console attribue deja a une page", () => {
    const guards = keywordGuardsOf(
      ['plombier troyes', ''],
      gsc({
        strikingDistance: [
          { query: 'fuite eau troyes', pageUrl: 'https://exemple.fr/fuite', position: 8, impressions: 300, clicks: 4 },
        ],
        cannibalized: [
          {
            query: 'chauffagiste troyes',
            impressions: 90,
            clicks: 2,
            pages: [],
            winner: 'https://exemple.fr/chauffage',
            losers: [],
          },
        ],
        blockedQueries: ['plombier troyes pas cher', 'Fuite eau Troyes'],
        lowCtrPages: [
          { pageUrl: 'https://exemple.fr/wc', impressions: 800, clicks: 2, ctr: 0.0025, position: 6, topQuery: 'wc bouche troyes' },
        ],
      })
    )

    expect(guards).toEqual([
      { keyword: 'plombier troyes', origin: 'site' },
      { keyword: 'fuite eau troyes', origin: 'search-console' },
      { keyword: 'chauffagiste troyes', origin: 'search-console' },
      { keyword: 'plombier troyes pas cher', origin: 'search-console' },
      { keyword: 'wc bouche troyes', origin: 'search-console' },
    ])
  })
})

describe('reusesAvoidedAddress', () => {
  it("reconnait l'adresse de la page a eviter sous toutes ses graphies", () => {
    expect(reusesAvoidedAddress('/Plombier-Troyes/', avoided())).toBe(true)
    expect(reusesAvoidedAddress('/detartrage-chauffe-eau-troyes', avoided())).toBe(false)
    expect(reusesAvoidedAddress('/plombier-troyes', null)).toBe(false)
  })
})

describe('avoidPromptLine', () => {
  it("nomme le creneau, la page, son mot-cle et l'adresse interdite", () => {
    expect(avoidPromptLine(3, avoided())).toBe(
      'Créneau 3 : le sujet « plombier Troyes » est déjà couvert par https://exemple.fr/plombier-troyes ' +
        '(« Plombier a Troyes », mot-clé « plombier troyes »). Propose un sujet DIFFÉRENT et complémentaire pour ' +
        'ce créneau (autre service, autre question, autre intention, autre quartier ou commune de la campagne), ' +
        'avec son propre target_keyword et son propre proposed_slug. ' +
        "N'utilise jamais l'adresse /plombier-troyes ni un mot-clé équivalent."
    )
  })

  it('reste lisible quand la page est sans titre', () => {
    expect(avoidPromptLine(1, avoided({ title: null }))).toContain(
      'déjà couvert par https://exemple.fr/plombier-troyes (mot-clé « plombier troyes »).'
    )
  })
})
