// ─────────────────────────────────────────────────────────────────────────────
// check — le job quotidien d'indexation, sur une base et un Google simules
//
// Chaque test decrit un mode d'echec reel : une page renvoyee alors que seul
// le site peut la corriger, un quota brule sur des refus, une page comptee deux
// fois sous deux ecritures, une base illisible qui viderait le suivi.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest'
import type { InspectionOutcome, UrlInspection } from '@/lib/google/url-inspection'
import { applyInspection, checkSiteIndexing, planIndexingSeed, type IndexCheckDeps } from './check'
import type { IndexingResult, IndexingStore, NewIndexingRow, PageIndexingRow } from './store'

vi.mock('@/lib/supabase', () => ({ createServiceClient: () => { throw new Error('no database in tests') } }))

const SITE = 'site-1'
const PROPERTY = 'sc-domain:example.fr'
const NOW = new Date('2026-11-17T05:00:00.000Z')

function row(overrides: Partial<PageIndexingRow> = {}): PageIndexingRow {
  return {
    id: 'row-1',
    site_id: SITE,
    url: 'https://www.example.fr/taxi-lyon/',
    url_key: 'example.fr/taxi-lyon',
    generation_id: null,
    priority: 1,
    state: 'unchecked',
    verdict: null,
    coverage_state: null,
    indexing_state: null,
    robots_txt_state: null,
    page_fetch_state: null,
    google_canonical: null,
    user_canonical: null,
    inspection_link: null,
    last_crawl_at: null,
    inspected_at: null,
    next_check_at: NOW.toISOString(),
    miss_streak: 0,
    resubmit_count: 0,
    last_resubmitted_at: null,
    last_error: null,
    ...overrides,
  }
}

function inspection(overrides: Partial<UrlInspection> = {}): InspectionOutcome {
  return {
    ok: true,
    inspection: {
      verdict: 'NEUTRAL',
      coverageState: 'URL inconnue de Google',
      robotsTxtState: null,
      indexingState: null,
      pageFetchState: null,
      googleCanonical: null,
      userCanonical: null,
      lastCrawlTime: null,
      inspectionLink: null,
      ...overrides,
    },
  }
}

describe('planIndexingSeed', () => {
  it('counts one page once, whatever the form each source wrote it in, engine first', () => {
    const plan = planIndexingSeed({
      siteId: SITE,
      property: PROPERTY,
      sources: {
        engine: [{ generationId: 'gen-1', url: 'https://example.fr/taxi-lyon', publishedAt: '2026-11-16T10:00:00.000Z' }],
        inventory: ['https://www.example.fr/taxi-lyon/', 'https://www.example.fr/contact/'],
      },
      existing: [],
      now: NOW,
    })

    expect(plan.insert).toEqual([
      { site_id: SITE, url: 'https://example.fr/taxi-lyon', url_key: 'example.fr/taxi-lyon', generation_id: 'gen-1', priority: 0, next_check_at: '2026-11-18T10:00:00.000Z' },
      { site_id: SITE, url: 'https://www.example.fr/contact/', url_key: 'example.fr/contact', generation_id: null, priority: 1, next_check_at: NOW.toISOString() },
    ])
  })

  it('leaves out URLs the property cannot inspect: Google would refuse them and still count them', () => {
    const plan = planIndexingSeed({
      siteId: SITE,
      property: PROPERTY,
      sources: { engine: [], inventory: ['https://autre-site.fr/a', 'https://www.example.fr/a'] },
      existing: [],
      now: NOW,
    })
    expect(plan.insert.map((page) => page.url)).toEqual(['https://www.example.fr/a'])
  })

  it('links a crawled page to the engine publication, and forgets pages gone from both sources', () => {
    const plan = planIndexingSeed({
      siteId: SITE,
      property: PROPERTY,
      sources: { engine: [{ generationId: 'gen-1', url: 'https://www.example.fr/a/', publishedAt: null }], inventory: [] },
      existing: [{ url_key: 'example.fr/a', generation_id: null }, { url_key: 'example.fr/supprimee', generation_id: null }],
      now: NOW,
    })
    expect(plan.insert).toEqual([])
    expect(plan.link).toEqual([{ site_id: SITE, url: 'https://www.example.fr/a/', url_key: 'example.fr/a', generation_id: 'gen-1', priority: 0 }])
    expect(plan.remove).toEqual(['example.fr/supprimee'])
  })
})

