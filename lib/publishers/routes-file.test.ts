// ─────────────────────────────────────────────────────────────────────────────
// Generated route registry
// SEO Engine - A page nobody is told about is not published.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  parseGeneratedRoutes,
  renderGeneratedRoutes,
  routeForPublication,
  upsertRoute,
} from './routes-file'

const ENTRY = { path: '/taxi-gare-troyes', lastModified: '2026-08-09', priority: 0.8, changeFrequency: 'monthly' as const }

describe('routeForPublication', () => {
  it('classe une page pilier au-dessus de ses filles', () => {
    const base = { path: '/x', today: '2026-08-09' }
    expect(routeForPublication({ ...base, variant: 'pilier' }).priority).toBe(0.9)
    expect(routeForPublication({ ...base, variant: 'local' }).priority).toBe(0.8)
  })

  it('annonce une frequence mensuelle, pas hebdomadaire', () => {
    // A frequency the crawler can disprove is discarded, and an SEO article is
    // revised when the facts change, not on a schedule.
    expect(routeForPublication({ path: '/x', variant: 'local', today: '2026-08-09' }).changeFrequency).toBe('monthly')
  })

  it('retombe sur la priorite standard pour une variante inconnue', () => {
    expect(routeForPublication({ path: '/x', variant: 'inedit', today: '2026-08-09' }).priority).toBe(0.8)
  })
})

describe('parseGeneratedRoutes', () => {
  it('relit ce qu il a ecrit', () => {
    const rendered = renderGeneratedRoutes([ENTRY], './routes')
    expect(parseGeneratedRoutes(rendered)).toEqual([ENTRY])
  })

  it('rend une liste vide plutot qu une liste partielle', () => {
    // Half a registry silently replacing a whole one would drop pages out of the
    // sitemap — worse than the problem this file solves.
    for (const broken of [null, '', 'export const GENERATED_ROUTES = [ {oops', 'rien du tout']) {
      expect(parseGeneratedRoutes(broken)).toEqual([])
    }
  })

  it('ignore une entree qui n a pas la forme attendue', () => {
    const rendered = renderGeneratedRoutes([ENTRY], './routes').replace(
      '"/taxi-gare-troyes"',
      '42'
    )
    expect(parseGeneratedRoutes(rendered)).toEqual([])
  })
})

describe('upsertRoute', () => {
  it('ajoute une route et garde la liste triee', () => {
    const out = upsertRoute([{ ...ENTRY, path: '/z' }], { ...ENTRY, path: '/a' })
    expect(out.map((r) => r.path)).toEqual(['/a', '/z'])
  })

  it('remplace au lieu de dupliquer quand on republie', () => {
    // Republishing the same slug is normal — a correction, a regenerated page.
    // Two entries for one path would put it in the sitemap twice.
    const out = upsertRoute([ENTRY], { ...ENTRY, lastModified: '2026-09-01' })
    expect(out).toHaveLength(1)
    expect(out[0].lastModified).toBe('2026-09-01')
  })
})

describe('renderGeneratedRoutes', () => {
  it('se type sur le registre du site plutot que de redeclarer le type', () => {
    const out = renderGeneratedRoutes([ENTRY], './routes')
    expect(out).toContain("import type { IndexableRoute } from './routes'")
    expect(out).toContain('export const GENERATED_ROUTES: readonly IndexableRoute[]')
  })

  it('dit dans le fichier ce qu il faut faire pour qu il serve', () => {
    // A generated file nobody spreads into ROUTES does nothing at all, and that
    // is invisible from our side. The instruction lives where the reader is.
    expect(renderGeneratedRoutes([], './routes')).toContain('...GENERATED_ROUTES')
  })

  it('est stable : meme entree, meme octet', () => {
    expect(renderGeneratedRoutes([ENTRY], './routes')).toBe(renderGeneratedRoutes([ENTRY], './routes'))
  })
})
