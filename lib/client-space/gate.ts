// ─────────────────────────────────────────────────────────────────────────────
// The client space's branch of proxy.ts
// docs/cadrage.md ACC-5, § 4.4
// ─────────────────────────────────────────────────────────────────────────────
//
// `/espace`, `/api/espace` and `/auth` leave the operator's Basic gate — a
// client must never see the browser's native credential prompt — and pass
// through this one instead:
//
//   1. refresh the Supabase session, so server components read a fresh one
//      (they cannot write cookies themselves);
//   2. without a session, a page goes to the sign-in page, an API call gets a
//      401 WITHOUT a Basic challenge;
//   3. with one, the request goes on — and the layout of the space and each
//      route check the MEMBERSHIP again (lib/client-space/session.ts). This is
//      the first of three checks; none of them is enough alone.
//
// Nothing a member sees may sit in a shared cache: `no-store` on every answer.

import { NextResponse, type NextRequest } from 'next/server'
import { publicUrl } from '@/lib/public-origin'
import { createAuthClient, readClientAuthEnv } from './auth-client'
import { SIGN_IN_TEXT } from './labels'

/** Same segment-shaped form as the webhook exception of proxy.ts: `/espacex` is NOT in. */
const CLIENT_SPACE_PATH = /^\/(?:espace|api\/espace|auth)(?:\/|$)/

/**
 * Reached without a session: the sign-in page, its two API calls, the e-mail
 * link and sign-out — and the unsubscribe page and its POST (L7), which must
 * work from any mailbox; the token they carry opens one setting, nothing else.
 */
const PUBLIC_CLIENT_PATH = /^\/(?:espace\/connexion|api\/espace\/connexion|espace\/desinscription|api\/espace\/desinscription|auth)(?:\/|$)/

const NO_STORE = 'private, no-store'

export function isClientSpacePath(pathname: string): boolean {
  return CLIENT_SPACE_PATH.test(pathname)
}

export function isPublicClientPath(pathname: string): boolean {
  return PUBLIC_CLIENT_PATH.test(pathname)
}

export async function clientSpaceGate(req: NextRequest): Promise<NextResponse> {
  const env = readClientAuthEnv()
  // Fail closed, like the operator gate: no public key, no client space.
  if (!env) return noStore(NextResponse.json({ error: SIGN_IN_TEXT.unavailable }, { status: 503 }))

  let response = NextResponse.next({ request: req })
  const auth = createAuthClient(env, {
    getAll: () => req.cookies.getAll(),
    setAll: (list) => {
      // Onto the request, for the server components downstream; onto the
      // response, for the browser.
      for (const { name, value } of list) req.cookies.set(name, value)
      response = NextResponse.next({ request: req })
      for (const { name, value, options } of list) response.cookies.set(name, value, options)
    },
  })

  const { data } = await auth.auth.getClaims()
  const signedIn = Boolean(data?.claims?.sub)
  const { pathname, search } = req.nextUrl

  if (signedIn || isPublicClientPath(pathname)) return noStore(response)

  if (pathname.startsWith('/api/')) {
    return noStore(carryCookies(response, NextResponse.json({ error: SIGN_IN_TEXT.sessionRequired }, { status: 401 })))
  }

  const signIn = publicUrl('/espace/connexion', req)
  if (pathname !== '/espace') signIn.searchParams.set('suite', `${pathname}${search}`)
  return noStore(carryCookies(response, NextResponse.redirect(signIn)))
}

/** A dead session the library just cleared must be cleared in the browser too. */
function carryCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie)
  return to
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', NO_STORE)
  return response
}
