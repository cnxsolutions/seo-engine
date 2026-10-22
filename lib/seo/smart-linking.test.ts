// ─────────────────────────────────────────────────────────────────────────────
// Smart linking — external sources
// SEO Engine - Where a source goes when no sentence names it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { applySmartLinking } from './smart-linking'
import type { ExternalLink } from '@/lib/types'

const source = (anchor: string, url: string): ExternalLink => ({ anchor, url, domain: new URL(url).hostname, relevance: 'contexte' })

const link = (htmlContent: string, externalLinks: ExternalLink[]) =>
  applySmartLinking({
    htmlContent,
    currentPage: { id: 'g1', slug: 'page', pageType: 'child' },
    linkGraph: [],
    siteUrl: 'https://example.fr',
    externalLinks,
  })

const PAGE = [
  '<h1>Titre</h1>',
  '<p>Les démarches sont détaillées sur le portail Service-Public.fr pour chaque entreprise.</p>',
  '<p class="page-auteur">Publié par Exemple — mis à jour le <time datetime="2026-10-21">21 octobre 2026</time></p>',
  '<p><a href="/contact">Nous contacter</a></p>',
].join('\n')

describe('applySmartLinking — external sources', () => {
  it('links a source on the words of the sentence that names it', () => {
    const result = link(PAGE, [source('Service-Public.fr', 'https://www.service-public.fr')])
    expect(result.htmlContent).toContain('le portail <a href="https://www.service-public.fr"')
    expect(result.htmlContent).not.toContain('external-ref')
  })

  it('cites the sources no sentence names on one line, above the author line rather than under the call to action', () => {
    const result = link(PAGE, [
      source('Service-Public.fr', 'https://www.service-public.fr'),
      source('l’INSEE', 'https://www.insee.fr'),
      source('Wikipédia', 'https://fr.wikipedia.org'),
    ])
    const html = result.htmlContent

    expect(html.match(/class="external-ref"/g)).toHaveLength(1)
    expect(html).toMatch(/<p class="external-ref">Sources : <a href="https:\/\/www\.insee\.fr"[^>]*>l’INSEE<\/a> · <a href="https:\/\/fr\.wikipedia\.org"/)
    expect(html.indexOf('external-ref')).toBeLessThan(html.indexOf('page-auteur'))
    expect(html.indexOf('external-ref')).toBeLessThan(html.indexOf('Nous contacter'))
    expect(result.injectedExternalLinks).toHaveLength(3)
  })

  it('falls back to after the last paragraph when the page has no author line', () => {
    const html = link('<h1>Titre</h1>\n<p>Un paragraphe.</p>', [source('l’INSEE', 'https://www.insee.fr')]).htmlContent
    expect(html).toMatch(/<p>Un paragraphe\.<\/p>\n<p class="external-ref">Source : <a href="https:\/\/www\.insee\.fr"/)
  })
})
