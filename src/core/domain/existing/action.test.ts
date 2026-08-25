// ─────────────────────────────────────────────────────────────────────────────
// Editorial Action Tests
// SEO Engine - Domain
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux tests de ce fichier valent tous les autres.
//
// Le premier parcourt LES SIX REGLES avec un inventaire aveugle et exige qu'AUCUNE
// ne rende 'refresh'. Il est parametre sur les memes six scenarios que le test
// nominal, et c'est ce qui lui donne sa valeur : si un scenario cessait de
// declencher sa regle, le test nominal virerait au rouge avant que celui-ci ne
// devienne vacuement vert. Un inventaire aveugle PORTE des entrees — un crawl de
// cinquante jours est 'blind' sans etre vide — donc le garde-fou est bien
// atteint, pas contourne par une liste vide.
//
// Le second verifie qu'une page desindexee ou canonisee ailleurs n'est jamais
// designee, MEME quand Search Console la designe. Ecraser une page dont on ne
// sait pas pourquoi elle est hors index est exactement le dommage que ce module
// existe pour empecher.

import { describe, it, expect } from 'vitest'
import type { GscPlanningSignals } from '@/lib/google/performance'
import {
  CREATE_ACTION,
  WITHOUT_SEARCH_CONSOLE,
  decideEditorialAction,
  rewritesBody,
  type ActionInputs,
  type EditorialAction,
} from './action'
import type { EditorialTarget } from './identity'
import type { InventoryEntry, InventoryFreshness, SiteInventory } from './inventory'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const VILLES = ['troyes', 'sainte', 'savine', 'reims']

/** Le sujet qu'on s'apprete a ecrire. Sans `body` : la decision precede le texte. */
function target(overrides: Partial<EditorialTarget> = {}): EditorialTarget {
  return {
    path: '/taxi-troyes-reservation',
    title: 'Taxi Troyes',
    metaDescription: 'Une course en taxi depuis la gare de Troyes, reservation en ligne.',
    focusKeyword: 'taxi troyes',
    ...overrides,
  }
}

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/taxi-troyes',
    url: 'https://exemple.fr/taxi-troyes',
    title: 'Taxi Troyes',
    metaDescription: 'Taxi a Troyes, prise en charge immediate, 24h/24.',
    focusKeyword: 'taxi troyes',
    canonicalPath: null,
    noindex: false,
    body: 'Un corps de page deja en ligne.',
    bodyIsExcerpt: true,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  }
}

const FRESH: InventoryFreshness = {
  state: 'fresh',
  lastCrawledAt: '2026-08-20T00:00:00.000Z',
  ageDays: 1,
}

const STALE: InventoryFreshness = {
  state: 'stale',
  lastCrawledAt: '2026-08-01T00:00:00.000Z',
  ageDays: 21,
}

/** 'blind' AVEC des entrees : un crawl de cinquante jours n'est pas un crawl vide. */
const BLIND: InventoryFreshness = {
  state: 'blind',
  blindReason: 'crawl-trop-vieux',
  lastCrawledAt: '2026-07-02T00:00:00.000Z',
  ageDays: 51,
}

function inventory(
  entries: readonly InventoryEntry[],
  overrides: Partial<SiteInventory> = {},
): SiteInventory {
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map(item => item.path)),
    freshness: FRESH,
    crawledCount: entries.length,
    publishedCount: 0,
    truncated: false,
    ...overrides,
  }
}

function gsc(overrides: Partial<GscPlanningSignals> = {}): GscPlanningSignals {
  return {
    available: true,
    windowStart: '2026-05-24',
    windowEnd: '2026-08-21',
    strikingDistance: [],
    lowCtrPages: [],
    deadPages: [],
    cannibalized: [],
    blockedQueries: [],
    ...overrides,
  }
}

function inputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return { gsc: gsc(), inventory: inventory([]), cityTokens: VILLES, ...overrides }
}

// ─── Lecture typee du verdict ───────────────────────────────────────────────

