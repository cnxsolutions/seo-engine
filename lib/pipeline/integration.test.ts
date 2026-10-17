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
//
// FIXTURE CHANGES (2026-10-17), when the gate became strict on every SEO and GEO
// concept (seo-audit.ts). The article used to be six paragraphs repeated three
// times each to reach its length: the strict gate refuses that as
// DUPLICATE_PARAGRAPH, and it was never what the generator produces anyway. It
// is now eleven distinct paragraphs, its length target follows (800 words
// instead of 1200 — six were repeated to fill the larger figure), and it
// carries what a real page of the generator carries and the audit now requires:
// an opening direct answer repeated in `directAnswer`, question headings, a
// list, three FAQ questions in `faqItems` mirrored by the FAQPage schema (two
// before), and an author line.

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
    {
      '@type': 'Question',
      name: 'Quels quartiers de Troyes sont desservis ?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Tous les quartiers de Troyes ainsi que Sainte-Savine, Saint-Andre-les-Vergers et La Chapelle-Saint-Luc.',
      },
    },
  ],
})

/** The visible FAQ, question for question the one in FAQ_PAGE. */
const FAQ_ITEMS = [
  {
    q: 'Combien coute un depannage de plomberie a Troyes ?',
    a: "Le tarif depend de la nature de la panne et de l'horaire d'intervention. Un diagnostic precede systematiquement le devis, qui est remis par ecrit.",
  },
  {
    q: 'Intervenez-vous en urgence le week-end ?',
    a: "Une astreinte est assuree le samedi et le dimanche pour les fuites et les degats des eaux, sur l'ensemble de l'agglomeration troyenne.",
  },
  {
    q: 'Quels quartiers de Troyes sont desservis ?',
    a: 'Tous les quartiers de Troyes ainsi que Sainte-Savine, Saint-Andre-les-Vergers et La Chapelle-Saint-Luc.',
  },
]

/** The opening paragraph, which the generator must also copy into `directAnswer`. */
const DIRECT_ANSWER = "Dupont Plomberie est un plombier a Troyes qui intervient sur les fuites, le remplacement de "
  + "chauffe-eau et la renovation de salle de bains dans toute l'agglomeration. Le diagnostic est realise sur place "
  + 'et le devis est remis par ecrit avant le debut des travaux, sans engagement de votre part.'

const BREADCRUMB = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://dupont-plomberie.fr/' },
    { '@type': 'ListItem', position: 2, name: 'Troyes', item: 'https://dupont-plomberie.fr/plomberie-troyes' },
  ],
})

/**
 * Ordinary French prose, never repeated.
 *
 * Ordinary is the point: normal sentence length, normal vocabulary, accents,
 * apostrophes, subordinate clauses. This is the text the readability score has
 * to accept. Each paragraph is a real sentence set — a wall of one repeated word
 * would not exercise the syllable counter — and each one is used ONCE: a page
 * repeating its own paragraphs is refused by DUPLICATE_PARAGRAPH.
 */
const BLOCKS = [
  `<p>Une fuite sous l'evier se manifeste souvent par une trace d'humidite dans le meuble bas, bien avant que l'eau n'atteigne le sol. Le joint du siphon se dessesserre avec le temps, et un simple resserrage suffit dans une majorite de cas. Lorsque la fuite persiste, c'est generalement la bague d'etancheite qui doit etre remplacee.</p>`,
  `<p>Le calcaire reste la premiere cause d'usure des installations dans l'Aube. Il se depose sur les resistances du chauffe-eau, reduit le debit des mousseurs et finit par bloquer les robinets thermostatiques. Un detartrage regulier prolonge la duree de vie de l'appareil et limite la consommation electrique du ballon.</p>`,
  `<p>Avant toute intervention, la coupure de l'arrivee generale est indispensable. La vanne se trouve le plus souvent dans le garage, la cave ou le local technique, a proximite du compteur. Ouvrir ensuite un robinet en point bas permet de vider la colonne et d'eviter que l'eau residuelle ne se repande pendant le demontage.</p>`,
  `<p>Le remplacement d'un chauffe-eau demande de verifier la puissance disponible sur la ligne dediee et l'etat du groupe de securite. Un groupe entartre ne joue plus son role et met la cuve sous pression. La date de mise en service figure sur la plaque signaletique et conditionne l'application de la garantie constructeur.</p>`,
  `<p>Un degat des eaux doit etre declare a l'assureur dans les cinq jours ouvres qui suivent sa constatation. Les photographies prises avant la remise en etat facilitent l'expertise, et la facture de reparation justifie la nature des travaux realises. Le constat amiable est necessaire des lors qu'un voisin est concerne.</p>`,
  `<p>L'entretien annuel d'une chaudiere est une obligation legale pour les appareils dont la puissance est comprise entre quatre et quatre cents kilowatts. L'attestation remise a l'issue de la visite est demandee par l'assurance en cas de sinistre. Elle mentionne les mesures de combustion et l'etat general de l'installation.</p>`,
  `<p>Un siphon bouche se traite d'abord sans produit chimique : le demontage du culot et le nettoyage du coude suffisent le plus souvent. Les deboucheurs corrosifs attaquent les joints et les canalisations anciennes en PVC, et ils rendent l'intervention suivante plus delicate pour le plombier qui doit manipuler un tuyau rempli de soude.</p>`,
  `<p>La pression du reseau d'eau varie d'un quartier a l'autre de l'agglomeration. Au-dela de trois bars, un reducteur de pression protege la robinetterie et les appareils electromenagers ; en dessous d'un bar, les mitigeurs thermostatiques fonctionnent mal et la douche alterne entre l'eau chaude et l'eau froide.</p>`,
  `<p>Le choix d'un chauffe-eau depend du nombre d'occupants et de la place disponible. Un ballon de deux cents litres convient a une famille de quatre personnes, tandis qu'un modele thermodynamique reduit la consommation mais demande un local ventile d'au moins vingt metres cubes pour fonctionner correctement.</p>`,
  `<p>Les fuites encastrees dans une dalle ou une cloison se localisent aujourd'hui sans casser : la camera thermique et le gaz traceur reperent le point de rupture a quelques centimetres pres. Seule la zone concernee est ouverte, ce qui limite les travaux de reprise et le cout de la remise en etat.</p>`,
  `<p>Apres un remplacement de chauffe-eau, l'ancien appareil est evacue vers une filiere de recyclage agreee. Le nouveau ballon est rempli, purge puis mis en chauffe, et le groupe de securite est controle avant le depart du technicien pour verifier l'absence de fuite au raccordement.</p>`,
]

