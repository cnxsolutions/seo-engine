// ─────────────────────────────────────────────────────────────────────────────
// Publication tracking — tests
// SEO Engine - Each published page, from the day it went live.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import type { GscRawRow } from './performance'
import { brandForms } from './query-match'
import { buildTracking, trackPage, trackingVerdictFor, type TrackedGeneration } from './tracking'

const BRANDS = brandForms({ name: 'CNX Solutions', url: 'https://cnx-solutions.fr/' })
const NOW = new Date('2026-11-08T10:00:00Z')
const LAST_DATA = '2026-11-05'

function generation(overrides: Partial<TrackedGeneration> = {}): TrackedGeneration {
  return {
    id: 'gen-1',
    title: 'Alternative à un consultant SEO à Troyes',
    focusKeyword: 'alternative à un consultant SEO à Troyes',
    pageUrl: 'https://cnx-solutions.fr/consultant-seo-troyes-2/',
    publishedAt: new Date('2026-10-30T08:01:20Z'),
    ...overrides,
  }
}

function row(overrides: Partial<GscRawRow> & Pick<GscRawRow, 'query'>): GscRawRow {
  return {
    date: '2026-11-04',
    page_url: 'https://cnx-solutions.fr/consultant-seo-troyes-2/',
    clicks: 0,
    impressions: 1,
    position: 30,
    ...overrides,
  }
}

function track(rows: GscRawRow[], overrides: Partial<TrackedGeneration> = {}) {
  return trackPage({ generation: generation(overrides), rows, lastDataDate: LAST_DATA, now: NOW, brands: BRANDS })
}

describe('trackPage', () => {
  it('counts the days of data against the last day Search Console reports, not today', () => {
    const page = track([])
    expect(page.daysLive).toBe(9)
    expect(page.dataDays).toBe(7)
  })

  it('leaves brand queries out of the position, and says so', () => {
    const page = track([
      row({ query: 'cnx solutions', impressions: 5, position: 2 }),
      row({ query: 'agence seo troyes', impressions: 22, position: 34 }),
      row({ query: 'consultant seo troyes', impressions: 8, position: 47 }),
    ])

    expect(page.impressions).toBe(35)
    expect(page.brandImpressions).toBe(5)
    expect(page.position).toBeCloseTo(37.5, 1)
    expect(page.verdict).toBe('climbing')
    expect(page.queries.map((query) => query.kind)).toEqual(['unexpected', 'related', 'brand'])
  })

  it('says which query Google picked when it is not the one the page chose', () => {
    const page = track([row({ query: 'agence seo troyes', impressions: 22, position: 34 })])
    expect(page.interpretation.insights[0]).toBe(
      'Google l’associe d’abord à « agence seo troyes » (34ᵉ position), jamais à son mot-clé visé exact « alternative à un consultant SEO à Troyes ».'
    )
  })

  it('ignores what the address did before this publication', () => {
    const page = track([row({ query: 'consultant seo troyes', date: '2026-10-01', impressions: 50, position: 4 })])
    expect(page.impressions).toBe(0)
    // Seven days of data, none of them showing the page: no longer « too early ».
    expect(page.verdict).toBe('unseen')
  })

  it('compares the last seven days of data to the seven before, once there are fourteen', () => {
    const page = track(
      [
        row({ query: 'consultant seo troyes', date: '2026-10-25', impressions: 4, position: 41 }),
        row({ query: 'consultant seo troyes', date: '2026-11-03', impressions: 12, position: 28 }),
      ],
      { publishedAt: new Date('2026-10-20T08:00:00Z') }
    )

    expect(page.previous).toEqual({ impressions: 4, clicks: 0, position: 41 })
    expect(page.recent).toEqual({ impressions: 12, clicks: 0, position: 28 })
    expect(page.interpretation.insights).toContain(
      '7 derniers jours de données : 12 impressions (contre 4 la semaine d’avant), position 28 (contre 41).'
    )
  })

  it('says « aujourd’hui » for a page published today', () => {
    const page = track([], { publishedAt: new Date('2026-11-08T08:00:00Z') })
    expect(page.dataDays).toBe(0)
    expect(page.interpretation.explanation).toMatch(/^Publiée aujourd’hui/)
  })
})

