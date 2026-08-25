// ─────────────────────────────────────────────────────────────────────────────
// Validation Gate Tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// Only the findings this module owns are asserted here — length, H1, JSON-LD,
// dead links. The thresholds of `ContentQualityValidator` and `SeoValidator`
// belong to their own test files; pinning them from here would make this suite
// fail whenever they are tuned.

import { describe, it, expect, vi } from 'vitest'
import { ValidationPipelineOrchestrator } from '@/src/adapters/rag/validation'
import type { ContentToCheck } from '@/src/adapters/rag/validation/DuplicateDetector'
import type { IdentityComparison } from '@/src/core/domain/existing/identity'
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

/** The address the page under test is asking for. */
const SLUG = 'plombier-troyes'

function buildInput(opts: {
  html?: string
  schemaFaqPage?: string
  target?: number
  declared?: number
  deadInternalLinks?: number
  existingContents?: ContentToCheck[]
  identity?: IdentityComparison[]
  intent?: GateInput['intent']
  duplicateMode?: GateInput['duplicateMode']
  inventoryTruncated?: boolean
} = {}): GateInput {
  const html = opts.html ?? buildHtml()

  return {
    pageType: 'child',
    title: 'Plombier a Troyes : interventions rapides et devis gratuit',
    metaDescription:
      'Plombier a Troyes disponible pour vos urgences, fuites et installations sanitaires dans toute l Aube, devis gratuit sous 24 heures.',
    focusKeyword: 'plomberie troyes',
    html,
    // Required since the gate started answering questions about the address
    // itself. Every existing assertion below is unchanged.
    slug: SLUG,
    schemaFaqPage: opts.schemaFaqPage ?? VALID_FAQ,
    measurement: measureLength({ html, declared: opts.declared, target: opts.target ?? 400 }),
    deadInternalLinks: opts.deadInternalLinks,
    existingContents: opts.existingContents,
    identity: opts.identity,
    intent: opts.intent,
    duplicateMode: opts.duplicateMode,
    inventoryTruncated: opts.inventoryTruncated,
  }
}

/** A page already online, carrying the body it is compared against. */
function buildCandidate(overrides: Partial<ContentToCheck> = {}): ContentToCheck {
  return {
    id: '/depannage-plomberie-troyes',
    title: 'Depannage plomberie a Troyes',
    content: buildHtml(),
    url: 'https://exemple.fr/depannage-plomberie-troyes',
    ...overrides,
  }
}

/** A neighbour already weighed on what a SERP shows. */
function buildComparison(overrides: Partial<IdentityComparison> = {}): IdentityComparison {
  return {
    entryPath: '/depannage-plomberie-troyes',
    entryUrl: 'https://exemple.fr/depannage-plomberie-troyes',
    pathCollision: false,
    titleSimilarity: 0,
    metaSimilarity: 0,
    sameFocusKeyword: false,
    sharedIntents: [],
    comparisonIsPartial: false,
    ...overrides,
  }
}

