// ─────────────────────────────────────────────────────────────────────────────
// Validation Gate Tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// Only the findings this module owns are asserted here — length, H1, JSON-LD,
// dead links, the duplicate policy, and the WIRING of the SEO + GEO audit. The
// audit's own rules are pinned in seo-audit.test.ts, and the thresholds of
// `ContentQualityValidator` and `SeoValidator` in their own test files; pinning
// them from here would make this suite fail whenever they are tuned.
//
// FIXTURE CHANGE (2026-10-17). The page under test used to be one sentence —
// "plomberie troyes intervention rapide" — repeated 120 times in two identical
// paragraphs. The strict gate rightly refuses that: the exact keyword fills a
// quarter of the words (KEYWORD_STUFFING), the two paragraphs are the same
// (DUPLICATE_PARAGRAPH), and it has no direct answer, no question heading, no
// FAQ, no list. It is now the hand-written compliant page of
// compliant-page.fixture.ts, which passes every rule, so a test that expects a
// clean verdict still gets one for the right reason. The candidate page of the
// duplicate tests is built from the same HTML, so it remains an exact copy.

import { describe, it, expect, vi } from 'vitest'
import { ValidationPipelineOrchestrator } from '@/src/adapters/rag/validation'
import type { ContentToCheck } from '@/src/adapters/rag/validation/DuplicateDetector'
import type { IdentityComparison } from '@/src/core/domain/existing/identity'
import {
  COMPLIANT,
  COMPLIANT_DIRECT_ANSWER,
  COMPLIANT_FAQ,
  COMPLIANT_HTML,
  COMPLIANT_SCHEMAS,
} from './compliant-page.fixture'
import { DUPLICATE_ENFORCEMENT, runValidationGate, type GateFinding, type GateInput } from './gate'
import { measureLength } from './word-count'

const VALID_FAQ = COMPLIANT_SCHEMAS.faqPage

function buildHtml(withH1 = true): string {
  return withH1 ? COMPLIANT_HTML : COMPLIANT_HTML.replace(/<h1>[\s\S]*?<\/h1>/, '')
}

/** The address the page under test is asking for. */
const SLUG = COMPLIANT.slug

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
  faqItems?: GateInput['faqItems']
  directAnswer?: string
  anomalies?: GateInput['anomalies']
} = {}): GateInput {
  const html = opts.html ?? buildHtml()

  return {
    pageType: COMPLIANT.pageType,
    title: COMPLIANT.title,
    metaDescription: COMPLIANT.metaDescription,
    focusKeyword: COMPLIANT.focusKeyword,
    html,
    // Required since the gate started answering questions about the address
    // itself. Every existing assertion below is unchanged.
    slug: SLUG,
    schemaLocalBusiness: COMPLIANT_SCHEMAS.localBusiness,
    schemaFaqPage: opts.schemaFaqPage ?? VALID_FAQ,
    schemaBreadcrumb: COMPLIANT_SCHEMAS.breadcrumb,
    schemaArticle: COMPLIANT_SCHEMAS.article,
    // ~415 measured words: the target sits just above, as the brief would.
    measurement: measureLength({ html, declared: opts.declared, target: opts.target ?? 450 }),
    deadInternalLinks: opts.deadInternalLinks,
    existingContents: opts.existingContents,
    identity: opts.identity,
    intent: opts.intent,
    duplicateMode: opts.duplicateMode,
    inventoryTruncated: opts.inventoryTruncated,
    anomalies: opts.anomalies,
    faqItems: opts.faqItems ?? COMPLIANT_FAQ.map(item => ({ ...item })),
    directAnswer: opts.directAnswer ?? COMPLIANT_DIRECT_ANSWER,
    city: COMPLIANT.city,
    businessName: COMPLIANT.businessName,
    requiredEntities: [...COMPLIANT.requiredEntities],
    enableExternalLinks: true,
    hasGoogleBusinessProfile: false,
    siteUrl: COMPLIANT.siteUrl,
  }
}

