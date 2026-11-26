import { describe, expect, it } from 'vitest'
import { pagePath, relativeChange, summarizeResults } from './results'

const raw = (values: Record<string, unknown> = {}) => ({
  last_day: '2026-11-25',
  first_day: '2026-10-01',
  days: 28,
  current: { clicks: 325, impressions: 4222 },
  previous: { clicks: 250, impressions: 4222 },
  daily: [
    { day: '2026-10-29', clicks: 10, impressions: 100 },
    { day: '2026-11-25', clicks: 12, impressions: 90 },
  ],
  pages: [{ page: 'https://plomberie-martin.test/plombier-troyes', clicks: 141 }, { page: '', clicks: 3 }],
  queries: [{ query: 'plombier troyes', clicks: 120 }, { query: null, clicks: 1 }],
  ...values,
})

describe('relativeChange', () => {
  it('rend une variation relative, jamais contre zero', () => {
    expect(relativeChange(130, 100)).toBeCloseTo(0.3)
    expect(relativeChange(80, 100)).toBeCloseTo(-0.2)
    expect(relativeChange(10, 0)).toBeNull()
  })
})

describe('summarizeResults', () => {
  it('rend la fenetre, les totaux, la variation et les classements', () => {
    const results = summarizeResults(raw())
    expect(results).toMatchObject({ fromDay: '2026-10-29', toDay: '2026-11-25', days: 28, current: { clicks: 325, impressions: 4222 } })
    expect(results?.change.clicks).toBeCloseTo(0.3)
    expect(results?.change.impressions).toBe(0)
    expect(results?.pages).toEqual([{ url: 'https://plomberie-martin.test/plombier-troyes', clicks: 141 }])
    expect(results?.queries).toEqual([{ query: 'plombier troyes', clicks: 120 }])
  })

  it('remplit chaque jour de la courbe : un jour sans ligne est un jour sans visite', () => {
    const daily = summarizeResults(raw())?.daily ?? []
    expect(daily).toHaveLength(28)
    expect(daily[0]).toEqual({ day: '2026-10-29', clicks: 10, impressions: 100 })
    expect(daily[1]).toEqual({ day: '2026-10-30', clicks: 0, impressions: 0 })
    expect(daily.at(-1)?.day).toBe('2026-11-25')
  })

  it('ne compare pas quand l historique ne couvre pas la fenetre d avant', () => {
    const results = summarizeResults(raw({ first_day: '2026-10-15' }))
    expect(results?.change).toEqual({ clicks: null, impressions: null })
  })

  it('ne montre rien sans donnees, plutot que des zeros', () => {
    expect(summarizeResults({ last_day: null })).toBeNull()
    expect(summarizeResults(null)).toBeNull()
  })
})

describe('pagePath', () => {
  it('donne le chemin lisible, et null pour la page d accueil', () => {
    expect(pagePath('https://plomberie-martin.test/plombier-troyes/')).toBe('/plombier-troyes')
    expect(pagePath('https://plomberie-martin.test/')).toBeNull()
    expect(pagePath('https://x.test/d%C3%A9pannage')).toBe('/dépannage')
  })
})