describe('trackingVerdictFor', () => {
  const base = { dataDays: 20, impressions: 0, brandImpressions: 0, clicks: 0, position: null, queries: [] }

  it('never calls a young page dead', () => {
    expect(trackingVerdictFor({ ...base, dataDays: 4 })).toBe('too_early')
    expect(trackingVerdictFor({ ...base, dataDays: 20 })).toBe('unseen')
    expect(trackingVerdictFor({ ...base, dataDays: 30 })).toBe('no_demand')
  })

  it('separates a page shown only on the brand', () => {
    expect(trackingVerdictFor({ ...base, impressions: 3, brandImpressions: 3 })).toBe('brand_only')
  })

  it('reads the rank, and the age below four weeks', () => {
    const shown = { ...base, impressions: 40, queries: [] }
    expect(trackingVerdictFor({ ...shown, position: 3 })).toBe('winning')
    expect(trackingVerdictFor({ ...shown, position: 12 })).toBe('striking_distance')
    expect(trackingVerdictFor({ ...shown, position: 40, dataDays: 20 })).toBe('climbing')
    expect(trackingVerdictFor({ ...shown, position: 40, dataDays: 40 })).toBe('buried')
  })

  it('blames the title when a well-ranked page is seen and not clicked', () => {
    const queries = [{ query: 'consultant seo troyes', kind: 'related' as const, clicks: 1, impressions: 200, ctr: 0.005, position: 6 }]
    expect(trackingVerdictFor({ ...base, impressions: 200, clicks: 1, position: 6, queries })).toBe('low_ctr')
  })
})

describe('buildTracking', () => {
  it('merges the unexpected queries of every page, most shown first', () => {
    const other = generation({
      id: 'gen-2',
      title: 'Audit de référencement de site internet à Troyes',
      focusKeyword: 'audit de référencement de site internet à Troyes',
      pageUrl: 'https://cnx-solutions.fr/audit-referencement-site-troyes-2/',
      publishedAt: new Date('2026-10-24T11:00:00Z'),
    })

    const tracking = buildTracking({
      generations: [generation(), other],
      rows: [
        row({ query: 'agence seo troyes', impressions: 22, position: 34 }),
        row({ query: 'agence seo troyes', impressions: 5, position: 66.6, page_url: other.pageUrl }),
        row({ query: 'agence seo aube', impressions: 4, position: 41 }),
        row({ query: 'cnx solutions', impressions: 5, position: 2 }),
      ],
      lastDataDate: LAST_DATA,
      now: NOW,
      brands: BRANDS,
    })

    expect(tracking.pages.map((page) => page.generationId)).toEqual(['gen-1', 'gen-2'])
    expect(tracking.unexpected.map((query) => [query.query, query.impressions, query.position, query.pages.length])).toEqual([
      ['agence seo troyes', 27, 34, 2],
      ['agence seo aube', 4, 41, 1],
    ])
    expect(tracking.unexpected.map((query) => query.fate)).toEqual(['candidate', 'rare'])
  })

  it('agrees with the planner: a query another page of the site claims is not a candidate', () => {
    const tracking = buildTracking({
      generations: [generation()],
      rows: [
        row({ query: 'agence seo troyes', impressions: 22, position: 34 }),
        row({ query: 'consultant seo aube', impressions: 9, position: 60 }),
        row({ query: 'agence seo troyes', impressions: 3, position: 12, page_url: 'https://cnx-solutions.fr/' }),
        row({ query: 'cnx', impressions: 1, position: 1, page_url: 'https://cnx-solutions.fr/agence-seo-troyes/' }),
      ],
      lastDataDate: LAST_DATA,
      now: NOW,
      brands: BRANDS,
    })

    const fates = Object.fromEntries(tracking.unexpected.map((query) => [query.query, [query.fate, query.heldBy]]))
    // Ranked 12th through the home page: carried, not to be doubled.
    expect(fates['agence seo troyes']).toEqual(['carried', { url: 'https://cnx-solutions.fr/', position: 12 }])
  })

  it('sends a query several pages already dispute to the page to keep', () => {
    const tracking = buildTracking({
      generations: [generation()],
      rows: [
        row({ query: 'agence seo troyes', impressions: 22, position: 34 }),
        row({ query: 'agence seo troyes', impressions: 20, position: 30, page_url: 'https://cnx-solutions.fr/referencement-local-troyes/', clicks: 1 }),
      ],
      lastDataDate: LAST_DATA,
      now: NOW,
      brands: BRANDS,
    })

    expect(tracking.unexpected[0]).toMatchObject({
      fate: 'disputed',
      heldBy: { url: 'https://cnx-solutions.fr/referencement-local-troyes/', position: null },
    })
  })

  it('names the page that already treats an unexpected query', () => {
    const tracking = buildTracking({
      generations: [generation()],
      rows: [
        row({ query: 'agence seo aube', impressions: 9, position: 60 }),
        row({ query: 'seo', impressions: 1, position: 80, page_url: 'https://cnx-solutions.fr/agence-seo-aube/' }),
      ],
      lastDataDate: LAST_DATA,
      now: NOW,
      brands: BRANDS,
    })

    expect(tracking.unexpected[0]).toMatchObject({
      query: 'agence seo aube',
      fate: 'covered',
      heldBy: { url: 'https://cnx-solutions.fr/agence-seo-aube/', position: null },
    })
  })
})
