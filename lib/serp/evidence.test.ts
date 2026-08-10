import { describe, expect, it } from 'vitest'
import { findCommonSections, median } from './evidence'
import type { RankingPageMeasurement } from './types'

// These cover how ranking pages are turned into a brief's numbers. The HTML
// parser they used to sit next to is gone: scraping google.com/search returns a
// JavaScript shell with no results in it, so the SERP is read through SerpApi
// and there is no markup left to parse.

describe('median', () => {
  it('resists a single outlier', () => {
    // Why not a mean: 6000 would drag the average to 1980, a target none of the
    // other four pages meets.
    expect(median([900, 950, 1000, 1050, 6000])).toBe(1000)
  })

  it('averages the two middle values on an even count', () => {
    expect(median([800, 900, 1000, 1100])).toBe(950)
  })

  it('returns null with nothing to measure', () => {
    expect(median([])).toBeNull()
  })
})

describe('findCommonSections', () => {
  const page = (h2s: string[], id = 1): RankingPageMeasurement => ({
    url: `https://ex${id}.fr`,
    host: `ex${id}.fr`,
    position: id,
    wordCount: 1000,
    title: 't',
    h1: 'h1',
    h2s,
    hasFaq: false,
    hasSchema: false,
  })

  it('keeps headings shared by at least two pages, ignoring case and accents', () => {
    const sections = findCommonSections([
      page(['Combien ça coûte ?', 'Nos garanties'], 1),
      page(['COMBIEN CA COUTE', 'Zone d’intervention'], 2),
    ])

    expect(sections).toHaveLength(1)
    expect(sections[0]).toBe('Combien ça coûte ?')
  })

  it('does not let one page repeating a heading make it look common', () => {
    expect(findCommonSections([page(['Tarifs', 'Tarifs', 'Tarifs'])])).toEqual([])
  })

  it('returns nothing when no page was measured', () => {
    expect(findCommonSections([])).toEqual([])
  })
})
