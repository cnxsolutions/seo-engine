import { NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { applyEmailChoice, type EmailChoice } from '@/lib/client-space/email-preference'
import { EMAIL_PREFERENCE_TEXT } from '@/lib/client-space/labels'
import { publicUrl } from '@/lib/public-origin'
import { createRateLimiter } from '@/lib/rate-limit'
import { EMAIL_PREFERENCE_CHANGES } from '@/src/core/domain/client-access/policy'

const changes = createRateLimiter(EMAIL_PREFERENCE_CHANGES)

/**
 * POST /api/espace/desinscription/[token] — public (lib/client-space/gate.ts),
 * for two callers:
 *  - the button of /espace/desinscription/[token] (form field `choix`): back to
 *    the page, which says it is done (303);
 *  - a mail client's one-click unsubscribe (RFC 8058, the List-Unsubscribe-Post
 *    header of every client e-mail): no `choix`, it unsubscribes (200).
 * Never a GET that changes anything: link scanners open every link of an e-mail.
 * An unknown token is 404, like anything of the space that is not yours.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const verdict = changes.hit(`ip:${clientIp(req.headers)}`)
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: EMAIL_PREFERENCE_TEXT.tooMany },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
    )
  }

  const { token } = await params
  const form = await req.formData().catch(() => null)
  const field = form?.get('choix')
  const choice: EmailChoice = field === 'reabonner' ? 'resubscribe' : 'unsubscribe'

  const preference = await applyEmailChoice(token, choice)
  if (!preference) return NextResponse.json({ error: 'Lien inconnu' }, { status: 404 })

  if (typeof field !== 'string') return NextResponse.json({ ok: true })
  const done = choice === 'unsubscribe' ? 'desinscrit' : 'reabonne'
  return NextResponse.redirect(publicUrl(`/espace/desinscription/${encodeURIComponent(token)}?fait=${done}`, req), 303)
}
