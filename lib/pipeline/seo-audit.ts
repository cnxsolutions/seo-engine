// ─────────────────────────────────────────────────────────────────────────────
// Deep SEO + GEO audit
// SEO Engine - Post-generation pipeline
// Every on-page rule a page must satisfy before it ships, in one pure function
// ─────────────────────────────────────────────────────────────────────────────
//
// The owner's decision of 2026-10-17: a page is tested on every SEO and GEO
// concept BEFORE it is published, and a page that fails is regenerated, not
// shipped. This module is the "tested" half. It answers one question — what is
// wrong with this page, and what exactly must change — and nothing else:
//
//   - PURE and SYNCHRONOUS. No network, no database, no clock, no environment.
//     Everything it weighs is handed in. That is what lets `runValidationGate`
//     call it unconditionally, outside the validators' try/catch, and what lets
//     a test pin each rule with two literal strings.
//   - EVERY MESSAGE IS AN INSTRUCTION. The blocking findings are sent back to the
//     model as revision feedback (lib/scheduler/cron.ts, `revisionFeedback`). A
//     message that says what is wrong without saying what to do produces a second
//     page with the same defect, so each one names the measured value, the
//     expected range, and the correction — in French, because the model writes
//     in French and the operator reads in French.
//   - THRESHOLDS ARE NAMED, ONCE. `AUDIT_THRESHOLDS` is the single place a limit
//     lives; the messages and the tests both read it.
//
// Three families, three sources:
//
//   'seo' — what a search engine needs to understand and rank the page: title and
//           meta lengths, the keyword where it counts, a sound heading outline,
//           internal links, alt text, a clean slug, no leftover placeholder.
//   'geo' — what an answer engine (AI Overviews, ChatGPT, Perplexity) needs to
//           QUOTE the page: a self-contained answer under the H1, headings phrased
//           as the questions people ask, a FAQ that matches its schema, named
//           entities, scannable lists, cited sources — and no invented NAP.
//   'quality' — what the VISITOR reads as text written for a search engine: a
//           query pasted as typed, the page describing its own SEO or quoting
//           the site's Search Console, one label opening paragraph after
//           paragraph, a "?" stuck on a statement. Reported on 2026-10-21 on a
//           published page; the generator's READER_FIRST_RULES forbid them,
//           these rules refuse what still gets through.
//
// What this module deliberately does NOT re-check: the presence of an H1 and the
// parseability of the JSON-LD blocks. Both are owned by gate.ts (MISSING_H1,
// INVALID_JSON_LD) and reporting them twice would only double the feedback.

import { countWords, stripHtml } from './word-count'

// ─── Contract ───────────────────────────────────────────────────────────────

export type AuditSource = 'seo' | 'geo' | 'quality'
export type AuditSeverity = 'blocking' | 'warning'

export interface AuditFinding {
  code: string
  source: AuditSource
  severity: AuditSeverity
  /** French, actionable: what is wrong AND what to do about it. */
  message: string
}

export interface AuditFaqItem {
  q: string
  a: string
}

export interface SeoAuditInput {
  html: string
  title: string
  metaDescription: string
  focusKeyword: string
  slug: string
  /** Target city. Absent: the city checks do not run. */
  city?: string
  /** Absent: ENTITY_BUSINESS does not run. */
  businessName?: string
  /** `PlanItemBrief.required_entities`. Fewer than 2: REQUIRED_ENTITIES does not run. */
  requiredEntities?: readonly string[]
  /** The visible FAQ. Absent counts as an empty FAQ. */
  faqItems?: readonly AuditFaqItem[]
  schemas?: {
    localBusiness?: string
    faqPage?: string
    breadcrumb?: string
    article?: string
  }
  /** `GeneratedPage.directAnswer`. Absent counts as empty. */
  directAnswer?: string
  pageType: string
  /** Absent: SOURCES does not run. */
  enableExternalLinks?: boolean
  /**
   * False means "no Google Business Profile": no phone number and no street
   * address may appear. Absent means UNKNOWN, and INVENTED_NAP does not run —
   * the pre-publish path has no Google context, and guessing would refuse a page
   * whose NAP is perfectly real.
   */
  hasGoogleBusinessProfile?: boolean
  /** How many pages the site already has (home excluded). Absent: INTERNAL_LINKS does not run. */
  knownInternalPathsCount?: number
  /** Internal links that survived pruning. Absent: INTERNAL_LINKS does not run. */
  internalLinksKept?: number
  /** Tells an internal absolute link from an external one. */
  siteUrl?: string
}

// ─── Thresholds ─────────────────────────────────────────────────────────────

export const AUDIT_THRESHOLDS = {
  /** Title, in characters. Outside → blocking; above the comfort max → warning. */
  titleMin: 25,
  titleMax: 70,
  titleComfortMax: 60,
  /** Meta description, in characters. Outside → blocking; outside comfort → warning. */
  metaMin: 80,
  metaMax: 170,
  metaComfortMin: 120,
  metaComfortMax: 160,
  /** Share of the keyword's significant words that must appear (title, H1, intro). */
  keywordCoverage: 0.6,
  /** The intro window, in words, H1 excluded. */
  introWords: 150,
  /** Pages above this many words need `h2MinLong` H2, the others `h2MinShort`. */
  h2LongPageWords: 600,
  h2MinLong: 3,
  h2MinShort: 2,
  /** Exact focus-keyword phrase occurrences per word of body. */
  keywordDensityMax: 0.03,
  /** Share of H2 that may repeat the exact focus-keyword phrase. */
  keywordInH2Max: 0.5,
  /** Internal links kept, required once the site has `internalLinksSiteMin` pages. */
  internalLinksMin: 2,
  internalLinksSiteMin: 3,
  /** Paragraphs shorter than this are never compared (a CTA may legitimately repeat). */
  duplicateParagraphMinWords: 12,
  paragraphMaxWords: 150,
  sentenceAvgMaxWords: 28,
  /** The direct answer paragraph right after the H1, in words. */
  directAnswerMin: 30,
  directAnswerMax: 90,
  questionHeadingsMin: 2,
  faqMin: 3,
  faqMinPillar: 5,
  /** Share of FAQ questions that must match between faqItems and FAQPage. */
  faqSchemaMatch: 0.8,
  cityMentionsMin: 2,
  requiredEntitiesCoverage: 0.7,
  requiredEntitiesMinListed: 2,
  /** The window, in words, where a definition sentence is expected. */
  definitionWindowWords: 300,
  /** Paragraphs a template label (« Réponse courte : ») may open before the page is refused. */
  formulaicLabelMax: 1,
  /** Paragraphs any other label may open before a warning. */
  repeatedLabelMax: 2,
} as const

const T = AUDIT_THRESHOLDS

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Every SEO and GEO finding on a page, blocking first-hand facts and warnings
 * alike. Never throws: a malformed input yields findings, not an exception.
 *
 * Each rule runs in its own guard. A rule that breaks on an input nobody
 * foresaw is reported as an AUDIT_ERROR WARNING and the others still run: a
 * deterministic crash turned into a blocking finding would refuse every page
 * of the engine, three attempts each — the dead engine this gate must never be.
 */
