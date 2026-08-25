// ─────────────────────────────────────────────────────────────────────────────
// Redirect sources
// SEO Engine - The guard that was missing when a page shipped unreachable.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { isRedirectSource, readRedirectSources } from './redirects'

// Trimmed from cnxsolutions/taxidriver10 — including the comment that explains
// exactly why publishing there was wrong.
const MIDDLEWARE = `
const REDIRECTS: Record<string, string> = {
  // Fix homepage ↔ /taxi-troyes cannibalization
  '/taxi-troyes': '/',
  '/taxi-troyes-vers-orly': '/taxi-aeroport-orly-troyes',
  '/Taxi-Bucheres/': '/taxi-bucheres',
}
`

const NEXT_CONFIG = `
module.exports = {
  async redirects() {
    return [{ source: '/ancienne-page', destination: '/nouvelle', permanent: true }]
  },
}
`

describe('readRedirectSources', () => {
  it('lit une table de redirections', () => {
    const paths = readRedirectSources(MIDDLEWARE)
    expect(paths).toContain('/taxi-troyes')
    expect(paths).toContain('/taxi-troyes-vers-orly')
  })

  it('normalise la casse et le slash final', () => {
    expect(readRedirectSources(MIDDLEWARE)).toContain('/taxi-bucheres')
  })

  it('lit aussi la forme next.config', () => {
    expect(readRedirectSources(NEXT_CONFIG)).toEqual(['/ancienne-page'])
  })

  it('ne retient que la source, jamais la destination', () => {
    // `/taxi-aeroport-orly-troyes` is where a redirect POINTS. Treating it as a
    // source would forbid publishing on a perfectly good URL.
    expect(readRedirectSources(MIDDLEWARE)).not.toContain('/taxi-aeroport-orly-troyes')
  })

  it('ne leve pas sur un fichier absent', () => {
    expect(readRedirectSources(null)).toEqual([])
    expect(readRedirectSources('')).toEqual([])
  })
})

describe('isRedirectSource', () => {
  const redirects = readRedirectSources(MIDDLEWARE)

  it('reconnait le slug qui a casse la publication', () => {
    // The regression, exactly: the file did not exist, the guard allowed it, and
    // the middleware sent every visitor to the homepage.
    expect(isRedirectSource('taxi-troyes', redirects)).toBe(true)
  })

  it('laisse passer un slug libre', () => {
    expect(isRedirectSource('comment-choisir-taxi-selon-trajet-service-troyes', redirects)).toBe(false)
  })

  it('ne bloque rien quand le site ne declare aucune redirection', () => {
    expect(isRedirectSource('taxi-troyes', [])).toBe(false)
    expect(isRedirectSource('taxi-troyes', undefined)).toBe(false)
  })
})
