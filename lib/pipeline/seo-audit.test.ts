// ─────────────────────────────────────────────────────────────────────────────
// Deep SEO + GEO audit — tests
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// One base page that passes EVERY rule (compliant-page.fixture.ts), and for each
// rule a mutation of that page that breaks it — plus, where the rule has a trap,
// the near miss that must NOT trip it. Asserting on the code alone keeps each
// test about one rule: a mutation may well break a second one, and that is the
// other test's business.

import { describe, expect, it } from 'vitest'
import { auditSeoGeo, AUDIT_THRESHOLDS, isWellFormedQuestion, type AuditFinding, type SeoAuditInput } from './seo-audit'
import {
  COMPLIANT,
  COMPLIANT_DIRECT_ANSWER,
  COMPLIANT_FAQ,
  COMPLIANT_HTML,
  COMPLIANT_SCHEMAS,
} from './compliant-page.fixture'
import { REPORTED, REPORTED_HTML } from './reported-page.fixture'

function input(overrides: Partial<SeoAuditInput> = {}): SeoAuditInput {
  return {
    html: COMPLIANT_HTML,
    title: COMPLIANT.title,
    metaDescription: COMPLIANT.metaDescription,
    focusKeyword: COMPLIANT.focusKeyword,
    slug: COMPLIANT.slug,
    city: COMPLIANT.city,
    businessName: COMPLIANT.businessName,
    requiredEntities: [...COMPLIANT.requiredEntities],
    faqItems: COMPLIANT_FAQ.map(item => ({ ...item })),
    schemas: { ...COMPLIANT_SCHEMAS },
    directAnswer: COMPLIANT_DIRECT_ANSWER,
    pageType: COMPLIANT.pageType,
    enableExternalLinks: true,
    hasGoogleBusinessProfile: false,
    knownInternalPathsCount: 5,
    internalLinksKept: 2,
    siteUrl: COMPLIANT.siteUrl,
    ...overrides,
  }
}

function audit(overrides: Partial<SeoAuditInput> = {}): AuditFinding[] {
  return auditSeoGeo(input(overrides))
}

function blocking(findings: AuditFinding[]): string[] {
  return findings.filter(f => f.severity === 'blocking').map(f => f.code)
}

function warnings(findings: AuditFinding[]): string[] {
  return findings.filter(f => f.severity === 'warning').map(f => f.code)
}

function find(findings: AuditFinding[], code: string): AuditFinding | undefined {
  return findings.find(f => f.code === code)
}

/** The compliant page with one fragment of its HTML replaced. */
function htmlWith(search: string | RegExp, replacement: string): string {
  const next = COMPLIANT_HTML.replace(search, replacement)
  if (next === COMPLIANT_HTML) throw new Error(`fixture: « ${String(search)} » introuvable`)
  return next
}

const H1 = '<h1>Plombier à Troyes : dépannage rapide et devis clair</h1>'
const INTRO = `<p class="reponse-directe">${COMPLIANT_DIRECT_ANSWER}</p>`
const LIST = /<ul>[\s\S]*?<\/ul>/

function words(count: number, word = 'mot'): string {
  return Array.from({ length: count }, () => word).join(' ')
}

// ─── The base ───────────────────────────────────────────────────────────────

describe('auditSeoGeo — the compliant page', () => {
  it('raises nothing at all, blocking or warning', () => {
    expect(audit()).toEqual([])
  })

  it('never throws, even on an empty page', () => {
    expect(() => auditSeoGeo({
      html: '', title: '', metaDescription: '', focusKeyword: '', slug: '', pageType: 'child',
    })).not.toThrow()
  })

  it('contains a rule that breaks on an unforeseen input: a warning, and the other rules still run', () => {
    // A schema that is not a string — jsonb read back from a hand-edited row.
    const findings = audit({
      title: 'Court',
      schemas: { ...COMPLIANT_SCHEMAS, faqPage: 42 as unknown as string },
    })

    const error = find(findings, 'AUDIT_ERROR')
    expect(error?.severity).toBe('warning')
    expect(error?.message).toContain('FAQ')
    expect(blocking(findings)).toContain('TITLE_LENGTH')
  })

  it('writes every message in French, with the correction to make', () => {
    const findings = audit({
      title: 'Court',
      faqItems: [],
      html: htmlWith(LIST, ''),
    })
    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(finding.message).toMatch(/:/)
      expect(finding.message.length).toBeGreaterThan(40)
    }
  })
})

// ─── SEO — blocking ─────────────────────────────────────────────────────────

