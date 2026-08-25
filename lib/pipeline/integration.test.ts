// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Integration Test
// SEO Engine - Does a normal page still ship?
// ─────────────────────────────────────────────────────────────────────────────
//
// The unit tests next to this file each prove one function. This one proves the
// thing none of them can: that a REALISTIC French article, of the shape the
// generator actually produces, comes out of `runPostGenerationPipeline` with
// `publishable === true`.
//
// It exists because the two failure modes of a quality gate are symmetric and
// only one of them is loud. A gate that lets everything through is the bug we
// set out to fix; a gate that blocks everything is a dead engine, and it looks
// exactly like a working one from the outside — green tests, clean build,
// nothing published. Six rules in the validators used to reject 100 % of real
// French pages (readability computed with an English syllable count, "no <img>"
// when the generator emits none, a 60-character title cap against a prompt
// asking for 65, exact-substring keyword matching...). They are fixed; this test
// is what stops them silently coming back.
//
// No database and no network: `siteId` is left undefined, which is the documented
// way to run the pipeline without `loadSiteLinkContext`. The internal-link mesh
// is covered by internal-links.test.ts, which does not need either.

import { describe, it, expect } from 'vitest'
import type { GeneratedPage } from '@/lib/ai/openai'
import { runPostGenerationPipeline, runPrePublishGate } from './index'

// ─── A page as the generator really produces one ────────────────────────────

const LOCAL_BUSINESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Plumber',
  name: 'Dupont Plomberie',
  url: 'https://dupont-plomberie.fr',
  telephone: '+33325123456',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '12 rue de la Paix',
    addressLocality: 'Troyes',
    postalCode: '10000',
    addressCountry: 'FR',
  },
})

const FAQ_PAGE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Combien coute un depannage de plomberie a Troyes ?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Le tarif depend de la nature de la panne et de l horaire d intervention. Un diagnostic est realise avant tout devis, et le devis est remis par ecrit avant le debut des travaux.',
      },
    },
    {
      '@type': 'Question',
      name: 'Intervenez-vous en urgence le week-end ?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Oui, une astreinte est assuree le samedi et le dimanche pour les fuites et les degats des eaux, sur l ensemble de l agglomeration troyenne.',
      },
    },
  ],
})

const BREADCRUMB = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://dupont-plomberie.fr/' },
    { '@type': 'ListItem', position: 2, name: 'Troyes', item: 'https://dupont-plomberie.fr/plomberie-troyes' },
  ],
})

/**
 * ~700 words of ordinary French prose.
 *
 * Ordinary is the point: normal sentence length, normal vocabulary, accents,
 * apostrophes, subordinate clauses. This is the text the readability score has
 * to accept. Built from repeated paragraphs so the word count is deliberate
 * rather than accidental, but each paragraph is a real sentence set — a wall of
 * one repeated word would not exercise the syllable counter.
 */