/** A page already online, carrying the body it is compared against. */
function buildCandidate(overrides: Partial<ContentToCheck> = {}): ContentToCheck {
  return {
    id: '/depannage-plomberie-troyes',
    title: 'Depannage plomberie a Troyes',
    // The very HTML of the page under test: an exact copy by construction.
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

  it('publishes the compliant page outright — the strict gate is not a dead engine', async () => {
    const verdict = await runValidationGate(buildInput())

    expect(verdict.blocking.map(f => `${f.code} (${f.source})`)).toEqual([])
    expect(verdict.publishable).toBe(true)
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

// ─── The SEO + GEO audit, as wired into the gate ────────────────────────────

describe('runValidationGate — SEO + GEO audit', () => {
  it('blocks on an audit finding, filed under its own source', async () => {
    const verdict = await runValidationGate(buildInput({ faqItems: COMPLIANT_FAQ.slice(0, 2).map(item => ({ ...item })) }))
    const finding = verdict.blocking.find(f => f.code === 'FAQ_MINIMUM')

    expect(verdict.publishable).toBe(false)
    expect(finding?.source).toBe('geo')
  })

  it('files a search-engine rule under seo', async () => {
    const verdict = await runValidationGate(buildInput({ html: buildHtml().replace('<ul>', '<ul><li><img src="/x.jpg"></li>') }))

    expect(verdict.blocking.find(f => f.code === 'IMAGE_ALT')?.source).toBe('seo')
  })

  it('keeps a warning-level audit finding out of the blocking list', async () => {
    const html = buildHtml().replace(/<p class="page-auteur">[\s\S]*?<\/p>/, '')
    const verdict = await runValidationGate(buildInput({ html }))

    expect(verdict.warnings.some(f => f.code === 'AUTHOR_DATE')).toBe(true)
    expect(verdict.blocking.some(f => f.code === 'AUTHOR_DATE')).toBe(false)
  })

  it('reports a missing direct answer ONCE, as the blocking DIRECT_ANSWER — not again as the generator anomaly', async () => {
    const verdict = await runValidationGate(buildInput({
      directAnswer: '',
      anomalies: [{ field: 'directAnswer', severity: 'blocking', reason: 'Bloc de reponse directe absent.' }],
    }))
    const all = codes([...verdict.blocking, ...verdict.warnings])

    expect(codes(verdict.blocking)).toContain('DIRECT_ANSWER')
    expect(all).not.toContain('GENERATOR_DIRECTANSWER')
  })

  it('still never blocks on the directAnswer anomaly alone: the page is what gets measured', async () => {
    // The generator says its answer is off-target, the page itself carries a
    // correct one: the anomaly is reported, the page ships.
    const verdict = await runValidationGate(buildInput({
      anomalies: [{ field: 'directAnswer', severity: 'blocking', reason: 'Reponse directe de 33 mots, hors cible 40-60.' }],
    }))

    expect(verdict.publishable).toBe(true)
    expect(codes(verdict.warnings)).toContain('GENERATOR_DIRECTANSWER')
  })

  it('keeps the audit when the external validators crash', async () => {
    const spy = vi.spyOn(ValidationPipelineOrchestrator.prototype, 'validate').mockRejectedValue(new Error('validateur en panne'))

    try {
      const verdict = await runValidationGate(buildInput({ faqItems: [] }))

      expect(verdict.degraded).toBe('validateur en panne')
      expect(codes(verdict.blocking)).toContain('FAQ_MINIMUM')
    } finally {
      spy.mockRestore()
    }
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

    // By source, not by code prefix: the audit's DUPLICATE_PARAGRAPH is about
    // the page repeating ITSELF, not about what is online.
    expect([...alone.blocking, ...alone.warnings].some(finding => finding.source === 'duplicate')).toBe(false)
    expect(alone.duplicateVerdict).toBeUndefined()
  })

  it('blocks by default since 2026-10-17, and persists the mode it blocked in', async () => {
    expect(DUPLICATE_ENFORCEMENT).toBe('block')

    const verdict = await runValidationGate(buildInput({ existingContents: [buildCandidate()] }))

    expect(codes(verdict.blocking)).toContain('DUPLICATE_EXACT')
    expect(verdict.publishable).toBe(false)
    expect(verdict.duplicateVerdict?.mode).toBe('block')
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
    // In `blocking` since the default became 'block'; the caveat travels either way.
    expect(excerpt.blocking.find(f => f.code === 'DUPLICATE_EXACT')?.message).toContain('comparaison partielle')

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

  it('holds a page whose title is already used, and says the comparison was partial', async () => {
    const verdict = await runValidationGate(buildInput({
      identity: [buildComparison({ titleSimilarity: 0.94, comparisonIsPartial: true })],
    }))
    const finding = verdict.blocking.find(f => f.code === 'TITLE_NEAR_DUPLICATE')

    expect(finding).toBeDefined()
    expect(finding?.source).toBe('duplicate')
    expect(finding?.message).toContain('https://exemple.fr/depannage-plomberie-troyes')
    expect(finding?.message).toContain('comparaison partielle')
    expect(verdict.duplicateVerdict?.matches[0]?.partial).toBe(true)
  })

  it('holds the page on cannibalisation in block mode, and only warns under observation', async () => {
    // Same focus keyword as a page already online: two pages for one click.
    const identity = [buildComparison({ sameFocusKeyword: true })]

    const blocked = await runValidationGate(buildInput({ identity }))
    const finding = blocked.blocking.find(f => f.code === 'CANNIBALIZATION')
    expect(finding?.source).toBe('duplicate')
    expect(finding?.message).toContain('https://exemple.fr/depannage-plomberie-troyes')
    expect(blocked.publishable).toBe(false)
    // Named in the persisted reasons: that is what the operator and the
    // regeneration read.
    expect(blocked.duplicateVerdict?.reasons).toHaveLength(1)

    const observed = await runValidationGate(buildInput({ identity, duplicateMode: 'observe' }))
    expect(codes(observed.warnings)).toContain('CANNIBALIZATION')
    expect(observed.publishable).toBe(true)
    expect(observed.duplicateVerdict?.matches).toEqual(blocked.duplicateVerdict?.matches)
  })

  it('holds the page on a LEXICAL cannibalisation too — same title and intent, overlapping body', async () => {
    // The detector's own cannibalisation: a title identical to ours, the same
    // intent, and a body that overlaps (the first 40 % of ours, measured at a
    // content similarity of ~0.76) without reaching the 0.85 of a duplicate.
    const candidate = buildCandidate({
      title: COMPLIANT.title,
      content: COMPLIANT_HTML.slice(0, Math.floor(COMPLIANT_HTML.length * 0.4)),
    })

    const verdict = await runValidationGate(buildInput({ existingContents: [candidate] }))

    expect(verdict.duplicateVerdict?.matches.map(m => m.code)).toEqual(['CANNIBALIZATION'])
    expect(codes(verdict.blocking)).toContain('CANNIBALIZATION')
    expect(verdict.publishable).toBe(false)

    const observed = await runValidationGate(buildInput({ existingContents: [candidate], duplicateMode: 'observe' }))
    expect(codes(observed.warnings)).toContain('CANNIBALIZATION')
    expect(observed.publishable).toBe(true)
  })

  it('reports a taken address on a creation, and ignores it on a refresh', async () => {
    const identity = [buildComparison({ pathCollision: true, titleSimilarity: 0.99 })]

    const creation = await runValidationGate(buildInput({ identity, intent: 'create' }))
    expect(codes(creation.blocking)).toContain('SLUG_COLLISION')

    // A refresh rewrites the page living at that very address: judging it
    // against itself would refuse every update ever ordered.
    const refresh = await runValidationGate(buildInput({ identity, intent: 'refresh' }))
    expect(codes([...refresh.blocking, ...refresh.warnings])).not.toContain('SLUG_COLLISION')
    expect(codes([...refresh.blocking, ...refresh.warnings])).not.toContain('TITLE_NEAR_DUPLICATE')
  })
})
