// ─────────────────────────────────────────────────────────────────────────────
// Is a page indexed by Google — and if not, will resubmitting it help?
// SEO Engine - Pure rules over what Search Console's URL Inspection answers.
// ─────────────────────────────────────────────────────────────────────────────
//
// Google has no API for « Demander l'indexation ». What the engine can do for a
// page Google has not indexed is resend the sitemaps that list it (and tell
// Bing through IndexNow). That only helps a page Google has NOT CRAWLED yet. A
// page in noindex, in 404 or canonicalised elsewhere stays out whatever is
// resent: it needs a fix on the site. A page crawled and still left out was
// judged by Google: it needs better content, not another nudge.
//
// The classification therefore reads the structural fields of the inspection
// (verdict, robots, indexing state, fetch state, canonicals, last crawl), never
// the localised `coverageState` sentence, which is only displayed.

export type IndexState =
  | 'unchecked'            // never inspected yet
  | 'indexed'              // in Google's index
  | 'not_discovered'       // never crawled: unknown to Google, or discovered and queued
  | 'crawled_not_indexed'  // crawled, allowed, and still left out: a quality verdict
  | 'blocked'              // noindex, or robots.txt forbids the crawl
  | 'fetch_error'          // 404, soft 404, server error, redirect error…
  | 'canonical_elsewhere'  // Google — or the page itself — points to another URL

/** The part of `indexStatusResult` that decides anything. Raw Google enum values. */
export interface IndexStatusFacts {
  verdict: string | null
  robotsTxtState: string | null
  indexingState: string | null
  pageFetchState: string | null
  googleCanonical: string | null
  userCanonical: string | null
  lastCrawlTime: string | null
}

/** How the screen groups states: what needs a human, what needs time, what is done. */
export type IndexStateGroup = 'to_fix' | 'not_indexed' | 'indexed' | 'unchecked'

export const INDEX_STATE_GROUPS: Record<IndexStateGroup, readonly IndexState[]> = {
  to_fix: ['blocked', 'fetch_error', 'canonical_elsewhere'],
  not_indexed: ['not_discovered', 'crawled_not_indexed'],
  indexed: ['indexed'],
  unchecked: ['unchecked'],
}

// ─── Cadence ─────────────────────────────────────────────────────────────────

/** An indexed page can drop out: checked again once a month. */
export const INDEXED_RECHECK_DAYS = 30

/** Nothing changes until someone fixes the site; a week is soon enough to notice the fix. */
export const ACTION_REQUIRED_RECHECK_DAYS = 7

/**
 * A page waiting for Google, by consecutive non-indexed inspections: J+2, J+4,
 * J+7, then weekly. Discovery takes days, not hours — checking more often
 * would spend the daily quota to read the same answer.
 */
export const WAITING_RECHECK_DAYS: readonly number[] = [2, 2, 3, 7]

/** A failed call (network, 5xx) says nothing about the page: retried the next day. */
export const ERROR_RETRY_DAYS = 1

/** A page just published was submitted at publication; inspecting it before is wasted quota. */
export const FIRST_CHECK_DELAY_DAYS = 2

/** The same page is not resent more than once a week: a sitemap read twice is read once. */
export const RESUBMIT_COOLDOWN_DAYS = 7

const DAY_MS = 86_400_000

const BLOCKING_INDEXING_STATES = new Set(['BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER', 'BLOCKED_BY_ROBOTS_TXT'])
const HARMLESS_FETCH_STATES = new Set(['SUCCESSFUL', 'PAGE_FETCH_STATE_UNSPECIFIED'])

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * @param normalize the site's single definition of « the same page » (protocol,
 *   www, trailing slash), injected so this module stays free of infrastructure.
 */
export function classifyIndexStatus(
  facts: IndexStatusFacts,
  pageUrl: string,
  normalize: (url: string) => string
): IndexState {
  if (facts.verdict === 'PASS') return 'indexed'

  if (
    facts.robotsTxtState === 'DISALLOWED'
    || facts.pageFetchState === 'BLOCKED_ROBOTS_TXT'
    || (facts.indexingState !== null && BLOCKING_INDEXING_STATES.has(facts.indexingState))
  ) {
    return 'blocked'
  }

  if (facts.pageFetchState !== null && !HARMLESS_FETCH_STATES.has(facts.pageFetchState)) return 'fetch_error'

  const self = normalize(pageUrl)
  const pointsElsewhere = (canonical: string | null) => canonical !== null && normalize(canonical) !== self
  if (pointsElsewhere(facts.googleCanonical) || pointsElsewhere(facts.userCanonical)) return 'canonical_elsewhere'

  return facts.lastCrawlTime ? 'crawled_not_indexed' : 'not_discovered'
}

/** Consecutive inspections without indexation; the cadence backs off on it. */
export function nextMissStreak(state: IndexState, previous: number): number {
  return state === 'indexed' ? 0 : previous + 1
}

export function nextCheckAt(state: IndexState, missStreak: number, now: Date): Date {
  return addDays(now, recheckDays(state, missStreak))
}

export function recheckDays(state: IndexState, missStreak: number): number {
  if (state === 'indexed') return INDEXED_RECHECK_DAYS
  if (INDEX_STATE_GROUPS.to_fix.includes(state)) return ACTION_REQUIRED_RECHECK_DAYS
  if (state === 'unchecked') return 0
  const step = Math.min(Math.max(missStreak, 1), WAITING_RECHECK_DAYS.length) - 1
  return WAITING_RECHECK_DAYS[step]
}

/**
 * Resending is worth it only for a page Google has not crawled yet, and not
 * more often than once a week.
 */
export function isResubmittable(state: IndexState, lastResubmittedAt: Date | null, now: Date): boolean {
  if (state !== 'not_discovered') return false
  if (!lastResubmittedAt) return true
  return now.getTime() - lastResubmittedAt.getTime() >= RESUBMIT_COOLDOWN_DAYS * DAY_MS
}

/**
 * Whether a URL can be inspected under a Search Console property. Google
 * refuses — and still counts — an inspection outside the property.
 *
 * `sc-domain:example.fr` covers every protocol and subdomain of example.fr; a
 * URL-prefix property covers what starts with it, protocol and host included.
 */
export function belongsToProperty(url: string, property: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length).toLowerCase()
    const host = parsed.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  }

  let prefix: URL
  try {
    prefix = new URL(property)
  } catch {
    return false
  }
  if (parsed.origin.toLowerCase() !== prefix.origin.toLowerCase()) return false
  const prefixPath = prefix.pathname.endsWith('/') ? prefix.pathname : `${prefix.pathname}/`
  return parsed.pathname.replace(/\/?$/, '/').startsWith(prefixPath)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}
