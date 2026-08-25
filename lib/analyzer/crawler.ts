/**
 * Website crawler — fetches sitemap and key pages to understand site structure.
 * Extracts: URLs, titles, H1s, meta descriptions, internal links, keywords, geo signals.
 */

import { normalizePath } from '@/lib/pipeline/internal-links'

export interface CrawlResult {
  siteUrl: string
  pages: CrawledPage[]
  sitemap: string[]
  totalPages: number
  crawledAt: string
  /**
   * The cap cut the inventory short: more URLs were known than were crawled.
   *
   * Everything downstream must read this as "what you did not see may
   * contradict you". A partial inventory makes the engine MORE careful — it
   * never lets it conclude that a path is free or a topic uncovered.
   */
  truncated: boolean
}

export interface CrawledPage {
  url: string
  path: string
  title: string
  metaDescription: string
  h1: string
  h2s: string[]
  wordCount: number
  internalLinks: string[]
  externalLinks: string[]
  images: { src: string; alt: string }[]
  hasSchema: boolean
  schemaTypes: string[]
  hasFaq: boolean
  hasLocalBusiness: boolean
  geoSignals: string[]
  keywords: string[]
  /**
   * Opening of the page's readable body, navigation and boilerplate removed.
   *
   * Persisted to `site_pages.content_excerpt` and embedded into the vector
   * index. Without it an embedding is built from the title and headings alone —
   * a table of contents, which retrieves badly.
   */
  textExcerpt: string
  /**
   * Path declared by `<link rel="canonical">`, normalised like every other path
   * in the engine — never the raw href.
   *
   * Tells "this URL is taken" apart from "this URL is taken by something that
   * counts": a page canonicalised elsewhere holds its address without holding a
   * ranking. Persisted to `site_pages.canonical_path` since migration 018.
   * Null when the page declares nothing.
   */
  canonicalPath: string | null
  /**
   * `<meta name="robots">` carries noindex.
   *
   * A de-indexed page cannibalises nothing, so it must not weigh in a duplicate
   * verdict the way a ranking page does. Persisted to
   * `site_pages.robots_noindex`.
   */
  robotsNoindex: boolean
}

/**
 * Characters of body text kept per page.
 *
 * 2 000 characters is roughly the first third of a typical article: enough for
 * an embedding to place the page in topic space, small enough that a 50-page
 * crawl stays a rounding error on both the database and the embedding bill.
 */
export const CONTENT_EXCERPT_MAX_CHARS = 2000

export interface CrawlOptions {
  siteUrl: string
  maxPages?: number
  followLinks?: boolean
  respectRobots?: boolean
}

/** One `<url>` of a sitemap, with the date the site claims for it. */
export interface SitemapEntry {
  url: string
  /** Whatever `<lastmod>` carried, null when the sitemap omits it. */
  lastmod: string | null
}

/**
 * Fetches one sitemap file and returns its body, or null when it cannot be read.
 *
 * Injected rather than called directly so the extraction can be exercised
 * offline: the sitemap-index bug below survived precisely because nothing could
 * observe it without a network.
 */
export type SitemapFetcher = (url: string) => Promise<string | null>

/**
 * How many child sitemaps of a `<sitemapindex>` we are willing to fetch.
 *
 * Yoast and RankMath split at 1 000 URLs per file, so ten files cover 10 000
 * pages — an order of magnitude above any cap a caller passes. The ceiling is
 * not there for coverage: it is there so a site listing hundreds of child
 * sitemaps cannot turn one crawl into hundreds of HTTP round trips.
 */
export const MAX_NESTED_SITEMAPS = 10

