// ─────────────────────────────────────────────────────────────────────────────
// Text Utilities
// SEO Engine - Validation Pipeline
// Shared HTML / French text helpers used by every validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Block-level tags. They terminate a sentence even without punctuation, so the
 * text extractor turns them into a full stop: a page made of headings and list
 * items would otherwise look like one endless 900-word sentence and wreck every
 * readability metric.
 */
const BLOCK_TAG_PATTERN =
  /<\/?(?:p|div|section|article|aside|header|footer|main|nav|li|ul|ol|dl|dt|dd|h[1-6]|br|hr|td|th|tr|table|blockquote|figure|figcaption|pre)\b[^>]*>/gi

/** A word: letters/digits, possibly glued by an apostrophe or a hyphen. */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

/** Stateless probe: does this fragment contain at least one letter or digit? */
const HAS_WORD_PATTERN = /[\p{L}\p{N}]/u

/** First and last code point of the Unicode combining-diacritics block. */
const COMBINING_MIN = 0x0300
const COMBINING_MAX = 0x036f

// ─── HTML ────────────────────────────────────────────────────────────────────

/**
 * Turns an HTML fragment into plain text suitable for counting.
 * Script/style bodies are dropped entirely, block tags become sentence
 * boundaries, remaining tags become spaces.
 */
export function stripHtmlToText(html: string): string {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(BLOCK_TAG_PATTERN, ' . ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A heading with its level, as opposed to a bare string of heading text. */
export interface HeadingNode {
  level: number
  text: string
}

/**
 * Extracts the heading outline.
 *
 * The backreference on the level matters: `<h([1-6])...</h\1>` refuses to pair
 * an opening `<h2>` with a closing `</h3>`, which the previous
 * non-backreferenced pattern happily did on malformed markup.
 */
export function extractHeadingOutline(html: string): HeadingNode[] {
  const outline: HeadingNode[] = []
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html || '')) !== null) {
    outline.push({
      level: Number(match[1]),
      text: match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    })
  }

  return outline
}

/** Result of splitting the anchors of a document. */
export interface ExtractedLinks {
  internal: string[]
  external: string[]
}

/**
 * Extracts anchor targets, accepting single quotes, double quotes and unquoted
 * attributes. The generator emits `<a href='/slug'>` (single quotes) in
 * `internalLinksHtml`, which a double-quote-only regex silently ignored — every
 * page then looked like it had zero internal links.
 */
export function extractLinks(html: string, siteOrigin?: string): ExtractedLinks {
  const internal: string[] = []
  const external: string[] = []
  const pattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
  const origin = siteOrigin ? siteOrigin.replace(/\/+$/, '').toLowerCase() : undefined
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html || '')) !== null) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!href) continue

    const lower = href.toLowerCase()
    if (
      lower.startsWith('#') ||
      lower.startsWith('mailto:') ||
      lower.startsWith('tel:') ||
      lower.startsWith('javascript:')
    ) {
      continue
    }

    if (/^https?:\/\//i.test(href)) {
      if (origin && lower.startsWith(origin)) internal.push(href)
      else external.push(href)
      continue
    }

    // Root-relative or relative: same site.
    internal.push(href)
  }

  return { internal, external }
}

