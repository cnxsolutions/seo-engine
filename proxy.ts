// ─────────────────────────────────────────────────────────────────────────────
// Access gate
// SEO Engine - One shared secret in front of every page and every API route.
//              Single operator, single instance: no accounts, no sessions table,
//              no identity provider — just "prove you are the operator".
//
//              This is the `proxy` file convention. Next 16 deprecated
//              `middleware.ts` (the build warns about it) and runs `proxy.ts` on
//              the NODE.JS runtime rather than the Edge one — `export const
//              config` keeps working for the matcher, but a route segment
//              `runtime` may not be declared here. lib/crypto stays on Web
//              Crypto regardless: it is global in Node 18+, and keeping it free
//              of `node:crypto` costs nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from '@/lib/crypto'

/**
 * Shown by the browser's native credential prompt. There is no login page: the
 * dashboard is a handful of server components under app/(dashboard), and a
 * Basic challenge authenticates the pages, the fetch() calls they make and
 * `curl` alike, without a single line of UI.
 */
const REALM = 'seo-engine'

/**
 * A secret shorter than this, on a public IP, is a matter of hours. The gate
 * refuses to run with one rather than pretending to protect anything.
 */
const MIN_SECRET_LENGTH = 16

export async function proxy(req: NextRequest) {
  const expected = process.env.APP_ACCESS_SECRET

  // Fail closed, deliberately.
  //
  // The tempting alternative — "no secret configured, let everything through" —
  // means one forgotten variable in the VPS environment silently republishes the
  // whole instance to the internet: every API route, the campaign runner that
  // spends money on Anthropic and OpenAI, and the sites list. A gate that opens
  // when its configuration is missing is not a gate.
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return NextResponse.json(
      { error: `Instance verrouillee: APP_ACCESS_SECRET absente ou trop courte (${MIN_SECRET_LENGTH} caracteres minimum).` },
      { status: 503 }
    )
  }

  const presented = readPresentedSecret(req)
  if (presented === null) return challenge()

  if (!(await timingSafeEqual(presented, expected))) return challenge()

  if (isCrossSiteWrite(req)) {
    return NextResponse.json({ error: 'Requete cross-site refusee' }, { status: 403 })
  }

  return NextResponse.next()
}

/** Requests that change nothing, and so need no cross-site protection. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether a third-party page triggered this write.
 *
 * Basic credentials are *ambient*: once the browser has them it replays them on
 * every request to this origin, including a form POST that some other site
 * submits on the operator's behalf. Authentication alone would therefore leave
 * `POST /api/campaigns/[id]/run` — which ignores its body and bills Anthropic —
 * one hidden form away from anyone who gets the operator to open a page.
 *
 * `Sec-Fetch-Site` is set by the browser itself and cannot be forged from a
 * page. Its absence means a non-browser client (curl, the plugin, a script),
 * which is not a confused deputy and is let through. Deliberately no fallback on
 * `Origin` vs the request host: behind a reverse proxy the two disagree often
 * enough to reject the operator's own dashboard.
 */
function isCrossSiteWrite(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false

  const fetchSite = req.headers.get('sec-fetch-site')
  return fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none'
}

/**
 * The secret as the caller sent it, or null when the request carries none.
 *
 * Three shapes, one secret. `X-App-Secret` is for scripts and `curl`, `Bearer`
 * for anything that already speaks OAuth-ish headers, and `Basic` exists purely
 * so that a browser handed a 401 prompts for the secret by itself — the username
 * half is ignored on purpose, there is only one operator to authenticate.
 */
function readPresentedSecret(req: NextRequest): string | null {
  const headerSecret = req.headers.get('x-app-secret')
  if (headerSecret) return headerSecret

  const authorization = req.headers.get('authorization')
  if (!authorization) return null

  const [scheme, value] = splitOnce(authorization, ' ')
  if (!value) return null

  if (scheme.toLowerCase() === 'bearer') return value

  if (scheme.toLowerCase() === 'basic') {
    const decoded = decodeBase64(value)
    if (decoded === null) return null
    const [, password] = splitOnce(decoded, ':')
    return password || null
  }

  return null
}

/**
 * 401 with the Basic challenge attached, used both for "no credentials" and for
 * "wrong credentials": telling those two apart only helps whoever is guessing.
 */
function challenge() {
  return NextResponse.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
        // Nothing behind this gate may sit in a shared cache.
        'Cache-Control': 'no-store',
      },
    }
  )
}

/** `atob` yields a binary string; the round-trip through bytes keeps UTF-8 secrets intact. */
function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator)
  if (index === -1) return [value, '']
  return [value.slice(0, index), value.slice(index + separator.length)]
}

export const config = {
  matcher: [
    /*
     * Everything, minus a short list:
     *
     * - api/webhook/wordpress : called by the client WordPress sites, which have
     *   no business holding the operator's secret. It authenticates its callers
     *   itself, per site — see app/api/webhook/wordpress/route.ts.
     * - _next/static, _next/image, _next/webpack-hmr : build output and the dev
     *   hot-reload channel. Gating them buys nothing (no secret is served from
     *   there) and breaks `next dev`.
     *
     * Note what is NOT excluded: /_next/data and every /api/* route other than
     * the webhook. The dashboard pages are server components, so their payloads
     * travel through the matched paths and stay behind the gate.
     *
     * Each exclusion ends in `(?:/|$)` so it matches a path SEGMENT and not a
     * prefix: a bare `api/webhook/wordpress` would also let a future
     * `/api/webhook/wordpress-admin` through the gate, unauthenticated, purely
     * because its name starts the same way.
     */
    '/((?!api/webhook/wordpress(?:/|$)|_next/static/|_next/image(?:/|$)|_next/webpack-hmr(?:/|$)|favicon\\.ico$).*)',
  ],
}
