// ─────────────────────────────────────────────────────────────────────────────
// WordPress REST client
// SEO Engine - One way out to the network, and errors that name their cause.
// ─────────────────────────────────────────────────────────────────────────────
//
// The publisher this replaces made bare `fetch` calls with no timeout, no
// user-agent, and no reading of the second response at all. Every failure came
// back as the same sentence — "WP API 401: …" — which does not distinguish
// between a REST API turned off by a plugin, a WAF blocking us, a wrong
// password, and a Subscriber account that authenticates perfectly and cannot
// create a page.
//
// Those four need four different actions from the operator, so they get four
// different names. Guessing is what made connecting a WordPress site feel like
// a lottery.

/** Why a WordPress call failed, in terms the operator can act on. */
export type WpFailure =
  | 'url_non_https'
  | 'rest_injoignable'
  | 'rest_desactive'
  | 'rest_filtre'
  | 'auth_refusee'
  | 'droits_insuffisants'
  | 'reponse_illisible'
  | 'refus_wordpress'

const EXPLANATION: Record<WpFailure, string> = {
  url_non_https:
    "l'URL du site n'est pas en HTTPS — WordPress desactive les mots de passe d'application hors HTTPS",
  rest_injoignable: 'le site ne repond pas',
  rest_desactive: "l'API REST de WordPress est desactivee ou masquee",
  rest_filtre: "un pare-feu ou une extension de securite bloque l'API REST",
  auth_refusee: "identifiant ou mot de passe d'application refuse",
  droits_insuffisants: "le compte n'a pas le droit de creer ou modifier une page",
  reponse_illisible: "la reponse n'est pas du JSON — une extension injecte probablement du HTML",
  refus_wordpress: 'WordPress a refuse la demande',
}

export class WpError extends Error {
  constructor(
    readonly failure: WpFailure,
    detail?: string,
    readonly status?: number
  ) {
    super(detail ? `${EXPLANATION[failure]} (${detail})` : EXPLANATION[failure])
    this.name = 'WpError'
  }
}

export interface WpClientOptions {
  siteUrl: string
  username: string
  appPassword: string
  /** Total budget per request. The scheduler already caps the whole publication. */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Does this look like something WordPress generated?
 *
 * An application password is 24 characters, letters and digits only, shown in
 * six groups of four. An account password is not accepted by the REST API at
 * all — Basic auth only ever matches an application password — so pasting one
 * produces a 401 that reads as "wrong credentials" when the credentials are
 * right and simply of the wrong kind. It is the most common way a WordPress
 * connection fails, and it was indistinguishable from a typo.
 */
export function looksLikeApplicationPassword(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.length === 24 && /^[A-Za-z0-9]+$/.test(compact)
}

export interface WpClient {
  origin: string
  /** Authenticated GET returning parsed JSON. */
  get<T>(path: string, query?: Record<string, string>): Promise<T>
  /** Authenticated POST returning parsed JSON. WordPress uses POST for updates too. */
  post<T>(path: string, body: unknown): Promise<T>
  /** Unauthenticated GET, for the discovery document. */
  anonymous<T>(path: string): Promise<T>
  /** Follow nothing: tells a redirect from a page. */
  probe(url: string): Promise<{ status: number; location: string | null }>
}

const DEFAULT_TIMEOUT_MS = 20000

/**
 * A client bound to one site.
 *
 * Refuses `http://` at construction rather than at the first failed write:
 * WordPress silently disables application passwords over plain HTTP, so the
 * credentials are correct, the login is refused, and nothing says why.
 */
export function createWpClient(options: WpClientOptions): WpClient {
  const origin = options.siteUrl.replace(/\/+$/, '')

  if (!/^https:\/\//i.test(origin)) {
    throw new WpError('url_non_https', origin)
  }

  // Whitespace stripped, exactly as WordPress does.
  //
  // `wp_authenticate_application_password` runs the submitted password through
  // `preg_replace('/[^a-z\d]/i', '', …)` before comparing, so the spaces
  // WordPress itself displays between the six groups are irrelevant. Sending
  // them through unchanged made a correctly copied password fail.
  const auth = Buffer.from(`${options.username}:${options.appPassword.replace(/\s+/g, '')}`).toString('base64')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function call<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    const url = path.startsWith('http') ? path : `${origin}/wp-json${path}`
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          // Named on purpose: a site owner reading their access log should be
          // able to tell who is writing to their site.
          'User-Agent': 'SEO-Engine/1 (+publication automatisee)',
          ...(authenticated ? { Authorization: `Basic ${auth}` } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      })
    } catch (error) {
      throw new WpError('rest_injoignable', error instanceof Error ? error.message : String(error))
    }

    return interpret<T>(response)
  }

  return {
    origin,

    get: <T>(path: string, query?: Record<string, string>) =>
      call<T>(query ? `${path}?${new URLSearchParams(query)}` : path, { method: 'GET' }, true),

    post: <T>(path: string, body: unknown) =>
      call<T>(path, { method: 'POST', body: JSON.stringify(body) }, true),

    anonymous: <T>(path: string) => call<T>(path, { method: 'GET' }, false),

    async probe(url: string) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          // The whole point: a followed redirect looks exactly like a page.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'User-Agent': 'SEO-Engine/1 (+verification avant publication)' },
        })
        return { status: response.status, location: response.headers.get('location') }
      } catch {
        // A probe that cannot run must not block a publication: unknown is not
        // the same as redirected.
        return { status: 0, location: null }
      }
    },
  }
}

/** Turn an HTTP response into either a value or a named failure. */
async function interpret<T>(response: Response): Promise<T> {
  const text = await response.text().catch(() => '')

  if (response.ok) {
    try {
      return JSON.parse(text) as T
    } catch {
      throw new WpError('reponse_illisible', text.slice(0, 120), response.status)
    }
  }

  const body = safeJson(text)
  const code = typeof body?.code === 'string' ? body.code : undefined
  const detail = typeof body?.message === 'string' ? body.message : text.slice(0, 120)

  // `rest_no_route` and `rest_disabled` come from WordPress itself; a 403 with
  // no JSON at all is the signature of a WAF answering before WordPress does.
  if (response.status === 404 && (code === 'rest_no_route' || !body)) {
    throw new WpError('rest_desactive', detail, 404)
  }
  if (code === 'rest_disabled' || code === 'rest_login_required') {
    throw new WpError('rest_desactive', detail, response.status)
  }
  if (response.status === 401) {
    throw new WpError('auth_refusee', detail, 401)
  }
  if (response.status === 403) {
    // WordPress prefixes its own permission errors; anything else on a 403 came
    // from in front of WordPress. `rest_forbidden_context` and `rest_forbidden`
    // are what a reader without rights actually receives — matching only
    // `rest_cannot_*` reported a role problem as a firewall, and sent the
    // operator to inspect Wordfence instead of promoting the account.
    const permission =
      code?.startsWith('rest_cannot') ||
      code?.startsWith('rest_forbidden') ||
      code === 'rest_user_cannot_view'
    throw new WpError(permission ? 'droits_insuffisants' : 'rest_filtre', detail, 403)
  }
  if (!body) {
    throw new WpError('rest_filtre', `HTTP ${response.status}`, response.status)
  }

  throw new WpError('refus_wordpress', `${code ?? 'erreur'} — ${detail}`, response.status)
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
