// ─────────────────────────────────────────────────────────────────────────────
// Internal Link Resolution Tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  buildKnownPathSet,
  classifyHref,
  extractInternalHrefs,
  normalizePath,
  pruneUnresolvedInternalLinks,
} from './internal-links'

const SITE = 'https://exemple.fr'

describe('normalizePath', () => {
  it('produces one canonical form for the same page', () => {
    expect(normalizePath('/Plomberie-Troyes/')).toBe('/plomberie-troyes')
    expect(normalizePath('plomberie-troyes')).toBe('/plomberie-troyes')
    expect(normalizePath('//plomberie-troyes//')).toBe('/plomberie-troyes')
  })

  it('drops query strings and fragments', () => {
    expect(normalizePath('/contact?utm_source=x#form')).toBe('/contact')
  })

  it('keeps the root as the root', () => {
    expect(normalizePath('/')).toBe('/')
  })
})

describe('classifyHref', () => {
  it('treats the site own host as internal, www or not', () => {
    expect(classifyHref('https://exemple.fr/guide', SITE)).toEqual({ kind: 'internal', path: '/guide' })
    expect(classifyHref('https://www.exemple.fr/guide', SITE)).toEqual({ kind: 'internal', path: '/guide' })
  })

  it('treats another host as external', () => {
    expect(classifyHref('https://ademe.fr/etude', SITE).kind).toBe('external')
  })

  it('treats a root-relative href as internal', () => {
    expect(classifyHref('/guide-complet', SITE)).toEqual({ kind: 'internal', path: '/guide-complet' })
  })

  it('has nothing to resolve for anchors and protocols', () => {
    expect(classifyHref('#faq', SITE).kind).toBe('ignored')
    expect(classifyHref('mailto:contact@exemple.fr', SITE).kind).toBe('ignored')
    expect(classifyHref('tel:+33325000000', SITE).kind).toBe('ignored')
    expect(classifyHref('', SITE).kind).toBe('ignored')
  })
})

describe('buildKnownPathSet', () => {
  it('always contains the home page', () => {
    expect(buildKnownPathSet([]).has('/')).toBe(true)
  })

  it('normalises crawled paths and published slugs into the same shape', () => {
    const known = buildKnownPathSet(['/Guide/', 'plomberie-troyes', null, undefined, ''])

    expect(known.has('/guide')).toBe(true)
    expect(known.has('/plomberie-troyes')).toBe(true)
    expect(known.size).toBe(3)
  })
})

describe('pruneUnresolvedInternalLinks', () => {
  const known = buildKnownPathSet(['/guide-complet', '/contact'])

  it('keeps links whose destination exists', () => {
    const html = '<p>Lire le <a href="/guide-complet">guide complet</a>.</p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe(html)
    expect(audit.kept).toEqual(['/guide-complet'])
    expect(audit.removed).toEqual([])
    expect(audit.keptHtml).toHaveLength(1)
  })

  it('unwraps a dead link and keeps the sentence readable', () => {
    const html = '<p>Voir <a href="/page-inexistante">notre etude 2026</a> pour les details.</p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe('<p>Voir notre etude 2026 pour les details.</p>')
    expect(audit.removed).toEqual(['/page-inexistante'])
    expect(audit.kept).toEqual([])
  })

  it('resolves an absolute href on the site own host', () => {
    const html = '<p><a href="https://exemple.fr/contact">Nous contacter</a></p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe(html)
    expect(audit.kept).toEqual(['https://exemple.fr/contact'])
  })

  it('removes an absolute href to a page the site does not have', () => {
    const html = '<p><a href="https://exemple.fr/jamais-crawlee">page fantome</a></p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe('<p>page fantome</p>')
    expect(audit.removed).toHaveLength(1)
  })

  it('never touches external links or mailto', () => {
    const html = '<p><a href="https://ademe.fr/etude" rel="noopener">etude</a> <a href="mailto:a@b.fr">ecrire</a></p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe(html)
    expect(audit.external).toEqual(['https://ademe.fr/etude'])
    expect(audit.ignored).toEqual(['mailto:a@b.fr'])
    expect(audit.removed).toEqual([])
  })

  it('drops the whole list item when the link was all it contained', () => {
    const html = '<ul><li><a href="/guide-complet">Vivant</a></li><li><a href="/mort">Mort</a></li></ul>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe('<ul><li><a href="/guide-complet">Vivant</a></li></ul>')
    expect(audit.removed).toEqual(['/mort'])
    expect(audit.kept).toEqual(['/guide-complet'])
  })

  it('removes a navigation block emptied of every link', () => {
    const html = [
      '<p>Texte.</p>',
      '<nav class="related-pages" aria-label="Pages associées">',
      '<h3>À lire également</h3>',
      '<ul><li><a href="/mort-1">Un</a></li><li><a href="/mort-2">Deux</a></li></ul>',
      '</nav>',
    ].join('')

    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toBe('<p>Texte.</p>')
    expect(audit.removed).toEqual(['/mort-1', '/mort-2'])
  })

  it('keeps a navigation block that still has one live link', () => {
    const html = '<nav class="related-pages"><ul><li><a href="/contact">Contact</a></li><li><a href="/mort">Mort</a></li></ul></nav>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.html).toContain('<nav class="related-pages">')
    expect(audit.html).toContain('href="/contact"')
    expect(audit.html).not.toContain('/mort')
  })

  it('counts each link exactly once', () => {
    const html = '<ul><li><a href="/contact">Contact</a></li></ul><p><a href="/mort">X</a></p>'
    const audit = pruneUnresolvedInternalLinks({ html, knownPaths: known, siteUrl: SITE })

    expect(audit.kept).toEqual(['/contact'])
    expect(audit.removed).toEqual(['/mort'])
  })

  it('accepts a raw list of paths as well as a prepared set', () => {
    const html = '<p><a href="/depuis-le-crawl">page crawlee</a></p>'
    const audit = pruneUnresolvedInternalLinks({
      html,
      knownPaths: ['/Depuis-Le-Crawl/'],
      siteUrl: SITE,
    })

    expect(audit.removed).toEqual([])
    expect(audit.kept).toEqual(['/depuis-le-crawl'])
  })
})

describe('extractInternalHrefs', () => {
  it('lists only what has to resolve', () => {
    const html = '<a href="/a">a</a><a href="https://ailleurs.fr">b</a><a href="#c">c</a>'
    expect(extractInternalHrefs(html, SITE)).toEqual(['/a'])
  })
})
