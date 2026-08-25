// ─────────────────────────────────────────────────────────────────────────────
// Page Types Tests
// SEO Engine - Prompt construction, search intent and response normalization
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  AiOutputError,
  buildLengthPlan,
  resolveGenerationLength,
  buildSystemPrompt,
  buildUserPrompt,
  hasBlockingAnomaly,
  normalizeResponse,
  resolveSearchIntent,
  type PageTypeGenerateOptions,
} from './page-types'

const baseOptions: PageTypeGenerateOptions = {
  pageType: 'child',
  city: 'Troyes',
  department: 'Aube',
  businessType: 'plombier',
  businessName: 'Plomberie Martin',
  keywords: ['plombier troyes', 'depannage plomberie'],
  siteUrl: 'https://example.fr',
  targetLength: 800,
  enableRag: false,
  // The address is now an INPUT, reserved against the existing site before the
  // first token is spent. These four fields are required precisely so no caller
  // can generate blind again.
  reservedSlug: 'adresse-reservee-plombier-troyes',
  inventoryNeighbours: [],
  action: { kind: 'create' },
  inventoryFreshness: { state: 'fresh', lastCrawledAt: '2026-07-30T00:00:00.000Z', ageDays: 1 },
}

function buildPrompt(overrides: Partial<Parameters<typeof buildUserPrompt>[0]> = {}) {
  return buildUserPrompt({
    pageType: 'child',
    city: 'Troyes',
    department: 'Aube',
    businessType: 'plombier',
    businessName: 'Plomberie Martin',
    keywords: ['plombier troyes'],
    siteUrl: 'https://example.fr',
    adjustedLength: 1200,
    enableExternalLinks: true,
    externalLinkCount: 3,
    enableImages: true,
    imagePerPage: 2,
    minFaq: 3,
    requiredSections: ['hero', 'content', 'parent_link', 'faq', 'cta'],
    competitorNames: [],
    alternativeNames: [],
    // Rendered by lib/existing/prompt-block.ts and inserted verbatim. Empty
    // here: what this suite checks is the rest of the prompt, and the awareness
    // block has its own contract.
    existingAwareness: '',
    searchIntent: 'transactionnelle',
    today: '2026-07-31',
    ...overrides,
  })
}

describe('resolveSearchIntent()', () => {
  it('uses the intent declared in the plan brief', () => {
    expect(resolveSearchIntent('transactionnelle', 'comment reparer une fuite', 'pillar')).toBe('transactionnelle')
    expect(resolveSearchIntent('Commerciale / investigation', 'plombier troyes', 'pillar')).toBe('commerciale')
    expect(resolveSearchIntent('informational', 'devis plombier', 'local_pack')).toBe('informationnelle')
  })

  it('deduces the intent from the target query when the brief says nothing', () => {
    expect(resolveSearchIntent(undefined, 'devis plombier troyes', 'child')).toBe('transactionnelle')
    expect(resolveSearchIntent(undefined, 'meilleur plombier troyes', 'child')).toBe('commerciale')
    expect(resolveSearchIntent(undefined, 'comment reparer une fuite', 'child')).toBe('informationnelle')
    expect(resolveSearchIntent(undefined, 'horaires plombier troyes', 'child')).toBe('navigationnelle')
  })

  it('falls back to the page type default for a neutral query', () => {
    expect(resolveSearchIntent(undefined, 'plombier troyes', 'local_pack')).toBe('transactionnelle')
    expect(resolveSearchIntent(undefined, 'plombier troyes', 'comparative')).toBe('commerciale')
    expect(resolveSearchIntent(undefined, 'plombier troyes', 'pillar')).toBe('informationnelle')
  })

  it('ignores an unreadable declared intent', () => {
    expect(resolveSearchIntent('???', 'devis plombier troyes', 'child')).toBe('transactionnelle')
  })
})