describe('auditSeoGeo — SEO', () => {
  it('TITLE_LENGTH: blocks below 25 and above 70 characters, warns between 61 and 70', () => {
    expect(blocking(audit({ title: 'Plombier Troyes' }))).toContain('TITLE_LENGTH')
    expect(blocking(audit({ title: `Plombier à Troyes ${'x'.repeat(60)}` }))).toContain('TITLE_LENGTH')

    const long = audit({ title: 'Plombier à Troyes : dépannage rapide, devis clair et sans surprise' })
    expect(blocking(long)).not.toContain('TITLE_LENGTH')
    expect(warnings(long)).toContain('TITLE_LENGTH')

    expect(audit().map(f => f.code)).not.toContain('TITLE_LENGTH')
  })

  it('META_LENGTH: blocks below 80 and above 170, warns outside 120-160', () => {
    expect(blocking(audit({ metaDescription: 'Plombier à Troyes, devis gratuit.' }))).toContain('META_LENGTH')
    expect(blocking(audit({ metaDescription: `${COMPLIANT.metaDescription} ${'x'.repeat(60)}` }))).toContain('META_LENGTH')

    const short = audit({ metaDescription: 'Plombier à Troyes pour fuites et chauffe-eau, diagnostic sur place et devis gratuit.' })
    expect(blocking(short)).not.toContain('META_LENGTH')
    expect(warnings(short)).toContain('META_LENGTH')
  })

  it('H1_KEYWORD: blocks an H1 that carries under 60 % of the keyword', () => {
    const findings = audit({ html: htmlWith(H1, '<h1>Dépannage rapide à Troyes</h1>') })
    expect(blocking(findings)).toContain('H1_KEYWORD')
    expect(find(findings, 'H1_KEYWORD')?.message).toContain('plombier')
  })

  it('H1_KEYWORD: tolerates a plural, and stays silent when there is no H1 at all (MISSING_H1 is the gate\'s)', () => {
    expect(blocking(audit({ html: htmlWith(H1, '<h1>Plombiers à Troyes : dépannage rapide</h1>') }))).not.toContain('H1_KEYWORD')
    expect(blocking(audit({ html: htmlWith(H1, '') }))).not.toContain('H1_KEYWORD')
  })

  it('TITLE_KEYWORD: blocks a title without the keyword, and ignores the city when it is given separately', () => {
    expect(blocking(audit({ title: 'Dépannage rapide et devis clair dans l’Aube' }))).toContain('TITLE_KEYWORD')
    // "troyes" is the city: it is not counted as a keyword word, so a title
    // naming the trade alone carries 100 % of the keyword.
    expect(blocking(audit({ title: 'Plombier de confiance : dépannage rapide et devis clair' }))).not.toContain('TITLE_KEYWORD')
  })

  it('INTRO_KEYWORD: blocks when the first 150 words never name the keyword', () => {
    const intro = "<p>Dupont Plomberie intervient sur les fuites, les canalisations bouchées et les chauffe-eau en panne "
      + "dans toute l'agglomération. Le diagnostic est réalisé sur place, puis un devis écrit est remis avant le début "
      + 'des travaux, sans engagement et sans frais cachés pour la clientèle.</p>'
    const findings = audit({ html: htmlWith(INTRO, intro) })
    expect(blocking(findings)).toContain('INTRO_KEYWORD')
    expect(blocking(audit())).not.toContain('INTRO_KEYWORD')
  })

  it('HEADING_HIERARCHY: blocks an H3 before any H2, a skipped level, and a second H1', () => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<h3>Un détail</h3><p>Texte.</p>`) }))).toContain('HEADING_HIERARCHY')
    expect(blocking(audit({ html: htmlWith('<h2>Questions fréquentes</h2>', '<h2>Questions fréquentes</h2><h4>Saut</h4>') })))
      .toContain('HEADING_HIERARCHY')
    expect(blocking(audit({ html: `${COMPLIANT_HTML}<h1>Un second titre</h1>` }))).toContain('HEADING_HIERARCHY')
  })

  it('HEADING_HIERARCHY: ignores the navigation block the linker appends', () => {
    const nav = '<nav class="related-pages"><h3>À lire également</h3><ul><li><a href="/a">Page A</a></li></ul></nav>'
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}${nav}`) }))).not.toContain('HEADING_HIERARCHY')
  })

  it('H2_COUNT: 2 H2 minimum on a short page, 3 above 600 words', () => {
    const oneH2 = COMPLIANT_HTML
      .replace('<h2>Combien coûte un dépannage de plomberie à Troyes ?</h2>', '')
      .replace('<h2>Entretenir son installation pour éviter les urgences</h2>', '')
      .replace('<h2>Questions fréquentes</h2>', '')
    expect(blocking(audit({ html: oneH2 }))).toContain('H2_COUNT')

    const longTwoH2 = [
      H1, INTRO,
      '<h2>Comment reconnaître une fuite ?</h2>', `<p>${words(350, 'fuite')}.</p>`,
      '<h2>Combien coûte un dépannage ?</h2>', `<p>${words(350, 'tarif')}.</p>`,
    ].join('')
    expect(blocking(audit({ html: longTwoH2 }))).toContain('H2_COUNT')
    expect(blocking(audit())).not.toContain('H2_COUNT')
  })

  it('KEYWORD_STUFFING: blocks an exact-phrase density above 3 %', () => {
    const stuffed = htmlWith(INTRO, `${INTRO}<p>${Array.from({ length: 20 }, () => 'plombier Troyes').join(', ')}.</p>`)
    expect(blocking(audit({ html: stuffed }))).toContain('KEYWORD_STUFFING')
  })

  it('KEYWORD_STUFFING: blocks the exact phrase repeated in more than half of the H2, not in one of them', () => {
    const repeated = COMPLIANT_HTML
      .replace('<h2>Comment reconnaître une fuite avant les dégâts ?</h2>', '<h2>Plombier Troyes : reconnaître une fuite ?</h2>')
      .replace('<h2>Combien coûte un dépannage de plomberie à Troyes ?</h2>', '<h2>Combien coûte un plombier Troyes ?</h2>')
      .replace('<h2>Entretenir son installation pour éviter les urgences</h2>', '<h2>Entretien avec votre plombier Troyes</h2>')
    expect(blocking(audit({ html: repeated }))).toContain('KEYWORD_STUFFING')

    const once = htmlWith('<h2>Entretenir son installation pour éviter les urgences</h2>', '<h2>Entretien avec votre plombier Troyes</h2>')
    expect(blocking(audit({ html: once }))).not.toContain('KEYWORD_STUFFING')
  })

  it('INTERNAL_LINKS: blocks under 2 kept links on a site of 3+ pages, only warns on a smaller one', () => {
    expect(blocking(audit({ internalLinksKept: 1, knownInternalPathsCount: 5 }))).toContain('INTERNAL_LINKS')

    const small = audit({ internalLinksKept: 0, knownInternalPathsCount: 2 })
    expect(blocking(small)).not.toContain('INTERNAL_LINKS')
    expect(warnings(small)).toContain('INTERNAL_LINKS')

    // Unknown (the inventory could not be read): nothing to judge against.
    expect(audit({ internalLinksKept: undefined, knownInternalPathsCount: undefined }).map(f => f.code))
      .not.toContain('INTERNAL_LINKS')
  })

  it('IMAGE_ALT: blocks an image without a non-empty alt', () => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<img src="/fuite.jpg">`) }))).toContain('IMAGE_ALT')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<img src="/fuite.jpg" alt="  ">`) }))).toContain('IMAGE_ALT')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<img src="/fuite.jpg" alt="Fuite sous un évier à Troyes">`) })))
      .not.toContain('IMAGE_ALT')
  })

  it('SLUG_FORMAT: blocks a malformed slug, or one that names neither the keyword nor the city', () => {
    expect(blocking(audit({ slug: 'Plombier_Troyes' }))).toContain('SLUG_FORMAT')
    expect(blocking(audit({ slug: 'plombier--troyes' }))).toContain('SLUG_FORMAT')
    expect(blocking(audit({ slug: 'devis-gratuit-rapide' }))).toContain('SLUG_FORMAT')

    expect(blocking(audit({ slug: 'depannage-plombiers-aube' }))).not.toContain('SLUG_FORMAT')
    expect(blocking(audit({ slug: 'urgence-fuite-troyes' }))).not.toContain('SLUG_FORMAT')
  })

  it.each([
    ['lorem ipsum', '<p>Lorem ipsum dolor sit amet.</p>'],
    ['[VOTRE…]', '<p>Appelez le [VOTRE NUMÉRO] pour un devis.</p>'],
    ['{{…}}', '<p>Intervention à {{ville}} sous deux heures.</p>'],
    ['TODO', '<p>TODO ajouter les horaires.</p>'],
    ['XXX', '<p>Tarif : XXX euros.</p>'],
    ['[à compléter]', '<p>Horaires : [à compléter]</p>'],
    ['INSÉRER', '<p>INSÉRER LE NOM DU QUARTIER</p>'],
    ['insérer ici', '<p>Insérer ici la photo du chantier.</p>'],
  ])('PLACEHOLDER: blocks %s', (_label, fragment) => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}${fragment}`) }))).toContain('PLACEHOLDER')
  })

  it('PLACEHOLDER: finds a template token hidden in an attribute, never inside inline JSON-LD', () => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p><a href="{{lien_devis}}">Devis</a></p>`) }))).toContain('PLACEHOLDER')

    const jsonLd = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","address":{"@type":"PostalAddress","addressLocality":"Troyes"}}</script>'
    expect(blocking(audit({ html: `${COMPLIANT_HTML}${jsonLd}` }))).not.toContain('PLACEHOLDER')
  })

  it('PLACEHOLDER: lets plain French through', () => {
    const prose = '<p>Le formulaire à compléter auprès de la CPAM est remis sur place. Il suffit d’insérer le joint neuf dans la gorge du raccord.</p>'
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}${prose}`) }))).not.toContain('PLACEHOLDER')
  })

  it('DUPLICATE_PARAGRAPH: blocks a paragraph of 12+ words repeated, not a short one', () => {
    const paragraph = '<p>Le calcaire reste la première cause d\'usure des installations dans l\'Aube, surtout sur les chauffe-eau anciens.</p>'
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}${paragraph}${paragraph}`) }))).toContain('DUPLICATE_PARAGRAPH')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p>Appelez-nous.</p><p>Appelez-nous.</p>`) })))
      .not.toContain('DUPLICATE_PARAGRAPH')
  })

  it('EMPTY_LINK: blocks a link without href or without text, accepts an image link with alt', () => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p><a href="">devis</a></p>`) }))).toContain('EMPTY_LINK')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p><a href="#">devis</a></p>`) }))).toContain('EMPTY_LINK')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p><a href="/devis"> </a></p>`) }))).toContain('EMPTY_LINK')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p><a href="/devis"><img src="/d.png" alt="Demander un devis"></a></p>`) })))
      .not.toContain('EMPTY_LINK')
    // A named anchor is a jump target, not a link.
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<a id="faq"></a>`) }))).not.toContain('EMPTY_LINK')
  })
})

// ─── SEO — warnings ─────────────────────────────────────────────────────────

describe('auditSeoGeo — SEO warnings', () => {
  it('LONG_PARAGRAPH: warns on a paragraph over 150 words', () => {
    const findings = audit({ html: htmlWith(INTRO, `${INTRO}<p>${words(160, 'texte')}.</p>`) })
    expect(warnings(findings)).toContain('LONG_PARAGRAPH')
    expect(blocking(findings)).not.toContain('LONG_PARAGRAPH')
  })

  it('LONG_SENTENCES: warns when sentences average more than 28 words', () => {
    const findings = auditSeoGeo({
      ...input(),
      html: `${H1}<p>${words(40, 'phrase')}.</p><p>${words(35, 'longue')}.</p>`,
    })
    expect(warnings(findings)).toContain('LONG_SENTENCES')
    expect(warnings(audit())).not.toContain('LONG_SENTENCES')
  })

  it('EXTERNAL_LINK_REL: warns on target="_blank" without rel="noopener"', () => {
    const unsafe = '<p><a href="https://www.ademe.fr/" target="_blank">ADEME</a></p>'
    expect(warnings(audit({ html: htmlWith(INTRO, `${INTRO}${unsafe}`) }))).toContain('EXTERNAL_LINK_REL')
    expect(warnings(audit())).not.toContain('EXTERNAL_LINK_REL')
  })
})

// ─── GEO — blocking ─────────────────────────────────────────────────────────

describe('auditSeoGeo — GEO', () => {
  it('DIRECT_ANSWER: blocks an empty directAnswer field', () => {
    const findings = audit({ directAnswer: '  ' })
    expect(blocking(findings)).toContain('DIRECT_ANSWER')
    expect(find(findings, 'DIRECT_ANSWER')?.source).toBe('geo')
  })

  it('DIRECT_ANSWER: blocks when a heading comes before the first paragraph', () => {
    const html = htmlWith(INTRO, '<h2>Préambule</h2>' + INTRO)
    expect(blocking(audit({ html }))).toContain('DIRECT_ANSWER')
  })

  it('DIRECT_ANSWER: blocks a first paragraph outside 30-90 words', () => {
    expect(blocking(audit({ html: htmlWith(INTRO, `<p>${words(20, 'court')}</p>`) }))).toContain('DIRECT_ANSWER')
    expect(blocking(audit({ html: htmlWith(INTRO, `<p>${words(95, 'long')}</p>`) }))).toContain('DIRECT_ANSWER')
    expect(blocking(audit({ html: htmlWith(INTRO, `<p>${words(AUDIT_THRESHOLDS.directAnswerMin, 'juste')}</p>`) })))
      .not.toContain('DIRECT_ANSWER')
  })

  it('QUESTION_HEADINGS: blocks fewer than 2 H2/H3 phrased as questions', () => {
    const statements = COMPLIANT_HTML
      .replace('<h2>Comment reconnaître une fuite avant les dégâts ?</h2>', '<h2>Reconnaître une fuite</h2>')
      .replace('<h2>Combien coûte un dépannage de plomberie à Troyes ?</h2>', '<h2>Les tarifs</h2>')
      .replace('<h3>Intervenez-vous le week-end à Troyes ?</h3>', '<h3>Le week-end</h3>')
      .replace('<h3>Le devis est-il gratuit ?</h3>', '<h3>Le devis</h3>')
      .replace('<h3>Quels quartiers sont desservis ?</h3>', '<h3>Les quartiers</h3>')
    expect(blocking(audit({ html: statements }))).toContain('QUESTION_HEADINGS')

    // An interrogative opening counts even without its question mark.
    const interrogative = statements
      .replace('<h2>Les tarifs</h2>', '<h2>Combien coûte un dépannage</h2>')
      .replace('<h3>Les quartiers</h3>', '<h3>Quels quartiers sont desservis</h3>')
    expect(blocking(audit({ html: interrogative }))).not.toContain('QUESTION_HEADINGS')
  })

  it('FAQ_MINIMUM: 3 questions for a page, 5 for a pillar', () => {
    expect(blocking(audit({ faqItems: COMPLIANT_FAQ.slice(0, 2).map(item => ({ ...item })) }))).toContain('FAQ_MINIMUM')
    expect(blocking(audit({ pageType: 'pillar' }))).toContain('FAQ_MINIMUM')
    // An entry with an empty answer is not a question.
    expect(blocking(audit({ faqItems: [...COMPLIANT_FAQ.slice(0, 2), { q: 'Et ensuite ?', a: '' }] }))).toContain('FAQ_MINIMUM')
    expect(blocking(audit())).not.toContain('FAQ_MINIMUM')
  })

  it('FAQ_SCHEMA_MISMATCH: blocks a FAQPage that does not carry the visible questions', () => {
    const partial = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: COMPLIANT_FAQ[0].q, acceptedAnswer: { '@type': 'Answer', text: 'Oui.' } }],
    })
    expect(blocking(audit({ schemas: { ...COMPLIANT_SCHEMAS, faqPage: partial } }))).toContain('FAQ_SCHEMA_MISMATCH')
  })

  it('FAQ_SCHEMA_MISMATCH: blocks visible questions with no FAQPage schema at all', () => {
    expect(blocking(audit({ schemas: { ...COMPLIANT_SCHEMAS, faqPage: '{}' } }))).toContain('FAQ_SCHEMA_MISMATCH')
  })

  it('FAQ_SCHEMA_MISMATCH: matches across case and accents, and leaves an unparseable block to INVALID_JSON_LD', () => {
    const recased = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: COMPLIANT_FAQ.map(item => ({
        '@type': 'Question',
        name: item.q.toUpperCase(),
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    })
    expect(blocking(audit({ schemas: { ...COMPLIANT_SCHEMAS, faqPage: recased } }))).not.toContain('FAQ_SCHEMA_MISMATCH')
    expect(blocking(audit({ schemas: { ...COMPLIANT_SCHEMAS, faqPage: '{"@type":"FAQPage",' } }))).not.toContain('FAQ_SCHEMA_MISMATCH')
  })

  it('ENTITY_CITY: blocks a city named fewer than 2 times', () => {
    expect(blocking(audit({ city: 'Reims' }))).toContain('ENTITY_CITY')
    const once = auditSeoGeo({ ...input(), city: 'Bréviandes', html: htmlWith(INTRO, `${INTRO}<p>Bréviandes est desservie.</p>`) })
    expect(blocking(once)).toContain('ENTITY_CITY')
    expect(blocking(audit())).not.toContain('ENTITY_CITY')
  })

  it('ENTITY_BUSINESS: blocks a business never named in the body', () => {
    expect(blocking(audit({ businessName: 'Martin Sanitaire' }))).toContain('ENTITY_BUSINESS')
    expect(audit({ businessName: undefined }).map(f => f.code)).not.toContain('ENTITY_BUSINESS')
  })

  it('REQUIRED_ENTITIES: blocks under 70 % of the brief\'s entities, only when the brief lists 2+', () => {
    const findings = audit({ requiredEntities: ['Sainte-Savine', 'Rosières-près-Troyes', 'Bréviandes'] })
    expect(blocking(findings)).toContain('REQUIRED_ENTITIES')
    expect(find(findings, 'REQUIRED_ENTITIES')?.message).toContain('Bréviandes')

    expect(audit({ requiredEntities: ['Bréviandes'] }).map(f => f.code)).not.toContain('REQUIRED_ENTITIES')
  })

  it('REQUIRED_ENTITIES: accepts an entity whose words are all there, in another order', () => {
    // « groupe de sécurité du chauffe-eau » is written « chauffe-eau » … « groupe
    // de sécurité » in the fixture; the entity is named, not quoted.
    const findings = audit({ requiredEntities: ['sécurité du groupe chauffe-eau', 'Sainte-Savine'] })
    expect(findings.map(f => f.code)).not.toContain('REQUIRED_ENTITIES')
  })

  it('SCANNABLE: blocks a page without list or table — the linker\'s <nav> does not count', () => {
    const withoutList = htmlWith(LIST, '')
    expect(blocking(audit({ html: withoutList }))).toContain('SCANNABLE')

    const navOnly = `${withoutList}<nav class="related-pages"><h3>À lire</h3><ul><li><a href="/a">Page A</a></li></ul></nav>`
    expect(blocking(audit({ html: navOnly }))).toContain('SCANNABLE')

    const table = htmlWith(LIST, '<table><tr><td>Débouchage</td><td>Sur devis</td></tr></table>')
    expect(blocking(audit({ html: table }))).not.toContain('SCANNABLE')
  })

  it.each([
    ['a landline', '<p>Appelez le 03 25 12 34 56.</p>'],
    ['an international number', '<p>Appelez le +33 3 25 12 34 56.</p>'],
    ['a compact number', '<p>Appelez le 0325123456.</p>'],
    ['a street address', '<p>Atelier au 12 rue de la Paix.</p>'],
    ['a "bis" address', '<p>Atelier au 4 bis avenue Pasteur.</p>'],
  ])('INVENTED_NAP: blocks %s when no Google Business Profile is connected', (_label, fragment) => {
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}${fragment}`) }))).toContain('INVENTED_NAP')
  })

  it('INVENTED_NAP: blocks a phone written into the LocalBusiness schema too', () => {
    const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Plumber', name: 'Dupont Plomberie', telephone: '+33325123456' })
    expect(blocking(audit({ schemas: { ...COMPLIANT_SCHEMAS, localBusiness: schema } }))).toContain('INVENTED_NAP')
  })

  it('INVENTED_NAP: silent with a profile, when it is unknown, and on a postal code', () => {
    const phone = htmlWith(INTRO, `${INTRO}<p>Appelez le 03 25 12 34 56.</p>`)
    expect(audit({ html: phone, hasGoogleBusinessProfile: true }).map(f => f.code)).not.toContain('INVENTED_NAP')
    expect(audit({ html: phone, hasGoogleBusinessProfile: undefined }).map(f => f.code)).not.toContain('INVENTED_NAP')
    expect(blocking(audit({ html: htmlWith(INTRO, `${INTRO}<p>Secteur 10000 Troyes et 10300 Sainte-Savine.</p>`) })))
      .not.toContain('INVENTED_NAP')
  })

  it('SOURCES: blocks a page with external links enabled and no external https link', () => {
    const noSource = COMPLIANT_HTML.replace(/<a href="https:\/\/www\.service-public\.fr[^"]*"[^>]*>([\s\S]*?)<\/a>/, '$1')
    expect(blocking(audit({ html: noSource }))).toContain('SOURCES')

    // A link to the site itself, absolute or not, is not a source.
    const self = htmlWith(INTRO, `${INTRO}<p><a href="https://dupont-plomberie.fr/contact">contact</a></p>`)
      .replace(/<a href="https:\/\/www\.service-public\.fr[^"]*"[^>]*>([\s\S]*?)<\/a>/, '$1')
    expect(blocking(audit({ html: self }))).toContain('SOURCES')

    expect(audit({ html: noSource, enableExternalLinks: false }).map(f => f.code)).not.toContain('SOURCES')
    expect(blocking(audit())).not.toContain('SOURCES')
  })
})

