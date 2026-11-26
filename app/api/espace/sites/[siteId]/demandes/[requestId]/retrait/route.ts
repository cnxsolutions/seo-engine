import { NextResponse } from 'next/server'
import { REQUEST_TEXT, SIGN_IN_TEXT } from '@/lib/client-space/labels'
import { readJson } from '@/lib/client-space/schemas'
import { getClientSession } from '@/lib/client-space/session'
import { withdrawForMember } from '@/lib/keyword-requests/submit'

/**
 * POST /api/espace/sites/<site>/demandes/<demande>/retrait — KW-9.
 *
 * A request of another client's site, or of another site, is 404 — the same
 * answer as an invented id. One being written is 409, with the reason.
 *
 * An empty JSON body is still required: an HTML form cannot send that type,
 * so a cross-site form post is refused even where `Sec-Fetch-Site` is not sent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ siteId: string; requestId: string }> }) {
  const current = await getClientSession()
  if (current.status !== 'active') return NextResponse.json({ error: SIGN_IN_TEXT.sessionRequired }, { status: 401 })

  if ((await readJson(req)) === null) return NextResponse.json({ error: REQUEST_TEXT.withdrawFailed }, { status: 400 })

  const { siteId, requestId } = await params
  try {
    const outcome = await withdrawForMember({ session: current.session, siteId, requestId })
    if (outcome === 'not_found') return NextResponse.json({ error: 'Introuvable.' }, { status: 404 })
    if (outcome === 'locked') return NextResponse.json({ error: REQUEST_TEXT.withdrawLocked }, { status: 409 })
    return NextResponse.json({ status: 'withdrawn' })
  } catch (error) {
    console.error('[espace] retrait d une demande :', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: REQUEST_TEXT.withdrawFailed }, { status: 500 })
  }
}