export function auditSeoGeo(input: SeoAuditInput): AuditFinding[] {
  const findings: AuditFinding[] = []
  const add = (code: string, source: AuditSource, severity: AuditSeverity, message: string) => {
    findings.push({ code, source, severity, message })
  }

  let page: PageAnalysis
  try {
    page = analysePage(input)
  } catch (error) {
    add('AUDIT_ERROR', 'seo', 'warning', `Audit SEO/GEO impossible : ${errorText(error)}`)
    return findings
  }

  const rules: ReadonlyArray<[string, () => void]> = [
    // ─── SEO ────────────────────────────────────────────────────────────
    ['TITLE_LENGTH', () => checkTitleLength(input, add)],
    ['META_LENGTH', () => checkMetaLength(input, add)],
    ['KEYWORD_PLACEMENT', () => checkKeywordPlacement(input, page, add)],
    ['HEADING_HIERARCHY', () => checkHeadingHierarchy(page, add)],
    ['H2_COUNT', () => checkH2Count(page, add)],
    ['KEYWORD_STUFFING', () => checkKeywordStuffing(input, page, add)],
    ['INTERNAL_LINKS', () => checkInternalLinks(input, add)],
    ['IMAGE_ALT', () => checkImageAlt(page, add)],
    ['SLUG_FORMAT', () => checkSlug(input, page, add)],
    ['PLACEHOLDER', () => checkPlaceholders(input, page, add)],
    ['DUPLICATE_PARAGRAPH', () => checkDuplicateParagraphs(page, add)],
    ['EMPTY_LINK', () => checkEmptyLinks(page, add)],
    ['READABILITY', () => checkReadability(page, add)],
    ['EXTERNAL_LINK_REL', () => checkExternalLinkRel(page, add)],
    // ─── GEO ────────────────────────────────────────────────────────────
    ['DIRECT_ANSWER', () => checkDirectAnswer(input, page, add)],
    ['QUESTION_HEADINGS', () => checkQuestionHeadings(page, add)],
    ['FAQ', () => checkFaq(input, add)],
    ['ENTITIES', () => checkEntities(input, page, add)],
    ['SCANNABLE', () => checkScannable(page, add)],
    ['INVENTED_NAP', () => checkInventedNap(input, page, add)],
    ['SOURCES', () => checkSources(input, page, add)],
    ['AUTHOR_DATE', () => checkAuthorDate(page, add)],
    ['ARTICLE_SCHEMA', () => checkArticleSchema(input, add)],
    ['DEFINITION', () => checkDefinition(page, add)],
    // ─── Quality: written for the reader ────────────────────────────────
    ['RAW_KEYWORD', () => checkRawKeywords(page, add)],
    ['SELF_REFERENCE', () => checkSelfReference(input, page, add)],
    ['REPEATED_LABEL', () => checkRepeatedLabels(page, add)],
    ['FAKE_QUESTION', () => checkFakeQuestions(input, page, add)],
  ]

  for (const [name, rule] of rules) {
    try {
      rule()
    } catch (error) {
      add('AUDIT_ERROR', 'seo', 'warning', `Règle ${name} non évaluée : ${errorText(error)}`)
    }
  }

  return findings
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Add = (code: string, source: AuditSource, severity: AuditSeverity, message: string) => void

// ─── Page analysis, done once ───────────────────────────────────────────────

interface Heading {
  level: number
  text: string
}

interface Anchor {
  href: string | null
  target: string | null
  rel: string | null
  inner: string
}

interface PageAnalysis {
  /** The whole HTML, engine blocks included — what links are judged on. */
  html: string
  /** The article alone: navigation blocks injected by the linker removed. */
  editorial: string
  headings: Heading[]
  paragraphs: string[]
  anchors: Anchor[]
  /** Visible text of the article, as written. */
  text: string
  /** Visible text of the article, normalised (lowercase, no accent, no punctuation). */
  normalized: string
  words: number
  keyword: KeywordProfile
}

interface KeywordProfile {
  /** The focus keyword's significant words: stop words and city words removed. */
  tokens: Array<{ word: string; stem: string }>
  /** The exact phrase, normalised. */
  phrase: string
  cityPhrase: string
}

function analysePage(input: SeoAuditInput): PageAnalysis {
  const html = input.html || ''
  const editorial = withoutEngineBlocks(html)
  const text = stripHtml(editorial)
  const normalized = normalizeText(text)

  return {
    html,
    editorial,
    headings: headingsOf(editorial),
    paragraphs: paragraphsOf(editorial),
    anchors: anchorsOf(html),
    text,
    normalized,
    words: countWords(text),
    keyword: keywordProfile(input.focusKeyword, input.city),
  }
}

/**
 * The blocks the linker adds are OUR boilerplate, not the article.
 *
 * The "see also" `<nav>` carries a `<ul>` and an `<h3>`; the pillar hub carries a
 * `<ul>` and an `<h2>`. Counting them would let a page pass SCANNABLE or H2_COUNT
 * on the strength of its own navigation — the same reason the length is measured
 * before linking. The « Source : … » lines it appends for sources no sentence
 * named are boilerplate too: three of them would read as a repeated label the
 * model never wrote and could never remove.
 */
function withoutEngineBlocks(html: string): string {
  return html
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<section\b[^>]*class\s*=\s*["'][^"']*\bpillar-hub\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, ' ')
    .replace(/<p\b[^>]*class\s*=\s*["'][^"']*\bexternal-ref\b[^"']*["'][^>]*>[\s\S]*?<\/p\s*>/gi, ' ')
}

function headingsOf(html: string): Heading[] {
  const headings: Heading[] = []
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    headings.push({ level: Number(match[1]), text: stripHtml(match[2]) })
  }
  return headings
}

function paragraphsOf(html: string): string[] {
  const paragraphs: string[] = []
  const pattern = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    paragraphs.push(stripHtml(match[1]))
  }
  return paragraphs
}

function anchorsOf(html: string): Anchor[] {
  const anchors: Anchor[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    anchors.push({
      href: attribute(match[1], 'href'),
      target: attribute(match[1], 'target'),
      rel: attribute(match[1], 'rel'),
      inner: match[2],
    })
  }
  return anchors
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
  if (!match) return null
  return match[1] ?? match[2] ?? match[3] ?? ''
}

// ─── Text normalisation ─────────────────────────────────────────────────────

/** Lowercase, accents and punctuation removed, single spaces. */
export function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokensOf(text: string): string[] {
  const normalized = normalizeText(text)
  return normalized ? normalized.split(' ') : []
}

/**
 * A deliberately crude French stem: plural mark, then trailing e's.
 *
 * Applied to BOTH sides of every comparison, so it only has to be consistent,
 * not linguistically right: "plombiers" and "plombier", "conventionnée" and
 * "conventionne" meet; nothing that differs by more than an ending does.
 */
function stem(token: string): string {
  if (token.length <= 3) return token
  let out = token.replace(/[sx]$/, '')
  while (out.length > 3 && out.endsWith('e')) out = out.slice(0, -1)
  return out
}

const STOPWORDS = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'chez', 'd', 'dans', 'de', 'des', 'du',
  'en', 'entre', 'et', 'l', 'la', 'le', 'les', 'leur', 'leurs', 'ma', 'mes', 'mon', 'ne', 'nos',
  'notre', 'ou', 'par', 'pas', 'pour', 'qu', 'que', 'qui', 'sa', 'sans', 'se', 'ses', 'son', 'sous',
  'sur', 'ta', 'tes', 'ton', 'un', 'une', 'vers', 'vos', 'votre', 'y', 'est', 'sont', 'il', 'elle',
  'on', 'nous', 'vous', 'ils', 'elles', 'n', 's', 'c', 'j', 'm', 't', 'the', 'of', 'and',
])