type RefreshAction = Extract<EditorialAction, { kind: 'refresh' }>
type SkipAction = Extract<EditorialAction, { kind: 'skip' }>

function asRefresh(action: EditorialAction): RefreshAction {
  if (action.kind !== 'refresh') throw new Error(`attendu 'refresh', recu '${action.kind}'`)
  return action
}

function asSkip(action: EditorialAction): SkipAction {
  if (action.kind !== 'skip') throw new Error(`attendu 'skip', recu '${action.kind}'`)
  return action
}

// ─── Les six regles, une par une ────────────────────────────────────────────

describe('decideEditorialAction — les six regles ordonnees', () => {
  it("1. une requete du sujet en position 5-20 fait rafraichir le CORPS de la page qui la porte", () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry()]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 7.4,
              impressions: 320,
              clicks: 4,
            },
          ],
        }),
      }),
    )

    const refresh = asRefresh(action)
    expect(refresh.targetPath).toBe('/taxi-troyes')
    expect(refresh.scope).toBe('content')
    expect(refresh.evidence.join('\n')).toContain('position 7.4')
  })

  it('2. une requete cannibalisee fait rafraichir le GAGNANT et se contente de nommer les perdantes', () => {
    const losers = ['https://exemple.fr/vtc-troyes', 'https://exemple.fr/taxi-gare-troyes']

    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([
          entry(),
          entry({ path: '/vtc-troyes', url: losers[0], title: 'VTC Troyes' }),
          entry({ path: '/taxi-gare-troyes', url: losers[1], title: 'Taxi gare de Troyes' }),
        ]),
        gsc: gsc({
          cannibalized: [
            {
              query: 'taxi troyes',
              impressions: 900,
              clicks: 12,
              pages: [
                { pageUrl: 'https://exemple.fr/taxi-troyes', impressions: 500, clicks: 10, position: 4.1 },
                { pageUrl: losers[0], impressions: 250, clicks: 2, position: 9.3 },
                { pageUrl: losers[1], impressions: 150, clicks: 0, position: 14.8 },
              ],
              winner: 'https://exemple.fr/taxi-troyes',
              losers,
            },
          ],
        }),
      }),
    )

    const refresh = asRefresh(action)
    expect(refresh.targetPath).toBe('/taxi-troyes')

    // Les perdantes sont RAPPORTEES, et rien de plus : le verdict ne porte
    // qu'une seule cible, et ce n'est aucune d'elles.
    const evidence = refresh.evidence.join('\n')
    expect(evidence).toContain(losers[0])
    expect(evidence).toContain(losers[1])
    expect(evidence).toContain('INTACTES')
    expect(['/vtc-troyes', '/taxi-gare-troyes']).not.toContain(refresh.targetPath)
  })

  it("3. une page vue et pas cliquee sur le sujet ne fait reecrire QUE ses metadonnees", () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry()]),
        gsc: gsc({
          lowCtrPages: [
            {
              pageUrl: 'https://exemple.fr/taxi-troyes',
              impressions: 1400,
              clicks: 6,
              ctr: 0.0043,
              position: 6.2,
              topQuery: 'taxi troyes',
            },
          ],
        }),
      }),
    )

    const refresh = asRefresh(action)
    expect(refresh.scope).toBe('metadata')
    expect(rewritesBody(refresh)).toBe(false)
    expect(refresh.evidence.join('\n')).toContain('corps')
  })

  it("4. sans aucune mesure, un titre trop proche suffit a preferer la mise a jour a l'ajout", () => {
    const voisine = entry({
      path: '/taxi-sainte-savine',
      url: 'https://exemple.fr/taxi-sainte-savine',
      title: 'Taxi Sainte-Savine',
      metaDescription: 'Transport medical assis, conventionne CPAM, sur rendez-vous.',
      focusKeyword: 'taxi sainte savine',
      generationId: 'gen-42',
      origin: 'engine',
    })

    const action = decideEditorialAction(
      target(),
      inputs({ inventory: inventory([voisine]) }),
    )

    const refresh = asRefresh(action)
    expect(refresh.targetPath).toBe('/taxi-sainte-savine')
    expect(refresh.scope).toBe('content')
    // La generation qui a produit la page voyage avec la cible : sans elle, le
    // panneau de confirmation ne saurait pas quelle ligne mettre a jour.
    expect(refresh.targetGenerationId).toBe('gen-42')
    // L'asymetrie de la comparaison est AVOUEE : le corps a ecrire n'existe pas
    // encore, celui de la page en ligne n'est qu'un extrait.
    expect(refresh.evidence.join('\n')).toContain('Comparaison partielle')
  })

  it("5. un mot-cle deja gagne ou deja cannibalise fait renoncer, avec des raisons lisibles", () => {
    const action = decideEditorialAction(
      target(),
      // Ecrit avec accents et majuscules : les deux cotes passent par
      // normalizeForMatch, sinon « Taxi Troyes » ne retrouverait pas son sujet.
      inputs({ gsc: gsc({ blockedQueries: ['Taxi Troyes', 'plomberie à Reims'] }) }),
    )

    const skip = asSkip(action)
    expect(skip.reasons.length).toBeGreaterThan(0)
    expect(skip.reasons[0]).toContain('taxi troyes')
    expect(skip.reasons[0]).toContain('Search Console')
    // Des phrases, pas des codes : ces lignes sont montrees telles quelles.
    for (const reason of skip.reasons) {
      expect(reason.length).toBeGreaterThan(30)
      expect(reason).toMatch(/[.!]$/)
    }
  })

  it('6. sans signal ni ressemblance, on ecrit une page de plus', () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([
          entry({
            path: '/mentions-legales',
            url: 'https://exemple.fr/mentions-legales',
            title: 'Mentions legales',
            metaDescription: 'Editeur du site, hebergeur et responsable de publication.',
            focusKeyword: 'mentions legales',
          }),
        ]),
      }),
    )

    expect(action).toEqual(CREATE_ACTION)
  })
})