/** Counts `<img>` tags and how many of them carry a non-empty alt attribute. */
export function countImages(html: string): { total: number; withAlt: number } {
  const images = (html || '').match(/<img\b[^>]*>/gi) || []
  const withAlt = images.filter(img =>
    /\balt\s*=\s*(?:"\s*[^"\s][^"]*"|'\s*[^'\s][^']*'|[^\s"'>]+)/i.test(img)
  ).length
  return { total: images.length, withAlt }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Removes diacritics: "référencement" → "referencement".
 * Written without a combining-mark regex literal so the source stays pure ASCII.
 */
export function stripAccents(value: string): string {
  let out = ''
  for (const char of (value || '').normalize('NFD')) {
    const code = char.codePointAt(0) as number
    if (code < COMBINING_MIN || code > COMBINING_MAX) out += char
  }
  return out
}

/**
 * Case-folded, accent-folded, punctuation-free form used for every keyword
 * comparison. "Plomberie à Troyes" and "plomberie a troyes" must match: an SEO
 * gate that fails on an accent would reject perfectly correct French.
 */
export function normalizeForMatch(value: string): string {
  return stripAccents((value || '').toLowerCase())
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Tokenizes a raw text into words (HTML must already be stripped). */
export function tokenizeWords(text: string): string[] {
  return (text || '').match(WORD_PATTERN) ?? []
}

/** Splits into sentences on terminal punctuation and blank lines. */
export function splitSentences(text: string): string[] {
  return (text || '')
    .split(/[.!?…]+|\n{2,}/)
    .map(s => s.trim())
    .filter(s => HAS_WORD_PATTERN.test(s))
}

// ─── Keyword matching ────────────────────────────────────────────────────────

/** Normalized tokens of a focus keyword, e.g. "plombier Troyes" → [plombier, troyes]. */
export function keywordTokens(keyword: string): string[] {
  const normalized = normalizeForMatch(keyword)
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

/** True when the exact keyword phrase appears, accents and case ignored. */
export function containsKeywordPhrase(text: string, keyword: string): boolean {
  const needle = normalizeForMatch(keyword)
  if (!needle) return false
  return ` ${normalizeForMatch(text)} `.includes(` ${needle} `)
}

/**
 * Share of the keyword tokens present anywhere in the text (0 → 1).
 *
 * Exact-phrase matching alone is too brittle for French: "plomberie Troyes"
 * legitimately reads "plomberie à Troyes" in a real sentence, and a gate keyed
 * on the exact string would block a perfectly on-topic page.
 */
export function keywordTokenCoverage(text: string, keyword: string): number {
  const tokens = keywordTokens(keyword)
  if (tokens.length === 0) return 1

  const haystack = ` ${normalizeForMatch(text)} `
  const found = tokens.filter(token => haystack.includes(` ${token} `)).length
  return found / tokens.length
}

/** Counts exact occurrences of the keyword phrase in a token stream. */
export function countKeywordOccurrences(text: string, keyword: string): number {
  const needle = keywordTokens(keyword)
  if (needle.length === 0) return 0

  const words = normalizeForMatch(text).split(' ').filter(Boolean)
  let count = 0

  for (let i = 0; i <= words.length - needle.length; i++) {
    let matches = true
    for (let j = 0; j < needle.length; j++) {
      if (words[i + j] !== needle[j]) {
        matches = false
        break
      }
    }
    if (matches) count++
  }

  return count
}

// ─── Pixel width ─────────────────────────────────────────────────────────────

/**
 * Per-character advance widths for Arial 20px, the font Google renders desktop
 * SERP titles in. Approximate, but far closer to the real constraint than a
 * character count: "Illililli" and "MWMWMWMWM" are both 9 characters and one is
 * three times wider.
 */
const NARROW_CHARS = "iljtfr.,;:!|'’()[]{}/\\ "
const WIDE_CHARS = 'mwMW@%'
const UPPER_PATTERN = /[A-Z0-9À-Ý]/

/** Rough SERP pixel width of a title rendered in Arial 20px. */
export function estimatePixelWidth(text: string): number {
  let width = 0
  for (const char of text || '') {
    if (NARROW_CHARS.includes(char)) width += 5
    else if (WIDE_CHARS.includes(char)) width += 16
    else if (UPPER_PATTERN.test(char)) width += 13
    else width += 10
  }
  return Math.round(width)
}

// ─── French stopwords ────────────────────────────────────────────────────────

/**
 * Function words carry no topical signal. Leaving them in a bag-of-words
 * comparison makes any two French texts look alike, because "les", "des",
 * "pour" and "dans" dominate the vector.
 */
export const FRENCH_STOPWORDS: ReadonlySet<string> = new Set([
  'afin', 'ainsi', 'alors', 'apres', 'aucun', 'aussi', 'autre', 'autres', 'avaient', 'avais',
  'avait', 'avant', 'avec', 'avoir', 'car', 'cas', 'ceci', 'cela', 'celle', 'celles', 'celui',
  'ces', 'cet', 'cette', 'ceux', 'chaque', 'chez', 'comme', 'comment', 'dans', 'des', 'deux',
  'doit', 'donc', 'dont', 'elle', 'elles', 'encore', 'entre', 'est', 'etaient', 'etait', 'etant',
  'etc', 'ete', 'etes', 'etre', 'eux', 'faut', 'hors', 'ici', 'ils', 'jusqu', 'les', 'leur',
  'leurs', 'lors', 'lui', 'mais', 'meme', 'memes', 'mes', 'moins', 'mon', 'nos', 'notre', 'nous',
  'ont', 'aux',
  'par', 'parce', 'pas', 'peu', 'peut', 'plus', 'pour', 'pourquoi', 'quand', 'que', 'quel',
  'quelle', 'quelles', 'quels', 'qui', 'quoi', 'sans', 'sera', 'seront', 'ses', 'seulement',
  'soit', 'son', 'sont', 'sous', 'sur', 'tous', 'tout', 'toute', 'toutes', 'tres', 'trop',
  'une', 'unes', 'uns', 'vos', 'votre', 'vous',
])

/** Topical tokens only: normalized, longer than two characters, stopwords removed. */
export function contentTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter(word => word.length > 2 && !FRENCH_STOPWORDS.has(word))
}

/** Word n-grams ("shingles"), the standard way to catch real copy-paste. */
export function wordShingles(tokens: string[], size: number): Set<string> {
  if (tokens.length === 0) return new Set()
  if (tokens.length <= size) return new Set([tokens.join(' ')])

  const shingles = new Set<string>()
  for (let i = 0; i <= tokens.length - size; i++) {
    shingles.add(tokens.slice(i, i + size).join(' '))
  }
  return shingles
}

/** Jaccard index of two sets. */
export function jaccardIndex(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const value of small) {
    if (large.has(value)) intersection++
  }

  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Cosine similarity of two term-frequency vectors. */
export function cosineSimilarityOfTokens(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  const freqA = new Map<string, number>()
  const freqB = new Map<string, number>()
  for (const token of tokensA) freqA.set(token, (freqA.get(token) || 0) + 1)
  for (const token of tokensB) freqB.set(token, (freqB.get(token) || 0) + 1)

  let dot = 0
  for (const [token, count] of freqA) {
    const other = freqB.get(token)
    if (other) dot += count * other
  }

  let magA = 0
  for (const count of freqA.values()) magA += count * count
  let magB = 0
  for (const count of freqB.values()) magB += count * count

  if (magA === 0 || magB === 0) return 0

  // Clamped: floating-point error makes two identical vectors score
  // 1.0000000000000002, which then leaks into every threshold comparison.
  return Math.min(1, dot / (Math.sqrt(magA) * Math.sqrt(magB)))
}