describe('applyInspection', () => {
  it('records what Google said and schedules the next look', () => {
    const result = applyInspection(row(), inspection(), NOW)
    expect(result).toMatchObject({ state: 'not_discovered', miss_streak: 1, coverage_state: 'URL inconnue de Google', last_error: null })
    expect(result.next_check_at).toBe('2026-11-19T05:00:00.000Z')
  })

  it('keeps the known state when the call itself failed', () => {
    const result = applyInspection(row({ state: 'indexed' }), { ok: false, failure: 'error', error: 'HTTP 500' }, NOW)
    expect(result).toMatchObject({ state: 'indexed', last_error: 'HTTP 500', next_check_at: '2026-11-18T05:00:00.000Z' })
  })
})

// ─── The run, against fakes ─────────────────────────────────────────────────

function fakeStore(due: PageIndexingRow[], overrides: Partial<IndexingStore> = {}) {
  const saved: IndexingResult[] = []
  const inserted: NewIndexingRow[] = []
  const deleted: string[] = []
  const store: IndexingStore = {
    loadSources: async () => ({ engine: [], inventory: due.map((page) => page.url) }),
    listKeys: async () => due.map((page) => ({ url_key: page.url_key, generation_id: page.generation_id })),
    insertRows: async (rows) => { inserted.push(...rows) },
    linkRows: async () => {},
    deleteRows: async (_siteId, keys) => { deleted.push(...keys) },
    listDue: async () => due,
    saveResults: async (rows) => { saved.push(...rows) },
    ...overrides,
  }
  return { store, saved, inserted, deleted }
}

function deps(store: IndexingStore, answers: Record<string, InspectionOutcome>, overrides: Partial<IndexCheckDeps> = {}) {
  const resubmitSitemaps = vi.fn(async () => ({ submitted: ['https://www.example.fr/sitemap.xml'], problems: [] }))
  const submitIndexNow = vi.fn(async (urls: readonly string[]) => ({ submitted: [...urls] }))
  const inspect = vi.fn(async (_fetch: unknown, _property: string, url: string) => answers[url] ?? inspection())
  const value: IndexCheckDeps = {
    store,
    connect: async () => ({ fetch: async () => new Response(), property: PROPERTY }),
    inspect,
    resubmitSitemaps,
    submitIndexNow,
    now: () => NOW,
    ...overrides,
  }
  return { value, resubmitSitemaps, submitIndexNow, inspect }
}

const UNKNOWN = row({ id: 'a', url: 'https://www.example.fr/a/', url_key: 'example.fr/a' })
const NOINDEX = row({ id: 'b', url: 'https://www.example.fr/b/', url_key: 'example.fr/b' })
const INDEXED = row({ id: 'c', url: 'https://www.example.fr/c/', url_key: 'example.fr/c' })

