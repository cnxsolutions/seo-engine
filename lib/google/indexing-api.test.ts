// ─────────────────────────────────────────────────────────────────────────────
// indexing-api — the service account JWT that Google actually accepts
//
// The module exists because its predecessor signed with standard base64
// (`btoa`): `=` padding, `+` and `/`, which Google rejects before reading the
// signature. These tests sign with a real RSA key generated on the spot and
// check what Google checks — base64url segments, claims, a signature the public
// key verifies — then the two answers the publication cares about: accepted,
// or refused with a reason the notes can show. No network.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let privateKeyPem = ''
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  publicKey = pair.publicKey
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const body = Buffer.from(pkcs8).toString('base64').replace(/(.{64})/g, '$1\n')
  // Escaped newlines: the form a key takes once pasted into an env var.
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\\n${body.replace(/\n/g, '\\n')}\\n-----END PRIVATE KEY-----\\n`
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

/** A fresh module each time: the access token is cached at module level. */
async function load() {
  return import('./indexing-api')
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('base64UrlEncode', () => {
  it('never emits padding, + or /', async () => {
    const { base64UrlEncode } = await load()
    // 0xfb 0xff is « +/8= » in standard base64.
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
    expect(base64UrlEncode('a')).toBe('YQ')
  })
})

describe('signServiceAccountJwt', () => {
  it('produces a JWT whose claims and signature Google can verify', async () => {
    const { signServiceAccountJwt } = await load()
    const jwt = await signServiceAccountJwt(
      { client_email: 'indexing@projet.iam.gserviceaccount.com', private_key: privateKeyPem },
      'https://www.googleapis.com/auth/indexing',
      1_790_000_000
    )

    const [header, payload, signature] = jwt.split('.')
    expect(jwt).not.toMatch(/[=+/]/)
    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decodeSegment(payload)).toEqual({
      iss: 'indexing@projet.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_790_000_000,
      exp: 1_790_003_600,
    })

    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(signature, 'base64url'),
      new TextEncoder().encode(`${header}.${payload}`)
    )
    expect(verified).toBe(true)
  })
})

describe('submitUrlToIndexingApi', () => {
  function credentials() {
    vi.stubEnv('GOOGLE_INDEXING_CREDENTIALS', JSON.stringify({
      type: 'service_account',
      client_email: 'indexing@projet.iam.gserviceaccount.com',
      private_key: privateKeyPem,
    }))
  }

  it('exchanges the JWT for a token, then notifies the URL', async () => {
    credentials()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return url.startsWith('https://oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({ access_token: 'jeton', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ urlNotificationMetadata: {} }), { status: 200 })
    }))
    const { submitUrlToIndexingApi } = await load()

    expect(await submitUrlToIndexingApi('https://example.fr/taxi-lyon')).toEqual({ success: true })

    const token = new URLSearchParams(String(calls[0].init?.body))
    expect(token.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(token.get('assertion')?.split('.')).toHaveLength(3)

    expect(calls[1].url).toBe('https://indexing.googleapis.com/v3/urlNotifications:publish')
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer jeton')
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ url: 'https://example.fr/taxi-lyon', type: 'URL_UPDATED' })
  })

  it('reuses the token across a batch instead of signing for every URL', async () => {
    credentials()
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('https://oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({ access_token: 'jeton', expires_in: 3600 }), { status: 200 })
        : new Response('{}', { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { submitUrlToIndexingApi } = await load()

    await submitUrlToIndexingApi('https://example.fr/a')
    await submitUrlToIndexingApi('https://example.fr/b')

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('oauth2'))).toHaveLength(1)
  })

  it('returns Google’s refusal as a reason — a service account that does not own the property', async () => {
    credentials()
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.startsWith('https://oauth2.googleapis.com/token')
        ? new Response(JSON.stringify({ access_token: 'jeton', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'Permission denied. Failed to verify the URL ownership.' } }), { status: 403 })
    ))
    const { submitUrlToIndexingApi } = await load()

    expect(await submitUrlToIndexingApi('https://example.fr/a')).toEqual({
      success: false,
      error: 'Indexing API 403: Permission denied. Failed to verify the URL ownership.',
    })
  })

  it('returns a refused authentication instead of throwing', async () => {
    credentials()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })
    ))
    const { submitUrlToIndexingApi } = await load()

    expect(await submitUrlToIndexingApi('https://example.fr/a')).toEqual({
      success: false,
      error: 'Google service account auth failed: Invalid JWT Signature.',
    })
  })

  it('says so when the credentials are missing or unreadable', async () => {
    vi.stubEnv('GOOGLE_INDEXING_CREDENTIALS', '{pas du json')
    const { submitUrlToIndexingApi } = await load()

    expect(await submitUrlToIndexingApi('https://example.fr/a')).toEqual({
      success: false,
      error: 'GOOGLE_INDEXING_CREDENTIALS absent ou illisible',
    })
  })
})
