import { NextRequest, NextResponse } from 'next/server'
import { getSiteById } from '@/lib/db'
import { refreshJobOf, startInventoryRefresh } from '@/lib/existing/refresh'

/**
 * Re-read the pages already online on a site — the crawl alone, without the
 * strategy wizard the interface used to send this through (lib/existing/refresh.ts).
 *
 * POST starts it and answers at once (202): a crawl outlasts the proxy's
 * request timeout. GET says where it is.
 */
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const site = await getSiteById(id)
  if (!site) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
  if (!site.url) return NextResponse.json({ error: 'Ce site n’a pas d’adresse à lire' }, { status: 400 })

  const job = startInventoryRefresh({ id: site.id, url: site.url })
  return NextResponse.json({ job }, { status: 202 })
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return NextResponse.json({ job: refreshJobOf(id) })
}
