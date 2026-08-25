import { afterEach, describe, expect, it, vi } from 'vitest'
import { crawlPage, crawlWebsite, extractUrlsFromSitemap, MAX_NESTED_SITEMAPS } from './crawler'

// No network anywhere in this file. Sitemap extraction takes an injected
// fetcher, page parsing goes through a stubbed global fetch. That is the whole
// point: the sitemap-index bug these tests lock down lived for as long as it did
// because nothing could observe it offline.

const BASE = 'https://taxi-troyes.fr'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** What every WordPress equipped with Yoast or RankMath actually serves. */
const YOAST_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${BASE}/page-sitemap.xml</loc>
    <lastmod>2026-02-01T10:00:00+00:00</lastmod>
  </sitemap>
  <sitemap>
    <loc>${BASE}/post-sitemap.xml</loc>
    <lastmod>2026-03-01T10:00:00+00:00</lastmod>
  </sitemap>
</sitemapindex>`

const PAGE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE}/taxi-troyes</loc>
    <lastmod>2026-01-15T09:00:00+00:00</lastmod>
  </url>
  <url>
    <loc>${BASE}/taxi-sainte-savine</loc>
    <lastmod>2026-04-20T09:00:00+00:00</lastmod>
  </url>
</urlset>`

const POST_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE}/blog/vsl-conventionne</loc>
    <lastmod>2026-02-10T09:00:00+00:00</lastmod>
  </url>
  <url>
    <loc>${BASE}/blog/gare-de-troyes</loc>
  </url>
