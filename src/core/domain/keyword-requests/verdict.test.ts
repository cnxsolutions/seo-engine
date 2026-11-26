import { describe, expect, it } from 'vitest'
import type { GscPlanningSignals } from '@/lib/google/performance'
import type { InventoryEntry, SiteInventory } from '../existing/inventory'
import { normalizedRequest } from './normalize'
import { detectPlaces, fitVerdict, measuredVerdict, type FitOpinion, type RequestSubject, type VerdictContext } from './verdict'

const SITE = 'https://plomberie-martin.test'

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/plombier-troyes',
    url: `${SITE}/plombier-troyes`,
    title: 'Plombier à Troyes',
    metaDescription: 'Dépannage rapide.',
    focusKeyword: 'plombier troyes',
    canonicalPath: null,
    noindex: false,
    body: '',
    bodyIsExcerpt: true,
    origin: 'engine',
    coversTopic: true,
    observedAt: '2026-11-20T00:00:00Z',
    ...overrides,
  }
}

function inventory(entries: InventoryEntry[], state: 'fresh' | 'blind' = 'fresh'): SiteInventory {
  return {
    siteId: 'site',
    entries,
    takenPaths: new Set(entries.map((e) => e.path)),
    freshness: state === 'fresh'
      ? { state, lastCrawledAt: '2026-11-20T00:00:00Z', ageDays: 6 }
      : { state, blindReason: 'jamais-analyse', lastCrawledAt: null, ageDays: null },
    crawledCount: entries.length,
    publishedCount: entries.length,
    truncated: false,
  }
}

const NO_GSC: GscPlanningSignals = {
  available: false, windowStart: '', windowEnd: '', strikingDistance: [], lowCtrPages: [], deadPages: [], cannibalized: [], blockedQueries: [],
}
const GSC: GscPlanningSignals = { ...NO_GSC, available: true, windowStart: '2026-08-28', windowEnd: '2026-11-26' }

function context(overrides: Partial<VerdictContext> = {}): VerdictContext {
  return {
    zone: { national: false, communes: ['Troyes', 'Sainte-Savine'] },
    plannedBriefs: [],
    wonQueries: [],
    editorial: { gsc: GSC, inventory: inventory([]), cityTokens: ['Troyes', 'Sainte-Savine'] },
    knownPlaces: ['Troyes', 'Sainte-Savine', 'Romilly-sur-Seine', 'Rosières-près-Troyes'],
    siteUrl: SITE,
    ...overrides,
  }
}

function subject(keyword: string, city: string | null = null): RequestSubject {
  const normalized = normalizedRequest(keyword, city)
  return {
    keyword,
    city,
    normalized,
    target: { path: `/${normalized.replace(/ /g, '-')}`, title: keyword, metaDescription: '', focusKeyword: city ? `${keyword} ${city}` : keyword },
  }
}

const IN: FitOpinion = { fit: 'in', service: 'plomberie', city: null, intent: 'transactionnelle', reason: 'Service du métier.' }

describe('regle 3 — deja prevue dans la periode en cours', () => {
  const brief = { cyclePlanId: 'plan-1', planItemId: 'item-6', day: '2026-11-28', targetKeyword: "fuite d'eau", targetCity: 'Troyes', secondaryKeywords: ['recherche de fuite troyes'] }

  it('rattache la demande au brief qui la vise, avec sa date', () => {
    const verdict = measuredVerdict(subject("Fuite d'eau", 'Troyes'), context({ plannedBriefs: [brief] }))
    expect(verdict).toMatchObject({
      status: 'scheduled',
      reasonCode: 'ALREADY_PLANNED',
      plan: { cyclePlanId: 'plan-1', planItemId: 'item-6', scheduledFor: '2026-11-28' },
      evidence: [{ kind: 'planned', day: '2026-11-28', planItemId: 'item-6' }],
    })
  })

  it('un mot-cle secondaire du brief compte aussi', () => {
    expect(measuredVerdict(subject('recherche de fuite troyes'), context({ plannedBriefs: [brief] }))?.status).toBe('scheduled')
  })
})

describe('regle 4 — une recherche deja gagnee', () => {
  it('dit la position et la page, plutot qu une page de plus', () => {
    const verdict = measuredVerdict(subject('plomberie martin'), context({ wonQueries: [{ query: 'plomberie martin', pageUrl: `${SITE}/`, position: 1.2 }] }))
    expect(verdict).toMatchObject({
      status: 'covered',
      reasonCode: 'ALREADY_WON',
      evidence: [{ kind: 'position', query: 'plomberie martin', position: 1 }, { kind: 'page', url: `${SITE}/` }],
    })
  })

  it('passe avant la regle 5 : une mesure bat une ressemblance', () => {
    const verdict = measuredVerdict(
      subject('plombier', 'Troyes'),
      context({ wonQueries: [{ query: 'plombier troyes', pageUrl: `${SITE}/plombier-troyes`, position: 2.6 }], editorial: { gsc: GSC, inventory: inventory([entry()]), cityTokens: [] } }),
    )
    expect(verdict?.reasonCode).toBe('ALREADY_WON')
  })
})

