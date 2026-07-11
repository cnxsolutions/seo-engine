import { NextRequest, NextResponse } from 'next/server'
import { POST as publishPost } from '@/app/api/publish/route'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const proxyRequest = new NextRequest(req.url.replace('/publish/wordpress', '/publish'), {
    method: 'POST',
    body: JSON.stringify({
      page: body.page,
      publishStatus: body.publishStatus ?? 'draft',
      siteId: body.siteId,
    }),
    headers: req.headers,
  })

  if (!body.siteId) {
    return NextResponse.json({ error: 'siteId est requis pour la route unifiee.' }, { status: 400 })
  }

  return publishPost(proxyRequest)
}