function keywordProfile(focusKeyword: string, city: string | undefined): KeywordProfile {
  const cityStems = new Set(tokensOf(city ?? '').map(stem))
  const seen = new Set<string>()
  const tokens: KeywordProfile['tokens'] = []

  for (const word of tokensOf(focusKeyword)) {
    if (word.length < 2 || STOPWORDS.has(word)) continue
    const wordStem = stem(word)
    if (cityStems.has(wordStem) || seen.has(wordStem)) continue
    seen.add(wordStem)
    tokens.push({ word, stem: wordStem })
  }

  return { tokens, phrase: normalizeText(focusKeyword), cityPhrase: normalizeText(city ?? '') }
}

interface Coverage {
  ratio: number
  missing: string[]
}

function coverageIn(keyword: KeywordProfile, text: string): Coverage {
  if (keyword.tokens.length === 0) return { ratio: 1, missing: [] }
  const present = new Set(tokensOf(text).map(stem))
  const missing = keyword.tokens.filter(token => !present.has(token.stem)).map(token => token.word)
  return { ratio: (keyword.tokens.length - missing.length) / keyword.tokens.length, missing }
}

/** Non-overlapping occurrences of a normalised phrase in a normalised text, on word boundaries. */
function occurrences(normalizedText: string, normalizedPhrase: string): number {
  if (!normalizedPhrase) return 0
  const haystack = ` ${normalizedText} `
  const needle = ` ${normalizedPhrase} `
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count++
    // Step back over the trailing space so "a a a" counts every "a".
    from = at + needle.length - 1
  }
}

function contains(normalizedText: string, phrase: string): boolean {
  return occurrences(normalizedText, normalizeText(phrase)) > 0
}

function excerpt(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`
}

function chars(value: string): number {
  return [...(value || '').trim()].length
}

// ─── SEO checks ─────────────────────────────────────────────────────────────

function checkTitleLength(input: SeoAuditInput, add: Add): void {
  const length = chars(input.title)
  if (length < T.titleMin || length > T.titleMax) {
    add('TITLE_LENGTH', 'seo', 'blocking',
      `Title de ${length} caractères, hors de la plage ${T.titleMin}-${T.titleMax} : réécrire le title `
      + `entre 50 et ${T.titleComfortMax} caractères, mot-clé principal en tête.`)
  } else if (length > T.titleComfortMax) {
    add('TITLE_LENGTH', 'seo', 'warning',
      `Title de ${length} caractères : au-delà de ${T.titleComfortMax}, Google le tronque souvent — viser 50 à ${T.titleComfortMax}.`)
  }
}

function checkMetaLength(input: SeoAuditInput, add: Add): void {
  const length = chars(input.metaDescription)
  if (length < T.metaMin || length > T.metaMax) {
    add('META_LENGTH', 'seo', 'blocking',
      `Meta description de ${length} caractères, hors de la plage ${T.metaMin}-${T.metaMax} : la réécrire entre `
      + `${T.metaComfortMin} et ${T.metaComfortMax} caractères avec le mot-clé, la ville, un bénéfice et un appel à l'action.`)
  } else if (length < T.metaComfortMin || length > T.metaComfortMax) {
    add('META_LENGTH', 'seo', 'warning',
      `Meta description de ${length} caractères : viser ${T.metaComfortMin} à ${T.metaComfortMax} pour un extrait complet sans troncature.`)
  }
}

function checkKeywordPlacement(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const keyword = page.keyword
  if (keyword.tokens.length === 0) return
  const quoted = `« ${(input.focusKeyword ?? '').trim()} »`

  // No H1 at all is MISSING_H1, reported by the gate. Saying "the H1 lacks the
  // keyword" on top would ask the model to fix a heading that does not exist.
  const h1 = page.headings.find(heading => heading.level === 1)
  if (h1) {
    const coverage = coverageIn(keyword, h1.text)
    if (coverage.ratio < T.keywordCoverage) {
      add('H1_KEYWORD', 'seo', 'blocking',
        `Le H1 « ${excerpt(h1.text)} » ne reprend que ${percent(coverage.ratio)} du mot-clé ${quoted} `
        + `(minimum ${percent(T.keywordCoverage)}) : réécrire le H1 en y plaçant ${coverage.missing.join(', ')}.`)
    }
  }

  const titleCoverage = coverageIn(keyword, input.title)
  if (titleCoverage.ratio < T.keywordCoverage) {
    add('TITLE_KEYWORD', 'seo', 'blocking',
      `Le title ne reprend que ${percent(titleCoverage.ratio)} du mot-clé ${quoted} `
      + `(minimum ${percent(T.keywordCoverage)}) : réécrire le title en y plaçant ${titleCoverage.missing.join(', ')}.`)
  }

  const intro = tokensOf(stripHtml(page.editorial.replace(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/gi, ' ')))
    .slice(0, T.introWords)
    .join(' ')
  const introCoverage = coverageIn(keyword, intro)
  if (introCoverage.ratio < T.keywordCoverage) {
    add('INTRO_KEYWORD', 'seo', 'blocking',
      `Les ${T.introWords} premiers mots du texte (hors H1) ne reprennent que ${percent(introCoverage.ratio)} du mot-clé `
      + `${quoted} : citer ${introCoverage.missing.join(', ')} dès la réponse directe qui ouvre la page.`)
  }
}

function checkHeadingHierarchy(page: PageAnalysis, add: Add): void {
  const problems: string[] = []
  const h1Count = page.headings.filter(heading => heading.level === 1).length
  if (h1Count > 1) problems.push(`${h1Count} H1 dans la page`)

  let seenH2 = false
  let previous: number | null = null
  for (const heading of page.headings) {
    if (heading.level === 2) seenH2 = true
    if (heading.level >= 3 && !seenH2) {
      problems.push(`H${heading.level} « ${excerpt(heading.text, 50)} » placé avant tout H2`)
    } else if (previous !== null && heading.level > previous + 1) {
      problems.push(`saut de H${previous} à H${heading.level} (« ${excerpt(heading.text, 50)} »)`)
    }
    previous = heading.level
  }

  if (problems.length > 0) {
    add('HEADING_HIERARCHY', 'seo', 'blocking',
      `Plan de titres incorrect — ${problems.slice(0, 3).join(' ; ')} : un seul H1, puis des H2, `
      + `des H3 uniquement sous un H2, jamais de niveau sauté.`)
  }
}