describe('checkSiteIndexing', () => {
  it('resends only the page Google has not crawled — never the one in noindex', async () => {
    const { store, saved } = fakeStore([UNKNOWN, NOINDEX, INDEXED])
    const { value, resubmitSitemaps, submitIndexNow } = deps(store, {
      [NOINDEX.url]: inspection({ verdict: 'FAIL', indexingState: 'BLOCKED_BY_META_TAG' }),
      [INDEXED.url]: inspection({ verdict: 'PASS', lastCrawlTime: '2026-11-10T00:00:00Z' }),
    })

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(report).toMatchObject({ status: 'success', inspected: 3, resubmitted: 1, states: { not_discovered: 1, blocked: 1, indexed: 1 } })
    expect(resubmitSitemaps).toHaveBeenCalledTimes(1)
    expect(submitIndexNow).toHaveBeenCalledWith([UNKNOWN.url])
    expect(saved.find((result) => result.url === UNKNOWN.url)).toMatchObject({ resubmit_count: 1, last_resubmitted_at: NOW.toISOString() })
    expect(saved.find((result) => result.url === NOINDEX.url)?.last_resubmitted_at).toBeNull()
  })

  it('writes every column on every row, so a failed call beside a success cannot null a state in the batch', async () => {
    const { store, saved } = fakeStore([row({ ...UNKNOWN, state: 'indexed' }), INDEXED])
    const { value, resubmitSitemaps } = deps(store, {
      [UNKNOWN.url]: { ok: false, failure: 'error', error: 'URL Inspection 500 : backend error' },
      [INDEXED.url]: inspection({ verdict: 'PASS', lastCrawlTime: '2026-11-10T00:00:00Z' }),
    })

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(report).toMatchObject({ status: 'success', inspected: 1, resubmitted: 0 })
    expect(report.problems).toEqual([`${UNKNOWN.url} : URL Inspection 500 : backend error`])
    expect(Object.keys(saved[0]).sort()).toEqual(Object.keys(saved[1]).sort())
    expect(saved[0]).toMatchObject({ state: 'indexed', last_error: 'URL Inspection 500 : backend error' })
    expect(resubmitSitemaps).not.toHaveBeenCalled()
  })

  it('does not resend a page resent three days ago', async () => {
    const recent = row({ ...UNKNOWN, last_resubmitted_at: '2026-11-14T05:00:00.000Z', resubmit_count: 1 })
    const { store } = fakeStore([recent])
    const { value, resubmitSitemaps } = deps(store, {})

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(report.resubmitted).toBe(0)
    expect(resubmitSitemaps).not.toHaveBeenCalled()
  })

  it('stops at the first quota refusal instead of spending it on every remaining page', async () => {
    const { store, saved } = fakeStore([UNKNOWN, NOINDEX, INDEXED])
    const { value, inspect } = deps(store, {
      [NOINDEX.url]: { ok: false, failure: 'quota', error: 'URL Inspection 429 : Quota exceeded' },
    })

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(inspect).toHaveBeenCalledTimes(2)
    expect(report).toMatchObject({ status: 'partial', inspected: 1, stoppedBy: 'quota' })
    expect(saved.map((result) => result.url)).toEqual([UNKNOWN.url])
  })

  it('skips a site without a Search Console property, and says why', async () => {
    const { store } = fakeStore([UNKNOWN])
    const { value, inspect } = deps(store, {}, { connect: async () => ({ fetch: async () => new Response(), property: null }) })

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(report).toMatchObject({ status: 'skipped', skipReason: 'no_property' })
    expect(inspect).not.toHaveBeenCalled()
  })

  it('deletes nothing when the known pages cannot be read', async () => {
    const { store, deleted } = fakeStore([UNKNOWN], { loadSources: async () => { throw new Error('site_pages illisible') } })
    const { value } = deps(store, {})

    const report = await checkSiteIndexing(SITE, {}, value)

    expect(deleted).toEqual([])
    expect(report.problems[0]).toContain('site_pages illisible')
    expect(report.inspected).toBe(1)
  })

  it('refuses a second run on the same site while the first is in progress', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { store } = fakeStore([UNKNOWN], { listDue: async () => { await gate; return [UNKNOWN] } })
    const { value } = deps(store, {})

    const first = checkSiteIndexing(SITE, {}, value)
    const second = await checkSiteIndexing(SITE, {}, value)
    release()

    expect(second).toMatchObject({ status: 'skipped', skipReason: 'already_running' })
    expect((await first).status).toBe('success')
  })
})
