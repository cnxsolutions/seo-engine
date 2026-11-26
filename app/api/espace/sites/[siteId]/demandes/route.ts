import { NextResponse, type NextRequest } from 'next/server'
import { REQUEST_TEXT, SIGN_IN_TEXT } from '@/lib/client-space/labels'
import { RequestSubmissionBody, readJson } from '@/lib/client-space/schemas'
import { getClientSession } from '@/lib/client-space/session'
import { submitForMember } from '@/lib/keyword-requests/submit'
import { parisDay } from '@/src/core/domain/client-space/overview'

/**
 * POST /api/espace/sites/<site>/demandes — KW-1, KW-2.
 *
 * The third check of the client space: the session is re-read here, and the
 * site must belong to its client (submitForMember → scope.ts), or 404. The
 * answer carries codes and dates; the form says them in words (labels.ts).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const current = await getClientSession()
  if (current.status !== 'active') return NextResponse.json({ error: SIGN_IN_TEXT.sessionRequired }, { status: 401 })

  const parsed = RequestSubmissionBody.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: REQUEST_TEXT.unavailable }, { status: 400 })

  const { siteId } = await params
  try {
    const result = await submitForMember({ session: current.session, siteId, body: parsed.data })
    switch (result.kind) {
      case 'not_found':
        return NextResponse.json({ error: 'Introuvable.' }, { status: 404 })
      case 'invalid':
        return NextResponse.json({ problems: result.problems }, { status: 422 })
      case 'limited':
        return NextResponse.json(
          { error: REQUEST_TEXT.tooMany(result.retryAfterSeconds) },
          { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
        )
      case 'done':
        return NextResponse.json({
          outcomes: result.outcomes.map((outcome) => ({
            keyword: outcome.keyword,
            outcome: outcome.outcome,
            day: outcome.outcome === 'duplicate' ? parisDay(outcome.created_at) : null,
          })),
        })
    }
  } catch (error) {
    console.error('[espace] envoi de demandes :', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: REQUEST_TEXT.unavailable }, { status: 500 })
  }
}