function checkH2Count(page: PageAnalysis, add: Add): void {
  const required = page.words > T.h2LongPageWords ? T.h2MinLong : T.h2MinShort
  const h2 = page.headings.filter(heading => heading.level === 2).length
  if (h2 < required) {
    add('H2_COUNT', 'seo', 'blocking',
      `${h2} H2 pour ${page.words} mots (minimum ${required}) : découper le contenu en au moins ${required} `
      + `sections H2 qui couvrent chacune un sous-sujet.`)
  }
}

function checkKeywordStuffing(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const phrase = page.keyword.phrase
  if (!phrase || page.words === 0) return
  const quoted = `« ${(input.focusKeyword ?? '').trim()} »`

  const totalWords = page.normalized ? page.normalized.split(' ').length : 0
  const count = occurrences(page.normalized, phrase)
  const density = totalWords > 0 ? count / totalWords : 0
  if (density > T.keywordDensityMax) {
    add('KEYWORD_STUFFING', 'seo', 'blocking',
      `L'expression exacte ${quoted} apparaît ${count} fois (${(density * 100).toFixed(1)} % des mots, maximum `
      + `${percent(T.keywordDensityMax)}) : remplacer une partie des répétitions par des synonymes et des variantes.`)
    return
  }

  const h2 = page.headings.filter(heading => heading.level === 2)
  if (h2.length < 2) return
  const repeated = h2.filter(heading => occurrences(normalizeText(heading.text), phrase) > 0).length
  if (repeated / h2.length > T.keywordInH2Max) {
    add('KEYWORD_STUFFING', 'seo', 'blocking',
      `L'expression exacte ${quoted} est répétée dans ${repeated} H2 sur ${h2.length} (maximum ${percent(T.keywordInH2Max)}) : `
      + `la garder dans un seul H2 et formuler les autres avec des variantes ou des questions.`)
  }
}

function checkInternalLinks(input: SeoAuditInput, add: Add): void {
  if (input.knownInternalPathsCount === undefined || input.internalLinksKept === undefined) return
  if (input.internalLinksKept >= T.internalLinksMin) return

  if (input.knownInternalPathsCount >= T.internalLinksSiteMin) {
    add('INTERNAL_LINKS', 'seo', 'blocking',
      `${input.internalLinksKept} lien(s) interne(s) valide(s) pour un site de ${input.knownInternalPathsCount} pages `
      + `(minimum ${T.internalLinksMin}) : lier dans le texte au moins ${T.internalLinksMin} pages existantes du site `
      + `parmi celles qui sont proposées, avec une ancre descriptive.`)
  } else {
    add('INTERNAL_LINKS', 'seo', 'warning',
      `${input.internalLinksKept} lien(s) interne(s) valide(s) : le site ne compte que ${input.knownInternalPathsCount} page(s), `
      + `le maillage se renforcera avec les prochaines publications.`)
  }
}

function checkImageAlt(page: PageAnalysis, add: Add): void {
  const images = page.html.match(/<img\b[^>]*>/gi) ?? []
  const missing = images.filter(tag => !(attribute(tag, 'alt') ?? '').trim()).length
  if (missing > 0) {
    add('IMAGE_ALT', 'seo', 'blocking',
      `${missing} image(s) sans texte alternatif : donner à chaque <img> un attribut alt descriptif `
      + `qui décrit l'image et, quand c'est naturel, le service et la ville.`)
  }
}

function checkSlug(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const slug = (input.slug || '').trim().replace(/^\/+|\/+$/g, '')
  const wellFormed = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)

  const slugStems = new Set(slug.split('-').map(stem))
  const citySlug = page.keyword.cityPhrase.replace(/ /g, '-')
  const hasTopic = page.keyword.tokens.length > 0 || citySlug.length > 0
  const namesKeyword = page.keyword.tokens.some(token => slugStems.has(token.stem))
  const namesCity = citySlug.length > 0 && `-${slug}-`.includes(`-${citySlug}-`)

  if (!wellFormed) {
    add('SLUG_FORMAT', 'seo', 'blocking',
      `Adresse « ${slug || '(vide)'} » mal formée : uniquement des minuscules sans accent, des chiffres et des tirets simples.`)
  } else if (hasTopic && !namesKeyword && !namesCity) {
    add('SLUG_FORMAT', 'seo', 'blocking',
      `L'adresse « ${slug} » ne contient ni un mot du mot-clé « ${(input.focusKeyword ?? '').trim()} » ni la ville : `
      + `l'adresse doit nommer le sujet de la page.`)
  }
}

/**
 * Placeholders a model leaves behind when it lacks a value.
 *
 * « à compléter » and « insérer » are matched only in a placeholder SHAPE —
 * bracketed, parenthesised, capitalised, or followed by « ici ». Plain French
 * uses both legitimately (« le formulaire à compléter auprès de la CPAM »,
 * « insérer le joint dans la gorge ») and refusing those sentences would send a
 * correct page back for a rewrite it cannot understand.
 */