function buildBody(paragraphs: number): string {
  const blocks = [
    `<p>Une fuite sous l'evier se manifeste souvent par une trace d'humidite dans le meuble bas, bien avant que l'eau n'atteigne le sol. Le joint du siphon se dessesserre avec le temps, et un simple resserrage suffit dans une majorite de cas. Lorsque la fuite persiste, c'est generalement la bague d'etancheite qui doit etre remplacee.</p>`,
    `<p>Le calcaire reste la premiere cause d'usure des installations dans l'Aube. Il se depose sur les resistances du chauffe-eau, reduit le debit des mousseurs et finit par bloquer les robinets thermostatiques. Un detartrage regulier prolonge la duree de vie de l'appareil et limite la consommation electrique du ballon.</p>`,
    `<p>Avant toute intervention, la coupure de l'arrivee generale est indispensable. La vanne se trouve le plus souvent dans le garage, la cave ou le local technique, a proximite du compteur. Ouvrir ensuite un robinet en point bas permet de vider la colonne et d'eviter que l'eau residuelle ne se repande pendant le demontage.</p>`,
    `<p>Le remplacement d'un chauffe-eau demande de verifier la puissance disponible sur la ligne dediee et l'etat du groupe de securite. Un groupe entartre ne joue plus son role et met la cuve sous pression. La date de mise en service figure sur la plaque signaletique et conditionne l'application de la garantie constructeur.</p>`,
    `<p>Un degat des eaux doit etre declare a l'assureur dans les cinq jours ouvres qui suivent sa constatation. Les photographies prises avant la remise en etat facilitent l'expertise, et la facture de reparation justifie la nature des travaux realises. Le constat amiable est necessaire des lors qu'un voisin est concerne.</p>`,
    `<p>L'entretien annuel d'une chaudiere est une obligation legale pour les appareils dont la puissance est comprise entre quatre et quatre cents kilowatts. L'attestation remise a l'issue de la visite est demandee par l'assurance en cas de sinistre. Elle mentionne les mesures de combustion et l'etat general de l'installation.</p>`,
  ]

  const out: string[] = []
  for (let i = 0; i < paragraphs; i++) out.push(blocks[i % blocks.length])
  return out.join('\n')
}

function realisticPage(overrides: Partial<GeneratedPage> = {}): GeneratedPage {
  const html = [
    `<h1>Plombier a Troyes : depannage et installation dans l'Aube</h1>`,
    `<p>Un plombier a Troyes intervient sur les fuites, le remplacement de chauffe-eau et la renovation de salle de bains dans toute l'agglomeration. Le diagnostic est realise sur place et le devis est remis par ecrit avant le debut des travaux, sans engagement de votre part.</p>`,
    `<h2>Reconnaitre une fuite avant qu'elle ne cause des degats</h2>`,
    buildBody(6),
    `<h2>Detartrage et entretien des installations dans l'Aube</h2>`,
    buildBody(6),
    `<h2>Remplacer un chauffe-eau : ce qu'il faut verifier</h2>`,
    buildBody(6),
    `<h2>Questions frequentes sur la plomberie a Troyes</h2>`,
    `<h3>Combien coute un depannage de plomberie a Troyes ?</h3>`,
    `<p>Le tarif depend de la nature de la panne et de l'horaire d'intervention. Un diagnostic precede systematiquement le devis, qui est remis par ecrit.</p>`,
    `<h3>Intervenez-vous en urgence le week-end ?</h3>`,
    `<p>Une astreinte est assuree le samedi et le dimanche pour les fuites et les degats des eaux, sur l'ensemble de l'agglomeration troyenne.</p>`,
  ].join('\n')

  return {
    title: 'Plombier a Troyes : depannage et installation dans l\'Aube',
    metaDescription: "Plombier a Troyes pour vos depannages, fuites et remplacements de chauffe-eau. Diagnostic sur place, devis ecrit avant travaux, intervention dans toute l'Aube.",
    slug: 'plombier-troyes-depannage-aube',
    focusKeyword: 'plombier Troyes',
    secondaryKeywords: ['depannage plomberie Troyes', 'chauffe-eau Troyes'],
    ogTitle: 'Plombier a Troyes',
    ogDescription: 'Depannage et installation dans l\'Aube.',
    twitterTitle: 'Plombier a Troyes',
    twitterDescription: 'Depannage et installation dans l\'Aube.',
    htmlContent: html,
    schemaLocalBusiness: LOCAL_BUSINESS,
    schemaFaqPage: FAQ_PAGE,
    schemaBreadcrumb: BREADCRUMB,
    internalLinks: [],
    internalLinksHtml: [],
    faqItems: [],
    // The generator emits alts but never an <img> tag. A page therefore always
    // reaches the gate with zero images, which is why that can never be blocking.
    imageAlts: ['Plombier intervenant sur un chauffe-eau a Troyes'],
    ctaText: 'Demander un devis',
    targetLength: 1200,
    // Over-declared on purpose: the model's own figure is never trusted, the
    // pipeline overwrites it with the measured one.
    estimatedWordCount: 1800,
    readingTimeMinutes: 9,
    ...overrides,
  }
}

