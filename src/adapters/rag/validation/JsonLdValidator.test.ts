// ─────────────────────────────────────────────────────────────────────────────
// JsonLdValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { JsonLdValidator, createJsonLdValidator } from './JsonLdValidator'

/** Shape the generator is asked to emit in `schemaLocalBusiness`. */
const LOCAL_BUSINESS = {
  '@context': 'https://schema.org',
  '@type': 'Plumber',
  name: 'Plomberie Dupont',
  url: 'https://plomberie-dupont.fr',
  telephone: '+33 3 25 00 00 00',
  image: 'https://plomberie-dupont.fr/atelier.jpg',
  priceRange: '€€',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '12 rue de la Paix',
    addressLocality: 'Troyes',
    postalCode: '10000',
    addressCountry: 'FR',
  },
  geo: { '@type': 'GeoCoordinates', latitude: 48.2973, longitude: 4.0744 },
  openingHours: 'Mo-Fr 08:00-18:00',
}

const FAQ_PAGE = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Quel est le tarif d une intervention ?',
      acceptedAnswer: { '@type': 'Answer', text: 'Le deplacement est facture 45 euros.' },
    },
  ],
}

const BREADCRUMB = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://plomberie-dupont.fr/' },
    { '@type': 'ListItem', position: 2, name: 'Plomberie Troyes' },
  ],
}

/** Returns a copy of `source` without `key`. */
function omit(source: object, key: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...source }
  delete clone[key]
  return clone
}

