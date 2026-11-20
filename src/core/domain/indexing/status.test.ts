// ─────────────────────────────────────────────────────────────────────────────
// status — ce que l'inspection d'URL veut dire, et ce qu'il est utile de renvoyer
//
// Chaque test decrit une reponse REELLE de Search Console : une page jamais
// vue, une page en noindex qui serait renvoyee pour rien, une page dont Google
// a choisi une autre canonique, une page exploree puis ecartee.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  ACTION_REQUIRED_RECHECK_DAYS,
  INDEXED_RECHECK_DAYS,
  RESUBMIT_COOLDOWN_DAYS,
  addDays,
  belongsToProperty,
  classifyIndexStatus,
  isResubmittable,
  nextMissStreak,
  recheckDays,
  type IndexStatusFacts,
} from './status'

const URL = 'https://www.example.fr/taxi-lyon/'

/** Same page whatever the protocol, www or trailing slash — the shape of normalizePageUrl. */
const normalize = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase()

function facts(overrides: Partial<IndexStatusFacts> = {}): IndexStatusFacts {
  return {
    verdict: 'NEUTRAL',
    robotsTxtState: null,
    indexingState: null,
    pageFetchState: null,
    googleCanonical: null,
    userCanonical: null,
    lastCrawlTime: null,
    ...overrides,
  }
}

describe('classifyIndexStatus', () => {
  it('reads PASS as indexed', () => {
    expect(classifyIndexStatus(facts({ verdict: 'PASS', lastCrawlTime: '2026-11-01T00:00:00Z' }), URL, normalize)).toBe('indexed')
  })

  it('reads a page Google never crawled as not discovered — the only case worth resending', () => {
    expect(classifyIndexStatus(facts(), URL, normalize)).toBe('not_discovered')
  })

  it('reads a crawled, allowed, unindexed page as a quality verdict, not a discovery problem', () => {
    const crawled = facts({
      lastCrawlTime: '2026-11-10T08:00:00Z',
      pageFetchState: 'SUCCESSFUL',
      indexingState: 'INDEXING_ALLOWED',
      robotsTxtState: 'ALLOWED',
      googleCanonical: 'https://example.fr/taxi-lyon',
      userCanonical: URL,
    })
    expect(classifyIndexStatus(crawled, URL, normalize)).toBe('crawled_not_indexed')
  })

  it('reads noindex as blocked', () => {
    expect(classifyIndexStatus(facts({ verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG' }), URL, normalize)).toBe('blocked')
    expect(classifyIndexStatus(facts({ verdict: 'FAIL', indexingState: 'BLOCKED_BY_HTTP_HEADER' }), URL, normalize)).toBe('blocked')
  })

  it('reads a robots.txt refusal as blocked', () => {
    expect(classifyIndexStatus(facts({ verdict: 'FAIL', robotsTxtState: 'DISALLOWED' }), URL, normalize)).toBe('blocked')
    expect(classifyIndexStatus(facts({ verdict: 'FAIL', pageFetchState: 'BLOCKED_ROBOTS_TXT' }), URL, normalize)).toBe('blocked')
  })

  it('reads 404, soft 404 and server errors as fetch errors', () => {
    for (const pageFetchState of ['NOT_FOUND', 'SOFT_404', 'SERVER_ERROR', 'REDIRECT_ERROR']) {
      expect(classifyIndexStatus(facts({ verdict: 'FAIL', pageFetchState, lastCrawlTime: '2026-11-01T00:00:00Z' }), URL, normalize)).toBe('fetch_error')
    }
  })

  it('reads a canonical chosen elsewhere by Google', () => {
    const duplicate = facts({
      lastCrawlTime: '2026-11-01T00:00:00Z',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://www.example.fr/taxi-lyon-gare/',
      userCanonical: URL,
    })
    expect(classifyIndexStatus(duplicate, URL, normalize)).toBe('canonical_elsewhere')
  })

  it('reads a page declaring another canonical itself', () => {
    expect(classifyIndexStatus(facts({ userCanonical: 'https://www.example.fr/autre/' }), URL, normalize)).toBe('canonical_elsewhere')
  })

  it('does not mistake the same URL written differently for another canonical', () => {
    const same = facts({ lastCrawlTime: '2026-11-01T00:00:00Z', googleCanonical: 'http://example.fr/taxi-lyon' })
    expect(classifyIndexStatus(same, URL, normalize)).toBe('crawled_not_indexed')
  })
})

describe('cadence', () => {
  it('backs off a waiting page: J+2, J+4, J+7, then weekly', () => {
    expect([1, 2, 3, 4, 9].map((streak) => recheckDays('not_discovered', streak))).toEqual([2, 2, 3, 7, 7])
  })

  it('rechecks an indexed page monthly and a page to fix weekly', () => {
    expect(recheckDays('indexed', 0)).toBe(INDEXED_RECHECK_DAYS)
    expect(recheckDays('blocked', 1)).toBe(ACTION_REQUIRED_RECHECK_DAYS)
    expect(recheckDays('fetch_error', 5)).toBe(ACTION_REQUIRED_RECHECK_DAYS)
  })

  it('resets the streak once indexed', () => {
    expect(nextMissStreak('not_discovered', 3)).toBe(4)
    expect(nextMissStreak('indexed', 3)).toBe(0)
  })
})

describe('isResubmittable', () => {
  const now = new Date('2026-11-17T05:00:00Z')

  it('resends a never-crawled page', () => {
    expect(isResubmittable('not_discovered', null, now)).toBe(true)
  })

  it('never resends a page that resending cannot fix', () => {
    for (const state of ['indexed', 'crawled_not_indexed', 'blocked', 'fetch_error', 'canonical_elsewhere'] as const) {
      expect(isResubmittable(state, null, now)).toBe(false)
    }
  })

  it('waits a week between two resends of the same page', () => {
    expect(isResubmittable('not_discovered', addDays(now, -3), now)).toBe(false)
    expect(isResubmittable('not_discovered', addDays(now, -RESUBMIT_COOLDOWN_DAYS), now)).toBe(true)
  })
})

describe('belongsToProperty', () => {
  it('covers every protocol and subdomain of a domain property', () => {
    expect(belongsToProperty('https://www.example.fr/a', 'sc-domain:example.fr')).toBe(true)
    expect(belongsToProperty('http://example.fr/', 'sc-domain:example.fr')).toBe(true)
    expect(belongsToProperty('https://blog.example.fr/a', 'sc-domain:example.fr')).toBe(true)
    expect(belongsToProperty('https://notexample.fr/a', 'sc-domain:example.fr')).toBe(false)
  })

  it('covers only what starts with a URL-prefix property', () => {
    expect(belongsToProperty('https://www.example.fr/a', 'https://www.example.fr/')).toBe(true)
    expect(belongsToProperty('https://example.fr/a', 'https://www.example.fr/')).toBe(false)
    expect(belongsToProperty('http://www.example.fr/a', 'https://www.example.fr/')).toBe(false)
    expect(belongsToProperty('https://www.example.fr/blog', 'https://www.example.fr/blog/')).toBe(true)
    expect(belongsToProperty('https://www.example.fr/blogger', 'https://www.example.fr/blog/')).toBe(false)
  })

  it('refuses what is not a web URL', () => {
    expect(belongsToProperty('mailto:a@example.fr', 'sc-domain:example.fr')).toBe(false)
    expect(belongsToProperty('pas une url', 'sc-domain:example.fr')).toBe(false)
  })
})
