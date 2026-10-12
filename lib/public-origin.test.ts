// ─────────────────────────────────────────────────────────────────────────────
// Origine publique — tests
// SEO Engine - Une redirection vers 0.0.0.0:3000 n'arrive nulle part.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { publicOrigin, publicUrl } from './public-origin'

function request(headers: Record<string, string>, url = 'http://0.0.0.0:3000/api/google/callback?code=x') {
  return new NextRequest(url, { headers })
}

describe('publicOrigin', () => {
  it('lit le nom et le schema que nginx transmet, pas l adresse d ecoute', () => {
    // Le cas de production : le conteneur ecoute sur 0.0.0.0, nginx devant.
    const req = request({ host: 'seo.cnx-solutions.fr', 'x-forwarded-proto': 'https' })
    expect(publicOrigin(req)).toBe('https://seo.cnx-solutions.fr')
    expect(publicUrl('/sites/abc/google/select', req).toString()).toBe('https://seo.cnx-solutions.fr/sites/abc/google/select')
  })

  it('prefere x-forwarded-host quand un proxy le pose', () => {
    const req = request({ host: 'interne:3000', 'x-forwarded-host': 'seo.cnx-solutions.fr', 'x-forwarded-proto': 'https' })
    expect(publicOrigin(req)).toBe('https://seo.cnx-solutions.fr')
  })

  it('suppose https pour un nom public sans x-forwarded-proto', () => {
    expect(publicOrigin(request({ host: 'seo.cnx-solutions.fr' }))).toBe('https://seo.cnx-solutions.fr')
  })

  it('reste en http sur localhost, ou `next dev` repond sans proxy', () => {
    expect(publicOrigin(request({ host: 'localhost:3000' }, 'http://localhost:3000/x'))).toBe('http://localhost:3000')
  })

  it('retombe sur l origine de la requete sans aucun en-tete', () => {
    const req = new NextRequest('http://localhost:3000/x')
    req.headers.delete('host')
    expect(publicOrigin(req)).toBe('http://localhost:3000')
  })
})
