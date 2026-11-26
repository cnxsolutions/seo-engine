import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson } from '@/lib/client-space/schemas'
import { arbitrate } from '@/lib/keyword-requests/arbitrate'
import { QUEUE_TEXT } from '@/lib/keyword-requests/operator-labels'

/**
 * POST /api/demandes/<demande> — CNX arbitrates a client request (KW-10).
 *
 * Behind the operator gate (proxy.ts): no client ever reaches it. The body
 * names the gesture; the domain decides whether the request's status allows it
 * (src/core/domain/keyword-requests/arbitration.ts).
 *
 *   200 { status }            written
 *   404                       no such request
 *   409 { error }             the request moved meanwhile: the console reloads
 *   422 { problem, error }    a missing or too long reason, a site without campaign
 */
const ArbitrationBody = z.object({
  action: z.enum(['integrate', 'defer', 'decline', 'reopen']),
  reason: z.string().max(2000).nullish(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = ArbitrationBody.safeParse(await readJson(req))
  if (!parsed.success || !z.guid().safeParse(id).success) {
    return NextResponse.json({ error: QUEUE_TEXT.failed }, { status: 400 })
  }

  try {
    const outcome = await arbitrate({ requestId: id, action: parsed.data.action, reason: parsed.data.reason })
    switch (outcome.kind) {
      case 'not_found':
        return NextResponse.json({ error: 'Introuvable.' }, { status: 404 })
      case 'changed':
        return NextResponse.json({ error: QUEUE_TEXT.changed }, { status: 409 })
      case 'problem':
        return NextResponse.json(
          { problem: outcome.problem, error: QUEUE_TEXT.problems[outcome.problem] },
          { status: outcome.problem === 'not_allowed' ? 409 : 422 },
        )
      case 'done':
        return NextResponse.json({ status: outcome.status, reasonCode: outcome.reasonCode })
    }
  } catch (error) {
    console.error('[demandes] arbitrage :', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: QUEUE_TEXT.failed }, { status: 500 })
  }
}
