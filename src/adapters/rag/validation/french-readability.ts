// ─────────────────────────────────────────────────────────────────────────────
// French Readability
// SEO Engine - Validation Pipeline
// Syllable counting and Flesch reading ease adapted to French
// ─────────────────────────────────────────────────────────────────────────────

import { splitSentences, tokenizeWords } from './text-utils'

/**
 * Vowel letters, accents included. 'y' counts as a vowel: in French it always
 * carries a nucleus ("style", "cycle", "Troyes") and never plays the consonant
 * role it has in English.
 */
const VOWELS = 'aàâäeéèêëiîïoôöuùûüyÿ'

/**
 * Vowels whose accent forces a hiatus — two syllables — when they touch another
 * vowel: "création" = cré-a-tion, "poésie" = po-é-sie, "naïf" = na-ïf.
 *
 * 'â', 'ê', 'î', 'ô', 'û' and 'ù' are deliberately excluded: they only ever
 * appear inside digraphs that stay a single syllable ("traître", "poêle",
 * "coût", "où"), and treating them as hiatus markers over-counts them.
 */
const HIATUS_VOWELS = 'éèëïöüÿ'

const VOWEL_GROUP_PATTERN = new RegExp(`[${VOWELS}]+`, 'g')
const HAS_VOWEL_PATTERN = new RegExp(`[${VOWELS}]`)
const LETTERS_ONLY_PATTERN = new RegExp(`[^a-z${VOWELS}ç]`, 'g')

// ─── Syllables ───────────────────────────────────────────────────────────────

/**
 * Counts the syllables of a single French word.
 *
 * The previous implementation counted vowel CHARACTERS, which is not remotely
 * the same thing: "beau" is one syllable written with three vowel letters. On a
 * whole page that pushed the syllables-per-word ratio to ~2.7 instead of ~1.6,
 * and since Flesch multiplies that ratio by a large coefficient the score went
 * deeply negative — every French text was reported as unreadable.
 *
 * The rules implemented here, in order:
 *  1. consecutive vowels form ONE nucleus ("beau", "oiseau", "eau");
 *  2. a mute 'u' after 'q' or after 'g' before a front vowel is dropped, so
 *     "gué" and "qui" stay monosyllabic;
 *  3. a final mute 'e' / 'es' is removed ("plombe" → 1, "belles" → 1,
 *     "année" → 2), but only when a vowel survives, so "le" and "des" keep theirs;
 *  4. an acute/grave/diaeresis vowel touching another vowel splits the nucleus
 *     ("création" = 3, "naïf" = 2).
 *
 * These are WRITTEN syllables, which is what the French Flesch adaptation was
 * calibrated on. "référencement" therefore counts 5 (ré-fé-ren-ce-ment), not the
 * 4 of the elided spoken form.
 */
export function countFrenchSyllables(rawWord: string): number {
  let word = (rawWord || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/['’]/g, '')
    .replace(LETTERS_ONLY_PATTERN, '')

  // Digits and symbols survive as words ("2026", "24h/24") but carry no vowel;
  // charging them one syllable is closer to the truth than charging them zero.
  if (!word) return (rawWord || '').trim().length > 0 ? 1 : 0

  // Mute 'u': "quand" behaves like "kand", "guépard" like "gépard".
  word = word.replace(/qu/g, 'k').replace(/gu(?=[eéèêiîy])/g, 'g')

  // Mute final 'e' / 'es', guarded so single-syllable words keep their nucleus.
  if (word.endsWith('es') && HAS_VOWEL_PATTERN.test(word.slice(0, -2))) {
    word = word.slice(0, -2)
  } else if (word.endsWith('e') && HAS_VOWEL_PATTERN.test(word.slice(0, -1))) {
    word = word.slice(0, -1)
  }

  VOWEL_GROUP_PATTERN.lastIndex = 0
  const groups = word.match(VOWEL_GROUP_PATTERN)
  if (!groups) return 1

  let syllables = 0
  for (const group of groups) {
    syllables += 1
    for (let i = 1; i < group.length; i++) {
      if (HIATUS_VOWELS.includes(group[i]) || HIATUS_VOWELS.includes(group[i - 1])) {
        syllables += 1
      }
    }
  }

  return syllables
}

/** Total syllables of an already-tokenized word list. */
export function countSyllables(words: string[]): number {
  let total = 0
  for (const word of words) total += countFrenchSyllables(word)
  return total
}

// ─── Readability ─────────────────────────────────────────────────────────────

/** Human-readable band of a French Flesch score. */
export type FrenchReadabilityLabel =
  | 'tres facile'
  | 'facile'
  | 'assez facile'
  | 'standard'
  | 'assez difficile'
  | 'difficile'
  | 'tres difficile'

export interface FrenchReadabilityResult {
  /** Kandel & Moles score, clamped to 0-100. */
  score: number
  /** Same score before clamping, useful for debugging a pathological text. */
  rawScore: number
  /** Flesch-Kincaid style grade level, kept for backward compatibility. */
  gradeLevel: number
  label: FrenchReadabilityLabel
  words: number
  sentences: number
  syllables: number
  averageWordsPerSentence: number
  averageSyllablesPerWord: number
}

/**
 * French adaptation of Flesch Reading Ease by Kandel & Moles:
 *   207 - 1.015 x (words / sentences) - 73.6 x (syllables / words)
 *
 * The English coefficient (84.6) is wrong for French, whose words are longer:
 * applied to French it drags every score 15 to 25 points below where the
 * interpretation bands expect it to be.
 */
export function computeFrenchReadability(
  input: string | { words: number; sentences: number; syllables: number }
): FrenchReadabilityResult | null {
  let words: number
  let sentences: number
  let syllables: number

  if (typeof input === 'string') {
    const tokens = tokenizeWords(input)
    words = tokens.length
    sentences = splitSentences(input).length
    syllables = countSyllables(tokens)
  } else {
    words = input.words
    sentences = input.sentences
    syllables = input.syllables
  }

  if (words === 0 || sentences === 0) return null

  const averageWordsPerSentence = words / sentences
  const averageSyllablesPerWord = syllables / words

  const rawScore = 207 - 1.015 * averageWordsPerSentence - 73.6 * averageSyllablesPerWord
  const score = Math.round(Math.max(0, Math.min(100, rawScore)))
  const gradeLevel = Math.max(
    0,
    Math.round(0.39 * averageWordsPerSentence + 11.8 * averageSyllablesPerWord - 15.59)
  )

  return {
    score,
    rawScore: Math.round(rawScore),
    gradeLevel,
    label: describeFrenchReadability(score),
    words,
    sentences,
    syllables,
    averageWordsPerSentence,
    averageSyllablesPerWord,
  }
}

/**
 * Kandel & Moles interpretation bands. A French text does NOT read on the
 * anglo-saxon scale: ordinary French press prose lands around 50-65, so
 * demanding 60+ the way an English checker would flags healthy copy as hard.
 */
export function describeFrenchReadability(score: number): FrenchReadabilityLabel {
  if (score >= 80) return 'tres facile'
  if (score >= 70) return 'facile'
  if (score >= 60) return 'assez facile'
  if (score >= 50) return 'standard'
  if (score >= 40) return 'assez difficile'
  if (score >= 30) return 'difficile'
  return 'tres difficile'
}
