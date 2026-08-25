// ─────────────────────────────────────────────────────────────────────────────
// Google Indexing API — service account authentication that actually verifies
//
// Replaces the signing code in lib/seo/indexing.ts, which built its JWT with
// `btoa(...)`. `btoa` produces STANDARD base64: it pads with `=` and emits `+`
// and `/`. A JWT segment must be base64url — no padding, `-` and `_` instead.
// Concretely, for a real service account payload:
//
//   eyJpc3MiOiJzZW8t…LCJleHAiOjE3ODU0OTgwNTl9==      <- two padding characters
//
// Google base64url-decodes each segment before verifying anything, so the token
// was rejected before its signature was ever examined. The signature itself was
// correctly base64url-encoded, which is why the defect reads as "the key is
// wrong" rather than "the encoding is wrong". Two consequences compounded it:
// a `+` inside the payload is decoded as a SPACE by the form-urlencoded body
// the assertion travels in, and the assertion was interpolated into that body
// without being percent-encoded.
//
// Result: authentication failed every time, and `submitGoogleIndexingApi`
// swallowed the failure into an error string nobody read.
//
// Scope note: the Indexing API is officially limited to JobPosting and
// BroadcastEvent pages. Calls for other URL types are accepted and then ignored,
// so this must be treated as a bonus, never as the indexing strategy.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const INDEXING_API_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish'
const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing'

/** Refresh a minute early: a token that expires in flight reads as a 401. */
const TOKEN_SAFETY_MARGIN_SECONDS = 60

interface ServiceAccountCredentials {
  client_email: string
  private_key: string
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

// Single process, single instance — a module-level cache is enough, and it saves
// an RSA signature plus a round trip on every URL of a batch publish.
let cachedToken: CachedToken | null = null

// ─── Public API ──────────────────────────────────────────────────────────────

export interface IndexingSubmission {
  success: boolean
  error?: string
}

/**
 * Notifies Google that a URL was created, updated or removed.
 * Returns a failure rather than throwing: indexing is best-effort and must
 * never turn a successful publication into an error.
 */
export async function submitUrlToIndexingApi(
  pageUrl: string,
  type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED'
): Promise<IndexingSubmission> {
  const credentials = readCredentials()
  if (!credentials) return { success: false, error: 'GOOGLE_INDEXING_CREDENTIALS absent ou illisible' }

  try {
    const token = await getServiceAccountAccessToken(credentials, INDEXING_SCOPE)

    const res = await fetch(INDEXING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: pageUrl, type }),
    })

    if (res.ok) return { success: true }

    const body = await res.json().catch(() => ({}))
    return {
      success: false,
      error: `Indexing API ${res.status}: ${(body as { error?: { message?: string } }).error?.message || 'erreur inconnue'}`,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Indexing API error' }
  }
}

/**
 * Exchanges a signed JWT for an access token, per the OAuth 2.0 JWT bearer flow.
 * Cached until shortly before expiry.
 */
export async function getServiceAccountAccessToken(
  credentials: ServiceAccountCredentials,
  scope: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.accessToken

  const assertion = await signServiceAccountJwt(credentials, scope, now)

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // URLSearchParams percent-encodes the assertion. Interpolating it into the
    // body by hand is what let a stray character corrupt the token silently.
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const detail = (data as { error_description?: string; error?: string }).error_description
      || (data as { error?: string }).error
      || `HTTP ${res.status}`
    throw new Error(`Google service account auth failed: ${detail}`)
  }

  const token = (data as { access_token?: string; expires_in?: number }).access_token
  if (!token) throw new Error('Google service account auth failed: aucun access_token retourne')

  cachedToken = {
    accessToken: token,
    expiresAt: now + ((data as { expires_in?: number }).expires_in || 3600) - TOKEN_SAFETY_MARGIN_SECONDS,
  }

  return token
}

/** Builds `header.payload.signature`, every segment base64url without padding. */
export async function signServiceAccountJwt(
  credentials: ServiceAccountCredentials,
  scope: string,
  issuedAt: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    // Google rejects an assertion whose lifetime exceeds one hour.
    exp: issuedAt + 3600,
  }))

  const signingInput = `${header}.${payload}`
  const key = await importPrivateKey(credentials.private_key)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  )

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

/**
 * base64url as RFC 7515 requires it: `-` and `_` instead of `+` and `/`, and no
 * `=` padding. Strings are encoded as UTF-8 first, so a non-ASCII character in
 * the credentials cannot produce a malformed segment.
 */
export function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input

  let binary = ''
  // Chunked: spreading a large array into String.fromCharCode overflows the
  // argument limit. Signatures are 256 bytes, but the helper is generic.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ─── Internals ───────────────────────────────────────────────────────────────

function readCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_INDEXING_CREDENTIALS
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>
    if (!parsed.client_email || !parsed.private_key) return null
    return { client_email: parsed.client_email, private_key: parsed.private_key }
  } catch {
    return null
  }
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  // Service account keys copied into an env var often keep their newlines
  // escaped; PKCS#8 parsing needs the base64 body, whichever form it arrives in.
  const body = privateKey
    .replace(/\\n/g, '\n')
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '')

  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}