const PLACEHOLDER_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /lorem ipsum/i, label: 'lorem ipsum' },
  { pattern: /\[\s*(?:votre|vos|your)\b/i, label: '[VOTRE…]' },
  // The OPENING braces only: "}}" closes every nested JSON object, and an
  // inline JSON-LD block would trip a rule that looked for it.
  { pattern: /\{\{/, label: '{{…}}' },
  { pattern: /\bTODO\b/, label: 'TODO' },
  { pattern: /\bX{3,}\b/, label: 'XXX' },
  { pattern: /[[(]\s*[àaÀA]\s+compl[ée]ter|[àaÀA]\s+compl[ée]ter\s*[\])]|[ÀA]\s+COMPL[ÉE]TER/, label: 'à compléter' },
  { pattern: /[[(]\s*ins[ée]r|ins[ée]re[rz]\s+ici/i, label: 'insérer' },
  { pattern: /INS[ÉE]RER/, label: 'INSÉRER' },
]

function checkPlaceholders(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  // The markup is searched for a template token too — `href="{{lien}}"` is
  // invisible in the text — but never inside a <script>, where JSON lives.
  const markup = page.html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
  const haystack = [input.title, input.metaDescription, stripHtml(page.html), /\{\{/.test(markup) ? '{{' : '']
    .join('\n')
  const found = PLACEHOLDER_PATTERNS.filter(({ pattern }) => pattern.test(haystack)).map(({ label }) => label)
  if (found.length > 0) {
    add('PLACEHOLDER', 'seo', 'blocking',
      `Texte provisoire laissé dans la page (${found.join(', ')}) : remplacer chaque espace réservé par un contenu `
      + `réel, ou supprimer la phrase si l'information n'est pas fournie.`)
  }
}

function checkDuplicateParagraphs(page: PageAnalysis, add: Add): void {
  const seen = new Set<string>()
  for (const paragraph of page.paragraphs) {
    const normalized = normalizeText(paragraph)
    if (!normalized || normalized.split(' ').length < T.duplicateParagraphMinWords) continue
    if (seen.has(normalized)) {
      add('DUPLICATE_PARAGRAPH', 'seo', 'blocking',
        `Paragraphe répété mot pour mot (« ${excerpt(paragraph)} ») : supprimer la répétition et écrire `
        + `un contenu propre à chaque section.`)
      return
    }
    seen.add(normalized)
  }
}

function checkEmptyLinks(page: PageAnalysis, add: Add): void {
  const empty = page.anchors.filter(anchor => {
    // No href at all is a named anchor (`<a id="faq"></a>`), a jump target and
    // not a link: there is nothing for a crawler to follow, nor to find empty.
    if (anchor.href === null) return false
    const href = anchor.href.trim()
    const noTarget = href === '' || href === '#'
    const hasImageText = /<img\b[^>]*\balt\s*=\s*["'][^"']*\S[^"']*["']/i.test(anchor.inner)
    const noText = stripHtml(anchor.inner).trim() === '' && !hasImageText
    return noTarget || noText
  }).length

  if (empty > 0) {
    add('EMPTY_LINK', 'seo', 'blocking',
      `${empty} lien(s) vide(s) (sans adresse ou sans texte) : donner à chaque lien une URL réelle et une ancre `
      + `descriptive, ou le supprimer.`)
  }
}

function checkReadability(page: PageAnalysis, add: Add): void {
  const long = page.paragraphs.filter(paragraph => countWords(paragraph) > T.paragraphMaxWords).length
  if (long > 0) {
    add('LONG_PARAGRAPH', 'seo', 'warning',
      `${long} paragraphe(s) de plus de ${T.paragraphMaxWords} mots : les scinder pour la lecture sur mobile.`)
  }

  const sentences = page.paragraphs
    .flatMap(paragraph => paragraph.split(/(?<=[.!?…])\s+/))
    .map(sentence => countWords(sentence))
    .filter(words => words > 0)
  if (sentences.length === 0) return
  const average = sentences.reduce((sum, words) => sum + words, 0) / sentences.length
  if (average > T.sentenceAvgMaxWords) {
    add('LONG_SENTENCES', 'seo', 'warning',
      `Phrases de ${Math.round(average)} mots en moyenne (maximum conseillé ${T.sentenceAvgMaxWords}) : raccourcir les phrases.`)
  }
}

function checkExternalLinkRel(page: PageAnalysis, add: Add): void {
  const unsafe = page.anchors.filter(anchor => {
    if ((anchor.target ?? '').toLowerCase() !== '_blank') return false
    const rel = (anchor.rel ?? '').toLowerCase()
    return !/\bnoopener\b|\bnoreferrer\b/.test(rel)
  }).length
  if (unsafe > 0) {
    add('EXTERNAL_LINK_REL', 'seo', 'warning',
      `${unsafe} lien(s) target="_blank" sans rel="noopener" : ajouter rel="noopener noreferrer".`)
  }
}

// ─── GEO checks ─────────────────────────────────────────────────────────────

function checkDirectAnswer(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const problems: string[] = []

  const h1Close = /<\/h1\s*>/i.exec(page.editorial)
  // Without an H1 the gate already blocks on MISSING_H1; only the field is judged.
  if (h1Close) {
    const after = page.editorial.slice(h1Close.index + h1Close[0].length)
    const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(after)
    const headingFirst = paragraph ? /<h[1-6]\b/i.test(after.slice(0, paragraph.index)) : true
    const words = paragraph && !headingFirst ? countWords(stripHtml(paragraph[1])) : 0

    if (words < T.directAnswerMin || words > T.directAnswerMax) {
      problems.push(words === 0
        ? 'aucun paragraphe entre le H1 et le premier sous-titre'
        : `le premier paragraphe après le H1 compte ${words} mots (attendu ${T.directAnswerMin} à ${T.directAnswerMax})`)
    }
  }

  if (!(input.directAnswer ?? '').trim()) {
    problems.push('le champ directAnswer est vide')
  }

  if (problems.length > 0) {
    add('DIRECT_ANSWER', 'geo', 'blocking',
      `Réponse directe absente ou mal placée — ${problems.join(' ; ')} : ouvrir la page, juste sous le H1 et avant `
      + `tout H2, par un <p class="reponse-directe"> autosuffisant de 40 à 60 mots qui répond à la requête avec le `
      + `mot-clé et la ville, et le recopier mot pour mot dans directAnswer.`)
  }
}

const INTERROGATIVE_START =
  /^(?:comment|pourquoi|quand|quel|quelle|quels|quelles|combien|ou|qui|que|qu est|faut il|peut on|est ce)\b/

function isQuestion(text: string): boolean {
  if (/\?\s*$/.test(text.trim())) return true
  return INTERROGATIVE_START.test(normalizeText(text))
}

function checkQuestionHeadings(page: PageAnalysis, add: Add): void {
  const questions = page.headings
    .filter(heading => heading.level === 2 || heading.level === 3)
    .filter(heading => isQuestion(heading.text)).length
  if (questions < T.questionHeadingsMin) {
    add('QUESTION_HEADINGS', 'geo', 'blocking',
      `${questions} sous-titre(s) H2/H3 formulé(s) en question (minimum ${T.questionHeadingsMin}) : reformuler au moins `
      + `${T.questionHeadingsMin} sous-titres comme les questions que posent les internautes (Comment… ? Combien… ? `
      + `Pourquoi… ?), chacun suivi d'une réponse en deux phrases.`)
  }
}

function checkFaq(input: SeoAuditInput, add: Add): void {
  // Defensive on purpose: faqItems come straight from the model's JSON, where a
  // null entry or a numeric answer is a real possibility the type does not show.
  const visible = (input.faqItems ?? []).filter(item =>
    Boolean(item) && typeof item.q === 'string' && item.q.trim() !== ''
    && typeof item.a === 'string' && item.a.trim() !== '')
  const minimum = input.pageType === 'pillar' ? T.faqMinPillar : T.faqMin

  if (visible.length < minimum) {
    add('FAQ_MINIMUM', 'geo', 'blocking',
      `${visible.length} question(s) de FAQ (minimum ${minimum} pour une page ${input.pageType}) : ajouter des `
      + `questions réelles d'internautes avec des réponses précises, dans faqItems et dans la page.`)
  }

  const schema = parseSchema(input.schemas?.faqPage)
  // Unparseable: INVALID_JSON_LD (gate.ts) already says so; a mismatch on top
  // would ask for two fixes to one defect.
  if (schema === 'invalid') return

  const isFaqPage = schema !== null && typesOf(schema).has('FAQPage')
  if (!isFaqPage) {
    if (visible.length > 0) {
      add('FAQ_SCHEMA_MISMATCH', 'geo', 'blocking',
        `La page a ${visible.length} question(s) de FAQ mais aucun schéma FAQPage : produire un schemaFaqPage `
        + `qui reprend exactement les mêmes questions et réponses que faqItems.`)
    }
    return
  }

  const schemaQuestions = new Set(questionNamesOf(schema).map(normalizeText).filter(Boolean))
  const denominator = Math.max(visible.length, schemaQuestions.size)
  if (denominator === 0) return
  const matched = visible.filter(item => schemaQuestions.has(normalizeText(item.q))).length
  const ratio = matched / denominator
  if (ratio < T.faqSchemaMatch) {
    add('FAQ_SCHEMA_MISMATCH', 'geo', 'blocking',
      `Le schéma FAQPage ne correspond qu'à ${percent(ratio)} des questions visibles (minimum ${percent(T.faqSchemaMatch)}) : `
      + `le schemaFaqPage doit reprendre mot pour mot les questions de faqItems, ni plus ni moins.`)
  }
}

function checkEntities(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const city = page.keyword.cityPhrase
  if (city) {
    const mentions = occurrences(page.normalized, city)
    if (mentions < T.cityMentionsMin) {
      add('ENTITY_CITY', 'geo', 'blocking',
        `La ville « ${(input.city ?? '').trim()} » n'est citée que ${mentions} fois dans le texte (minimum `
        + `${T.cityMentionsMin}) : la nommer dans la réponse directe et dans au moins une section.`)
    }
  }

  const business = (input.businessName ?? '').trim()
  if (business && !contains(page.normalized, business)) {
    add('ENTITY_BUSINESS', 'geo', 'blocking',
      `L'entreprise « ${business} » n'est jamais nommée dans le texte : la citer au moins une fois `
      + `(présentation du service et bloc auteur).`)
  }

  const listed = [...new Set((input.requiredEntities ?? [])
    .filter((entity): entity is string => typeof entity === 'string')
    .map(entity => entity.trim())
    .filter(Boolean))]
  if (listed.length >= T.requiredEntitiesMinListed) {
    const bodyStems = new Set(page.normalized.split(' ').map(stem))
    const missing = listed.filter(entity => !mentionsEntity(page.normalized, bodyStems, entity))
    const ratio = (listed.length - missing.length) / listed.length
    if (ratio < T.requiredEntitiesCoverage) {
      add('REQUIRED_ENTITIES', 'geo', 'blocking',
        `Seulement ${percent(ratio)} des entités du brief sont présentes (minimum ${percent(T.requiredEntitiesCoverage)}) : `
        + `intégrer naturellement ${missing.join(', ')}.`)
    }
  }
}

/**
 * A brief's entity is present when it is written as such, OR when every one of
 * its significant words is.
 *
 * The planner writes its entities as a model does — « centre hospitalier
 * Simone-Veil », « code postal 10000 » — and a page that says « l'hôpital
 * Simone-Veil, centre hospitalier de Troyes » has named the entity. Exact
 * phrase matching alone would refuse it, and send back for a rewrite a page
 * that did what it was asked.
 */
function mentionsEntity(normalizedBody: string, bodyStems: ReadonlySet<string>, entity: string): boolean {
  if (contains(normalizedBody, entity)) return true
  const words = tokensOf(entity).filter(word => word.length > 1 && !STOPWORDS.has(word))
  return words.length > 0 && words.every(word => bodyStems.has(stem(word)))
}

function checkScannable(page: PageAnalysis, add: Add): void {
  if (!/<(?:ul|ol|table)\b/i.test(page.editorial)) {
    add('SCANNABLE', 'geo', 'blocking',
      `Aucune liste ni tableau dans le contenu : présenter au moins les étapes, les critères ou les points clés `
      + `sous forme de liste <ul>/<ol> ou de tableau.`)
  }
}

const FRENCH_PHONE = /(?:\+33\s?\(?0?\)?\s?[1-9]|\b0[1-9])(?:[\s.-]?\d{2}){4}\b/
const STREET_ADDRESS = /\b\d{1,4}\s*(?:bis\s+|ter\s+)?(?:rue|avenue|boulevard|chemin|impasse|place|all[ée]e)\b/i

function checkInventedNap(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  if (input.hasGoogleBusinessProfile !== false) return

  const text = stripHtml(page.html)
  const found: string[] = []
  if (FRENCH_PHONE.test(text)) found.push('un numéro de téléphone')
  if (STREET_ADDRESS.test(text)) found.push('une adresse postale')

  // The same NAP written into the LocalBusiness schema is the same invention,
  // and the generator is told so in the same sentence of its prompt.
  const business = parseSchema(input.schemas?.localBusiness)
  if (business && business !== 'invalid') {
    if (hasNonEmptyProperty(business, 'telephone')) found.push('un téléphone dans le schéma LocalBusiness')
    if (hasNonEmptyProperty(business, 'streetAddress')) found.push('une adresse dans le schéma LocalBusiness')
  }

  if (found.length > 0) {
    add('INVENTED_NAP', 'geo', 'blocking',
      `Aucune fiche Google Business Profile n'est connectée, et la page contient ${found.join(', ')} : `
      + `supprimer tout téléphone et toute adresse, du texte comme des schémas — ces données ne sont pas fournies.`)
  }
}

function checkSources(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  if (input.enableExternalLinks !== true) return
  const siteHost = hostOf(input.siteUrl ?? '')
  const external = page.anchors.some(anchor => {
    const href = (anchor.href ?? '').trim()
    if (!/^https:\/\//i.test(href)) return false
    const host = hostOf(href)
    return host !== '' && host !== siteHost
  })
  if (!external) {
    add('SOURCES', 'geo', 'blocking',
      `Aucun lien externe https vers une source : citer au moins une source officielle réellement existante `
      + `(service-public.fr, legifrance.gouv.fr, organisme ou fédération du métier) dans externalLinks.`)
  }
}

function checkAuthorDate(page: PageAnalysis, add: Add): void {
  const hasBlock = /class\s*=\s*["'][^"']*\bpage-auteur\b/i.test(page.html) || /<time\b/i.test(page.html)
  const hasLine = /\b(?:publi[ée]e?|mise? [àa] jour|r[ée]dig[ée]e?)\s+(?:par|le)\b/i.test(stripHtml(page.html))
  if (!hasBlock && !hasLine) {
    add('AUTHOR_DATE', 'geo', 'warning',
      `Aucune ligne auteur/date visible : ajouter « Publié par <entreprise> — mis à jour le <time datetime>… ».`)
  }
}

const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'WebPage'])

function checkArticleSchema(input: SeoAuditInput, add: Add): void {
  const schema = parseSchema(input.schemas?.article)
  const typed = schema !== null && schema !== 'invalid'
    && [...typesOf(schema)].some(type => ARTICLE_TYPES.has(type))
  if (!typed || !hasNonEmptyProperty(schema, 'datePublished')) {
    add('ARTICLE_SCHEMA', 'geo', 'warning',
      `Pas de schéma Article/WebPage avec datePublished : fournir un schemaArticle complet (auteur, éditeur, dates).`)
  }
}

function checkDefinition(page: PageAnalysis, add: Add): void {
  const window = tokensOf(stripHtml(page.editorial.replace(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/gi, ' ')))
    .slice(0, T.definitionWindowWords)
    .join(' ')
  const defines = /\b(?:est|sont) (?:un|une|le|la|les|l|des|du|d)\b/.test(window)
    || /\bon appelle\b|\bdesignen?t?\b|\bse definit\b|\bconsiste (?:a|en)\b/.test(window)
  if (!defines) {
    add('DEFINITION', 'geo', 'warning',
      `Aucune phrase de définition dans les ${T.definitionWindowWords} premiers mots : définir le sujet `
      + `(« Un … est … ») pour que la page puisse être citée comme réponse.`)
  }
}

// ─── Quality checks: written for the reader ─────────────────────────────────
//
// Each rule measures a tell a published page carried, and only in a shape plain
// French does not take. A false positive here sends a correct page back for a
// rewrite it cannot understand, which is worse than letting one tell through:
// these rules trade recall for precision, on purpose.

/** Passages in quotes are deliberate: a page may cite a query « comme ceci ». */
function unquoted(text: string): string {
  return text.replace(/«[^»]{0,200}»|“[^”]{0,200}”|"[^"\n]{0,200}"/g, ' ')
}

function stripAccents(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Acronyms a search query carries in lowercase.
 *
 * None is a French word and French prose capitalises every one, so a lowercase
 * "seo" or "ia" between two words is a query pasted as typed — « consultant seo
 * reims », « l'automatisation ia ». Never inside a domain, an address or a
 * hyphenated name: `seo-troyes.fr` is not prose.
 */
const LOWERCASE_ACRONYM =
  /(?<![\p{L}\p{N}\-./@_])(seo|sea|ia|pme|tpe|eti|crm|erp|gbp|rgpd|tva|cms|vtc|cpam|btp|sap|saas|b2b|b2c)(?![\p{L}\p{N}\-/@_]|\.[\p{L}\p{N}])/gu

/**
 * Words that are French with AND without their accent, so never evidence alone.
 * Words of three letters or fewer (a/à, ou/où, la/là, du/dû, sur/sûr) are not
 * even looked at.
 */
const ACCENT_HOMOGRAPHS = new Set([
  'cote', 'cotes', 'tache', 'taches', 'tacher', 'jeune', 'jeunes', 'foret', 'forets', 'notre', 'votre',
  'mure', 'mures', 'roder', 'pale', 'pales', 'denier', 'reformer', 'repartir', 'reparti', 'repartie', 'repartis',
])

/**
 * Accents whose absence proves nothing: a final é (« utilise » and « utilisé »,
 * « marche » and « marché » are both French) and the î and û the 1990 spelling
 * reform made optional (« cout », « boite »).
 */
function onlyBenignAccents(accented: string): boolean {
  const reduced = accented.replace(/é(e?s?)$/, 'e$1').replace(/î/g, 'i').replace(/û/g, 'u')
  return stripAccents(reduced) === reduced
}

/**
 * Lowercase words the same page also writes WITH their accents.
 *
 * Judged against the page itself rather than a dictionary: six « référencement »
 * and one « referencement site internet » is not a typo the writer cannot spell,
 * it is a query copied as Search Console reports it.
 */
function unaccentedTwins(text: string): string[] {
  const accented = new Map<string, Set<string>>()
  const plain = new Set<string>()
  for (const token of text.match(/\p{L}+/gu) ?? []) {
    if (token.length < 4) continue
    const lower = token.toLowerCase()
    const bare = stripAccents(lower)
    if (bare !== lower) {
      const forms = accented.get(bare) ?? new Set<string>()
      forms.add(lower)
      accented.set(bare, forms)
    } else if (token === lower) {
      // Capitalised forms are left out: a brand may drop its accents.
      plain.add(lower)
    }
  }

  const found: string[] = []
  for (const word of plain) {
    if (ACCENT_HOMOGRAPHS.has(word)) continue
    const twin = [...(accented.get(word) ?? [])].find(form => !onlyBenignAccents(form))
    if (twin) found.push(`« ${word} » au lieu de « ${twin} »`)
  }
  return found
}

function checkRawKeywords(page: PageAnalysis, add: Add): void {
  const text = unquoted(page.text)
  const found = [
    ...unaccentedTwins(text),
    ...[...new Set([...text.matchAll(LOWERCASE_ACRONYM)].map(match => match[1]))]
      .map(acronym => `« ${acronym} » au lieu de « ${acronym.toUpperCase()} »`),
    ...(/\bpres de (?:moi|chez moi)\b/.test(normalizeText(text)) ? ['« près de moi », une recherche et pas une phrase'] : []),
  ]
  if (found.length > 0) {
    add('RAW_KEYWORD', 'quality', 'blocking',
      `Requête recopiée telle quelle dans le texte (${found.slice(0, 4).join(', ')}) : un mot-clé s'écrit en français `
      + `correct — accents, articles, majuscules (« création de site internet », « SEO », « IA ») — dans une phrase `
      + `qu'un lecteur pourrait dire, et jamais en suite de mots-clés.`)
  }
}

/**
 * The page describing its own SEO to the visitor.
 *
 * Matched on what the page says about ITSELF — « cette page pilier », « une page
 * pilier comme celle-ci » — never on SEO vocabulary alone: on a site that sells
 * SEO, « maillage interne » and « page pilier » are the subject, and advising the
 * reader about HIS site is exactly what the page is for.
 */
const SELF_REFERENCES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:cette|la presente|notre) page (?:pilier|fille|satellite|hub|mere)\b/, label: '« cette page pilier »' },
  { pattern: /\bpages? (?:pilier|fille|satellite)s? comme (?:celle|celui) ci\b/, label: '« une page pilier comme celle-ci »' },
  { pattern: /\b(?:ce|notre) (?:cluster|silo|cocon semantique)\b/, label: '« ce cluster »' },
  { pattern: /\b(?:cette|la presente) page (?:est |a ete )?(?:optimisee|ciblee|positionnee|referencee)\b/, label: '« cette page est optimisée »' },
  { pattern: /\b(?:cet|ce) (?:article|contenu|texte|guide) (?:est |a ete )?(?:optimise|cible)\b/, label: '« ce contenu est optimisé »' },
  { pattern: /\b(?:cette|notre) (?:page|approche|section|demarche) (?:reste|est) (?:informationnelle|transactionnelle|navigationnelle)\b/, label: '« cette approche reste informationnelle »' },
  { pattern: /\bpos \d+\b/, label: 'une position Search Console (« pos 4 »)' },
]

/**
 * A sentence reporting the site's OWN Search Console to the visitor.
 *
 * All three are required — the tool, this site (its name, « notre site »), and
 * a verb reporting what the data shows — and a sentence about the READER's data
 * (« vos requêtes », « votre Search Console ») never counts: on an SEO agency's
 * site, explaining the tool is legitimate.
 */
function quotesOwnSearchConsole(text: string, businessName: string): boolean {
  const business = normalizeText(businessName)
  return text.split(/(?<=[.!?…])\s+/).some(sentence => {
    const words = ` ${normalizeText(sentence)} `
    if (!words.includes(' search console ') || / (?:votre|vos) /.test(words)) return false
    const aboutThisSite = (business !== '' && words.includes(` ${business} `)) || / (?:notre|ce) site /.test(words)
    return aboutThisSite && / (?:montre|indique|revele|signal|observe|remonte)\w* /.test(words)
  })
}

function checkSelfReference(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const normalized = normalizeText(unquoted(page.text))
  const found = SELF_REFERENCES.filter(({ pattern }) => pattern.test(normalized)).map(({ label }) => label)
  if (quotesOwnSearchConsole(page.text, input.businessName ?? '')) found.push('les données Search Console du site')
  if (found.length > 0) {
    add('SELF_REFERENCE', 'quality', 'blocking',
      `La page parle d'elle-même ou des données du site (${found.join(', ')}) : le lecteur n'a pas à connaître la `
      + `stratégie de référencement ni la Search Console — supprimer ces phrases et parler de son besoin à lui.`)
  }
}

/** Labels that are a template's, whatever the page: one is already one too many. */
const FORMULAIC_LABEL =
  /^(?:reponse (?:courte|rapide|directe|breve)|en (?:bref|resume|clair|pratique)|a retenir|le saviez vous|bon a savoir|l essentiel)$/

/** « Réponse courte : … » → « Réponse courte ». At most four words, or it is a sentence. */
function paragraphLabel(paragraph: string): string | null {
  const match = /^\s*(\p{L}[\p{L}'’ -]{0,38}?)\s*:\s+\S/u.exec(paragraph)
  if (!match) return null
  const label = match[1].trim()
  return label.split(/\s+/).length <= 4 ? label : null
}

function checkRepeatedLabels(page: PageAnalysis, add: Add): void {
  const counts = new Map<string, { label: string; count: number }>()
  for (const paragraph of page.paragraphs) {
    const label = paragraphLabel(paragraph)
    if (!label) continue
    const key = normalizeText(label)
    const entry = counts.get(key) ?? { label, count: 0 }
    entry.count++
    counts.set(key, entry)
  }

  const formulaic = [...counts].find(([key, entry]) => FORMULAIC_LABEL.test(key) && entry.count > T.formulaicLabelMax)
  if (formulaic) {
    const { label, count } = formulaic[1]
    add('REPEATED_LABEL', 'quality', 'blocking',
      `« ${label} : » ouvre ${count} paragraphes : c'est une formule de gabarit. Répondre directement, sans étiquette, `
      + `et varier l'entrée en matière d'une section à l'autre.`)
    return
  }

  const repeated = [...counts.values()].find(entry => entry.count > T.repeatedLabelMax)
  if (repeated) {
    add('REPEATED_LABEL', 'quality', 'warning',
      `« ${repeated.label} : » ouvre ${repeated.count} paragraphes : varier l'entrée en matière pour que la page ne `
      + `se lise pas comme un formulaire.`)
  }
}

const QUESTION_WORD =
  /\b(?:comment|pourquoi|quand|quel|quelle|quels|quelles|combien|qui|que|quoi|lequel|laquelle|lesquels|lesquelles|est ce|faut il|peut on)\b/
const SUBJECT_START = /^(?:vous|tu|on|il|elle|ils|elles|nous|c est|ca|et si|est ce)\b/
const INVERSION = /-(?:t-)?(?:il|elle|on|ils|elles|je|tu|nous|vous|ce)\b/i
/** « où », and the « ou » of an alternative (« Agence ou freelance ? »). Unaccented \b cannot see the ù. */
const OU = /(?:^|[\s'’(])o[uù](?=$|[\s,.!?)])/i

/**
 * A title ending in « ? » that a French reader takes for a question.
 *
 * Judged on the clause that carries the « ? » — « Fuite à Troyes : quel plombier
 * appeler ? » is a question — and generous: an interrogative word, an inversion,
 * an alternative, or a subject pronoun (« Vous cherchez… ? ») all qualify. What
 * remains is a noun phrase with a « ? » appended, which the old prompt's
 * "format QUESTION" produced: « Stratégie de référencement pour PME à Troyes ? ».
 */
export function isWellFormedQuestion(text: string): boolean {
  const raw = (text || '').trim()
  if (!/\?\s*$/.test(raw)) return false
  if (INVERSION.test(raw)) return true
  const clause = raw.replace(/\?\s*$/, '').split(/\s[:;—–]\s|,\s/).pop() ?? raw
  if (OU.test(clause)) return true
  const normalized = normalizeText(clause)
  return QUESTION_WORD.test(normalized) || SUBJECT_START.test(normalized)
}

function checkFakeQuestions(input: SeoAuditInput, page: PageAnalysis, add: Add): void {
  const h1 = page.headings.find(heading => heading.level === 1)
  const fake = ([['title', input.title], ['H1', h1?.text]] as const)
    .filter(([, text]) => /\?\s*$/.test((text ?? '').trim()) && !isWellFormedQuestion(text ?? ''))
  if (fake.length > 0) {
    const [which, text] = fake[0]
    add('FAKE_QUESTION', 'quality', 'blocking',
      `Le ${which} « ${excerpt(text ?? '')} » se termine par « ? » sans être une question : écrire une vraie question `
      + `(« Comment… ? », « Quel… ? », « Faut-il… ? ») ou retirer le point d'interrogation.`)
  }
}

// ─── JSON-LD helpers ────────────────────────────────────────────────────────

type Schema = unknown

/** null = absent (the generator writes '{}' for "none"), 'invalid' = unparseable. */
function parseSchema(raw: string | undefined): Schema | null | 'invalid' {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '' || trimmed === '{}' || trimmed === '[]' || trimmed === 'null') return null
  try {
    return JSON.parse(trimmed) as Schema
  } catch {
    return 'invalid'
  }
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  visit(node)
  for (const nested of Object.values(node)) {
    if (nested && typeof nested === 'object') walk(nested, visit)
  }
}

function typesOf(schema: Schema): Set<string> {
  const types = new Set<string>()
  walk(schema, node => {
    const type = node['@type']
    if (typeof type === 'string') types.add(type)
    else if (Array.isArray(type)) for (const entry of type) if (typeof entry === 'string') types.add(entry)
  })
  return types
}

function questionNamesOf(schema: Schema): string[] {
  const names: string[] = []
  walk(schema, node => {
    const type = node['@type']
    const isQuestionNode = type === 'Question' || (Array.isArray(type) && type.includes('Question'))
    if (isQuestionNode && typeof node.name === 'string') names.push(node.name)
  })
  return names
}

function hasNonEmptyProperty(schema: Schema, property: string): boolean {
  let found = false
  walk(schema, node => {
    const value = node[property]
    if (typeof value === 'string' && value.trim() !== '') found = true
  })
  return found
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}
