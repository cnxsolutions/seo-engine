import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedClient } from '@/lib/google/client'
import { submitSitemap } from '@/lib/google/gsc'

/**
 * Submit a site's sitemap to Google Search Console.
 *
 * This route used to GET `https://www.google.com/ping?sitemap=…`, an endpoint
 * Google retired in June 2023. It answers 404, so `response.ok` was false on
 * every call and the route returned a systematic 422 — "sitemap submission is
 * broken" was in fact the only thing it could ever say.
 *
 * The replacement is the Search Console Sitemaps API, which needs an
 * authenticated connection for the site. That is why `siteId` is now required:
 * the old ping needed no credentials because it did nothing.
 *
 * Note the OAuth scope. Submitting a sitemap is a WRITE, so a connection
 * authorised under the previous `webmasters.readonly` scope gets a 403 until the
 * site is reconnected — `submitSitemap` says so explicitly rather than reporting
 * a generic failure.
 */
export async function POST(req: NextRequest) {
  try {
    const { siteId, siteUrl, sitemapUrl } = await req.json()

    if (!siteId) {
      return NextResponse.json(
        { error: "siteId requis : la soumission de sitemap passe par l'API Search Console, qui exige une connexion Google." },
        { status: 400 }
      )
    }

    if (!siteUrl) {
      return NextResponse.json({ error: 'siteUrl requis' }, { status: 400 })
    }

    const sitemap = sitemapUrl || `${String(siteUrl).replace(/\/$/, '')}/sitemap.xml`

    const client = await getAuthenticatedClient(siteId)
    const result = await submitSitemap(client.fetch, siteUrl, sitemap)

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error || 'Soumission refusee par Search Console' },
        { status: 422 }
      )
    }

    return NextResponse.json({ success: true, message: `Sitemap soumis: ${sitemap}` })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}