describe('JsonLdValidator', () => {
  let validator: JsonLdValidator

  beforeEach(() => {
    validator = new JsonLdValidator()
  })

  describe('parsing', () => {
    it('accepts a JSON string, an object and an HTML script block', () => {
      expect(validator.validate(JSON.stringify(LOCAL_BUSINESS)).isValid).toBe(true)
      expect(validator.validate(LOCAL_BUSINESS).isValid).toBe(true)
      expect(
        validator.validate(
          `<script type="application/ld+json">${JSON.stringify(BREADCRUMB)}</script>`
        ).isValid
      ).toBe(true)
    })

    it('reports malformed JSON as a blocking error', () => {
      const result = validator.validate('{ "@type": "FAQPage", ')

      expect(result.isValid).toBe(false)
      expect(result.errors[0].code).toBe('MALFORMED_JSON')
    })

    it('treats "{}" as ABSENT, not invalid', () => {
      // '{}' is the generator's own fallback and every legacy row carries it.
      // Blocking on it would block every regenerated page.
      const result = validator.validate('{}')

      expect(result.isPresent).toBe(false)
      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.code === 'SCHEMA_ABSENT')).toBe(true)
    })

    it('walks an @graph container', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@graph': [LOCAL_BUSINESS, BREADCRUMB],
      })

      expect(result.types).toContain('Plumber')
      expect(result.types).toContain('BreadcrumbList')
    })
  })

  describe('generic requirements', () => {
    it('requires a schema.org @context on the root node', () => {
      const result = validator.validate(omit(LOCAL_BUSINESS, '@context'))

      expect(result.errors.some(e => e.code === 'MISSING_CONTEXT')).toBe(true)
    })

    it('rejects a @context that does not point at schema.org', () => {
      const result = validator.validate({ ...LOCAL_BUSINESS, '@context': 'https://example.org' })

      expect(result.errors.some(e => e.code === 'INVALID_CONTEXT')).toBe(true)
    })

    it('requires a @type', () => {
      const result = validator.validate({ '@context': 'https://schema.org', name: 'x' })

      expect(result.errors.some(e => e.code === 'MISSING_TYPE')).toBe(true)
    })
  })

  describe('LocalBusiness', () => {
    it('validates the payload the generator is asked to produce', () => {
      const result = validator.validate(LOCAL_BUSINESS, { expectedType: 'LocalBusiness' })

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('accepts a LocalBusiness SUBTYPE without complaining', () => {
      // A plumber page is @type "Plumber", which IS a LocalBusiness.
      const result = validator.validate(LOCAL_BUSINESS, { expectedType: 'LocalBusiness' })

      expect(result.warnings.some(w => w.code === 'UNEXPECTED_TYPE')).toBe(false)
    })

    it('blocks when the address is missing', () => {
      const result = validator.validate(omit(LOCAL_BUSINESS, 'address'))

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_PROPERTY')).toBe(true)
    })

    it('blocks when the postal address is incomplete', () => {
      const result = validator.validate({
        ...LOCAL_BUSINESS,
        address: { '@type': 'PostalAddress', postalCode: '10000' },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.node.endsWith('address.streetAddress'))).toBe(true)
    })

    it('blocks an aggregateRating without a count', () => {
      const result = validator.validate({
        ...LOCAL_BUSINESS,
        aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.9 },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'RATING_INCOMPLETE')).toBe(true)
    })

    it('blocks a rating outside its scale', () => {
      const result = validator.validate({
        ...LOCAL_BUSINESS,
        aggregateRating: { '@type': 'AggregateRating', ratingValue: 9, reviewCount: 12 },
      })

      expect(result.errors.some(e => e.code === 'RATING_OUT_OF_RANGE')).toBe(true)
    })

    it('warns about a self-serving rating with no Review node', () => {
      const result = validator.validate({
        ...LOCAL_BUSINESS,
        aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.9, reviewCount: 120 },
      })

      // Syntactically fine, so it must not block — but Google ignores ratings a
      // business publishes about itself, so it must be said.
      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.code === 'SELF_SERVING_REVIEW')).toBe(true)
    })

    it('warns about missing recommended properties instead of blocking', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Plomberie Dupont',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '12 rue de la Paix',
          addressLocality: 'Troyes',
        },
      })

      expect(result.isValid).toBe(true)
      expect(result.warnings.some(w => w.code === 'RECOMMENDED_PROPERTY_MISSING')).toBe(true)
    })
  })

  describe('FAQPage', () => {
    it('validates a well-formed FAQPage', () => {
      const result = validator.validate(FAQ_PAGE, { expectedType: 'FAQPage' })

      expect(result.isValid).toBe(true)
    })

    it('blocks a question without an accepted answer', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [{ '@type': 'Question', name: 'Une question ?' }],
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.node.endsWith('acceptedAnswer'))).toBe(true)
    })

    it('blocks an answer with an empty text', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: 'Une question ?', acceptedAnswer: { '@type': 'Answer', text: '  ' } },
        ],
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'EMPTY_REQUIRED_PROPERTY')).toBe(true)
    })

    it('blocks an empty mainEntity', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: [],
      })

      expect(result.isValid).toBe(false)
    })

    it('says out loud that FAQ markup no longer earns a rich result', () => {
      const result = validator.validate(FAQ_PAGE)

      expect(result.infos.some(i => i.code === 'NO_RICH_RESULT')).toBe(true)
      // Informational only: it must never stop a publication.
      expect(result.isValid).toBe(true)
    })
  })

  describe('BreadcrumbList', () => {
    it('validates a two-level breadcrumb whose last item has no URL', () => {
      const result = validator.validate(BREADCRUMB, { expectedType: 'BreadcrumbList' })

      expect(result.isValid).toBe(true)
    })

    it('blocks non-contiguous positions', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://x.fr/' },
          { '@type': 'ListItem', position: 3, name: 'Page' },
        ],
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'BREADCRUMB_POSITION_INVALID')).toBe(true)
    })

    it('blocks a relative item URL', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil', item: '/accueil' },
          { '@type': 'ListItem', position: 2, name: 'Page' },
        ],
      })

      expect(result.errors.some(e => e.code === 'INVALID_URL')).toBe(true)
    })

    it('blocks an intermediate item with no URL at all', () => {
      const result = validator.validate({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Accueil' },
          { '@type': 'ListItem', position: 2, name: 'Page' },
        ],
      })

      expect(result.isValid).toBe(false)
    })
  })

  describe('validateAll', () => {
    it('validates the three slots the generator fills', () => {
      const result = validator.validateAll(
        {
          localBusiness: JSON.stringify(LOCAL_BUSINESS),
          faqPage: JSON.stringify(FAQ_PAGE),
          breadcrumb: JSON.stringify(BREADCRUMB),
        },
        {
          localBusiness: { expectedType: 'LocalBusiness' },
          faqPage: { expectedType: 'FAQPage' },
          breadcrumb: { expectedType: 'BreadcrumbList' },
        }
      )

      expect(result.isValid).toBe(true)
      expect(result.isPresent).toBe(true)
      expect(result.types).toEqual(expect.arrayContaining(['Plumber', 'FAQPage', 'BreadcrumbList']))
    })

    it('stays valid when every slot is the "{}" fallback', () => {
      const result = validator.validateAll({
        localBusiness: '{}',
        faqPage: '{}',
        breadcrumb: '{}',
      })

      expect(result.isValid).toBe(true)
      expect(result.isPresent).toBe(false)
    })

    it('fails as soon as one slot is broken', () => {
      const result = validator.validateAll({
        localBusiness: JSON.stringify(LOCAL_BUSINESS),
        breadcrumb: '{ broken',
      })

      expect(result.isValid).toBe(false)
    })
  })

  describe('extractFromHtml', () => {
    it('pulls every ld+json block out of a page body', () => {
      const html = `
        <p>Contenu</p>
        <script type="application/ld+json">${JSON.stringify(LOCAL_BUSINESS)}</script>
        <script type="application/ld+json">${JSON.stringify(BREADCRUMB)}</script>
      `

      expect(validator.extractFromHtml(html)).toHaveLength(2)
    })
  })

  describe('createJsonLdValidator factory', () => {
    it('creates a validator', () => {
      expect(createJsonLdValidator()).toBeInstanceOf(JsonLdValidator)
    })

    it('can silence the recommended-property warnings', () => {
      const lenient = createJsonLdValidator({ checkRecommended: false, checkRichResultEligibility: false })
      const result = lenient.validate({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Plomberie Dupont',
        address: { '@type': 'PostalAddress', streetAddress: '12 rue', addressLocality: 'Troyes' },
      })

      expect(result.warnings).toHaveLength(0)
    })
  })
})