// ─── GEO — warnings ─────────────────────────────────────────────────────────

describe('auditSeoGeo — GEO warnings', () => {
  it('AUTHOR_DATE: warns without a visible author/date line', () => {
    const html = COMPLIANT_HTML.replace(/<p class="page-auteur">[\s\S]*?<\/p>/, '')
    expect(warnings(audit({ html }))).toContain('AUTHOR_DATE')
    expect(warnings(audit())).not.toContain('AUTHOR_DATE')
  })

  it('ARTICLE_SCHEMA: warns without an Article/WebPage schema carrying datePublished', () => {
    expect(warnings(audit({ schemas: { ...COMPLIANT_SCHEMAS, article: '{}' } }))).toContain('ARTICLE_SCHEMA')
    const undated = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Plombier' })
    expect(warnings(audit({ schemas: { ...COMPLIANT_SCHEMAS, article: undated } }))).toContain('ARTICLE_SCHEMA')
    const webPage = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', datePublished: '2026-10-17' })
    expect(warnings(audit({ schemas: { ...COMPLIANT_SCHEMAS, article: webPage } }))).not.toContain('ARTICLE_SCHEMA')
  })

  it('DEFINITION: warns without a definition sentence in the first 300 words', () => {
    const findings = auditSeoGeo({
      ...input(),
      html: `${H1}<p>Intervention rapide sur les fuites à Troyes, devis écrit remis avant travaux.</p>`,
    })
    expect(warnings(findings)).toContain('DEFINITION')
    expect(warnings(audit())).not.toContain('DEFINITION')
  })
})

