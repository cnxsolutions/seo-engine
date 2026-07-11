import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { siteUrl } = await req.json()
    if (!siteUrl) {
      return NextResponse.json({ error: 'siteUrl requis' }, { status: 400 })
    }

    const sitemapUrl = `${siteUrl.replace(/\/$/, '')}/sitemap.xml`
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`
    const response = await fetch(pingUrl, { method: 'GET' })

    if (!response.ok) {
      return NextResponse.json({ success: false, message: `Ping Google invalide (${response.status})` }, { status: 422 })
    }

    return NextResponse.json({ success: true, message: `Sitemap soumis: ${sitemapUrl}` })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