// ─── L'ordre EST la politique ───────────────────────────────────────────────

describe("decideEditorialAction — l'ordre des regles", () => {
  it('une mesure Search Console bat une ressemblance de titre', () => {
    // La ressemblance designerait /taxi-sainte-savine ; la position mesuree
    // designe /taxi-troyes. C'est la mesure qui gagne.
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([
          entry({
            path: '/taxi-sainte-savine',
            url: 'https://exemple.fr/taxi-sainte-savine',
            title: 'Taxi Sainte-Savine',
            focusKeyword: 'taxi sainte savine',
          }),
          entry({ title: 'Reserver une course', focusKeyword: 'course taxi' }),
        ]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 8.1,
              impressions: 210,
              clicks: 1,
            },
          ],
        }),
      }),
    )

    expect(asRefresh(action).targetPath).toBe('/taxi-troyes')
  })

  it("une opportunite portant sur un AUTRE sujet ne designe aucune cible", () => {
    // Sans le test de sujet, la premiere opportunite du site ferait rafraichir
    // une page sans rapport avec ce qu'on allait ecrire.
    const action = decideEditorialAction(
      target({ focusKeyword: 'demenagement troyes', title: 'Demenageur a Troyes' }),
      inputs({
        inventory: inventory([entry({ title: 'Reserver une course', focusKeyword: 'course taxi' })]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 7,
              impressions: 400,
              clicks: 3,
            },
          ],
        }),
      }),
    )

    expect(action.kind).toBe('create')
  })

  it("une meta description en doublon ne fait reecrire que la meta, pas le corps qui ranke", () => {
    const promesse =
      'Reservez un taxi a %VILLE% en quelques secondes, 24h/24, transport conventionne et prise en charge immediate.'

    const action = decideEditorialAction(
      target({
        path: '/reservation-taxi-troyes',
        title: 'Reservation de taxi a Troyes',
        metaDescription: promesse.replace('%VILLE%', 'Troyes'),
        focusKeyword: 'reservation taxi troyes',
      }),
      inputs({
        inventory: inventory([
          entry({
            path: '/vtc-reims',
            url: 'https://exemple.fr/vtc-reims',
            title: 'Chauffeur VTC Reims',
            metaDescription: promesse.replace('%VILLE%', 'Reims'),
            focusKeyword: 'vtc reims',
          }),
        ]),
      }),
    )

    const refresh = asRefresh(action)
    expect(refresh.targetPath).toBe('/vtc-reims')
    expect(refresh.scope).toBe('metadata')
    expect(rewritesBody(refresh)).toBe(false)
  })
})