describe('buildLengthPlan()', () => {
  const sections = ['hero', 'introduction', 'context', 'detailed_sections', 'child_links', 'faq', 'cta']

  it('splits the target across the sections', () => {
    const plan = buildLengthPlan(2000, sections)
    const total = plan.reduce((sum, entry) => sum + entry.words, 0)

    expect(plan).toHaveLength(sections.length)
    expect(total).toBeGreaterThanOrEqual(2000 * 0.85)
    expect(total).toBeLessThanOrEqual(2000 * 1.05)
  })

  it('gives the core section the largest budget and never leaves one empty', () => {
    const plan = buildLengthPlan(2000, sections)
    const byName = Object.fromEntries(plan.map((entry) => [entry.section, entry.words]))

    expect(byName.detailed_sections).toBeGreaterThan(byName.hero)
    expect(byName.detailed_sections).toBeGreaterThan(byName.cta)
    for (const entry of plan) {
      expect(entry.words).toBeGreaterThanOrEqual(40)
    }
  })

  it('handles an empty section list', () => {
    expect(buildLengthPlan(1000, [])).toEqual([])
  })
})

describe('buildSystemPrompt()', () => {
  it('carries the factual integrity rules', () => {
    const prompt = buildSystemPrompt('local_pack', 'extra', 'transactionnelle')

    expect(prompt).toContain('INTEGRITE FACTUELLE')
    expect(prompt).toContain('aggregateRating')
    expect(prompt).toMatch(/INTERDICTION d'inventer/)
  })

  it('no longer asks for invented figures or social proof', () => {
    const prompt = buildSystemPrompt('pillar', 'extra', 'informationnelle')

    expect(prompt).not.toContain('Integre des preuves sociales (avis, temoignages, chiffres)')
    expect(prompt).not.toContain('Utilise des donnees concretes, des chiffres')
  })

  it('injects the directives of the qualified intent', () => {
    expect(buildSystemPrompt('child', 'extra', 'transactionnelle')).toContain('INTENTION : TRANSACTIONNELLE')
    expect(buildSystemPrompt('child', 'extra', 'commerciale')).toContain('INTENTION : COMMERCIALE')
    expect(buildSystemPrompt('child', 'extra', 'navigationnelle')).toContain('INTENTION : NAVIGATIONNELLE')
    expect(buildSystemPrompt('child', 'extra', 'informationnelle')).toContain('INTENTION : INFORMATIONNELLE')
  })
})

describe('buildUserPrompt()', () => {
  it('demands a self-contained direct answer right after the H1', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('BLOC DE REPONSE DIRECTE')
    expect(prompt).toContain('40 a 60 mots')
    expect(prompt).toContain('reponse-directe')
    expect(prompt).toContain('"directAnswer"')
  })

  it('asks for an author entity and publication dates', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('E-E-A-T')
    expect(prompt).toContain('Plomberie Martin')
    expect(prompt).toContain('2026-07-31')
    expect(prompt).toContain('schemaArticle')
    expect(prompt).toMatch(/N'INVENTE JAMAIS de nom de personne/)
  })

  it('states the qualified intent', () => {
    expect(buildPrompt({ searchIntent: 'commerciale' })).toContain('Intention de recherche qualifiee : commerciale')
  })

  it('budgets the length section by section and repeats the target at the very end', () => {
    const prompt = buildPrompt({ adjustedLength: 1200 })

    expect(prompt).toContain('BUDGET DE LONGUEUR PAR SECTION')
    expect(prompt).toMatch(/- hero : ~\d+ mots/)
    expect(prompt).toContain('RAPPEL FINAL')
    // 85 % of 1200 — the floor another job enforces after the fact.
    expect(prompt).toContain('1020 mots')

    // The end of a prompt weighs more: the reminder must sit in its last quarter.
    const reminderPosition = prompt.indexOf('RAPPEL FINAL')
    expect(reminderPosition).toBeGreaterThan(prompt.length * 0.75)
  })

  it('forbids NAP data when no Google Business Profile is connected', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('DONNEES GOOGLE BUSINESS PROFILE: AUCUNE')
    expect(prompt).toMatch(/Aucune adresse, aucun telephone/)
  })
})