export async function crawlWebsite(opts: CrawlOptions): Promise<CrawlResult> {
  const { siteUrl, maxPages = 50, followLinks = true } = opts
  let baseUrl = siteUrl.replace(/\/$/, '')
  const visited = new Set<string>()
  const pages: CrawledPage[] = []

  // 0. Resolve actual base URL (handle redirects like http->https, www->non-www)
  baseUrl = await resolveBaseUrl(baseUrl)

  // 1. Try to fetch sitemap
  const sitemapEntries = await fetchSitemap(baseUrl)
  const sitemapUrls = sitemapEntries.map((entry) => entry.url)

  // The list arrives newest-first, so the cap cuts the tail: a 300-page ceiling
  // on a 2 000-page site keeps the 300 pages most likely to still rank, instead
  // of the 300 the generator happened to write first — usually the oldest.
  let truncated = sitemapEntries.length > maxPages

  // 2. Build URL queue from sitemap + homepage
  const queue: string[] = []
  if (sitemapUrls.length > 0) {
    queue.push(...sitemapUrls.slice(0, maxPages))
  } else {
    queue.push(baseUrl)
  }

  // 3. Crawl pages
  for (const url of queue) {
    if (visited.size >= maxPages) {
      // Stopped with URLs still queued. Said out loud, because an inventory that
      // admits being partial is the only kind entitled to answer "this path is
      // free".
      truncated = true
      break
    }
    if (visited.has(url)) continue
    const normalizedUrl = url.replace(/\/$/, '')
    if (!normalizedUrl.startsWith(baseUrl)) continue

    visited.add(url)
    const page = await crawlPage(url, baseUrl)
    if (page) {
      pages.push(page)

      if (followLinks && visited.size < maxPages) {
        for (const link of page.internalLinks) {
          if (!visited.has(link) && !queue.includes(link) && link.startsWith(baseUrl)) {
            queue.push(link)
          }
        }
      }
    }
  }

  return {
    siteUrl: baseUrl,
    pages,
    sitemap: sitemapUrls,
    totalPages: sitemapUrls.length || pages.length,
    crawledAt: new Date().toISOString(),
    truncated,
  }
}

async function resolveBaseUrl(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOEngine/1.0; +https://seoengine.app)',
        'Accept': 'text/html',
      },
    })
    const finalUrl = res.url || baseUrl
    return finalUrl.replace(/\/$/, '')
  } catch {
    return baseUrl
  }
}

