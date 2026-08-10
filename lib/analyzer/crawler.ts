/**
 * Website crawler — fetches sitemap and key pages to understand site structure.
 * Extracts: URLs, titles, H1s, meta descriptions, internal links, keywords, geo signals.
 */

export interface CrawlResult {
  siteUrl: string
  pages: CrawledPage[]
  sitemap: string[]
  totalPages: number
  crawledAt: string
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

export async function crawlWebsite(opts: CrawlOptions): Promise<CrawlResult> {
  const { siteUrl, maxPages = 50, followLinks = true } = opts
  let baseUrl = siteUrl.replace(/\/$/, '')
  const visited = new Set<string>()
  const pages: CrawledPage[] = []
  const sitemap: string[] = []

  // 0. Resolve actual base URL (handle redirects like http->https, www->non-www)
  baseUrl = await resolveBaseUrl(baseUrl)

  // 1. Try to fetch sitemap
  const sitemapUrls = await fetchSitemap(baseUrl)
  sitemap.push(...sitemapUrls)

  // 2. Build URL queue from sitemap + homepage
  const queue: string[] = []
  if (sitemapUrls.length > 0) {
    queue.push(...sitemapUrls.slice(0, maxPages))
  } else {
    queue.push(baseUrl)
  }

  // 3. Crawl pages
  for (const url of queue) {
    if (visited.size >= maxPages) break
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

async function fetchSitemap(baseUrl: string): Promise<string[]> {
  const sitemapUrls = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/wp-sitemap.xml`,
  ]

  for (const url of sitemapUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SEOEngine/1.0; +https://seoengine.app)',
          'Accept': 'application/xml,text/xml,text/html,*/*;q=0.5',
        },
      })
      if (!res.ok) continue
      const xml = await res.text()
      return extractUrlsFromSitemap(xml, baseUrl)
    } catch {
      continue
    }
  }

  return []
}

function extractUrlsFromSitemap(xml: string, baseUrl: string): string[] {
  const urls: string[] = []

  // Check if it's a sitemap index (contains other sitemaps)
  const sitemapLocs = xml.match(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)
  if (sitemapLocs) {
    // For now just extract direct URLs, skip nested sitemaps
  }

  // Extract <loc> from urlset
  const locMatches = xml.match(/<loc>([^<]+)<\/loc>/g)
  if (locMatches) {
    for (const match of locMatches) {
      const url = match.replace(/<\/?loc>/g, '').trim()
      if (url.startsWith(baseUrl) || url.startsWith('http')) {
        urls.push(url)
      }
    }
  }

  return urls.filter((u) => !u.endsWith('.xml'))
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
  const path = url.replace(baseUrl, '') || '/'

  const title = extractFirst(html, /<title[^>]*>([^<]+)<\/title>/i) || ''
  const metaDescription = extractMeta(html, 'description')
  const h1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || ''
  const h2s = extractAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi)

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