// ─── Les six scenarios, rejoues sur chaque regime de fraicheur ──────────────

interface Scenario {
  rule: string
  expected: EditorialAction['kind']
  build: () => ActionInputs
}

const PAGE_EN_LIGNE = entry()

const SCENARIOS: Scenario[] = [
  {
    rule: '1 — position 5-20',
    expected: 'refresh',
    build: () =>
      inputs({
        inventory: inventory([PAGE_EN_LIGNE]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 7.4,
              impressions: 320,
              clicks: 4,
            },
          ],
        }),
      }),
  },
  {
    rule: '2 — requete cannibalisee',
    expected: 'refresh',
    build: () =>
      inputs({
        inventory: inventory([PAGE_EN_LIGNE]),
        gsc: gsc({
          cannibalized: [
            {
              query: 'taxi troyes',
              impressions: 900,
              clicks: 12,
              pages: [
                { pageUrl: 'https://exemple.fr/taxi-troyes', impressions: 500, clicks: 10, position: 4.1 },
                { pageUrl: 'https://exemple.fr/vtc-troyes', impressions: 400, clicks: 2, position: 9.3 },
              ],
              winner: 'https://exemple.fr/taxi-troyes',
              losers: ['https://exemple.fr/vtc-troyes'],
            },
          ],
        }),
      }),
  },
  {
    rule: '3 — vue et pas cliquee',
    expected: 'refresh',
    build: () =>
      inputs({
        inventory: inventory([PAGE_EN_LIGNE]),
        gsc: gsc({
          lowCtrPages: [
            {
              pageUrl: 'https://exemple.fr/taxi-troyes',
              impressions: 1400,
              clicks: 6,
              ctr: 0.0043,
              position: 6.2,
              topQuery: 'taxi troyes',
            },
          ],
        }),
      }),
  },
  {
    rule: '4 — identite editoriale',
    expected: 'refresh',
    build: () =>
      inputs({
        inventory: inventory([
          entry({
            path: '/taxi-sainte-savine',
            url: 'https://exemple.fr/taxi-sainte-savine',
            title: 'Taxi Sainte-Savine',
            metaDescription: 'Transport medical assis, conventionne CPAM, sur rendez-vous.',
            focusKeyword: 'taxi sainte savine',
          }),
        ]),
      }),
  },
  {
    rule: '5 — requete deja gagnee',
    expected: 'skip',
    build: () => inputs({ gsc: gsc({ blockedQueries: ['taxi troyes'] }) }),
  },
  {
    rule: "6 — rien ne s'y oppose",
    expected: 'create',
    build: () => inputs({ inventory: inventory([]) }),
  },
]

describe('decideEditorialAction — chaque regle declenche bien', () => {
  for (const scenario of SCENARIOS) {
    it(`regle ${scenario.rule} rend '${scenario.expected}' sur un inventaire frais`, () => {
      expect(decideEditorialAction(target(), scenario.build()).kind).toBe(scenario.expected)
    })
  }
})

describe("decideEditorialAction — un inventaire aveugle ne rafraichit JAMAIS", () => {
  for (const scenario of SCENARIOS) {
    it(`regle ${scenario.rule} : aucune preuve ne justifie d'ecraser une page qu'on ne voit pas`, () => {
      const base = scenario.build()
      const aveugle: ActionInputs = {
        ...base,
        inventory: { ...base.inventory, freshness: BLIND },
      }

      const action = decideEditorialAction(target(), aveugle)

      expect(action.kind).not.toBe('refresh')
      expect(['create', 'skip']).toContain(action.kind)
    })
  }
})