const fetchSitemapXml: SitemapFetcher = async (url) => {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOEngine/1.0; +https://seoengine.app)',
        'Accept': 'application/xml,text/xml,text/html,*/*;q=0.5',
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function fetchSitemap(baseUrl: string): Promise<SitemapEntry[]> {
  const candidates = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/wp-sitemap.xml`,
  ]

  for (const url of candidates) {
    const xml = await fetchSitemapXml(url)
    if (!xml) continue
    const entries = await extractUrlsFromSitemap(xml, baseUrl)
    // An empty result is not an answer. Returning on the first 200 meant a stub
    // /sitemap.xml stopped the search before wp-sitemap.xml was ever tried.
    if (entries.length > 0) return entries
  }

  return []
}

/**
 * URLs declared by a sitemap, child sitemaps included, most recently modified
 * first.
 *
 * Exported because this function carried the bug that blinded the whole
 * inventory: it detected a `<sitemapindex>`, did nothing with it, then dropped
 * every `.xml` `<loc>` on the way out. On an index — what every WordPress
 * equipped with Yoast or RankMath serves — the only `<loc>` present point at
 * other .xml files, so the function returned ZERO url, site_pages stayed empty,
 * and every consumer of the inventory read "this site has no pages".
 *
 * Child sitemaps are followed ONE level and no further. Not a limitation: a
 * sitemap that lists itself, directly or through a cycle, must not be able to
 * spin the crawl forever.
 */
export async function extractUrlsFromSitemap(
  xml: string,
  baseUrl: string,
  fetcher: SitemapFetcher = fetchSitemapXml,
): Promise<SitemapEntry[]> {
  const entries = extractUrlsetEntries(xml, baseUrl)

  for (const child of extractIndexLocs(xml, baseUrl).slice(0, MAX_NESTED_SITEMAPS)) {
    const childXml = await fetcher(child)
    if (!childXml) continue
    // Only the `<urlset>` of the child is read: recursing here would be the
    // second level this function refuses to take.
    entries.push(...extractUrlsetEntries(childXml, baseUrl))
  }

  return sortByLastmodDesc(dedupeByUrl(entries))
}

/** The `<loc>` of each `<sitemap>` block, i.e. the children of an index. */
function extractIndexLocs(xml: string, baseUrl: string): string[] {
  const locs: string[] = []
  // `<sitemap\b` and not `<sitemap` alone: without the word boundary the opening
  // `<sitemapindex>` tag matches too, and the first block would start at the
  // document root instead of at a child.
  for (const block of xml.match(/<sitemap\b[^>]*>[\s\S]*?<\/sitemap>/gi) || []) {
    const loc = extractLoc(block, baseUrl)
    if (loc) locs.push(loc)
  }
  return [...new Set(locs)]
}

/** The pages of a `<urlset>`, with their declared modification date. */
function extractUrlsetEntries(xml: string, baseUrl: string): SitemapEntry[] {
  // The `<sitemap>` blocks are cut out first so a child-sitemap `<loc>` can
  // never be mistaken for a page. Telling the two apart by hand is what the old
  // `.filter(u => !u.endsWith('.xml'))` was attempting — and it took the pages
  // with it.
  const urlset = xml.replace(/<sitemap\b[^>]*>[\s\S]*?<\/sitemap>/gi, ' ')
  const entries: SitemapEntry[] = []

  for (const block of urlset.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi) || []) {
    const url = extractLoc(block, baseUrl)
    if (url) entries.push({ url, lastmod: extractFirst(block, /<lastmod\b[^>]*>([^<]+)<\/lastmod>/i) })
  }

  if (entries.length === 0) {
    // A generator that emits `<loc>` outside any `<url>` is out of spec, but
    // losing its pages would trade one silent zero for another.
    for (const loc of urlset.match(/<loc\b[^>]*>[^<]+<\/loc>/gi) || []) {
      const url = extractLoc(loc, baseUrl)
      if (url) entries.push({ url, lastmod: null })
    }
  }

  // Inside a `<urlset>`, a .xml address is a child sitemap that leaked out of a
  // malformed index — never a page.
  return entries.filter((entry) => !entry.url.toLowerCase().endsWith('.xml'))
}

/**
 * Absolute, fetchable form of the `<loc>` held by a block, or null.
 *
 * Resolved against the site base because the protocol allows a relative `<loc>`,
 * and because the previous prefix test (`url.startsWith(baseUrl)`) returned
 * nothing at all on a site serving https://www.example.fr while its sitemap
 * lists https://example.fr.
 *
 * Anchoring on `<loc` also keeps `<image:loc>` out: a Yoast image sitemap
 * carries one per page, and counting those would fill the cap with .jpg
 * addresses.
 */
function extractLoc(block: string, baseUrl: string): string | null {
  const loc = extractFirst(block, /<loc\b[^>]*>([^<]+)<\/loc>/i)
  if (!loc) return null

  // An unusable base must not cost us the absolute URLs: `new URL` throws on a
  // malformed base even when the address it is given needs no base at all.
  const base = /^https?:\/\//i.test(baseUrl) ? `${baseUrl}/` : undefined
  try {
    const url = new URL(loc, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function dedupeByUrl(entries: SitemapEntry[]): SitemapEntry[] {
  // Two child sitemaps listing the same page would otherwise burn two slots of
  // a cap that is supposed to buy coverage.
  const seen = new Set<string>()
  const unique: SitemapEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.url)) continue
    seen.add(entry.url)
    unique.push(entry)
  }
  return unique
}

/**
 * Most recently modified first, undated pages last.
 *
 * The cap truncates AFTER this sort, so what survives is the freshest slice of
 * the site. A page with no `<lastmod>` is not evidence of freshness, so it never
 * outranks one that carries a date.
 */
function sortByLastmodDesc(entries: SitemapEntry[]): SitemapEntry[] {
  return [...entries].sort((a, b) => {
    const left = timeOf(a.lastmod)
    const right = timeOf(b.lastmod)
    // Compared, never subtracted: `-Infinity - -Infinity` is NaN, and a NaN
    // comparator scrambles the order of every undated page instead of leaving
    // them where the sitemap put them.
    if (left === right) return 0
    return right > left ? 1 : -1
  })
}

/** -Infinity for a missing or unparsable date: it sorts last without a special case. */
function timeOf(lastmod: string | null): number {
  if (!lastmod) return -Infinity
  const parsed = Date.parse(lastmod.trim())
  return Number.isNaN(parsed) ? -Infinity : parsed
}

/**
 * Fetch and parse a single page.
 *
 * Exported so competitor measurement (lib/serp) can reuse this extractor rather
 * than grow a second, subtly different one: the point of measuring ranking pages
 * is comparing them to our own on the SAME ruler — same word counting, same
 * heading extraction, same FAQ detection.
 *
 * Returns null on any failure — a competitor that blocks us, times out or serves
 * a PDF is one missing measurement, never a broken plan.
 */
export async function crawlPage(url: string, baseUrl: string): Promise<CrawledPage | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOEngine/1.0; +https://seoengine.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/xml') && !contentType.includes('application/xhtml')) return null

    const html = await res.text()
    return parsePage(html, res.url || url, baseUrl)
  } catch {
    return null
  }
}

function parsePage(html: string, url: string, baseUrl: string): CrawledPage {
  // LE CHEMIN PASSE PAR LA MEME REGLE QUE TOUT LE RESTE.
  //
  // Ce calcul etait `url.replace(baseUrl, '') || '/'` : un remplacement de
  // chaine, qui gardait le slash final, la casse, la requete et l'ancre. Or
  // `canonicalPath`, quinze lignes plus bas, passe par normalizePath. Les deux
  // valeurs etaient donc mesurees sur deux regles differentes — et elles sont
  // ensuite COMPAREES.
  //
  // Ce que cela produisait, constate sur un WordPress reel : « /about/ » avec
  // pour canonique « /about ». La page se declarait canonisee AILLEURS alors
  // qu'elle se canonisait vers elle-meme, et `isComparable` l'ecartait de la
  // detection de duplicats. Sur ce site, 24 pages sur 26 etaient dans ce cas :
  // l'anti-duplication y aurait tourne a vide, sans erreur et sans test rouge.
  //
  // Passer par l'URL plutot que par un replace corrige au passage le doublon de
  // page d'accueil : « https://exemple.fr/ » et « https://www.exemple.fr/ »
  // rendent desormais le meme chemin.
  const path = normalizePath(safePathname(url, baseUrl))

  const title = extractFirst(html, /<title[^>]*>([^<]+)<\/title>/i) || ''
  const metaDescription = extractMeta(html, 'description')
  const h1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || ''
  const h2s = extractAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi)

  // The two declarations that separate "this URL is taken" from "this URL is
  // taken by a page that competes". Both are read here rather than in a second
  // parser: every field the inventory needs is extracted on the same ruler as
  // the ones competitor measurement already uses.
  const canonicalPath = extractCanonicalPath(html, baseUrl)
  const robotsNoindex = /\bnoindex\b/i.test(extractMeta(html, 'robots'))

  // Word count and readable text.
  // Scripts and styles are removed FIRST: stripping tags alone leaves their
  // contents behind, so a page carrying an inline bundle used to be counted as
  // several thousand words of minified JavaScript.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  const bodyHtml = stripNonContent(bodyMatch ? bodyMatch[1] : html)
  const bodyText = htmlToPlainText(bodyHtml)
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length

  // The excerpt drops navigation, header, footer and asides on top of that:
  // every page of a site shares them, and embedding them makes every page look
  // like every other one.
  const textExcerpt = htmlToPlainText(stripChrome(bodyHtml)).slice(0, CONTENT_EXCERPT_MAX_CHARS)

  // Links
  const allLinks = extractLinks(html)
  const internalLinks = allLinks.filter((l) => l.startsWith(baseUrl) || l.startsWith('/'))
    .map((l) => l.startsWith('/') ? `${baseUrl}${l}` : l)
    .filter((l) => l !== url)
  const externalLinks = allLinks.filter((l) => l.startsWith('http') && !l.startsWith(baseUrl))

  // Images
  const images = extractImages(html)

  // Schema.org
  const schemaMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || []
  const schemaTypes: string[] = []
  for (const match of schemaMatches) {
    const typeMatch = match.match(/"@type"\s*:\s*"([^"]+)"/g)
    if (typeMatch) {
      typeMatch.forEach((t) => {
        const val = t.match(/"@type"\s*:\s*"([^"]+)"/)
        if (val) schemaTypes.push(val[1])
      })
    }
  }

  // FAQ detection
  const hasFaq = /FAQPage|faq|question.*answer/i.test(html)
  const hasLocalBusiness = /LocalBusiness|localBusiness|local-business/i.test(html)

  // Geo signals (city names, addresses, phone patterns)
  const geoSignals = extractGeoSignals(bodyText)

  // Keywords from title + h1 + h2s + meta
  const keywords = extractKeywords(title, h1, h2s, metaDescription)

  return {
    url,
    path,
    title: stripTags(title),
    metaDescription,
    h1: stripTags(h1),
    h2s: h2s.map(stripTags),
    wordCount,
    internalLinks: [...new Set(internalLinks)].slice(0, 20),
    externalLinks: [...new Set(externalLinks)].slice(0, 10),
    images,
    hasSchema: schemaMatches.length > 0,
    schemaTypes,
    hasFaq,
    hasLocalBusiness,
    geoSignals,
    keywords,
    textExcerpt,
    canonicalPath,
    robotsNoindex,
  }
}

/**
 * The canonical as a normalised path, never the raw href.
 *
 * `new URL(href, base)` and not a prefix replacement: the tag is written
 * absolute on some sites and relative on others, and a site that canonicalises
 * to another host would otherwise produce a path made of its own domain name.
 *
 * The href is looked for in both attribute orders, like extractMeta already
 * does — `<link href="…" rel="canonical">` is legal HTML and half the themes
 * emit it.
 */
/**
 * Le chemin d'une URL, sans jamais jeter.
 *
 * Une URL que `new URL` refuse ne doit pas faire echouer le crawl de la page :
 * on retombe alors sur l'ancien retrait de prefixe, qui a le merite de rendre
 * quelque chose de comparable plutot que rien.
 */
function safePathname(url: string, baseUrl: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.replace(baseUrl, '') || '/'
  }
}

function extractCanonicalPath(html: string, baseUrl: string): string | null {
  const href =
    extractFirst(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    extractFirst(html, /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)
  if (!href) return null

  const base = /^https?:\/\//i.test(baseUrl) ? `${baseUrl}/` : undefined
  try {
    // normalizePath is the same function the link auditor and the inventory
    // use. A canonical stored in any other shape would never match a takenPath.
    return normalizePath(new URL(href, base).pathname)
  } catch {
    // A canonical we cannot parse is no canonical at all, never a crashed crawl.
    return null
  }
}

/** Removes elements whose text content is not page content. */
function stripNonContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

/** Removes the parts every page of a site repeats. */
function stripChrome(html: string): string {
  return html
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFirst(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern)
  return match ? match[1].trim() : null
}

function extractAll(html: string, pattern: RegExp): string[] {
  const results: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    results.push(match[1].trim())
  }
  return results
}

function extractMeta(html: string, name: string): string {
  const pattern = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i')
  const match = html.match(pattern)
  if (match) return match[1]
  const pattern2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i')
  const match2 = html.match(pattern2)
  return match2 ? match2[1] : ''
}

function extractLinks(html: string): string[] {
  const links: string[] = []
  const pattern = /href=["']([^"'#]+)["']/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1].trim()
    if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      links.push(href)
    }
  }
  return links
}

function extractImages(html: string): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = []
  const pattern = /<img[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0]
    const src = tag.match(/src=["']([^"']+)["']/)?.[1] || ''
    const alt = tag.match(/alt=["']([^"']*?)["']/)?.[1] || ''
    if (src) images.push({ src, alt })
  }
  return images.slice(0, 20)
}

function extractGeoSignals(text: string): string[] {
  const signals: string[] = []
  // French postal codes
  const postalCodes = text.match(/\b(0[1-9]|[1-9]\d)\d{3}\b/g)
  if (postalCodes) signals.push(...postalCodes.slice(0, 5))
  // Phone numbers
  const phones = text.match(/(?:0[1-9][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/g)
  if (phones) signals.push(...phones.slice(0, 3))
  // Common geo terms
  const geoTerms = text.match(/\b(?:rue|avenue|boulevard|place|chemin|impasse|quartier)\s+[A-Z][a-zéèê]+/gi)
  if (geoTerms) signals.push(...geoTerms.slice(0, 5))
  return [...new Set(signals)]
}

function extractKeywords(title: string, h1: string, h2s: string[], meta: string): string[] {
  const sources = [title, h1, ...h2s, meta]
    .map((s) => stripTags(s).toLowerCase().trim())
    .filter(Boolean)

  const stopWords = new Set([
    'dans', 'pour', 'avec', 'votre', 'notre', 'plus', 'tout', 'tous', 'cette',
    'chez', 'sont', 'nous', 'vous', 'leur', 'même', 'aussi', 'très', 'bien',
    'fait', 'être', 'avoir', 'quoi', 'comment', 'pourquoi', 'vers', 'depuis',
    'entre', 'comme', 'elle', 'elles', 'ceux', 'cela', 'dont', 'sans',
    'sous', 'après', 'avant', 'quel', 'quelle', 'mais', 'encore', 'déjà',
    'autres', 'autre', 'chaque', 'faire', 'peut', 'page', 'site', 'accueil',
    'menu', 'navigation', 'contenu', 'lire', 'suite', 'article', 'articles',
  ])

  const phrases = new Map<string, number>()

  for (const source of sources) {
    const cleaned = source.replace(/[^a-zàâäéèêëïîôùûüÿçœæ\s'-]/gi, ' ').replace(/\s+/g, ' ')
    const words = cleaned.split(' ').filter((w) => w.length > 2)

    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i <= words.length - n; i++) {
        const ngram = words.slice(i, i + n)
        if (ngram.every((w) => stopWords.has(w) || w.length <= 2)) continue
        if (ngram[0].length <= 2 || stopWords.has(ngram[0])) continue
        if (ngram[ngram.length - 1].length <= 2 || stopWords.has(ngram[ngram.length - 1])) continue
        const phrase = ngram.join(' ')
        phrases.set(phrase, (phrases.get(phrase) || 0) + 1)
      }
    }

    // Also keep meaningful single words (from title/h1 only)
    if (source === title.toLowerCase().trim() || source === h1.toLowerCase().trim()) {
      for (const word of words) {
        if (word.length > 4 && !stopWords.has(word)) {
          phrases.set(word, (phrases.get(word) || 0) + 0.5)
        }
      }
    }
  }

  return [...phrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([phrase]) => phrase)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}
