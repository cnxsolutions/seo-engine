// ─────────────────────────────────────────────────────────────────────────────
// The engine's own sitemap — tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { engineSitemapUrl, renderEngineSitemap } from './engine-sitemap'

describe('renderEngineSitemap', () => {
  it('lists each URL once, with its most recent day, sorted', () => {
    const xml = renderEngineSitemap([
      { url: 'https://www.flowyne.com/b', lastmod: '2026-10-20T07:00:00Z' },
      { url: 'https://www.flowyne.com/a', lastmod: '2026-10-21' },
      { url: 'https://www.flowyne.com/b', lastmod: '2026-10-22T09:30:00Z' },
      { url: 'https://www.flowyne.com/c' },
    ])

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.match(/<url>/g)).toHaveLength(3)
    expect(xml.indexOf('/a<')).toBeLessThan(xml.indexOf('/b<'))
    expect(xml).toContain('<loc>https://www.flowyne.com/b</loc><lastmod>2026-10-22</lastmod>')
    expect(xml).toContain('<loc>https://www.flowyne.com/c</loc></url>')
  })

  it('escapes what XML cannot carry raw', () => {
    expect(renderEngineSitemap([{ url: 'https://x.fr/?a=1&b=2' }])).toContain('<loc>https://x.fr/?a=1&amp;b=2</loc>')
  })

  it('lives at the root of the site', () => {
    expect(engineSitemapUrl('https://www.flowyne.com/')).toBe('https://www.flowyne.com/sitemap-seo.xml')
  })
})