function codes(findings: GateFinding[]): string[] {
  return findings.map(finding => finding.code)
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

// ─── The duplicate gate ─────────────────────────────────────────────────────

describe('runValidationGate — duplicate detection', () => {
  it('compares against what is online, and only when candidates are handed over', async () => {
    // The two halves of the switch, asserted together. Turning the orchestrator
    // flag on without passing `existingContents` produces nothing at all, so a
    // test on the flag alone would have gone green over a dead detector.
    const compared = await runValidationGate(buildInput({ existingContents: [buildCandidate()] }))
    const found = codes([...compared.blocking, ...compared.warnings])

    expect(found.some(code => code === 'DUPLICATE_EXACT' || code === 'DUPLICATE_NEAR')).toBe(true)

    const alone = await runValidationGate(buildInput())

    expect(codes([...alone.blocking, ...alone.warnings]).some(code => code.startsWith('DUPLICATE_'))).toBe(false)
    expect(alone.duplicateVerdict).toBeUndefined()
  })

  it('leaves results.duplicate undefined when the flag is on but the list is empty', async () => {
    // The trap this delivery had to walk around, proven on the orchestrator
    // itself: `duplicate: true` is not enough, the step is skipped on an empty
    // candidate list (ValidationPipelineOrchestrator.ts:262).
    const orchestrator = new ValidationPipelineOrchestrator({
      validators: { schema: false, contentQuality: false, seo: false, jsonLd: false, duplicate: true },
      stopOnFirstError: false,
    })
    const content = { fields: {}, contentType: 'child', title: 'Plombier a Troyes', content: buildHtml() }

    const withoutCandidates = await orchestrator.validate({ content })
    expect(withoutCandidates.results.duplicate).toBeUndefined()

    const withCandidates = await orchestrator.validate({ content, existingContents: [buildCandidate()] })
    expect(withCandidates.results.duplicate).toBeDefined()
  })

  it('never touches the network, candidates or not', async () => {
    // The invariant that makes this gate callable from a test, a script or a
    // route handler. It is asserted rather than merely written in the header,
    // because the header used to justify it by a detector that was switched off.
    const originalFetch = globalThis.fetch
    const spy = vi.fn(() => {
      throw new Error('runValidationGate a touche le reseau')
    })
    globalThis.fetch = spy as unknown as typeof fetch

    try {
      await runValidationGate(buildInput({
        existingContents: [buildCandidate()],
        identity: [buildComparison({ titleSimilarity: 0.95, comparisonIsPartial: true })],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(spy).not.toHaveBeenCalled()
  })

  it('observes without blocking, and blocks on the very same measurement', async () => {
    const input = { existingContents: [buildCandidate()] }

    const observed = await runValidationGate(buildInput({ ...input, duplicateMode: 'observe' }))
    expect(codes(observed.warnings)).toContain('DUPLICATE_EXACT')
    expect(codes(observed.blocking)).not.toContain('DUPLICATE_EXACT')
    expect(observed.publishable).toBe(true)
    expect(observed.duplicateVerdict?.mode).toBe('observe')

    const blocked = await runValidationGate(buildInput({ ...input, duplicateMode: 'block' }))
    expect(codes(blocked.blocking)).toContain('DUPLICATE_EXACT')
    expect(blocked.publishable).toBe(false)
    expect(blocked.duplicateVerdict?.mode).toBe('block')

    // Same evidence on both sides: the classification moves, the measurement
    // does not. Anything else would make the observation period measure a rule
    // other than the one that will eventually refuse pages.
    expect(blocked.duplicateVerdict?.matches).toEqual(observed.duplicateVerdict?.matches)
  })

  it('names the CANDIDATE as the culprit, never the page being written', async () => {
    const candidate = buildCandidate()
    const verdict = await runValidationGate(buildInput({ existingContents: [candidate] }))
    const match = verdict.duplicateVerdict?.matches.find(m => m.code === 'DUPLICATE_EXACT')

    // Reading `sourceId` instead of `targetId` would show the operator his own
    // address, accused of duplicating itself.
    expect(match?.entryPath).toBe(candidate.id)
    expect(match?.entryPath).not.toBe(`/${SLUG}`)
    expect(match?.entryUrl).toBe(candidate.url)
    expect(match?.entryKey).toBe(`page:${candidate.id}`)
  })

  it('carries the excerpt caveat from the identity comparison onto the body match', async () => {
    // The join that makes this work is `ContentToCheck.id === IdentityComparison.entryPath`,
    // both fed from `InventoryEntry.path` by lib/pipeline/index.ts. If those two
    // ever drift apart the lookup misses silently, so it is pinned here.
    const candidate = buildCandidate()

    const excerpt = await runValidationGate(buildInput({
      existingContents: [candidate],
      identity: [buildComparison({ entryPath: candidate.id, comparisonIsPartial: true })],
    }))
    const partialMatch = excerpt.duplicateVerdict?.matches.find(m => m.code === 'DUPLICATE_EXACT')

    expect(partialMatch?.partial).toBe(true)
    expect(excerpt.warnings.find(w => w.code === 'DUPLICATE_EXACT')?.message).toContain('comparaison partielle')

    const whole = await runValidationGate(buildInput({
      existingContents: [candidate],
      identity: [buildComparison({ entryPath: candidate.id, comparisonIsPartial: false })],
    }))

    expect(whole.duplicateVerdict?.matches.find(m => m.code === 'DUPLICATE_EXACT')?.partial).toBe(false)
  })

  it('records a verdict even when nothing matched, so "not compared" stays distinct', async () => {
    const verdict = await runValidationGate(buildInput({ identity: [buildComparison()] }))

    expect(verdict.duplicateVerdict).toBeDefined()
    expect(verdict.duplicateVerdict?.matches).toEqual([])
    expect(verdict.duplicateVerdict?.reasons).toEqual([])
  })

  it('warns about a title already used, and says the comparison was partial', async () => {
    const verdict = await runValidationGate(buildInput({
      identity: [buildComparison({ titleSimilarity: 0.94, comparisonIsPartial: true })],
    }))
    const finding = verdict.warnings.find(warning => warning.code === 'TITLE_NEAR_DUPLICATE')

    expect(finding).toBeDefined()
    expect(finding?.source).toBe('duplicate')
    expect(finding?.message).toContain('https://exemple.fr/depannage-plomberie-troyes')
    expect(finding?.message).toContain('comparaison partielle')
    expect(verdict.duplicateVerdict?.matches[0]?.partial).toBe(true)
  })

  it('reports a taken address on a creation, and ignores it on a refresh', async () => {
    const identity = [buildComparison({ pathCollision: true, titleSimilarity: 0.99 })]

    const creation = await runValidationGate(buildInput({ identity, intent: 'create' }))
    expect(codes(creation.warnings)).toContain('SLUG_COLLISION')

    // A refresh rewrites the page living at that very address: judging it
    // against itself would refuse every update ever ordered.
    const refresh = await runValidationGate(buildInput({ identity, intent: 'refresh' }))
    expect(codes([...refresh.blocking, ...refresh.warnings])).not.toContain('SLUG_COLLISION')
    expect(codes([...refresh.blocking, ...refresh.warnings])).not.toContain('TITLE_NEAR_DUPLICATE')
  })
})
