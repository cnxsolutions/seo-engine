import { listPublishedGenerations } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const generations = await listPublishedGenerations()
  const urls = generations
    .map((generation) => {
      if (!generation.published_url) return ''
      return `
  <url>
    <loc>${escapeXml(generation.published_url)}</loc>
    <lastmod>${new Date(generation.updated_at).toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${generation.focus_keyword ? '0.8' : '0.6'}</priority>
  </url>`
    })
    .filter(Boolean)
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
