// ─────────────────────────────────────────────────────────────────────────────
// Word Count Tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  MIN_LENGTH_RATIO,
  countHtmlWords,
  countWords,
  decodeEntities,
  measureLength,
  resolveTargetWordCount,
  stripHtml,
} from './word-count'

describe('stripHtml', () => {
  it('separates words that only tags kept apart', () => {
    expect(stripHtml('<li>premier</li><li>second</li>')).toBe('premier second')
  })

  it('drops JSON-LD, scripts and styles', () => {
    const html = '<p>Visible</p><script type="application/ld+json">{"@type":"FAQPage"}</script><style>.a{color:red}</style>'
    expect(stripHtml(html)).toBe('Visible')
  })

  it('drops comments', () => {
    expect(stripHtml('<p>Avant<!-- note interne -->apres</p>')).toBe('Avant apres')
  })

  it('decodes entities so glued words stay two words', () => {
    expect(stripHtml('<p>Bonjour&nbsp;le monde</p>')).toBe('Bonjour le monde')
    expect(decodeEntities('d&rsquo;eau')).toBe('d’eau')
    expect(decodeEntities('&#233;t&#xE9;')).toBe('été')
  })

  it('leaves an unknown entity untouched rather than mangling it', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;')
  })
})

describe('countWords', () => {
  it('counts elided articles as separate words, as French does', () => {
    expect(countWords("l'entreprise de plomberie")).toBe(4)
    expect(countWords('l’entreprise de plomberie')).toBe(4)
  })

  it('ignores tokens carrying no letter or digit', () => {
    expect(countWords('un — deux • trois')).toBe(3)
  })

  it('counts nothing in an empty string', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

describe('countHtmlWords', () => {
  it('counts the prose and not the markup', () => {
    const html = '<div class="hero"><h1>Plombier a Troyes</h1><p>Nous intervenons vite.</p></div>'
    expect(countHtmlWords(html)).toBe(6)
  })

  it('does not count structured data as content', () => {
    const withSchema = '<p>Trois mots ici</p><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage"}</script>'
    expect(countHtmlWords(withSchema)).toBe(3)
  })
})

describe('measureLength', () => {
  const page = (words: number) => `<p>${'mot '.repeat(words).trim()}</p>`

  it('measures the HTML instead of believing the model', () => {
    const measurement = measureLength({ html: page(80), declared: 1500, target: 100 })

    expect(measurement.measured).toBe(80)
    expect(measurement.declared).toBe(1500)
    expect(measurement.overDeclaredBy).toBe(1420)
  })

  it('rejects a page under 85 % of its target', () => {
    expect(measureLength({ html: page(84), target: 100 }).meetsTarget).toBe(false)
  })

  it('accepts a page exactly at the threshold', () => {
    const measurement = measureLength({ html: page(85), target: 100 })

    expect(measurement.ratio).toBeCloseTo(MIN_LENGTH_RATIO)
    expect(measurement.meetsTarget).toBe(true)
  })

  it('accepts a longer page than ordered', () => {
    expect(measureLength({ html: page(300), target: 100 }).meetsTarget).toBe(true)
  })

  it('never fails a page for which no target is known', () => {
    const measurement = measureLength({ html: page(10), target: 0 })

    expect(measurement.meetsTarget).toBe(true)
    expect(measurement.ratio).toBe(0)
  })

  it('never reports a negative over-declaration', () => {
    expect(measureLength({ html: page(500), declared: 100, target: 400 }).overDeclaredBy).toBe(0)
  })

  it('honours a caller-supplied ratio', () => {
    expect(measureLength({ html: page(60), target: 100, minRatio: 0.5 }).meetsTarget).toBe(true)
  })
})

describe('resolveTargetWordCount', () => {
  it('prefers the brief, then the adjusted page length, then the campaign', () => {
    expect(resolveTargetWordCount({ briefWordCount: 1200, pageTargetLength: 800, campaignTargetLength: 600 })).toBe(1200)
    expect(resolveTargetWordCount({ pageTargetLength: 800, campaignTargetLength: 600 })).toBe(800)
    expect(resolveTargetWordCount({ campaignTargetLength: 600 })).toBe(600)
  })

  it('skips values that carry no information', () => {
    expect(resolveTargetWordCount({ briefWordCount: 0, pageTargetLength: 800 })).toBe(800)
    expect(resolveTargetWordCount({ briefWordCount: Number.NaN, campaignTargetLength: 600 })).toBe(600)
    expect(resolveTargetWordCount({})).toBe(0)
  })
})

// ─── Over-length ─────────────────────────────────────────────────────────────

describe('measureLength — depassement', () => {
  const words = (n: number) => `<p>${Array.from({ length: n }, (_, i) => `mot${i}`).join(' ')}</p>`

  it('signale un depassement au-dela du seuil, sans jamais bloquer', () => {
    // The regression this locks: 2 692 words shipped against a 1 100-word target
    // measured on the SERP, and nothing said a word about it.
    const m = measureLength({ html: words(2692), target: 1100 })
    expect(m.exceedsTarget).toBe(true)
    expect(m.meetsTarget).toBe(true) // over-length still ships
  })

  it('ne signale rien pour une page legerement plus longue', () => {
    // 1.3x is thorough, not padded.
    expect(measureLength({ html: words(1430), target: 1100 }).exceedsTarget).toBe(false)
  })

  it('ne signale rien exactement au seuil', () => {
    expect(measureLength({ html: words(1650), target: 1100 }).exceedsTarget).toBe(false)
  })

  it('ne signale rien sans cible connue', () => {
    // No campaign setting must not turn every page into a warning.
    expect(measureLength({ html: words(5000), target: 0 }).exceedsTarget).toBe(false)
  })
})
