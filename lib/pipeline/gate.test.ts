// ─────────────────────────────────────────────────────────────────────────────
// Validation Gate Tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// Only the findings this module owns are asserted here — length, H1, JSON-LD,
// dead links. The thresholds of `ContentQualityValidator` and `SeoValidator`
// belong to their own test files; pinning them from here would make this suite
// fail whenever they are tuned.

import { describe, it, expect } from 'vitest'
import { runValidationGate, type GateFinding, type GateInput } from './gate'
import { measureLength } from './word-count'

const VALID_FAQ = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [{ '@type': 'Question', name: 'Combien ?', acceptedAnswer: { '@type': 'Answer', text: 'Cela depend.' } }],
})

function buildHtml(withH1 = true): string {
  const body = `<p>${'plomberie troyes intervention rapide '.repeat(60)}</p>`
  return [
    withH1 ? '<h1>Plombier a Troyes</h1>' : '',
    '<h2>Nos interventions</h2>',
    body,
    '<h2>Nos tarifs</h2>',
    body,
  ].join('')
}

function buildInput(opts: {
  html?: string
  schemaFaqPage?: string
  target?: number
  declared?: number
  deadInternalLinks?: number
} = {}): GateInput {
  const html = opts.html ?? buildHtml()

  return {
    pageType: 'child',
    title: 'Plombier a Troyes : interventions rapides et devis gratuit',
    metaDescription:
      'Plombier a Troyes disponible pour vos urgences, fuites et installations sanitaires dans toute l Aube, devis gratuit sous 24 heures.',
    focusKeyword: 'plomberie troyes',
    html,
    schemaFaqPage: opts.schemaFaqPage ?? VALID_FAQ,
    measurement: measureLength({ html, declared: opts.declared, target: opts.target ?? 400 }),
    deadInternalLinks: opts.deadInternalLinks,
  }
}

/** Findings this module owns, isolated from the external validators. */
function ownCodes(findings: GateFinding[]): string[] {
  return findings
    .filter(finding => finding.source !== 'quality' && finding.source !== 'seo')
    .map(finding => finding.code)
}

describe('runValidationGate', () => {
  it('raises no structural objection against a well-formed page', async () => {
    const verdict = await runValidationGate(buildInput())

    expect(ownCodes(verdict.blocking)).toEqual([])
  })

  it('blocks a page with no H1', async () => {
    const verdict = await runValidationGate(buildInput({ html: buildHtml(false) }))

    expect(verdict.publishable).toBe(false)
    expect(ownCodes(verdict.blocking)).toContain('MISSING_H1')
  })

  it('blocks a page whose JSON-LD does not parse', async () => {
    const verdict = await runValidationGate(buildInput({ schemaFaqPage: '{"@type": "FAQPage",}' }))

    expect(verdict.publishable).toBe(false)
    expect(ownCodes(verdict.blocking)).toContain('INVALID_JSON_LD')
  })

  it('accepts an absent schema but says so', async () => {
    const verdict = await runValidationGate(buildInput({ schemaFaqPage: '{}' }))

    expect(ownCodes(verdict.blocking)).not.toContain('INVALID_JSON_LD')
    expect(verdict.warnings.some(warning => warning.code === 'SCHEMA_ABSENT')).toBe(true)
  })

  it('blocks a page far below its ordered length', async () => {
    const verdict = await runValidationGate(buildInput({
      html: '<h1>Titre</h1><h2>Section</h2><p>Trois mots seulement.</p>',
      target: 1200,
    }))

    expect(verdict.publishable).toBe(false)
    expect(ownCodes(verdict.blocking)).toContain('LENGTH_BELOW_TARGET')
  })

  it('reports an over-declared word count without blocking on it alone', async () => {
    const verdict = await runValidationGate(buildInput({ declared: 99999 }))

    expect(verdict.warnings.some(warning => warning.code === 'WORD_COUNT_OVER_DECLARED')).toBe(true)
    expect(ownCodes(verdict.blocking)).not.toContain('WORD_COUNT_OVER_DECLARED')
  })

  it('records removed dead links as a warning', async () => {
    const verdict = await runValidationGate(buildInput({ deadInternalLinks: 3 }))

    expect(verdict.warnings.some(warning => warning.code === 'DEAD_INTERNAL_LINKS_REMOVED')).toBe(true)
  })
})
