// ─────────────────────────────────────────────────────────────────────────────
// Search Console URL Inspection — what Google knows about one URL
// SEO Engine - The API behind « Inspection de l'URL », read-only.
// ─────────────────────────────────────────────────────────────────────────────
//
// It READS: there is no « Demander l'indexation » in any Google API. It uses
// the site's OAuth connection (the `webmasters` scope covers it) and is metered
// per property: 2 000 inspections a day, 600 a minute. A refused inspection —
// URL outside the property, quota spent — still counts, so the caller filters
// URLs before asking and stops the run on a failure that would repeat.

import type { GoogleFetch } from './client'
import type { IndexStatusFacts } from '@/src/core/domain/indexing/status'

const URL_INSPECTION_API = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'

/**
 * An inspection answers in one to three seconds. Without a bound, a request
 * Google never answers holds the run for Node's own five-minute limit, and the
 * « Vérifier maintenant » button spins for as long.
 */
export const INSPECTION_TIMEOUT_MS = 30_000

export interface UrlInspection extends IndexStatusFacts {
  /** Google's own sentence (« Explorée, actuellement non indexée »), in French. Displayed, never parsed. */
  coverageState: string | null
  /** Opens this inspection in the Search Console interface. */
  inspectionLink: string | null
}

export type InspectionFailure =
  | 'quota'         // 429: the property's daily or per-minute quota is spent
  | 'forbidden'     // 403: the connected account has no access to the property
  | 'unauthorized'  // 401: the token died during the run
  | 'invalid'       // 400: this URL cannot be inspected under this property
  | 'error'         // network or server failure, says nothing about the page

export type InspectionOutcome =
  | { ok: true; inspection: UrlInspection }
  | { ok: false; failure: InspectionFailure; error: string }

/** These hit every remaining URL of the run: going on would only spend quota on refusals. */
export function stopsTheRun(failure: InspectionFailure): boolean {
  return failure === 'quota' || failure === 'forbidden' || failure === 'unauthorized'
}

export async function inspectUrl(googleFetch: GoogleFetch, property: string, url: string): Promise<InspectionOutcome> {
  let res: Response
  try {
    res = await googleFetch(URL_INSPECTION_API, {
      method: 'POST',
      body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: 'fr-FR' }),
      signal: AbortSignal.timeout(INSPECTION_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    const detail = timedOut ? `pas de reponse en ${INSPECTION_TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : String(error)
    return { ok: false, failure: 'error', error: `URL Inspection : ${detail}` }
  }

  const body: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const detail = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`
    return { ok: false, failure: failureFor(res.status), error: `URL Inspection ${res.status} : ${detail}` }
  }

  const inspection = parseInspection(body)
  if (!inspection) return { ok: false, failure: 'error', error: 'URL Inspection : réponse sans indexStatusResult' }
  return { ok: true, inspection }
}

export function parseInspection(body: unknown): UrlInspection | null {
  const result = (body as { inspectionResult?: { inspectionResultLink?: unknown; indexStatusResult?: Record<string, unknown> } } | null)
    ?.inspectionResult
  const status = result?.indexStatusResult
  if (!status) return null

  return {
    verdict: enumValue(status.verdict),
    coverageState: text(status.coverageState),
    robotsTxtState: enumValue(status.robotsTxtState),
    indexingState: enumValue(status.indexingState),
    pageFetchState: enumValue(status.pageFetchState),
    googleCanonical: text(status.googleCanonical),
    userCanonical: text(status.userCanonical),
    lastCrawlTime: text(status.lastCrawlTime),
    inspectionLink: text(result.inspectionResultLink),
  }
}

function failureFor(status: number): InspectionFailure {
  if (status === 429) return 'quota'
  if (status === 403) return 'forbidden'
  if (status === 401) return 'unauthorized'
  if (status === 400) return 'invalid'
  return 'error'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** `VERDICT_UNSPECIFIED`, `PAGE_FETCH_STATE_UNSPECIFIED`… mean « Google did not say »: null. */
function enumValue(value: unknown): string | null {
  const raw = text(value)
  return raw && !raw.endsWith('_UNSPECIFIED') ? raw : null
}
