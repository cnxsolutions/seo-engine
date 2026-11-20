import { describe, it, expect } from 'vitest'
import { inspectUrl, parseInspection, stopsTheRun } from './url-inspection'
import type { GoogleFetch } from './client'

function respond(status: number, body: unknown): { fetch: GoogleFetch; calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetch: GoogleFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(String(options?.body ?? 'null')) })
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

const INDEXED = {
  inspectionResult: {
    inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=x',
    indexStatusResult: {
      verdict: 'PASS',
      coverageState: 'Envoyée et indexée',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      lastCrawlTime: '2026-11-12T03:14:00Z',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://example.fr/a',
      userCanonical: 'https://example.fr/a',
    },
  },
}

describe('inspectUrl', () => {
  it('asks for one URL under the property, with French wording', async () => {
    const { fetch, calls } = respond(200, INDEXED)
    const outcome = await inspectUrl(fetch, 'sc-domain:example.fr', 'https://example.fr/a')

    expect(calls[0].url).toBe('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect')
    expect(calls[0].body).toEqual({ inspectionUrl: 'https://example.fr/a', siteUrl: 'sc-domain:example.fr', languageCode: 'fr-FR' })
    expect(outcome).toMatchObject({ ok: true, inspection: { verdict: 'PASS', coverageState: 'Envoyée et indexée' } })
  })

  it('names the failure so the run knows whether to stop', async () => {
    const cases: Array<[number, string]> = [[429, 'quota'], [403, 'forbidden'], [401, 'unauthorized'], [400, 'invalid'], [500, 'error']]
    for (const [status, failure] of cases) {
      const { fetch } = respond(status, { error: { message: 'refus' } })
      const outcome = await inspectUrl(fetch, 'sc-domain:example.fr', 'https://example.fr/a')
      expect(outcome).toMatchObject({ ok: false, failure })
      if (!outcome.ok) expect(outcome.error).toContain('refus')
    }
  })

  it('turns a network failure into a result rather than a throw', async () => {
    const fetch: GoogleFetch = async () => { throw new Error('ECONNRESET') }
    expect(await inspectUrl(fetch, 'sc-domain:example.fr', 'https://example.fr/a')).toEqual({ ok: false, failure: 'error', error: 'URL Inspection : ECONNRESET' })
  })

  it('gives up on a request Google never answers instead of holding the run', async () => {
    let signal: AbortSignal | null | undefined
    const fetch: GoogleFetch = async (_url, options) => {
      signal = options?.signal
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }
    const outcome = await inspectUrl(fetch, 'sc-domain:example.fr', 'https://example.fr/a')

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(outcome).toEqual({ ok: false, failure: 'error', error: 'URL Inspection : pas de reponse en 30 s' })
  })

  it('stops the run only on failures that would repeat for every URL', () => {
    expect(stopsTheRun('quota')).toBe(true)
    expect(stopsTheRun('forbidden')).toBe(true)
    expect(stopsTheRun('unauthorized')).toBe(true)
    expect(stopsTheRun('invalid')).toBe(false)
    expect(stopsTheRun('error')).toBe(false)
  })
})

describe('parseInspection', () => {
  it('reads « unspecified » enum values as unknown', () => {
    const parsed = parseInspection({
      inspectionResult: {
        indexStatusResult: {
          verdict: 'NEUTRAL',
          coverageState: 'URL inconnue de Google',
          robotsTxtState: 'ROBOTS_TXT_STATE_UNSPECIFIED',
          indexingState: 'INDEXING_STATE_UNSPECIFIED',
          pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED',
        },
      },
    })
    expect(parsed).toEqual({
      verdict: 'NEUTRAL',
      coverageState: 'URL inconnue de Google',
      robotsTxtState: null,
      indexingState: null,
      pageFetchState: null,
      googleCanonical: null,
      userCanonical: null,
      lastCrawlTime: null,
      inspectionLink: null,
    })
  })

  it('refuses a body without an index status', () => {
    expect(parseInspection({})).toBeNull()
    expect(parseInspection(null)).toBeNull()
  })
})
