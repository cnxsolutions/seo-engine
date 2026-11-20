import { NextRequest, NextResponse } from 'next/server'
import { getSiteById } from '@/lib/db'
import { indexCheckJobOf, startIndexCheck } from '@/lib/indexing/check'

/**
 * « Vérifier maintenant » — inspect a site's pages through Search Console
 * without waiting for the night's run (lib/indexing/check.ts).
 *
 * POST starts it and answers at once (202): a check of a few hundred pages
 * outlasts the proxy's request timeout. GET says where it is.
 */
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const site = await getSiteById(id)
  if (!site) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

  return NextResponse.json({ job: startIndexCheck(site.id) }, { status: 202 })
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return NextResponse.json({ job: indexCheckJobOf(id) })
}
