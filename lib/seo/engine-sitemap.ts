// ─────────────────────────────────────────────────────────────────────────────
// The engine's own sitemap, on Next.js sites
// SEO Engine - Every page the engine put online, listed where Google looks.
// ─────────────────────────────────────────────────────────────────────────────
//
// A Next.js site builds its sitemap in code, from its own routes: the pages the
// engine commits are not in it. On 2026-10-22 neither flowyne.com (107 URLs) nor
// artisan-boisson-teddy.fr (42 URLs) listed a single engine page, so resending
// their sitemap to Search Console would have told Google nothing new.
//
// Rather than edit code the engine does not own, it keeps a file of its own,
// `public/sitemap-seo.xml`, rewritten in full at every publication and submitted
// to Search Console next to the site's sitemap. WordPress needs none of this:
// its own sitemap lists every published page.

export const ENGINE_SITEMAP_FILE = 'sitemap-seo.xml'

export interface SitemapEntry {
  url: string
  /** ISO date or datetime; only the day is written. */
  lastmod?: string | null
}

export function engineSitemapUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/${ENGINE_SITEMAP_FILE}`
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The sitemap XML: one entry per URL — the most recent date wins when a page
 * appears twice — sorted, so two publications of the same set write the same
 * file and a commit only changes what changed.
 */
export function renderEngineSitemap(entries: readonly SitemapEntry[]): string {
  const latest = new Map<string, string | null>()
  for (const entry of entries) {
    const url = entry.url.trim()
    if (!url) continue
    const day = entry.lastmod && /^\d{4}-\d{2}-\d{2}/.test(entry.lastmod) ? entry.lastmod.slice(0, 10) : null
    const known = latest.get(url)
    if (known === undefined || (day !== null && (known === null || day > known))) latest.set(url, day)
  }

  const urls = [...latest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([url, day]) => `  <url><loc>${escapeXml(url)}</loc>${day ? `<lastmod>${day}</lastmod>` : ''}</url>`)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
