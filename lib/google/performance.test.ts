import { describe, expect, it } from 'vitest'
import {
  aggregateRows,
  detectCannibalization,
  normalizePageUrl,
  selectLowCtrPages,
  selectStrikingDistance,
  verdictFor,
  type GscRawRow,
} from './performance'

function row(overrides: Partial<GscRawRow> & Pick<GscRawRow, 'page_url' | 'query'>): GscRawRow {
  return {
    date: '2026-01-01',
    clicks: 0,
    impressions: 0,
    position: 0,
    ...overrides,
  }
}

describe('aggregateRows', () => {
  it('collapses a (page, query) couple across days', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/x', query: 'q', clicks: 1, impressions: 100, position: 10, date: '2026-01-01' }),
      row({ page_url: 'https://a.fr/x', query: 'q', clicks: 0, impressions: 1, position: 1, date: '2026-01-02' }),
    ])

    expect(stats).toHaveLength(1)
    expect(stats[0].clicks).toBe(1)
    expect(stats[0].impressions).toBe(101)
    expect(stats[0].ctr).toBe(0.0099)
  })

  it('weights the average position by impressions', () => {
    // A day seen once must not weigh as much as a day seen a hundred times.
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/x', query: 'q', impressions: 100, position: 10, date: '2026-01-01' }),
      row({ page_url: 'https://a.fr/x', query: 'q', impressions: 1, position: 1, date: '2026-01-02' }),
    ])

    expect(stats[0].position).toBe(9.9)
  })

  it('separates two pages answering the same query', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/x', query: 'q', impressions: 10, position: 4 }),
      row({ page_url: 'https://a.fr/y', query: 'q', impressions: 10, position: 8 }),
    ])

    expect(stats).toHaveLength(2)
  })
})

describe('detectCannibalization', () => {
  it('flags a query two pages of the site are shown on', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/plombier', query: 'plombier troyes', clicks: 5, impressions: 100, position: 4 }),
      row({ page_url: 'https://a.fr/plomberie', query: 'plombier troyes', clicks: 1, impressions: 60, position: 9 }),
    ])

    const [conflict] = detectCannibalization(stats)

    expect(conflict.query).toBe('plombier troyes')
    expect(conflict.impressions).toBe(160)
    // Most clicks wins: it is the page Google already rewards.
    expect(conflict.winner).toBe('https://a.fr/plombier')
    expect(conflict.losers).toEqual(['https://a.fr/plomberie'])
  })

  it('ignores a query a single page answers', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/plombier', query: 'plombier troyes', clicks: 5, impressions: 500, position: 4 }),
    ])

    expect(detectCannibalization(stats)).toEqual([])
  })

  it('ignores a marginal second page', () => {
    // 2 impressions against 200 is not a fight, it is noise.
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/plombier', query: 'plombier troyes', clicks: 9, impressions: 200, position: 3 }),
      row({ page_url: 'https://a.fr/contact', query: 'plombier troyes', clicks: 0, impressions: 2, position: 60 }),
    ])

    expect(detectCannibalization(stats)).toEqual([])
  })

  it('ignores a query too rare for the split to cost anything', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/a', query: 'requete rare', impressions: 5, position: 8 }),
      row({ page_url: 'https://a.fr/b', query: 'requete rare', impressions: 4, position: 9 }),
    ])

    expect(detectCannibalization(stats)).toEqual([])
  })
})

describe('selectStrikingDistance', () => {
  it('keeps only queries ranking 5 to 20 with real volume', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/a', query: 'a portee', clicks: 2, impressions: 300, position: 7 }),
      row({ page_url: 'https://a.fr/b', query: 'deja gagnee', clicks: 40, impressions: 500, position: 2 }),
      row({ page_url: 'https://a.fr/c', query: 'trop loin', clicks: 0, impressions: 300, position: 42 }),
      row({ page_url: 'https://a.fr/d', query: 'trop rare', clicks: 0, impressions: 4, position: 8 }),
    ])

    expect(selectStrikingDistance(stats).map((o) => o.query)).toEqual(['a portee'])
  })

  it('sorts by potential and keeps one page per query', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/a', query: 'petite', clicks: 0, impressions: 50, position: 12 }),
      row({ page_url: 'https://a.fr/b', query: 'grosse', clicks: 0, impressions: 900, position: 6 }),
      row({ page_url: 'https://a.fr/c', query: 'grosse', clicks: 0, impressions: 100, position: 15 }),
    ])

    const opportunities = selectStrikingDistance(stats)

    expect(opportunities.map((o) => o.query)).toEqual(['grosse', 'petite'])
    expect(opportunities[0].pageUrl).toBe('https://a.fr/b')
  })
})

describe('selectLowCtrPages', () => {
  it('flags a page displayed a lot and clicked almost never', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/vue', query: 'q', clicks: 2, impressions: 500, position: 6 }),
    ])

    const [page] = selectLowCtrPages(stats)

    expect(page.pageUrl).toBe('https://a.fr/vue')
    expect(page.ctr).toBe(0.004)
    expect(page.topQuery).toBe('q')
  })

  it('does not blame the title for the ranking', () => {
    // Position 18 explains a 0.2% CTR on its own.
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/loin', query: 'q', clicks: 1, impressions: 500, position: 18 }),
    ])

    expect(selectLowCtrPages(stats)).toEqual([])
  })

  it('leaves a healthy page alone', () => {
    const stats = aggregateRows([
      row({ page_url: 'https://a.fr/ok', query: 'q', clicks: 50, impressions: 500, position: 3 }),
    ])

    expect(selectLowCtrPages(stats)).toEqual([])
  })
})

describe('normalizePageUrl', () => {
  it('reads the same page through its spelling variants', () => {
    const canonical = 'example.com/page'

    expect(normalizePageUrl('https://www.Example.com/Page/')).toBe(canonical)
    expect(normalizePageUrl('http://example.com/page')).toBe(canonical)
    expect(normalizePageUrl('https://example.com/page?utm_source=x')).toBe(canonical)
    expect(normalizePageUrl('https://example.com/page#faq')).toBe(canonical)
  })

  it('survives an empty or malformed url', () => {
    expect(normalizePageUrl('')).toBe('')
    expect(normalizePageUrl('https://example.com/%E0%A4%A')).toBe('example.com/%e0%a4%a')
  })
})

describe('verdictFor', () => {
  it('calls a page nobody ever saw dead', () => {
    expect(verdictFor({ clicks: 0, impressions: 0, position: null })).toBe('dead')
  })

  it('separates a wording problem from a ranking problem', () => {
    expect(verdictFor({ clicks: 1, impressions: 500, position: 7 })).toBe('low_ctr')
    expect(verdictFor({ clicks: 2, impressions: 120, position: 12 })).toBe('striking_distance')
  })

  it('recognises a page that works', () => {
    expect(verdictFor({ clicks: 50, impressions: 500, position: 3 })).toBe('winning')
  })

  it('recognises a page that is indexed and nowhere', () => {
    expect(verdictFor({ clicks: 0, impressions: 30, position: 45 })).toBe('buried')
  })
})