</urlset>`

/** A double for SitemapFetcher, recording what was actually asked for. */
function fetcherFor(files: Record<string, string>) {
  const calls: string[] = []
  const fetcher = async (url: string): Promise<string | null> => {
    calls.push(url)
    return files[url] ?? null
  }
  return { fetcher, calls }
}

// ─── extractUrlsFromSitemap ──────────────────────────────────────────────────

describe('extractUrlsFromSitemap', () => {
  it('follows a Yoast sitemap index instead of returning nothing', async () => {
    // THE regression. Before the fix the only <loc> of an index pointed at .xml
    // files, the final filter dropped all of them, and the function answered
    // "this site has zero page" to every consumer of the inventory.
    const { fetcher } = fetcherFor({
      [`${BASE}/page-sitemap.xml`]: PAGE_SITEMAP,
      [`${BASE}/post-sitemap.xml`]: POST_SITEMAP,
    })

    const entries = await extractUrlsFromSitemap(YOAST_INDEX, BASE, fetcher)

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.map((e) => e.url)).toContain(`${BASE}/taxi-sainte-savine`)
    expect(entries.map((e) => e.url)).toContain(`${BASE}/blog/vsl-conventionne`)
    expect(entries.every((e) => !e.url.endsWith('.xml'))).toBe(true)
  })

  it('still reads a plain <urlset>, and asks for nothing', async () => {
    const { fetcher, calls } = fetcherFor({})

    const entries = await extractUrlsFromSitemap(PAGE_SITEMAP, BASE, fetcher)

    expect(entries.map((e) => e.url)).toEqual([
      `${BASE}/taxi-sainte-savine`,
      `${BASE}/taxi-troyes`,
    ])
    expect(calls).toEqual([])
  })

  it('sorts by lastmod descending and leaves undated pages last', async () => {
    // The cap truncates after this sort, so the order decides which pages an
    // inventory of 300 keeps out of a site of 2 000.
    const { fetcher } = fetcherFor({
      [`${BASE}/page-sitemap.xml`]: PAGE_SITEMAP,
      [`${BASE}/post-sitemap.xml`]: POST_SITEMAP,
    })

    const entries = await extractUrlsFromSitemap(YOAST_INDEX, BASE, fetcher)

    expect(entries[0].url).toBe(`${BASE}/taxi-sainte-savine`) // 2026-04-20
    expect(entries[0].lastmod).toBe('2026-04-20T09:00:00+00:00')
    expect(entries[entries.length - 1].url).toBe(`${BASE}/blog/gare-de-troyes`)
    expect(entries[entries.length - 1].lastmod).toBeNull()
  })

  it('does not take a second level, even when a child lists itself', async () => {
    // A sitemap cycle must cost one round trip, not an endless crawl.
    const selfReferencing = `<?xml version="1.0"?>
      <sitemapindex>
        <sitemap><loc>${BASE}/loop-sitemap.xml</loc></sitemap>
      </sitemapindex>`
    const { fetcher, calls } = fetcherFor({ [`${BASE}/loop-sitemap.xml`]: selfReferencing })

    const entries = await extractUrlsFromSitemap(selfReferencing, BASE, fetcher)

    expect(calls).toEqual([`${BASE}/loop-sitemap.xml`])
    expect(entries).toEqual([])
  })

  it('caps how many child sitemaps it is willing to fetch', async () => {
    const children = Array.from({ length: MAX_NESTED_SITEMAPS + 5 }, (_, i) => `${BASE}/s${i}.xml`)
    const index = `<sitemapindex>${children
      .map((c) => `<sitemap><loc>${c}</loc></sitemap>`)
      .join('')}</sitemapindex>`
    const { fetcher, calls } = fetcherFor(
      Object.fromEntries(children.map((c, i) => [c, `<urlset><url><loc>${BASE}/p${i}</loc></url></urlset>`]))
    )

    await extractUrlsFromSitemap(index, BASE, fetcher)

    expect(calls).toHaveLength(MAX_NESTED_SITEMAPS)
  })

  it('ignores the <image:loc> a Yoast image sitemap attaches to each page', async () => {
    // Counting those as pages would fill the cap with .jpg addresses.
    const withImages = `<urlset>
      <url>
        <loc>${BASE}/taxi-troyes</loc>
        <image:image><image:loc>${BASE}/wp-content/voiture.jpg</image:loc></image:image>
      </url>
    </urlset>`

    const entries = await extractUrlsFromSitemap(withImages, BASE, fetcherFor({}).fetcher)

    expect(entries.map((e) => e.url)).toEqual([`${BASE}/taxi-troyes`])
  })
})

// ─── Page parsing ────────────────────────────────────────────────────────────

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } })
}

const CANONICAL_HTML = `<!doctype html><html><head>
<title>Taxi Troyes</title>
<link rel="canonical" href="${BASE}/taxi-troyes/" />
<meta name="robots" content="noindex,follow" />
</head><body><h1>Taxi a Troyes</h1><p>Une course, un chauffeur.</p></body></html>`

/** Same declarations, shouted, and with a relative canonical. */
const SHOUTING_HTML = `<!DOCTYPE HTML><HTML><HEAD>
<TITLE>Taxi Sainte-Savine</TITLE>
<LINK REL="CANONICAL" HREF="/Taxi-Sainte-Savine/">
<META NAME="ROBOTS" CONTENT="NOINDEX, FOLLOW">
</HEAD><BODY><H1>Taxi a Sainte-Savine</H1></BODY></HTML>`

const PLAIN_HTML = `<!doctype html><html><head>
<title>Accueil</title>
<meta name="robots" content="index,follow" />
</head><body><h1>Accueil</h1></body></html>`

describe('crawlPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts the canonical as a normalised path and reads noindex', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(CANONICAL_HTML)))

    const page = await crawlPage(`${BASE}/taxi-troyes`, BASE)

    // Path, not href: stored in any other shape it would never match a takenPath.
    expect(page?.canonicalPath).toBe('/taxi-troyes')
    expect(page?.robotsNoindex).toBe(true)
  })

  it('reads both declarations whatever the case, and resolves a relative canonical', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(SHOUTING_HTML)))

    const page = await crawlPage(`${BASE}/taxi-sainte-savine`, BASE)

    expect(page?.canonicalPath).toBe('/taxi-sainte-savine')
    expect(page?.robotsNoindex).toBe(true)
  })

  it('leaves canonicalPath null and robotsNoindex false when nothing is declared', async () => {
    // `index,follow` must never be read as noindex: a page wrongly marked
    // de-indexed stops counting as competition and the engine writes over it.
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(PLAIN_HTML)))

    const page = await crawlPage(BASE, BASE)

    expect(page?.canonicalPath).toBeNull()
    expect(page?.robotsNoindex).toBe(false)
  })
})

// ─── The cap, and the flag that admits it ────────────────────────────────────

describe('crawlWebsite', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubSite(sitemapXml: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url === `${BASE}/sitemap.xml`) return new Response(sitemapXml, { status: 200 })
        if (url.endsWith('.xml')) return new Response('', { status: 404 })
        return htmlResponse(PLAIN_HTML)
      })
    )
  }

  it('reports truncated and keeps the most recent pages when the cap bites', async () => {
    stubSite(PAGE_SITEMAP)

    const result = await crawlWebsite({ siteUrl: BASE, maxPages: 1, followLinks: false })

    expect(result.truncated).toBe(true)
    expect(result.pages.map((p) => p.url)).toEqual([`${BASE}/taxi-sainte-savine`])
  })

  it('does not claim truncation when everything known was crawled', async () => {
    stubSite(PAGE_SITEMAP)

    const result = await crawlWebsite({ siteUrl: BASE, maxPages: 50, followLinks: false })

    expect(result.truncated).toBe(false)
    expect(result.pages).toHaveLength(2)
  })
})
