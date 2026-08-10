// ─────────────────────────────────────────────────────────────────────────────
// AI Output Handling Tests
// SEO Engine - Parsing, truncation detection and shared helpers
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  AiOutputError,
  countHtmlWords,
  countWords,
  estimateMaxOutputTokens,
  firstNonEmpty,
  looksTruncated,
  parseAiJsonObject,
  todayIso,
} from './openai'

describe('parseAiJsonObject()', () => {
  it('parses a plain JSON object', () => {
    expect(parseAiJsonObject('{"title":"Plombier Troyes"}', 'test')).toEqual({ title: 'Plombier Troyes' })
  })

  it('tolerates markdown fences', () => {
    const raw = '```json\n{"title":"Plombier Troyes"}\n```'
    expect(parseAiJsonObject(raw, 'test')).toEqual({ title: 'Plombier Troyes' })
  })

  it('tolerates surrounding prose', () => {
    const raw = 'Voici la page demandee :\n{"title":"Plombier Troyes"}\nBonne publication !'
    expect(parseAiJsonObject(raw, 'test')).toEqual({ title: 'Plombier Troyes' })
  })

  it('reports an empty answer instead of returning an empty page', () => {
    for (const raw of ['', '   ', '{}']) {
      try {
        parseAiJsonObject(raw, 'test')
        throw new Error('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AiOutputError)
        expect((error as AiOutputError).kind).toBe('empty')
      }
    }
  })

  it('distinguishes a truncated answer from a malformed one', () => {
    try {
      parseAiJsonObject('{"title":"Plombier","htmlContent":"<p>debut du texte', 'test')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AiOutputError)
      expect((error as AiOutputError).kind).toBe('truncated')
    }

    try {
      parseAiJsonObject('{"title": undefined,}', 'test')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AiOutputError)
      expect((error as AiOutputError).kind).toBe('malformed')
    }
  })

  it('refuses a JSON array', () => {
    try {
      parseAiJsonObject('[1,2,3]', 'test')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AiOutputError)
      expect((error as AiOutputError).kind).toBe('not_object')
    }
  })

  it('names the generation in the error message', () => {
    try {
      parseAiJsonObject('', 'page pillar plombier Troyes')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as AiOutputError).message).toContain('page pillar plombier Troyes')
    }
  })
})

describe('looksTruncated()', () => {
  it('detects an unclosed object', () => {
    expect(looksTruncated('{"a":{"b":1}')).toBe(true)
  })

  it('detects a cut inside a string', () => {
    expect(looksTruncated('{"a":"texte non termin')).toBe(true)
  })

  it('accepts a balanced payload, braces inside strings included', () => {
    expect(looksTruncated('{"a":"un { dans une chaine"}')).toBe(false)
    expect(looksTruncated('{"a":"echappement \\" interne"}')).toBe(false)
  })
})

describe('estimateMaxOutputTokens()', () => {
  it('scales with the target length instead of a flat budget', () => {
    expect(estimateMaxOutputTokens(3000)).toBeGreaterThan(estimateMaxOutputTokens(800))
  })

  it('gives a long pillar page more room than the old 8000-token ceiling', () => {
    expect(estimateMaxOutputTokens(3000)).toBeGreaterThan(8000)
  })

  it('stays within a floor and a ceiling', () => {
    // The floor covers the fixed cost of the response — four JSON-LD blocks, the
    // FAQ array, the metadata — which does not shrink with the article.
    expect(estimateMaxOutputTokens(100)).toBe(6000)
    expect(estimateMaxOutputTokens(100000)).toBe(16000)
  })

  it('leaves room for the schemas at a brief-sized target', () => {
    // The regression this locks: lowering the target from 2 000 to 1 100 words
    // dropped the budget to 5 020 tokens and truncated the response mid-JSON —
    // a page ordered SHORTER failed for lack of room.
    expect(estimateMaxOutputTokens(1100)).toBeGreaterThanOrEqual(7000)
    expect(estimateMaxOutputTokens(2000)).toBeGreaterThanOrEqual(10000)
  })
})

describe('countHtmlWords()', () => {
  it('counts rendered text only', () => {
    expect(countHtmlWords('<h1>Plombier a Troyes</h1><p>Intervention rapide.</p>')).toBe(5)
  })

  it('ignores scripts, styles and entities', () => {
    const html = '<style>p{color:red}</style><script>var a=1</script><p>un&nbsp;deux trois</p>'
    expect(countHtmlWords(html)).toBe(3)
  })
})

describe('countWords()', () => {
  it('counts words of plain text', () => {
    expect(countWords('  un deux   trois ')).toBe(3)
    expect(countWords('')).toBe(0)
  })
})

describe('firstNonEmpty()', () => {
  it('skips empty strings where ?? would keep them', () => {
    expect(firstNonEmpty('', '   ', 'valeur')).toBe('valeur')
    expect(firstNonEmpty(undefined, null, 42)).toBe('')
  })
})

describe('todayIso()', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayIso(new Date('2026-07-31T10:20:30Z'))).toBe('2026-07-31')
  })
})
