import { NextRequest, NextResponse } from 'next/server'
import { createArticle, listArticles } from '@/lib/db'

export async function GET() {
  try {
    const articles = await listArticles()
    return NextResponse.json({ articles })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const required = ['site_id', 'article_type', 'title', 'slug', 'content']

    for (const field of required) {
      if (!payload[field]) {
        return NextResponse.json({ error: `Champ requis manquant: ${field}` }, { status: 400 })
      }
    }

    const article = await createArticle({
      campaign_id: payload.campaign_id || null,
      site_id: payload.site_id,
      pillar_page_slug: payload.pillar_page_slug || null,
      article_type: payload.article_type,
      title: payload.title,
      slug: payload.slug,
      content: payload.content,
      status: payload.status || 'draft',
      published_url: payload.published_url || null,
    })

    return NextResponse.json({ success: true, article }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
