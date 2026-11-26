import { after, NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { SIGN_IN_TEXT } from '@/lib/client-space/labels'
import { CodeRequestBody, readJson } from '@/lib/client-space/schemas'
import { requestSignInCode } from '@/lib/client-space/sign-in'

/**
 * POST /api/espace/connexion/code — « send me a code ».
 *
 * The same answer for every well-formed address (lib/client-space/sign-in.ts):
 * this route must not become a way to learn who is a client of CNX.
 */
export async function POST(req: NextRequest) {
  const parsed = CodeRequestBody.safeParse(await readJson(req))
  if (!parsed.success) return NextResponse.json({ error: SIGN_IN_TEXT.invalidEmail }, { status: 400 })

  const result = await requestSignInCode({
    email: parsed.data.email,
    ip: clientIp(req.headers),
    defer: (task) => after(task),
  })

  if (result.status === 'limited') {
    return NextResponse.json(
      { error: SIGN_IN_TEXT.tooMany(result.retryAfterSeconds) },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
    )
  }
  return NextResponse.json({ message: SIGN_IN_TEXT.codeSent })
}