const BASE = {
  generationId: 'gen-test',
  pageType: 'child' as const,
  siteUrl: 'https://dupont-plomberie.fr',
  // No siteId: no database access. The link mesh is reported as degraded, which
  // must not by itself block a publication.
  siteId: undefined,
}

// ─── The test that matters ──────────────────────────────────────────────────

describe('post-generation pipeline — a normal French page', () => {
  it('publishes a realistic article', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    // The whole point. If this ever goes red, the engine has stopped producing.
    expect(report.reasons).toEqual([])
    expect(report.publishable).toBe(true)
  })

  it('does not judge ordinary French prose unreadable', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    const readability = [...report.reasons, ...report.warnings]
      .filter(entry => entry.startsWith('READABILITY_DIFFICULT'))

    expect(readability).toEqual([])
  })

  it('does not block a page for having no <img>, which the generator never emits', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.reasons.some(reason => reason.includes('IMAGE'))).toBe(false)
  })

  it('replaces the declared word count with the measured one', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.measurement.declared).toBe(1800)
    expect(report.measurement.measured).toBeLessThan(1800)
    // What gets stored is the measurement, not the claim.
    expect(report.page.estimatedWordCount).toBe(report.measurement.measured)
  })

  it('still passes on the deferred publishing path', async () => {
    const report = await runPrePublishGate({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.reasons).toEqual([])
    expect(report.publishable).toBe(true)
  })
})

// ─── And the defects it must still catch ────────────────────────────────────

describe('post-generation pipeline — what must not ship', () => {
  it('blocks a page well under its ordered length', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        htmlContent: `<h1>Plombier a Troyes</h1><h2>Nos interventions</h2>${buildBody(2)}`,
      }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('LENGTH_BELOW_TARGET'))).toBe(true)
  })

  it('blocks a page with no H1', async () => {
    const page = realisticPage()
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ htmlContent: page.htmlContent.replace(/<\/?h1>/g, 'p>') }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('MISSING_H1'))).toBe(true)
  })

  it('blocks a page whose JSON-LD does not parse', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ schemaFaqPage: '{"@type":"FAQPage", "mainEntity": [' }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.includes('JSON'))).toBe(true)
  })

  it('treats the generator\'s "{}" schema fallback as absent, not as broken', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ schemaFaqPage: '{}', schemaBreadcrumb: '{}' }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(true)
    expect(report.warnings.some(warning => warning.startsWith('SCHEMA_ABSENT'))).toBe(true)
  })

  it('blocks a breadcrumb whose positions are not contiguous', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        schemaBreadcrumb: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://dupont-plomberie.fr/' },
            { '@type': 'ListItem', position: 7, name: 'Troyes', item: 'https://dupont-plomberie.fr/troyes' },
          ],
        }),
      }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    // Reaches the gate only because `schemas` is passed to the orchestrator;
    // the structural parse check alone would have accepted this block.
    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('JSON_LD_'))).toBe(true)
  })

  it('blocks on a generator anomaly listed as blocking', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        anomalies: [
          { field: 'metaDescription', severity: 'blocking', reason: 'Meta description absente de la reponse IA.' },
        ],
      }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('GENERATOR_METADESCRIPTION'))).toBe(true)
  })

  it('does not block on a missing directAnswer, only warns', async () => {
    // Deliberate policy, not an oversight: `directAnswer` is a brand-new prompt
    // requirement, and one drifting optional field must not stop the engine.
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        anomalies: [
          { field: 'directAnswer', severity: 'blocking', reason: 'Bloc de reponse directe absent.' },
        ],
      }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(true)
    expect(report.warnings.some(warning => warning.startsWith('GENERATOR_DIRECTANSWER'))).toBe(true)
  })

  it('never throws, even on an empty page', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ htmlContent: '' }),
      campaign: { target_length: 1200, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.length).toBeGreaterThan(0)
  })
})
