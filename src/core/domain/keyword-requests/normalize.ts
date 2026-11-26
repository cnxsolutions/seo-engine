// ─────────────────────────────────────────────────────────────────────────────
// What a client may send, and the search it stands for — docs/cadrage.md § 3.1
// (rule 1) and § 3.8
// ─────────────────────────────────────────────────────────────────────────────
//
// Rule 1 of the verdict lives here, because it is not a verdict: a malformed
// keyword is refused AT INPUT, under its field, and never stored. Everything
// else — duplicates, ceilings, the engine's judgement — happens to a request
// that exists.

import { daysBetween, parisDay } from '../client-space/overview'
import type { RateLimitRule } from '../client-access/policy'
import { containsKeywordPhrase, normalizeForMatch } from '../text/text-utils'

// ── Ceilings (§ 3.8) — named, changeable in one line ──────────────────────

export const KEYWORD_MAX_CHARS = 80
export const KEYWORD_MAX_WORDS = 8
/** One submission stays readable, and analysable in one pass. */
export const KEYWORDS_PER_SUBMISSION = 10
/** Beyond, it is a strategy to rework with CNX, not a queue. */
export const OPEN_REQUESTS_PER_SITE = 30
/** Submissions per member: abuse, and the cost of the model's opinion. */
export const REQUEST_SUBMISSIONS: RateLimitRule = { limit: 30, windowMs: 60 * 60 * 1000 }
export const CITY_MAX_CHARS = 80
export const NOTE_MAX_CHARS = 500
/** « Pour quand » further than a year is not a date, it is a wish. */
export const DESIRED_BY_MAX_DAYS = 365

// ── One keyword ───────────────────────────────────────────────────────────

export type KeywordProblem = 'empty' | 'too_long' | 'too_many_words' | 'url'

const URL_LIKE = [/https?:\/\//i, /\bwww\./i, /\b[a-z0-9-]+\.(?:fr|com|net|org|io|eu|be|ch|info|biz|co)\b/i]

/**
 * Control and zero-width characters: invisible in the form, but they would
 * make two identical-looking requests different.
 */
function isInvisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202f) ||
    code === 0x2060 ||
    code === 0xfeff
  )
}

/** Trimmed, one space between words, no invisible character. */
export function cleanText(raw: string): string {
  let out = ''
  for (const char of raw.normalize('NFC')) out += isInvisible(char.codePointAt(0) as number) ? ' ' : char
  return out.replace(/\s+/g, ' ').trim()
}

function looksLikeUrl(value: string): boolean {
  return URL_LIKE.some((pattern) => pattern.test(value))
}

export function checkKeyword(raw: string): { ok: true; keyword: string } | { ok: false; problem: KeywordProblem } {
  const keyword = cleanText(raw)
  if (!keyword || !normalizeForMatch(keyword)) return { ok: false, problem: 'empty' }
  if (keyword.length > KEYWORD_MAX_CHARS) return { ok: false, problem: 'too_long' }
  if (keyword.split(' ').length > KEYWORD_MAX_WORDS) return { ok: false, problem: 'too_many_words' }
  if (looksLikeUrl(keyword)) return { ok: false, problem: 'url' }
  return { ok: true, keyword }
}

// ── The search a request stands for ───────────────────────────────────────

/**
 * What someone would type into Google: the keyword, followed by the town when
 * the keyword does not already name it. « plombier » at Troyes and « plombier
 * troyes » are the same request.
 */
export function requestQuery(keyword: string, city: string | null): string {
  if (!city || containsKeywordPhrase(keyword, city)) return keyword
  return `${keyword} ${city}`
}

/** The comparable form, stored as `keyword_normalized` and unique among open requests. */
export function normalizedRequest(keyword: string, city: string | null): string {
  return normalizeForMatch(requestQuery(keyword, city))
}

// ── One submission ────────────────────────────────────────────────────────

export interface SubmissionInput {
  /** One keyword per line. */
  keywords: string
  city?: string | null
  note?: string | null
  /** YYYY-MM-DD, Paris day. */
  desiredBy?: string | null
}

export type SubmissionProblem =
  | { field: 'keywords'; code: 'none' | 'too_many' }
  | { field: 'keywords'; code: KeywordProblem; line: number; text: string }
  | { field: 'city'; code: 'too_long' | 'url' }
  | { field: 'note'; code: 'too_long' }
  | { field: 'desiredBy'; code: 'invalid' | 'past' | 'too_far' }

export interface SubmissionItem {
  keyword: string
  normalized: string
}

export type SubmissionCheck =
  | { ok: true; items: SubmissionItem[]; city: string | null; note: string | null; desiredBy: string | null }
  | { ok: false; problems: SubmissionProblem[] }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day, between today and a year from now. */
function checkDesiredBy(raw: string | null | undefined, today: string): { value: string | null; problem?: SubmissionProblem } {
  const value = (raw ?? '').trim()
  if (!value) return { value: null }
  // 2026-02-30 parses, as 2 March: the round trip is what proves the day exists.
  const noon = new Date(`${value}T12:00:00Z`)
  if (!ISO_DAY.test(value) || Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== value) {
    return { value: null, problem: { field: 'desiredBy', code: 'invalid' } }
  }
  const ahead = daysBetween(today, value)
  if (ahead < 0) return { value: null, problem: { field: 'desiredBy', code: 'past' } }
  if (ahead > DESIRED_BY_MAX_DAYS) return { value: null, problem: { field: 'desiredBy', code: 'too_far' } }
  return { value }
}

/**
 * Every problem at once — the form shows them all, not one per round trip.
 * Lines left blank are ignored; the same search typed twice is kept once.
 */
export function checkSubmission(input: SubmissionInput, now: Date = new Date()): SubmissionCheck {
  const problems: SubmissionProblem[] = []

  const city = cleanText(input.city ?? '') || null
  if (city && city.length > CITY_MAX_CHARS) problems.push({ field: 'city', code: 'too_long' })
  else if (city && looksLikeUrl(city)) problems.push({ field: 'city', code: 'url' })

  const note = (input.note ?? '').trim() || null
  if (note && note.length > NOTE_MAX_CHARS) problems.push({ field: 'note', code: 'too_long' })

  const desiredBy = checkDesiredBy(input.desiredBy, parisDay(now))
  if (desiredBy.problem) problems.push(desiredBy.problem)

  const lines = input.keywords
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((entry) => entry.text.length > 0)
  if (lines.length === 0) problems.push({ field: 'keywords', code: 'none' })
  if (lines.length > KEYWORDS_PER_SUBMISSION) problems.push({ field: 'keywords', code: 'too_many' })

  const items: SubmissionItem[] = []
  const seen = new Set<string>()
  if (lines.length <= KEYWORDS_PER_SUBMISSION) {
    for (const { text, line } of lines) {
      const checked = checkKeyword(text)
      if (!checked.ok) {
        problems.push({ field: 'keywords', code: checked.problem, line, text })
        continue
      }
      const normalized = normalizedRequest(checked.keyword, city)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      items.push({ keyword: checked.keyword, normalized })
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, items, city, note, desiredBy: desiredBy.value }
}