/** `count` distinct paragraphs, starting at `from`. */
function buildBody(count: number, from = 0): string {
  return BLOCKS.slice(from, from + count).join('\n')
}

function realisticPage(overrides: Partial<GeneratedPage> = {}): GeneratedPage {
  const html = [
    `<h1>Plombier a Troyes : depannage et installation dans l'Aube</h1>`,
    `<p class="reponse-directe">${DIRECT_ANSWER}</p>`,
    `<h2>Comment reconnaitre une fuite avant qu'elle ne cause des degats ?</h2>`,
    BLOCKS[0],
    BLOCKS[9],
    `<p>Trois signes doivent alerter sans attendre :</p>`,
    `<ul><li>une facture d'eau qui augmente sans raison apparente ;</li><li>un compteur qui tourne robinets fermes ;</li><li>une peinture qui cloque au bas d'un mur.</li></ul>`,
    `<h2>Detartrage et entretien des installations dans l'Aube</h2>`,
    BLOCKS[1],
    BLOCKS[2],
    BLOCKS[6],
    BLOCKS[7],
    `<h2>Que faut-il verifier avant de remplacer un chauffe-eau ?</h2>`,
    BLOCKS[3],
    BLOCKS[8],
    BLOCKS[10],
    BLOCKS[4],
    BLOCKS[5],
    `<h2>Questions frequentes sur la plomberie a Troyes</h2>`,
    ...FAQ_ITEMS.flatMap(item => [`<h3>${item.q}</h3>`, `<p>${item.a}</p>`]),
    `<p class="page-auteur">Publie par Dupont Plomberie — mis a jour le <time datetime="2026-10-17">2026-10-17</time></p>`,
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
    faqItems: FAQ_ITEMS.map(item => ({ ...item })),
    directAnswer: DIRECT_ANSWER,
    author: 'Dupont Plomberie',
    // The generator emits alts but never an <img> tag. A page therefore always
    // reaches the gate with zero images, which is why that can never be blocking.
    imageAlts: ['Plombier intervenant sur un chauffe-eau a Troyes'],
    ctaText: 'Demander un devis',
    targetLength: 800,
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
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    // The whole point. If this ever goes red, the engine has stopped producing.
    expect(report.reasons).toEqual([])
    expect(report.publishable).toBe(true)
  })

  it('does not judge ordinary French prose unreadable', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    const readability = [...report.reasons, ...report.warnings]
      .filter(entry => entry.startsWith('READABILITY_DIFFICULT'))

    expect(readability).toEqual([])
  })

  it('does not block a page for having no <img>, which the generator never emits', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.reasons.some(reason => reason.includes('IMAGE'))).toBe(false)
  })

  it('replaces the declared word count with the measured one', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
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
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
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
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('LENGTH_BELOW_TARGET'))).toBe(true)
  })

  it('blocks a page with no H1', async () => {
    const page = realisticPage()
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ htmlContent: page.htmlContent.replace(/<\/?h1>/g, 'p>') }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('MISSING_H1'))).toBe(true)
  })

  it('blocks a page whose JSON-LD does not parse', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ schemaFaqPage: '{"@type":"FAQPage", "mainEntity": [' }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.includes('JSON'))).toBe(true)
  })

  it('treats the generator\'s "{}" schema fallback as absent, not as broken', async () => {
    // The breadcrumb only. This test used to blank the FAQPage too, and that page
    // is no longer publishable for a reason of its own: it SHOWS three questions
    // and declares none (FAQ_SCHEMA_MISMATCH, next test). Absent is still not
    // broken — what changed is that a visible FAQ now requires its schema.
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ schemaBreadcrumb: '{}' }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(true)
    expect(report.warnings.some(warning => warning.startsWith('SCHEMA_ABSENT'))).toBe(true)
  })

  it('refuses a visible FAQ without its FAQPage schema — as a mismatch, never as broken JSON', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ schemaFaqPage: '{}' }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('FAQ_SCHEMA_MISMATCH'))).toBe(true)
    expect(report.reasons.some(reason => reason.startsWith('INVALID_JSON_LD'))).toBe(false)
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
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
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
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('GENERATOR_METADESCRIPTION'))).toBe(true)
  })

  it('never blocks on the generator\'s directAnswer anomaly by itself — the page is what gets measured', async () => {
    // Policy changed on 2026-10-17, the assertion did not: the anomaly is still
    // only a warning. The direct answer now blocks through the audit's
    // DIRECT_ANSWER, which reads the page — and this page carries a correct one.
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        anomalies: [
          { field: 'directAnswer', severity: 'blocking', reason: 'Reponse directe de 33 mots, hors cible 40-60.' },
        ],
      }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(true)
    expect(report.warnings.some(warning => warning.startsWith('GENERATOR_DIRECTANSWER'))).toBe(true)
  })

  it('blocks a page without its direct answer, and says so once', async () => {
    const page = realisticPage()
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({
        htmlContent: page.htmlContent.replace(/<p class="reponse-directe">[\s\S]*?<\/p>\n/, ''),
        directAnswer: undefined,
        anomalies: [
          { field: 'directAnswer', severity: 'blocking', reason: 'Bloc de reponse directe absent.' },
        ],
      }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.some(reason => reason.startsWith('DIRECT_ANSWER'))).toBe(true)
    expect([...report.reasons, ...report.warnings].some(entry => entry.startsWith('GENERATOR_DIRECTANSWER'))).toBe(false)
  })

  it('hands the campaign context to the audit: no Google profile, no NAP', async () => {
    // The fixture's LocalBusiness carries a phone and a street address. With a
    // profile connected that is real data; without one it is invented.
    const withProfile = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      hasGoogleBusinessProfile: true,
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })
    expect(withProfile.publishable).toBe(true)

    const withoutProfile = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      hasGoogleBusinessProfile: false,
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })
    expect(withoutProfile.publishable).toBe(false)
    expect(withoutProfile.reasons.some(reason => reason.startsWith('INVENTED_NAP'))).toBe(true)
  })

  it('never guesses the city from the campaign\'s communes (the pre-publish paths do not say which one)', async () => {
    const report = await runPrePublishGate({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false, communes: ['Reims', 'Troyes'] },
    })

    expect(report.reasons.some(reason => reason.startsWith('ENTITY_CITY'))).toBe(false)
    expect(report.publishable).toBe(true)
  })

  it('hands the target city and the business to the audit', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      city: 'Reims',
      campaign: { target_length: 800, enable_images: false, enable_external_links: false, business_name: 'Martin Sanitaire' },
    })

    expect(report.reasons.some(reason => reason.startsWith('ENTITY_CITY'))).toBe(true)
    expect(report.reasons.some(reason => reason.startsWith('ENTITY_BUSINESS'))).toBe(true)
  })

  it('weaves the cited sources into the page even without a site context, so SOURCES can pass', async () => {
    // No siteId: no inventory, no internal mesh. The sources the model cited
    // used to stay in `externalLinks` and never reach the HTML on this path —
    // a page the SOURCES rule would then refuse for a link the pipeline dropped.
    const source = {
      url: 'https://www.service-public.fr/particuliers/vosdroits/F2061',
      anchor: 'degat des eaux',
      domain: 'service-public.fr',
      relevance: 'Demarches officielles',
    }
    const page = { ...realisticPage(), externalLinks: [source] }

    const report = await runPostGenerationPipeline({
      ...BASE,
      page,
      campaign: { target_length: 800, enable_images: false, enable_external_links: true },
    })

    expect(report.page.htmlContent).toContain('href="https://www.service-public.fr/particuliers/vosdroits/F2061"')
    expect(report.reasons.some(reason => reason.startsWith('SOURCES'))).toBe(false)
    expect(report.publishable).toBe(true)

    const uncited = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage(),
      campaign: { target_length: 800, enable_images: false, enable_external_links: true },
    })
    expect(uncited.reasons.some(reason => reason.startsWith('SOURCES'))).toBe(true)
  })

  it('never throws, even on an empty page', async () => {
    const report = await runPostGenerationPipeline({
      ...BASE,
      page: realisticPage({ htmlContent: '' }),
      campaign: { target_length: 800, enable_images: false, enable_external_links: false },
    })

    expect(report.publishable).toBe(false)
    expect(report.reasons.length).toBeGreaterThan(0)
  })
})
