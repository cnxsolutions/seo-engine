import { describe, expect, it } from 'vitest'
import { deriveHubSteps, type HubFacts } from './steps'

/** Un site complet : tout relié, un cycle en cours, un créneau à venir, des données. */
function facts(overrides: Partial<HubFacts> = {}): HubFacts {
  return {
    siteType: 'nextjs',
    described: true,
    google: { connected: true, hasProperty: true },
    campaigns: 1,
    cycle: { number: 3, status: 'executing' },
    nextSlotDate: '2026-10-21',
    awaitingReview: 0,
    publishedThisMonth: 2,
    failedLast7Days: 0,
    gsc: { rows: 120, lastSyncAt: '2026-10-16T04:00:00.000Z' },
    ...overrides,
  }
}

describe('deriveHubSteps', () => {
  it('rend cinq étapes, dans l’ordre fixe du parcours, chacune avec une phrase', () => {
    const steps = deriveHubSteps(facts())
    expect(steps.map((step) => step.id)).toEqual(['connexion', 'strategie', 'calendrier', 'publication', 'resultats'])
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5])
    for (const step of steps) expect(step.detail.trim()).not.toBe('')
  })

  it('un site complet n’a aucune étape courante', () => {
    const steps = deriveHubSteps(facts())
    expect(steps.every((step) => step.tone === 'done')).toBe(true)
  })

  it('met en avant la PREMIÈRE étape restante, et une seule', () => {
    const steps = deriveHubSteps(facts({ campaigns: 0, cycle: null, nextSlotDate: null }))
    expect(steps.filter((step) => step.tone === 'current').map((step) => step.id)).toEqual(['strategie'])
    expect(steps.find((step) => step.id === 'calendrier')?.tone).toBe('pending')
  })

  it('Connexion : le mot dépend du connecteur', () => {
    expect(deriveHubSteps(facts({ siteType: 'nextjs', described: false }))[0].detail).toBe('Dépôt jamais analysé')
    expect(deriveHubSteps(facts({ siteType: 'wordpress', described: false }))[0].detail).toBe('Identifiants WordPress manquants')
  })

  it('Connexion : connecté sans propriété n’est pas relié', () => {
    const [connexion] = deriveHubSteps(facts({ google: { connected: true, hasProperty: false } }))
    expect(connexion.tone).toBe('current')
    expect(connexion.detail).toBe('Propriété Search Console à choisir')
  })

  it('Stratégie : un plan en brouillon reste à faire, un cycle terminé aussi', () => {
    expect(deriveHubSteps(facts({ cycle: { number: 2, status: 'draft' } }))[1].tone).toBe('current')
    expect(deriveHubSteps(facts({ cycle: { number: 2, status: 'completed' } }))[1].tone).toBe('current')
    expect(deriveHubSteps(facts({ cycle: { number: 2, status: 'confirmed' } }))[1].tone).toBe('done')
  })

  it('Publication : les pages en attente priment sur le mois publié, et portent leur nombre', () => {
    const publication = deriveHubSteps(facts({ awaitingReview: 7 }))[3]
    expect(publication.tone).toBe('attention')
    expect(publication.count).toBe(7)
    expect(publication.detail).toBe('7 pages attendent votre avis')
  })

  it('Publication : une étape en attention n’est jamais aussi l’étape courante', () => {
    const steps = deriveHubSteps(facts({ awaitingReview: 1, publishedThisMonth: 0, gsc: { rows: 0, lastSyncAt: null } }))
    expect(steps[3].tone).toBe('attention')
    expect(steps[4].tone).toBe('current')
  })

  it('Résultats : distingue « jamais synchronisé » de « synchronisé sans ligne »', () => {
    expect(deriveHubSteps(facts({ gsc: { rows: 0, lastSyncAt: null } }))[4].detail).toBe('Première synchronisation en attente')
    expect(deriveHubSteps(facts({ gsc: { rows: 0, lastSyncAt: '2026-10-16T04:00:00.000Z' } }))[4].detail)
      .toBe('Données Google en attente (2 à 3 jours)')
    expect(deriveHubSteps(facts({ gsc: { rows: null, lastSyncAt: null } }))[4].detail).toBe('Données illisibles')
  })
})
