// ─────────────────────────────────────────────────────────────────────────────
// SERP source status — tests
// SEO Engine - Missing key, refused key, exhausted quota: three different fixes.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { accountOf, describeSerpStatus, type SerpStatus } from './status'

const OK: SerpStatus = {
  configured: true,
  account: { plan: 'Free Plan', searchesLeft: 87, searchesPerMonth: 100, usedThisMonth: 13 },
  accountError: null,
  lastFailure: null,
  lastSuccessAt: null,
  lastSnapshotAt: '2026-08-10T09:00:00.000Z',
}

describe('describeSerpStatus', () => {
  it('names the missing key and where to put it', () => {
    const summary = describeSerpStatus({ ...OK, configured: false, account: null })
    expect(summary.tone).toBe('critical')
    expect(summary.text).toContain('SERPAPI_KEY absente')
    expect(summary.text).toContain('/opt/seo-engine/.env')
  })

  it('tells a refused key from an exhausted quota', () => {
    expect(describeSerpStatus({ ...OK, account: null, accountError: 'Clé refusée par SerpApi (401/403).' }).text).toMatch(/^Clé refusée/)
    expect(describeSerpStatus({ ...OK, account: { ...OK.account!, searchesLeft: 0 } }).text).toMatch(/^Quota SerpApi épuisé/)
  })

  it('reports a failure more recent than the last success', () => {
    const failed = { ...OK, lastFailure: { kind: 'status' as const, message: 'SerpApi: boom', at: '2026-11-08T10:00:00Z' } }
    expect(describeSerpStatus(failed).tone).toBe('warning')
    expect(describeSerpStatus({ ...failed, lastSuccessAt: '2026-11-08T11:00:00Z' }).tone).toBe('good')
  })

  it('says how many searches are left when all is well', () => {
    expect(describeSerpStatus(OK)).toEqual({ tone: 'good', text: 'SerpApi répond — 87 recherches restantes (plan Free Plan).' })
  })
})

describe('accountOf', () => {
  it('reads the account payload field by field', () => {
    expect(accountOf({ plan_name: 'Developer', total_searches_left: 4200, searches_per_month: 5000, this_month_usage: 800 })).toEqual({
      plan: 'Developer', searchesLeft: 4200, searchesPerMonth: 5000, usedThisMonth: 800,
    })
    expect(accountOf({})).toEqual({ plan: null, searchesLeft: null, searchesPerMonth: null, usedThisMonth: null })
  })
})
