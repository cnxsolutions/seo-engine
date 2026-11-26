// ─────────────────────────────────────────────────────────────────────────────
// proxy.ts — the two doors (ACC-5): Basic for the operator, a Supabase session
// for the client space, and never one in place of the other.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const claims = vi.hoisted(() => ({ current: null as { sub: string } | null }))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims.current ? { claims: claims.current } : null, error: null }) },
  }),
}))

import { proxy } from './proxy'

const SECRET = 'operator-secret-of-32-characters!'
const basic = (secret: string) => `Basic ${Buffer.from(`operateur:${secret}`).toString('base64')}`

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3000', ...init.headers },
  })
}

const passesThrough = (response: Response) => response.headers.get('x-middleware-next') === '1'

beforeEach(() => {
  vi.stubEnv('APP_ACCESS_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  claims.current = null
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('porte operateur', () => {
  it('reste fermee sans secret configure, espace client compris', async () => {
    vi.stubEnv('APP_ACCESS_SECRET', '')
    expect((await proxy(request('/dashboard'))).status).toBe(503)
    expect((await proxy(request('/espace'))).status).toBe(503)
  })

  it('demande le secret par un defi Basic', async () => {
    const response = await proxy(request('/dashboard'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toMatch(/^Basic /)
  })

  it('laisse passer l operateur', async () => {
    expect(passesThrough(await proxy(request('/dashboard', { headers: { authorization: basic(SECRET) } })))).toBe(true)
  })

  it('ne s ouvre pas pour une session client', async () => {
    claims.current = { sub: 'user-1' }
    expect((await proxy(request('/api/sites'))).status).toBe(401)
  })

  it('garde les chemins qui ressemblent seulement a l espace client', async () => {
    for (const path of ['/espacex', '/api/espace-admin', '/authentification']) {
      expect((await proxy(request(path))).status).toBe(401)
    }
  })
})

describe('porte de l espace client', () => {
  it('envoie une page sans session vers la connexion, sans defi Basic', async () => {
    const response = await proxy(request('/espace'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost:3000/espace/connexion')
    expect(response.headers.get('www-authenticate')).toBeNull()
  })

  it('retient la page demandee pour y revenir apres la connexion', async () => {
    const response = await proxy(request('/espace/demandes?site=1'))
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('suite')).toBe('/espace/demandes?site=1')
  })

  it('refuse un appel d API sans session par un 401 sans defi Basic', async () => {
    const response = await proxy(request('/api/espace/sites'))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBeNull()
  })

  it('ouvre la connexion, ses deux appels, le lien de l e-mail et la deconnexion sans session', async () => {
    for (const path of ['/espace/connexion', '/api/espace/connexion/code', '/auth/callback', '/auth/deconnexion']) {
      const response = await proxy(request(path, { method: path.startsWith('/api/') ? 'POST' : 'GET' }))
      expect(passesThrough(response), path).toBe(true)
    }
  })

  it('laisse passer une session, sans cache partage', async () => {
    claims.current = { sub: 'user-1' }
    const response = await proxy(request('/espace'))
    expect(passesThrough(response)).toBe(true)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuse une ecriture venue d un autre site', async () => {
    claims.current = { sub: 'user-1' }
    const response = await proxy(request('/api/espace/connexion/code', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }))
    expect(response.status).toBe(403)
  })

  it('se ferme sans cle publique, sans fermer la console', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect((await proxy(request('/espace'))).status).toBe(503)
    expect(passesThrough(await proxy(request('/dashboard', { headers: { authorization: basic(SECRET) } })))).toBe(true)
  })
})
