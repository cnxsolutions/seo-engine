// ─────────────────────────────────────────────────────────────────────────────
// Query matching — tests
// SEO Engine - Brand, target, related, or unexpected.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { brandForms, classifyQuery, isBrandQuery, queryTokens, sameQuery } from './query-match'

// La page CNX du 30/10/2026, et les requêtes que Search Console lui associait le 08/11.
const PAGE = {
  focusKeyword: 'alternative à un consultant SEO à Troyes',
  title: 'Alternative à un consultant SEO à Troyes',
  url: 'https://cnx-solutions.fr/consultant-seo-troyes-2/',
}
const BRANDS = brandForms({ name: 'CNX Solutions', url: 'https://cnx-solutions.fr/' })

describe('queryTokens', () => {
  it('folds accents, drops stopwords and a trailing plural', () => {
    expect(queryTokens('Démoussage des toitures à Châlons-en-Champagne')).toEqual(['demoussage', 'toiture', 'chalon', 'champagne'])
  })
})

describe('brandForms / isBrandQuery', () => {
  it('recognises the name and the host label, spaces or not', () => {
    expect(BRANDS).toContain('cnxsolutions')
    expect(isBrandQuery('cnx solutions', BRANDS)).toBe(true)
    expect(isBrandQuery('CNX-Solutions avis', BRANDS)).toBe(true)
    expect(isBrandQuery('agence seo troyes', BRANDS)).toBe(false)
  })

  it('drops forms too short to be distinctive', () => {
    expect(brandForms({ name: 'AFS', url: 'https://afs-maintenance.fr' })).toEqual(['afsmaintenance'])
  })
})

describe('classifyQuery', () => {
  it('tells the brand, the target, the related and the unexpected apart', () => {
    expect(classifyQuery('cnx solutions', PAGE, BRANDS)).toBe('brand')
    expect(classifyQuery('alternative consultant seo troyes', PAGE, BRANDS)).toBe('target')
    expect(classifyQuery('consultant seo troyes', PAGE, BRANDS)).toBe('related')
    expect(classifyQuery('agence seo troyes', PAGE, BRANDS)).toBe('unexpected')
  })

  it('reads the address too, without its « -2 » republication suffix', () => {
    const page = { focusKeyword: null, title: null, url: 'https://cnx-solutions.fr/consultant-seo-troyes-2/' }
    expect(classifyQuery('consultant seo troyes', page, [])).toBe('related')
    expect(classifyQuery('consultant seo 2', page, [])).toBe('unexpected')
  })

  it('tolerates one foreign word in a query of four words or more', () => {
    expect(classifyQuery('meilleur consultant seo troyes', PAGE, BRANDS)).toBe('related')
    expect(classifyQuery('agence consultant seo', PAGE, BRANDS)).toBe('unexpected')
  })
})

describe('sameQuery', () => {
  it('ignores case, accents and stopwords', () => {
    expect(sameQuery('Couvreur à Châlons', 'couvreur chalons')).toBe(true)
    expect(sameQuery('couvreur', 'zingueur')).toBe(false)
  })
})
