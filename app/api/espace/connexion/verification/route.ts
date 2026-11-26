import { NextResponse, type NextRequest } from 'next/server'
import { safeNextPath } from '@/src/core/domain/client-access/policy'
import { clientIp } from '@/lib/client-ip'
import { SIGN_IN_TEXT } from '@/lib/client-space/labels'
import { createRequestAuthClient } from '@/lib/client-space/request-auth'
import { CodeVerificationBody, readJson } from '@/lib/client-space/schemas'
import { verifySignInCode } from '@/lib/client-space/sign-in'

/**
 * POST /api/espace/connexion/verification — the six digits.
 *
 * On success the session cookies ride on this response, and the page goes
 * where `redirect` says: inside the space only (safeNextPath).
 */
export async function POST(req: NextRequest) {
  const parsed = CodeVerificationBody.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: SIGN_IN_TEXT.invalidCodeFormat }, { status: 400 })

  const auth = await createRequestAuthClient()
  if (!auth) return NextResponse.json({ error: SIGN_IN_TEXT.unavailable }, { status: 503 })

  const result = await verifySignInCode({ ...parsed.data, ip: clientIp(req.headers), auth })

  if (result.status === 'limited') {
    return NextResponse.json(
      { error: SIGN_IN_TEXT.tooMany(result.retryAfterSeconds) },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
    )
  }
  if (result.status === 'invalid') return NextResponse.json({ error: SIGN_IN_TEXT.codeRejected }, { status: 400 })
  return NextResponse.json({ redirect: safeNextPath(parsed.data.suite) })
}
