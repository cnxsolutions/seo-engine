// ─────────────────────────────────────────────────────────────────────────────
// WordPress webhook
// SEO Engine - The one route deliberately left out of proxy.ts: it is
//              called by the client WordPress sites, which have no business
//              holding the operator's secret. It therefore authenticates its
//              own callers, and scopes every write to the calling site.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { timingSafeEqual } from '@/lib/crypto'
import { findSiteIdByOrigin } from '@/lib/db'
import { createServiceClient } from '@/lib/supabase'

/** Same floor as the app secret: this endpoint is reachable from the internet. */
const MIN_SECRET_LENGTH = 16

export async function POST(request: Request) {
  try {
    const expected = process.env.WORDPRESS_WEBHOOK_SECRET

    // Fail closed. Until now this route accepted *any* non-empty
    // `X-SEO-Engine-Key`, which is the same thing as accepting anyone; refusing
    // to run without a configured secret is what keeps that from coming back.
    if (!expected || expected.length < MIN_SECRET_LENGTH) {
      return NextResponse.json({ error: 'Webhook non configure' }, { status: 503 })
    }

    const presented = request.headers.get('X-SEO-Engine-Key')
    if (!presented || !(await timingSafeEqual(presented, expected))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { event, data, site_url: siteUrl } = body ?? {}

    // The key proves the caller is one of our WordPress sites; `site_url` says
    // which one. Resolving it is not a formality: every write below is scoped to
    // this id, so a site can only ever touch its own generations. Without the
    // scope, a slug shared by two sites — `plombier-troyes` on both — let the
    // first webhook to fire mark the other site's page as published.
    const siteId = typeof siteUrl === 'string' ? await findSiteIdByOrigin(siteUrl) : null
    if (!siteId) {
      return NextResponse.json({ error: 'Site inconnu' }, { status: 404 })
    }

    const supabase = createServiceClient()

    switch (event) {
      case 'page_published': {
        const slug = typeof data?.slug === 'string' ? data.slug : ''
        if (!slug) {
          return NextResponse.json({ error: 'slug requis' }, { status: 400 })
        }

        const { error } = await supabase
          .from('generations')
          .update({
            status: 'published',
            published_url: typeof data?.url === 'string' ? data.url : null,
            published_page_id: data?.page_id ?? null,
          })
          .eq('site_id', siteId)
          .eq('slug', slug)
          .eq('status', 'publishing')

        if (error) console.error('Webhook update error:', error.message)
        break
      }

      case 'page_updated': {
        // Log external updates
        break
      }

      case 'analytics_sync': {
        // Future: store analytics data
        break
      }
    }

    return NextResponse.json({ received: true, event })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook error' },
      { status: 500 }
    )
  }
}
