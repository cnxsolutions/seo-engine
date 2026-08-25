// ─────────────────────────────────────────────────────────────────────────────
// French Readability Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  computeFrenchReadability,
  countFrenchSyllables,
  countSyllables,
  describeFrenchReadability,
} from './french-readability'

describe('countFrenchSyllables', () => {
  it('counts vowel GROUPS, not vowel characters', () => {
    // The whole point of the fix: "beau" carries three vowel letters but a
    // single syllable.
    expect(countFrenchSyllables('beau')).toBe(1)
    expect(countFrenchSyllables('eau')).toBe(1)
    expect(countFrenchSyllables('oiseau')).toBe(2)
    expect(countFrenchSyllables('choix')).toBe(1)
  })

  it('counts common French words correctly', () => {
    const expectations: Array<[string, number]> = [
      ['maison', 2],
      ['ordinateur', 4],
      ['plombier', 2],
      ['plomberie', 3],
      ['chauffage', 2],
      ['entreprise', 3],
      ['travail', 2],
      ['difficile', 3],
      ['rapidement', 4],
      ['petit', 2],
      ['devis', 2],
      ['électricité', 5],
    ]

    for (const [word, syllables] of expectations) {
      expect(`${word}=${countFrenchSyllables(word)}`).toBe(`${word}=${syllables}`)
    }
  })

  it('drops the mute final e and es', () => {
    expect(countFrenchSyllables('fuite')).toBe(1)
    expect(countFrenchSyllables('faire')).toBe(1)
    expect(countFrenchSyllables('une')).toBe(1)
    expect(countFrenchSyllables('belles')).toBe(1)
    expect(countFrenchSyllables('simples')).toBe(1)
  })

  it('keeps the only syllable of short words', () => {
    expect(countFrenchSyllables('le')).toBe(1)
    expect(countFrenchSyllables('de')).toBe(1)
    expect(countFrenchSyllables('des')).toBe(1)
    expect(countFrenchSyllables('Troyes')).toBe(1)
  })

  it('does not drop an e that follows another vowel', () => {
    // "annee" would otherwise collapse to a single syllable.
    expect(countFrenchSyllables('année')).toBe(2)
    expect(countFrenchSyllables('idée')).toBe(2)
    expect(countFrenchSyllables('vie')).toBe(1)
    expect(countFrenchSyllables('rue')).toBe(1)
  })

  it('splits a hiatus marked by an accent or a diaeresis', () => {
    expect(countFrenchSyllables('création')).toBe(3)
    expect(countFrenchSyllables('poésie')).toBe(3)
    expect(countFrenchSyllables('naïf')).toBe(2)
    expect(countFrenchSyllables('théâtre')).toBe(2)
  })

  it('does not split digraphs that merely carry a circumflex', () => {
    expect(countFrenchSyllables('où')).toBe(1)
    expect(countFrenchSyllables('coût')).toBe(1)
    expect(countFrenchSyllables('poêle')).toBe(1)
    expect(countFrenchSyllables('traître')).toBe(1)
  })

  it('treats the u of qu- and gu- as mute', () => {
    expect(countFrenchSyllables('qui')).toBe(1)
    expect(countFrenchSyllables('quand')).toBe(1)
    expect(countFrenchSyllables('guerre')).toBe(1)
    expect(countFrenchSyllables('gué')).toBe(1)
  })

  it('handles ligatures and apostrophes', () => {
    expect(countFrenchSyllables('cœur')).toBe(1)
    expect(countFrenchSyllables("aujourd'hui")).toBe(3)
    expect(countFrenchSyllables('français')).toBe(2)
  })

  it('counts written syllables, including the internal mute e', () => {
    // "référencement" reads ré-fé-ren-ce-ment on the page. The elided spoken
    // form has four; this counter deliberately reports the written five, which
    // is what the French Flesch adaptation was calibrated on.
    expect(countFrenchSyllables('référencement')).toBe(5)
    expect(countFrenchSyllables('referencement')).toBe(5)
  })

  it('never returns zero for a non-empty token', () => {
    expect(countFrenchSyllables('2026')).toBe(1)
    expect(countFrenchSyllables('')).toBe(0)
  })

  it('sums a token list', () => {
    expect(countSyllables(['beau', 'maison', 'ordinateur'])).toBe(1 + 2 + 4)
  })
})

describe('computeFrenchReadability', () => {
  const NORMAL_FRENCH = [
    "Trouver un bon plombier a Troyes peut sembler difficile.",
    "Quelques criteres simples permettent de faire le bon choix.",
    "Demandez toujours un devis ecrit avant le debut des travaux.",
  ].join(' ')

  it('produces a plausible syllable ratio for real French', () => {
    const result = computeFrenchReadability(NORMAL_FRENCH)

    expect(result).not.toBeNull()
    // Real French sits around 1.5-1.9 written syllables per word. The old
    // character counter produced 2.5-3.
    expect(result!.averageSyllablesPerWord).toBeGreaterThan(1.2)
    expect(result!.averageSyllablesPerWord).toBeLessThan(2.1)
  })

  it('scores ordinary French in a publishable band, not deeply negative', () => {
    const result = computeFrenchReadability(NORMAL_FRENCH)

    expect(result!.rawScore).toBeGreaterThan(40)
    expect(result!.score).toBeGreaterThanOrEqual(40)
    expect(result!.score).toBeLessThanOrEqual(100)
  })

  it('penalises long sentences made of long words', () => {
    const easy = computeFrenchReadability(NORMAL_FRENCH)!
    const hard = computeFrenchReadability(
      'La reglementation thermique impose desormais aux professionnels certifies une verification ' +
      'systematique des installations existantes avant toute intervention corrective sur les ' +
      'equipements de production de chaleur individuels ou collectifs situes en zone urbaine dense.'
    )!

    expect(hard.score).toBeLessThan(easy.score)
  })

  it('returns null when there is nothing to measure', () => {
    expect(computeFrenchReadability('')).toBeNull()
    expect(computeFrenchReadability({ words: 0, sentences: 0, syllables: 0 })).toBeNull()
  })

  it('accepts pre-computed counts', () => {
    const result = computeFrenchReadability({ words: 100, sentences: 6, syllables: 170 })!

    // 207 - 1.015 * 16.667 - 73.6 * 1.7 = 65.0
    expect(result.score).toBe(65)
    expect(result.label).toBe('assez facile')
  })
})

describe('describeFrenchReadability', () => {
  it('uses the French Kandel & Moles bands, not the anglo-saxon ones', () => {
    expect(describeFrenchReadability(85)).toBe('tres facile')
    expect(describeFrenchReadability(72)).toBe('facile')
    expect(describeFrenchReadability(62)).toBe('assez facile')
    expect(describeFrenchReadability(55)).toBe('standard')
    expect(describeFrenchReadability(45)).toBe('assez difficile')
    expect(describeFrenchReadability(35)).toBe('difficile')
    expect(describeFrenchReadability(10)).toBe('tres difficile')
  })
})
