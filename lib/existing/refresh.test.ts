// ─────────────────────────────────────────────────────────────────────────────
// Refreshing a site's inventory — tests
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest'

let crawlPages: Array<{ url: string }> = []
let crawlError: Error | null = null
const upserts: string[] = []
const stamped: string[] = []

vi.mock('@/lib/analyzer/crawler', () => ({
  crawlWebsite: vi.fn(async () => {
    if (crawlError) throw crawlError
    return { siteUrl: 'https://exemple.fr', pages: crawlPages, sitemap: [], totalPages: crawlPages.length, crawledAt: '', truncated: false }
  }),
}))
vi.mock('@/lib/analyzer/to-site-pages', () => ({ toSitePagePayloads: (_: string, crawl: { pages: unknown[] }) => crawl.pages }))
vi.mock('@/lib/db', () => ({
  upsertSitePages: vi.fn(async (siteId: string) => { upserts.push(siteId); return [] }),
  markSiteCampaignsCrawled: vi.fn(async (siteId: string) => { stamped.push(siteId) }),
}))
vi.mock('@/src/adapters/rag/VectorIndexingService', () => ({ indexSitePages: vi.fn(async () => ({ errors: [] })) }))

const { refreshJobOf, startInventoryRefresh } = await import('./refresh')

/** Let the background job settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  crawlPages = [{ url: 'https://exemple.fr/a' }, { url: 'https://exemple.fr/b' }]
  crawlError = null
  upserts.length = 0
  stamped.length = 0
})

describe('startInventoryRefresh', () => {
  it('reads the site, writes the inventory and dates the campaigns', async () => {
    const started = startInventoryRefresh({ id: 'site-a', url: 'https://exemple.fr' })
    expect(started.state).toBe('running')

    await settle()

    expect(refreshJobOf('site-a')).toMatchObject({ state: 'done', pagesRead: 2, truncated: false })
    expect(upserts).toEqual(['site-a'])
    expect(stamped).toEqual(['site-a'])
  })

  it('never crawls the same site twice at once', () => {
    const first = startInventoryRefresh({ id: 'site-b', url: 'https://exemple.fr' })
    const second = startInventoryRefresh({ id: 'site-b', url: 'https://exemple.fr' })
    expect(second).toBe(first)
  })

  it('keeps the known pages and says why when nothing could be read', async () => {
    crawlPages = []
    startInventoryRefresh({ id: 'site-c', url: 'https://exemple.fr' })
    await settle()

    expect(refreshJobOf('site-c')?.state).toBe('failed')
    expect(refreshJobOf('site-c')?.error).toContain('Aucune page lue')
    expect(upserts).toEqual([])
  })

  it('reports a crawl failure instead of losing it', async () => {
    crawlError = new Error('DNS introuvable')
    startInventoryRefresh({ id: 'site-d', url: 'https://exemple.fr' })
    await settle()

    expect(refreshJobOf('site-d')).toMatchObject({ state: 'failed', error: 'DNS introuvable' })
  })

  it('knows nothing of a site never refreshed', () => {
    expect(refreshJobOf('jamais')).toBeNull()
  })
})
