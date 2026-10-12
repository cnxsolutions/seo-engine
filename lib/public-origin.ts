// ─────────────────────────────────────────────────────────────────────────────
// The origin a visitor can actually reach
// SEO Engine - `req.url` lies behind a reverse proxy.
// ─────────────────────────────────────────────────────────────────────────────
//
// In the production container Next listens on HOSTNAME=0.0.0.0, and that is
// what it writes into `req.url`. Every redirect built with `new URL(path,
// req.url)` therefore sent the browser to `http://0.0.0.0:3000/...` — which is
// exactly what happened at the end of the Google OAuth flow: Google answered,
// the tokens were stored, and the operator landed on "Unable to connect".
//
// nginx forwards the real name and scheme (`Host`, `X-Forwarded-Proto`, set by
// deploy/bootstrap.sh). Those are the truth; `req.url` is only the fallback for
// `next dev`, where there is no proxy and it is right.

import type { NextRequest } from 'next/server'

export function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return req.nextUrl.origin

  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')

  return `${proto}://${host}`
}

/** An absolute URL on the public origin — the one to put in a redirect. */
export function publicUrl(path: string, req: NextRequest): URL {
  return new URL(path, publicOrigin(req))
}
