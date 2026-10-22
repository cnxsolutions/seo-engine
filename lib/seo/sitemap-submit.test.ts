// ─────────────────────────────────────────────────────────────────────────────
// Sitemaps sent to Search Console — tests
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ url: string; method: string }> = []
let property: string | null = 'sc-domain:flowyne.com'
let connected = true

const googleFetch = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({ url, method: init?.method ?? 'GET' })
  if ((init?.method ?? 'GET') === 'GET') {
    return new Response(JSON.stringify({ sitemap: [{ path: 'https://flowyne.com/sitemap.xml' }] }), { status: 200 })
  }
  return new Response(null, { status: url.includes('refuse') ? 403 : 204 })
})

vi.mock('@/lib/google/client', () => ({
  getAuthenticatedClient: vi.fn(async () => {
    if (!connected) throw new Error('Aucune connexion Google pour ce site')
    return { fetch: googleFetch, connection: { gsc_site_url: property } }
  }),
}))

const { resubmitSitemaps } = await import('./sitemap-submit')

beforeEach(() => {
  calls.length = 0
  property = 'sc-domain:flowyne.com'
  connected = true
})

describe('resubmitSitemaps', () => {
  it('submits the engine sitemap AND the ones already registered on the property', async () => {
    const result = await resubmitSitemaps({ siteId: 's1', sitemaps: ['https://www.flowyne.com/sitemap-seo.xml'] })

    expect(result.submitted).toEqual(['https://www.flowyne.com/sitemap-seo.xml', 'https://flowyne.com/sitemap.xml'])
    expect(result.problems).toEqual([])
    const puts = calls.filter((call) => call.method === 'PUT').map((call) => call.url)
    expect(puts[0]).toContain('/sites/sc-domain%3Aflowyne.com/sitemaps/https%3A%2F%2Fwww.flowyne.com%2Fsitemap-seo.xml')
  })

  it('reports a refusal without hiding the other submissions', async () => {
    const result = await resubmitSitemaps({ siteId: 's1', sitemaps: ['https://www.flowyne.com/refuse.xml'] })
    expect(result.submitted).toEqual(['https://flowyne.com/sitemap.xml'])
    expect(result.problems[0]).toContain('refuse.xml')
  })

  it('never throws without a connection or a property', async () => {
    connected = false
    expect((await resubmitSitemaps({ siteId: 's1', sitemaps: [] })).problems[0]).toContain('pas de connexion Google')

    connected = true
    property = null
    expect((await resubmitSitemaps({ siteId: 's1', sitemaps: [] })).problems[0]).toContain('aucune propriete Search Console')
  })
})
