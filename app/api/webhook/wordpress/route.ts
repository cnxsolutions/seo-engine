import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get('X-SEO-Engine-Key')
    if (!apiKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { event, data } = body

    const supabase = createServiceClient()

    switch (event) {
      case 'page_published': {
        const { page_id, slug, url } = data
        const { error } = await supabase
          .from('generations')
          .update({
            status: 'published',
            published_url: url,
            published_page_id: page_id,
          })
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