describe("decideEditorialAction — un inventaire vieux n'accepte que les mesures", () => {
  it('une position mesuree la semaine derniere autorise encore le rafraichissement', () => {
    const base = SCENARIOS[0].build()
    const action = decideEditorialAction(target(), {
      ...base,
      inventory: { ...base.inventory, freshness: STALE },
    })

    const refresh = asRefresh(action)
    expect(refresh.targetPath).toBe('/taxi-troyes')
    // La degradation est nommee dans la preuve, avec son age.
    expect(refresh.evidence.join('\n')).toContain('21 jour(s)')
  })

  it('une simple ressemblance de titre, elle, ne suffit plus', () => {
    const base = SCENARIOS[3].build()
    const action = decideEditorialAction(target(), {
      ...base,
      inventory: { ...base.inventory, freshness: STALE },
    })

    expect(action.kind).toBe('create')
  })
})

// ─── L'absence de Search Console ────────────────────────────────────────────

describe('decideEditorialAction — sans Search Console', () => {
  it("tranche sur la seule identite editoriale, et le DIT dans la preuve", () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([
          entry({
            path: '/taxi-sainte-savine',
            url: 'https://exemple.fr/taxi-sainte-savine',
            title: 'Taxi Sainte-Savine',
            metaDescription: 'Transport medical assis, conventionne CPAM, sur rendez-vous.',
            focusKeyword: 'taxi sainte savine',
          }),
        ]),
        gsc: gsc({
          available: false,
          // Des signaux presents mais NON MESURES : une donnee absente n'est pas
          // une donnee a zero, et une donnee non fiable ne vaut pas un verdict.
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 6,
              impressions: 900,
              clicks: 9,
            },
          ],
        }),
      }),
    )

    const refresh = asRefresh(action)
    // Les regles 1 a 3 n'ont PAS ete evaluees : la cible vient de l'identite.
    expect(refresh.targetPath).toBe('/taxi-sainte-savine')
    expect(refresh.evidence.join('\n')).toContain(WITHOUT_SEARCH_CONSOLE)
  })

  it("ne fait pas passer une absence de mesure pour une absence de cannibalisation", () => {
    const action = decideEditorialAction(target(), inputs({ gsc: gsc({ available: false }) }))

    // Rien a rafraichir, rien a interdire : le moteur continue de produire. Une
    // source externe manquante n'arrete jamais le moteur.
    expect(action.kind).toBe('create')
  })
})

// ─── Ce qu'on ne rafraichit pas ─────────────────────────────────────────────

describe('decideEditorialAction — les pages qui ne sont pas des cibles', () => {
  it("ne vise ni une page desindexee ni une page canonisee ailleurs, MEME designee par Search Console", () => {
    const desindexee = entry({ path: '/taxi-troyes', noindex: true })
    const canonisee = entry({
      path: '/taxi-troyes-2',
      url: 'https://exemple.fr/taxi-troyes-2',
      canonicalPath: '/taxi-troyes',
    })

    const signals = gsc({
      strikingDistance: [
        {
          query: 'taxi troyes',
          pageUrl: 'https://exemple.fr/taxi-troyes',
          position: 7,
          impressions: 500,
          clicks: 5,
        },
        {
          query: 'taxi troyes',
          pageUrl: 'https://exemple.fr/taxi-troyes-2',
          position: 9,
          impressions: 200,
          clicks: 1,
        },
      ],
    })

    const action = decideEditorialAction(
      target(),
      inputs({ inventory: inventory([desindexee, canonisee]), gsc: signals }),
    )

    // Ni par la mesure, ni par la ressemblance : les deux regles lisent le meme
    // index de cibles, filtre a un seul endroit.
    expect(action.kind).toBe('create')
  })

  it('une page canonique sur elle-meme reste une cible legitime', () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry({ canonicalPath: '/taxi-troyes/' })]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/taxi-troyes',
              position: 7,
              impressions: 500,
              clicks: 5,
            },
          ],
        }),
      }),
    )

    expect(asRefresh(action).targetPath).toBe('/taxi-troyes')
  })
})