describe('regle 5 — deja portee par une page du site', () => {
  it('une page en ligne qui vise cette recherche y repond, meme sur un inventaire aveugle', () => {
    const verdict = measuredVerdict(subject('Plombier', 'Troyes'), context({ editorial: { gsc: NO_GSC, inventory: inventory([entry()], 'blind'), cityTokens: [] } }))
    expect(verdict).toMatchObject({ status: 'covered', reasonCode: 'ALREADY_COVERED', evidence: [{ kind: 'page', url: `${SITE}/plombier-troyes` }] })
    // Sans Search Console, le verdict le dit.
    expect(verdict?.reasons.at(-1)).toContain('sans Search Console')
  })

  it('une page desindexee ou canonisee ailleurs ne couvre rien', () => {
    const editorial = { gsc: GSC, inventory: inventory([entry({ noindex: true }), entry({ path: '/plombier-troyes-2', canonicalPath: '/autre' })], 'blind'), cityTokens: [] }
    expect(measuredVerdict(subject('plombier troyes'), context({ editorial }))).toBeNull()
  })

  it('reprend la decision editoriale du moteur : une page en position 5-20 se renforce', () => {
    const gsc: GscPlanningSignals = {
      ...GSC,
      strikingDistance: [{ query: 'chauffe-eau sainte-savine', pageUrl: `${SITE}/remplacement-chauffe-eau`, position: 11.3, impressions: 400, clicks: 12 }],
    }
    const editorial = { gsc, inventory: inventory([entry({ path: '/remplacement-chauffe-eau', url: '', focusKeyword: 'ballon eau chaude' })]), cityTokens: ['Sainte-Savine'] }
    const verdict = measuredVerdict(subject('chauffe-eau', 'Sainte-Savine'), context({ editorial }))
    expect(verdict).toMatchObject({ status: 'covered', reasonCode: 'ALREADY_COVERED', evidence: [{ kind: 'page', url: `${SITE}/remplacement-chauffe-eau` }] })
    expect(verdict?.reasons[0]).toContain('position 11.3')
  })

  it('une recherche que plusieurs pages se disputent renvoie a la mieux placee', () => {
    const gsc: GscPlanningSignals = {
      ...GSC,
      blockedQueries: ['debouchage troyes'],
      cannibalized: [{ query: 'debouchage troyes', impressions: 90, clicks: 4, pages: [], winner: `${SITE}/debouchage`, losers: [`${SITE}/wc-bouche`] }],
    }
    const verdict = measuredVerdict(subject('débouchage', 'Troyes'), context({ editorial: { gsc, inventory: inventory([], 'blind'), cityTokens: [] } }))
    expect(verdict).toMatchObject({ status: 'covered', evidence: [{ kind: 'page', url: `${SITE}/debouchage` }] })
  })
})

describe('regle 6 — la zone de la campagne', () => {
  it('une ville hors des communes part a CNX', () => {
    expect(measuredVerdict(subject('plombier', 'Romilly-sur-Seine'), context())).toMatchObject({
      status: 'review', reasonCode: 'CITY_OUT_OF_AREA', evidence: [{ kind: 'city', city: 'Romilly-sur-Seine' }],
    })
  })

  it('une ville nommee dans le mot-cle compte comme une ville choisie', () => {
    expect(measuredVerdict(subject('plombier romilly-sur-seine'), context())?.reasonCode).toBe('CITY_OUT_OF_AREA')
  })

  it('une ville sur une campagne nationale part a CNX', () => {
    expect(measuredVerdict(subject('plombier', 'Troyes'), context({ zone: { national: true, communes: [] } }))?.reasonCode).toBe('CITY_ON_NATIONAL')
  })

  it('une ville de la campagne ne dit rien : le modele est consulte', () => {
    expect(measuredVerdict(subject('débouchage', 'Sainte-Savine'), context())).toBeNull()
    expect(measuredVerdict(subject('débouchage'), context())).toBeNull()
  })

  it('un site sans campagne part a CNX', () => {
    expect(measuredVerdict(subject('débouchage'), context({ zone: null }))?.reasonCode).toBe('NO_CAMPAIGN')
  })
})

describe('detectPlaces', () => {
  it('une commune composee est une ville, pas deux', () => {
    expect(detectPlaces('plombier rosieres pres troyes', ['Troyes', 'Rosières-près-Troyes'])).toEqual(['Rosières-près-Troyes'])
    expect(detectPlaces('plombier troyes', ['Troyes', 'Rosières-près-Troyes'])).toEqual(['Troyes'])
    expect(detectPlaces('plombier', ['Troyes'])).toEqual([])
  })
})

describe('regles 7 et 8 — l avis du modele, puis la periode suivante', () => {
  it('recevable : gardee pour la periode suivante (L3)', () => {
    expect(fitVerdict(subject('débouchage'), context(), IN)).toMatchObject({ status: 'deferred', reasonCode: 'NEXT_PERIOD' })
  })

  it('hors metier ou incertain : a CNX, jamais un refus', () => {
    expect(fitVerdict(subject('coiffeur'), context(), { ...IN, fit: 'out', reason: 'Autre métier.' })).toMatchObject({ status: 'review', reasonCode: 'OUT_OF_TRADE' })
    expect(fitVerdict(subject('rénovation'), context(), { ...IN, fit: 'unsure', reason: 'Ambigu.' })).toMatchObject({ status: 'review', reasonCode: 'UNSURE_TRADE' })
  })

  it('une ville reconnue par le modele hors de la zone part a CNX', () => {
    expect(fitVerdict(subject('plombier reims'), context(), { ...IN, city: 'Reims' })).toMatchObject({ status: 'review', reasonCode: 'CITY_OUT_OF_AREA' })
    expect(fitVerdict(subject('plombier troyes'), context(), { ...IN, city: 'troyes' })?.status).toBe('deferred')
  })

  it('sans avis du modele, CNX regarde', () => {
    expect(fitVerdict(subject('débouchage'), context(), null)).toMatchObject({ status: 'review', reasonCode: 'OPINION_UNAVAILABLE' })
  })
})