// ─── Sources ────────────────────────────────────────────────────────────────

describe('auditSeoGeo — sources', () => {
  it('files search-engine rules under seo and answer-engine rules under geo', () => {
    const findings = auditSeoGeo({
      html: '<h2>x</h2>', title: 'x', metaDescription: 'x', focusKeyword: 'plombier', slug: 'X', pageType: 'child',
      directAnswer: '', faqItems: [], enableExternalLinks: true, hasGoogleBusinessProfile: false,
    })
    const source = (code: string) => find(findings, code)?.source

    expect(source('TITLE_LENGTH')).toBe('seo')
    expect(source('SLUG_FORMAT')).toBe('seo')
    expect(source('H2_COUNT')).toBe('seo')
    expect(source('DIRECT_ANSWER')).toBe('geo')
    expect(source('FAQ_MINIMUM')).toBe('geo')
    expect(source('SCANNABLE')).toBe('geo')
    expect(source('SOURCES')).toBe('geo')
  })
})

describe('auditSeoGeo — quality: written for the reader', () => {
  const QUALITY_CODES = ['RAW_KEYWORD', 'SELF_REFERENCE', 'REPEATED_LABEL', 'FAKE_QUESTION']

  /** The compliant page with one paragraph added after the direct answer. */
  const withParagraphs = (...paragraphs: string[]) =>
    htmlWith(INTRO, `${INTRO}\n${paragraphs.map(text => `<p>${text}</p>`).join('\n')}`)

  const reported = () => audit({
    html: REPORTED_HTML,
    title: REPORTED.title,
    focusKeyword: REPORTED.focusKeyword,
    city: REPORTED.city,
    businessName: REPORTED.businessName,
    pageType: REPORTED.pageType,
  })

  it('refuses the page reported on 2026-10-21 on each of its tells, under quality', () => {
    const findings = reported()

    expect(blocking(findings)).toEqual(expect.arrayContaining(QUALITY_CODES))
    for (const code of QUALITY_CODES) expect(find(findings, code)?.source).toBe('quality')

    expect(find(findings, 'RAW_KEYWORD')?.message).toContain('« creation » au lieu de « création »')
    expect(find(findings, 'RAW_KEYWORD')?.message).toContain('« ia » au lieu de « IA »')
    expect(find(findings, 'SELF_REFERENCE')?.message).toContain('« cette page pilier »')
    expect(find(findings, 'SELF_REFERENCE')?.message).toContain('les données Search Console du site')
    expect(find(findings, 'REPEATED_LABEL')?.message).toContain('« Réponse courte : » ouvre 2 paragraphes')
    expect(find(findings, 'FAKE_QUESTION')?.message).toContain('Stratégie de référencement pour PME à Troyes ?')
  })

  it('passes the compliant page on every quality rule', () => {
    const codes = audit().map(f => f.code)
    for (const code of QUALITY_CODES) expect(codes).not.toContain(code)
  })

  it('RAW_KEYWORD: refuses a lowercase acronym and « près de moi », each on its own', () => {
    expect(blocking(audit({ html: withParagraphs('Un audit seo complet commence par les pages qui reçoivent déjà des visites.') })))
      .toContain('RAW_KEYWORD')
    expect(blocking(audit({ html: withParagraphs('Vous cherchez un plombier près de moi un dimanche soir à Troyes.') })))
      .toContain('RAW_KEYWORD')
  })

  it('RAW_KEYWORD: leaves final é, optional î/û, homographs, quotes, domains and brands alone', () => {
    const html = withParagraphs(
      'Le marché local bouge : il marche bien en hiver, et le coût reste stable car le cout du matériel baisse.',
      'Sur la côte, la cote des artisans dépend des avis ; notre équipe se tient à votre disposition.',
      'Les internautes tapent « agence seo troyes » ou « creation site internet » sans accent.',
      'Écrivez à contact@seo-troyes.fr ; Referencement Pro, une marque voisine, fait du référencement.',
    )
    expect(audit({ html }).map(f => f.code)).not.toContain('RAW_KEYWORD')
  })

  it('SELF_REFERENCE: accepts SEO vocabulary that advises the reader about HIS site', () => {
    const html = withParagraphs(
      'Une page pilier relie vos pages filles par un maillage interne clair.',
      'Suivez vos requêtes dans votre Search Console : elle montre les pages qui progressent.',
      'Dupont Plomberie suit la Search Console de chaque client depuis le premier mois.',
    )
    expect(audit({ html }).map(f => f.code)).not.toContain('SELF_REFERENCE')
  })

  it('SELF_REFERENCE: refuses the page describing itself, even without Search Console', () => {
    const finding = find(audit({ html: withParagraphs('Ce contenu est optimisé pour les recherches locales à Troyes.') }), 'SELF_REFERENCE')
    expect(finding?.severity).toBe('blocking')
    expect(finding?.message).toContain('« ce contenu est optimisé »')
  })

  it('REPEATED_LABEL: refuses a template label from its second use', () => {
    const html = withParagraphs('En bref : le devis est gratuit.', 'En bref : nous intervenons le week-end.')
    expect(blocking(audit({ html }))).toContain('REPEATED_LABEL')
  })

  it('REPEATED_LABEL: only warns on another repeated label, ignores numbered steps and the linker\'s sources', () => {
    const repeated = withParagraphs('Exemple : une fuite sous évier.', 'Exemple : un chauffe-eau entartré.', 'Exemple : un siphon bouché.')
    expect(warnings(audit({ html: repeated }))).toContain('REPEATED_LABEL')
    expect(blocking(audit({ html: repeated }))).not.toContain('REPEATED_LABEL')

    const steps = withParagraphs('Étape 1 : le diagnostic.', 'Étape 2 : le devis.', 'Étape 3 : les travaux.')
    const sources = `${COMPLIANT_HTML}\n${['A', 'B', 'C'].map(name =>
      `<p class="external-ref">Source : <a href="https://${name.toLowerCase()}.fr">${name}</a></p>`).join('\n')}`
    expect(audit({ html: steps }).map(f => f.code)).not.toContain('REPEATED_LABEL')
    expect(audit({ html: sources }).map(f => f.code)).not.toContain('REPEATED_LABEL')
  })

  it('FAKE_QUESTION: tells a question from a noun phrase with a « ? »', () => {
    for (const question of [
      'Fuite urgente à Troyes : quel plombier appeler ?',
      'Combien coûte un site vitrine à Troyes ?',
      'Un site vitrine suffit-il ?',
      'Agence web ou freelance à Troyes ?',
      'SEO à Troyes, par où commencer ?',
      'Le référencement, c’est quoi ?',
      'Vous cherchez un plombier à Troyes ?',
    ]) expect(isWellFormedQuestion(question), question).toBe(true)

    for (const statement of [
      'Stratégie de référencement pour PME à Troyes ?',
      'Plombier à Troyes : dépannage rapide ?',
      'Plombier à Troyes',
    ]) expect(isWellFormedQuestion(statement), statement).toBe(false)
  })

  it('FAKE_QUESTION: judges the title and the H1, never the H2', () => {
    expect(blocking(audit({ title: 'Plombier à Troyes : dépannage rapide ?' }))).toContain('FAKE_QUESTION')
    expect(blocking(audit({ html: htmlWith(H1, '<h1>Plombier à Troyes : dépannage rapide ?</h1>') }))).toContain('FAKE_QUESTION')
    const h2 = htmlWith(INTRO, `${INTRO}\n<h2>Et pour les copropriétés ?</h2><p>Le syndic reçoit le devis.</p>`)
    expect(audit({ html: h2 }).map(f => f.code)).not.toContain('FAKE_QUESTION')
  })
})

describe('auditSeoGeo — a page with no town', () => {
  // The blocking messages go back to the model as corrections: asking a
  // national page for « la ville » would make it invent one.
  it('never asks for the town in a correction when the page targets none', () => {
    const findings = audit({ city: undefined, metaDescription: 'trop courte', html: htmlWith(INTRO, '') })
    const messages = findings.map(f => f.message).join('\n')
    expect(find(findings, 'META_LENGTH')).toBeDefined()
    expect(find(findings, 'DIRECT_ANSWER')).toBeDefined()
    expect(messages).not.toMatch(/la ville/)
    expect(find(audit({ metaDescription: 'trop courte' }), 'META_LENGTH')?.message).toContain('la ville')
  })
})