describe('normalizeResponse()', () => {
  const validPayload = {
    title: 'Depannage plomberie urgence a Troyes',
    metaDescription: 'Depannage plomberie a Troyes : intervention rapide par Plomberie Martin.',
    slug: 'depannage-plomberie-urgence-fuite-eau-troyes-centre',
    directAnswer: 'Un plombier intervient a Troyes pour une fuite ou une canalisation bouchee. '
      + 'La prise de contact declenche un diagnostic sur place, puis une reparation immediate '
      + 'quand la piece necessaire est disponible, sinon une mise en securite du logement avant '
      + 'le retour du technicien.',
    htmlContent: '<h1>Plombier Troyes</h1><p>Contenu de la page avec suffisamment de mots pour compter.</p>',
    secondaryKeywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    faqItems: [{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }, { q: 'e', a: 'f' }],
    internalLinks: [{ anchor: 'plomberie', suggestion: 'plomberie-troyes' }],
    schemaLocalBusiness: '{"@type":"LocalBusiness"}',
    schemaFaqPage: '{"@type":"FAQPage"}',
    schemaBreadcrumb: '{"@type":"BreadcrumbList"}',
    schemaArticle: '{"@type":"Article"}',
  }

  it('returns a clean page with no anomaly when everything is there', () => {
    const page = normalizeResponse(validPayload, baseOptions, 800, 'transactionnelle')

    expect(page.anomalies).toEqual([])
    expect(hasBlockingAnomaly(page)).toBe(false)
    expect(page.searchIntent).toBe('transactionnelle')
    expect(page.directAnswer).toContain('Un plombier intervient')
    expect(page.author).toBe('Plomberie Martin')
    expect(page.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(page.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('refuses a response with no article body instead of publishing an empty page', () => {
    expect(() => normalizeResponse({ ...validPayload, htmlContent: '' }, baseOptions, 800, 'transactionnelle'))
      .toThrow(AiOutputError)
    expect(() => normalizeResponse({ title: 'x' }, baseOptions, 800, 'transactionnelle'))
      .toThrow(/htmlContent/)
  })

  it('reports a missing meta description instead of shipping an empty one', () => {
    const page = normalizeResponse({ ...validPayload, metaDescription: '' }, baseOptions, 800, 'transactionnelle')

    expect(page.metaDescription).not.toBe('')
    expect(hasBlockingAnomaly(page)).toBe(true)
    expect(page.anomalies).toContainEqual(
      expect.objectContaining({ field: 'metaDescription', severity: 'blocking' })
    )
  })

  it('reports a missing direct answer as blocking', () => {
    const page = normalizeResponse({ ...validPayload, directAnswer: '' }, baseOptions, 800, 'transactionnelle')

    expect(page.directAnswer).toBeUndefined()
    expect(page.anomalies).toContainEqual(
      expect.objectContaining({ field: 'directAnswer', severity: 'blocking' })
    )
  })

  it('warns when the direct answer is off-target or refers to the rest of the page', () => {
    const short = normalizeResponse({ ...validPayload, directAnswer: 'Trop court.' }, baseOptions, 800, 'transactionnelle')
    expect(short.anomalies).toContainEqual(
      expect.objectContaining({ field: 'directAnswer', severity: 'warning' })
    )

    const referring = normalizeResponse(
      { ...validPayload, directAnswer: `${validPayload.directAnswer} Voir ci-dessous.` },
      baseOptions,
      800,
      'transactionnelle'
    )
    expect(referring.anomalies.some((anomaly) => /autosuffisante/.test(anomaly.reason))).toBe(true)
  })

  it('warns on a thin FAQ, a thin keyword set, missing internal links and missing schemas', () => {
    const page = normalizeResponse(
      {
        ...validPayload,
        faqItems: [],
        secondaryKeywords: ['a'],
        internalLinks: [],
        schemaFaqPage: '',
        schemaArticle: '',
      },
      baseOptions,
      800,
      'transactionnelle'
    )
    const fields = page.anomalies.map((anomaly) => anomaly.field)

    expect(fields).toContain('faqItems')
    expect(fields).toContain('secondaryKeywords')
    expect(fields).toContain('internalLinks')
    expect(fields).toContain('schemaFaqPage')
    expect(fields).toContain('schemaArticle')
    expect(hasBlockingAnomaly(page)).toBe(false)
  })

  it('measures the word count instead of trusting the model', () => {
    const page = normalizeResponse(
      { ...validPayload, estimatedWordCount: 99999 },
      baseOptions,
      800,
      'transactionnelle'
    )

    expect(page.estimatedWordCount).toBe(12)
    expect(page.readingTimeMinutes).toBe(1)
  })

  it('publishes at the RESERVED address, not the one the model or the brief proposed', () => {
    // The regression this locks, and the reason the rule was inverted: the slug
    // used to be rebuilt from whatever came back, AFTER the page was paid for.
    // Three sources disagree here on purpose — the payload says
    // `depannage-plomberie-urgence-fuite-eau-troyes-centre`, the brief says
    // `slug-du-plan-...`, and only `reservedSlug` was checked against the site's
    // existing pages and written to `generations.slug`. Publishing at either of
    // the other two would put this page on top of an address nobody arbitrated.
    const page = normalizeResponse(validPayload, {
      ...baseOptions,
      planBrief: {
        id: 'p1',
        scheduled_date: '2026-07-31',
        page_type: 'child',
        priority: 'high',
        target_city: 'Troyes',
        target_keyword: 'depannage plomberie troyes',
        secondary_keywords: [],
        search_intent: 'transactionnelle',
        proposed_title: 'Titre du plan',
        proposed_slug: 'slug-du-plan-depannage-plomberie-troyes',
        page_goal: 'convertir',
        outline: [],
        seo_rules: [],
        required_entities: [],
        internal_link_targets: [],
        competitor_insights: [],
        estimated_word_count: 800,
        rationale: '',
      },
    }, 800, 'transactionnelle')

    expect(page.slug).toBe(baseOptions.reservedSlug)
    expect(page.slug).not.toBe(validPayload.slug)
    expect(page.slug).not.toBe('slug-du-plan-depannage-plomberie-troyes')
    // The focus keyword still comes from the brief: only the ADDRESS moved.
    expect(page.focusKeyword).toBe('depannage plomberie troyes')
  })
})

// ─── Generation length ───────────────────────────────────────────────────────

describe('resolveGenerationLength', () => {
  it('honours the brief, because that figure is a SERP measurement', () => {
    // The regression this locks: a query whose ranking pages run ~1 100 words
    // produced a 2 692-word page, because 800 x 2.5 overrode the measurement.
    expect(resolveGenerationLength(1100, 800, 2.5)).toBe(1100)
  })

  it('falls back to campaign x page-type multiplier without a brief', () => {
    // Manual runs and sites with no SERP evidence: a pillar page genuinely
    // warrants more room than a child one.
    expect(resolveGenerationLength(undefined, 800, 2.5)).toBe(2000)
    expect(resolveGenerationLength(undefined, 800, 1.0)).toBe(800)
  })

  it('ignores an implausibly small brief figure', () => {
    // A malformed plan item or a SERP of directory one-liners must not order a
    // page too thin to rank — exactly what the quality gate exists to stop.
    expect(resolveGenerationLength(120, 800, 1.5)).toBe(1200)
  })

  it('keeps a brief figure at the credibility floor', () => {
    expect(resolveGenerationLength(300, 800, 2.5)).toBe(300)
  })

  it('rounds to whole words', () => {
    expect(resolveGenerationLength(undefined, 850, 1.8)).toBe(1530)
    expect(Number.isInteger(resolveGenerationLength(1100.6, 800, 2.5))).toBe(true)
  })
})