// ─── Details qui ont deja casse ailleurs ────────────────────────────────────

describe('decideEditorialAction — resolution des adresses et determinisme', () => {
  it('resout une URL Search Console absolue comme un chemin relatif, parametres compris', () => {
    const absolue = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry()]),
        gsc: gsc({
          strikingDistance: [
            {
              query: 'taxi troyes',
              pageUrl: 'https://exemple.fr/Taxi-Troyes/?utm_source=gsc',
              position: 7,
              impressions: 100,
              clicks: 1,
            },
          ],
        }),
      }),
    )

    const relative = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry()]),
        gsc: gsc({
          strikingDistance: [
            { query: 'taxi troyes', pageUrl: '/taxi-troyes', position: 7, impressions: 100, clicks: 1 },
          ],
        }),
      }),
    )

    expect(asRefresh(absolue).targetPath).toBe('/taxi-troyes')
    expect(asRefresh(relative).targetPath).toBe('/taxi-troyes')
  })

  it("designe la meme page quel que soit l'ordre de l'inventaire", () => {
    const collision = entry({
      path: '/taxi-troyes-reservation',
      url: 'https://exemple.fr/taxi-troyes-reservation',
      title: 'Reserver un taxi a Troyes',
      focusKeyword: 'reserver taxi troyes',
    })
    const ressemblance = entry({
      path: '/taxi-sainte-savine',
      url: 'https://exemple.fr/taxi-sainte-savine',
      title: 'Taxi Sainte-Savine',
      focusKeyword: 'taxi sainte savine',
    })

    const premier = decideEditorialAction(
      target(),
      inputs({ inventory: inventory([collision, ressemblance]) }),
    )
    const second = decideEditorialAction(
      target(),
      inputs({ inventory: inventory([ressemblance, collision]) }),
    )

    // La collision d'adresse est un FAIT ; la ressemblance de titre une mesure.
    expect(asRefresh(premier).targetPath).toBe('/taxi-troyes-reservation')
    expect(asRefresh(second).targetPath).toBe('/taxi-troyes-reservation')
  })

  it('un inventaire tronque le dit dans la preuve', () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory(
          [
            entry({
              path: '/taxi-sainte-savine',
              url: 'https://exemple.fr/taxi-sainte-savine',
              title: 'Taxi Sainte-Savine',
              metaDescription: 'Transport medical assis, conventionne CPAM, sur rendez-vous.',
              focusKeyword: 'taxi sainte savine',
            }),
          ],
          { truncated: true },
        ),
      }),
    )

    expect(asRefresh(action).evidence.join('\n')).toContain('Inventaire tronque')
  })

  it("n'invente pas de generation pour une page du proprietaire", () => {
    const action = decideEditorialAction(
      target(),
      inputs({
        inventory: inventory([entry()]),
        gsc: gsc({
          strikingDistance: [
            { query: 'taxi troyes', pageUrl: '/taxi-troyes', position: 7, impressions: 100, clicks: 1 },
          ],
        }),
      }),
    )

    expect(asRefresh(action).targetGenerationId).toBeUndefined()
    expect(Object.hasOwn(asRefresh(action), 'targetGenerationId')).toBe(false)
  })
})

// ─── Ce que la decision autorise a depenser ─────────────────────────────────

describe('rewritesBody', () => {
  it('un ajout et un rafraichissement de contenu font ecrire un corps, pas les deux autres', () => {
    expect(rewritesBody(CREATE_ACTION)).toBe(true)
    expect(
      rewritesBody({ kind: 'refresh', targetPath: '/x', scope: 'content', evidence: [] }),
    ).toBe(true)
    expect(
      rewritesBody({ kind: 'refresh', targetPath: '/x', scope: 'metadata', evidence: [] }),
    ).toBe(false)
    expect(rewritesBody({ kind: 'skip', reasons: ['deja couvert.'] })).toBe(false)
  })
})
