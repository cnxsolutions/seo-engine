// ─────────────────────────────────────────────────────────────────────────────
// SeoValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { SeoValidator, createSeoValidator } from './SeoValidator'
import type { SeoValidationConfig } from './SeoValidator'

const KEYWORD = 'plombier Troyes'

const CONTENT = [
  '<h1>Plombier Troyes : depannage urgent et devis gratuit</h1>',
  '<p>Vous cherchez un plombier Troyes pour une fuite ? Notre equipe intervient en urgence dans tous ',
  'les quartiers de la ville, du centre historique aux Chartreux, sept jours sur sept et sans ',
  'majoration le week-end.</p>',
  '<h2>Quels sont les tarifs d une intervention ?</h2>',
  '<p>Le deplacement est facture quarante-cinq euros dans toute la ville et ses environs immediats. ',
  'Chaque devis est remis par ecrit avant le debut des travaux, avec le detail des pieces et de la ',
  'main d oeuvre. Aucun supplement ne peut etre ajoute sans votre accord prealable.</p>',
  '<h2>Comment joindre un artisan la nuit ?</h2>',
  '<p>Une astreinte telephonique repond vingt-quatre heures sur vingt-quatre pour les urgences ',
  'reelles : degat des eaux, canalisation bouchee, chauffe-eau hors service. Un technicien se ',
  'deplace en moins de soixante minutes sur le secteur.</p>',
  '<p>Nos artisans sont assures, formes aux normes en vigueur et interviennent aussi sur les ',
  'communes voisines de Sainte-Savine, Saint-Andre-les-Vergers et La Chapelle-Saint-Luc.</p>',
].join('')

const VALID_LOCAL_BUSINESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Plumber',
  name: 'Plomberie Dupont',
  url: 'https://plomberie-dupont.fr',
  telephone: '+33325000000',
  image: 'https://plomberie-dupont.fr/a.jpg',
  priceRange: '€€',
  geo: { '@type': 'GeoCoordinates', latitude: 48.29, longitude: 4.07 },
  openingHours: 'Mo-Fr 08:00-18:00',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '12 rue de la Paix',
    addressLocality: 'Troyes',
    postalCode: '10000',
    addressCountry: 'FR',
  },
})

describe('SeoValidator', () => {
  let validator: SeoValidator

  beforeEach(() => {
    validator = new SeoValidator()
  })

  describe('validate()', () => {
    it('should return result object with expected structure', () => {
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result).toHaveProperty('isValid')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')
      expect(result).toHaveProperty('metrics')
      expect(result.errors).toBeInstanceOf(Array)
      expect(result.warnings).toBeInstanceOf(Array)
    })

    it('should detect missing title', () => {
      const result = validator.validate({ content: CONTENT, focusKeyword: KEYWORD })

      expect(result.errors.some(e => e.code === 'TITLE_MISSING')).toBe(true)
      expect(result.isValid).toBe(false)
    })
  })

  describe('title length', () => {
    it('accepts the 65-character title the generator is instructed to write', () => {
      // The prompt in lib/ai/page-types.ts asks for "max 65 chars". Erroring at
      // 60 with impact "high" — the previous behaviour — rejected titles the
      // engine was explicitly told to produce.
      const title = 'Plombier Troyes : depannage urgence fuite eau et devis gratuit'
      const result = validator.validate({ title, metaTitle: title, content: CONTENT, focusKeyword: KEYWORD })

      expect(title.length).toBeLessThanOrEqual(65)
      expect(result.errors.some(e => e.impact === 'high')).toBe(false)
      expect(result.isValid).toBe(true)
    })

    it('warns, never blocks, when the title exceeds the SERP budget', () => {
      const title = 'A'.repeat(80)
      const result = validator.validate({ title, metaTitle: title, content: CONTENT, focusKeyword: KEYWORD })

      expect(result.warnings.some(w => w.code === 'TITLE_TOO_LONG')).toBe(true)
      expect(result.errors.some(e => e.code === 'TITLE_TOO_LONG')).toBe(false)
      expect(result.isValid).toBe(true)
    })

    it('reports an absurd title as a non-blocking error', () => {
      const title = 'A'.repeat(120)
      const result = validator.validate({ title, metaTitle: title, content: CONTENT, focusKeyword: KEYWORD })

      const error = result.errors.find(e => e.code === 'TITLE_EXCESSIVELY_LONG')
      expect(error).toBeDefined()
      expect(error!.impact).toBe('medium')
      expect(result.isValid).toBe(true)
    })

    it('measures the title in pixels as well as characters', () => {
      const wide = validator.validate({ metaTitle: 'W'.repeat(45), content: CONTENT, focusKeyword: KEYWORD })
      const narrow = validator.validate({ metaTitle: 'i'.repeat(45), content: CONTENT, focusKeyword: KEYWORD })

      expect(wide.metrics.titlePixelWidth!).toBeGreaterThan(narrow.metrics.titlePixelWidth!)
      expect(wide.warnings.some(w => w.code === 'TITLE_TOO_LONG')).toBe(true)
      expect(narrow.warnings.some(w => w.code === 'TITLE_TOO_LONG')).toBe(false)
    })

    it('should respect custom meta title lengths', () => {
      const config: SeoValidationConfig = { metaTitleMinLength: 50, metaTitleMaxLength: 70 }
      const customValidator = new SeoValidator(config)

      const result = customValidator.validate({
        title: 'Short',
        metaTitle: 'Short',
        content: CONTENT,
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'TITLE_TOO_SHORT')).toBe(true)
    })
  })

  describe('meta description', () => {
    it('warns when it is too short', () => {
      const result = validator.validate({
        title: 'Test',
        metaDescription: 'Court',
        content: CONTENT,
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'DESCRIPTION_TOO_SHORT')).toBe(true)
    })

    it('warns, never blocks, when it exceeds 160 characters', () => {
      // Truncation costs CTR, not ranking. Google rewrites the description on
      // most queries anyway.
      const result = validator.validate({
        title: 'Test',
        metaDescription: 'A'.repeat(200),
        content: CONTENT,
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'DESCRIPTION_TOO_LONG')).toBe(true)
      expect(result.errors.some(e => e.code === 'DESCRIPTION_TOO_LONG')).toBe(false)
    })

    it('accepts a 155-character description without complaining', () => {
      const description = 'Plombier Troyes disponible en urgence pour vos fuites. '.padEnd(155, 'x')
      const result = validator.validate({
        title: 'Test',
        metaDescription: description,
        content: CONTENT,
        focusKeyword: KEYWORD,
      })

      expect(description).toHaveLength(155)
      expect(result.warnings.some(w => w.code === 'DESCRIPTION_TOO_LONG')).toBe(false)
      expect(result.warnings.some(w => w.code === 'DESCRIPTION_TOO_SHORT')).toBe(false)
    })
  })

  describe('focus keyword', () => {
    it('blocks a page that is genuinely off topic', () => {
      const result = validator.validate({
        title: 'Peinture murale',
        content: '<h1>Peinture</h1><p>Contenu sur la peinture et les enduits decoratifs.</p>',
        focusKeyword: KEYWORD,
      })

      const error = result.errors.find(e => e.code === 'KEYWORD_NOT_FOUND')
      expect(error).toBeDefined()
      expect(error!.impact).toBe('high')
      expect(result.isValid).toBe(false)
    })

    it('does NOT block when the keyword terms are present but split by a preposition', () => {
      // "plomberie a Troyes" is how a French sentence really reads. Exact-string
      // matching rejected it; token coverage accepts it and only warns.
      const content = '<h1>Plomberie a Troyes</h1><p>Notre service de plomberie intervient a Troyes.</p>'
      const result = validator.validate({ title: 'Plomberie a Troyes', content, focusKeyword: 'plomberie Troyes' })

      expect(result.errors.some(e => e.code === 'KEYWORD_NOT_FOUND')).toBe(false)
      expect(result.warnings.some(w => w.code === 'KEYWORD_PHRASE_NOT_EXACT')).toBe(true)
    })

    it('matches the keyword despite accents and case', () => {
      const content = '<h1>Plomberie à TROYES</h1><p>Une plomberie à Troyes réactive et sérieuse.</p>'
      const result = validator.validate({ title: 'x', content, focusKeyword: 'plomberie a troyes' })

      expect(result.metrics.keywordCoverage).toBe(1)
      expect(result.errors.some(e => e.code === 'KEYWORD_NOT_FOUND')).toBe(false)
    })
  })

  describe('keyword density', () => {
    it('never asks for MORE keyword repetition', () => {
      // A minimum-density rule is an obsolete criterion that pushes the
      // generator straight into keyword stuffing. It no longer exists.
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'KEYWORD_DENSITY_LOW')).toBe(false)
      expect(result.errors.some(e => e.code === 'KEYWORD_DENSITY_LOW')).toBe(false)
    })

    it('still flags obvious stuffing, as a warning', () => {
      const result = validator.validate({
        title: 'Plombier',
        content: '<p>plombier '.repeat(500),
        focusKeyword: 'plombier',
      })

      expect(result.warnings.some(w => w.code === 'KEYWORD_DENSITY_HIGH')).toBe(true)
      expect(result.errors.some(e => e.code === 'KEYWORD_DENSITY_HIGH')).toBe(false)
    })

    it('leaves a natural 1-2% density alone', () => {
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result.metrics.keywordDensity).toBeGreaterThan(0)
      expect(result.warnings.some(w => w.code === 'KEYWORD_DENSITY_HIGH')).toBe(false)
    })

    it('should respect custom keyword density thresholds', () => {
      const customValidator = new SeoValidator({ keywordDensityMax: 50 })

      const result = customValidator.validate({
        title: 'Plombier',
        content: '<p>plombier '.repeat(500),
        focusKeyword: 'plombier',
      })

      expect(result.warnings.some(w => w.code === 'KEYWORD_DENSITY_HIGH')).toBe(true)
    })
  })

  describe('heading structure', () => {
    it('does not claim "no H2" on a page full of H2s', () => {
      // The old check tested `headingText.startsWith('h2')`, which is never
      // true, so NO_H2 fired on every single page.
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result.metrics.h2Count).toBe(2)
      expect(result.warnings.some(w => w.code === 'NO_H2')).toBe(false)
    })

    it('reports a missing H1 and a duplicated H1', () => {
      const noH1 = validator.validate({
        title: 'Test',
        content: '<h2>Section plombier Troyes</h2><p>Texte plombier Troyes.</p>',
        focusKeyword: KEYWORD,
      })
      const twoH1 = validator.validate({
        title: 'Test',
        content: `${CONTENT}<h1>Second titre plombier Troyes</h1>`,
        focusKeyword: KEYWORD,
      })

      expect(noH1.warnings.some(w => w.code === 'NO_H1')).toBe(true)
      expect(twoH1.warnings.some(w => w.code === 'MULTIPLE_H1')).toBe(true)
    })

    it('reports a skipped heading level', () => {
      const result = validator.validate({
        title: 'Test',
        content: '<h1>Plombier Troyes</h1><h4>Detail plombier Troyes</h4><p>Texte.</p>',
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'HEADING_LEVEL_SKIP')).toBe(true)
    })

    it('counts headings carrying the focus keyword', () => {
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result.metrics.headingKeywordCount).toBeGreaterThan(0)
    })
  })

  describe('url', () => {
    it('should detect URL too long', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        url: '/' + 'a'.repeat(120),
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'URL_TOO_LONG')).toBe(true)
    })

    it('accepts a hyphenated slug carrying the keyword terms', () => {
      // The keyword is a phrase, the slug is hyphenated: comparing them raw
      // produced a false warning on literally every page.
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        url: 'https://site.fr/depannage-plombier-urgence-fuite-troyes-centre-ville',
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'KEYWORD_NOT_IN_URL')).toBe(false)
      expect(result.warnings.some(w => w.code === 'URL_TOO_LONG')).toBe(false)
    })

    it('flags a slug with uppercase or special characters', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        url: '/Plombier_Troyes',
        focusKeyword: KEYWORD,
      })

      expect(result.warnings.some(w => w.code === 'URL_SPECIAL_CHARS')).toBe(true)
    })
  })

  describe('structured data', () => {
    it('accepts the JSON-LD the generator emits', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
        schemas: { localBusiness: VALID_LOCAL_BUSINESS },
      })

      expect(result.errors.filter(e => e.element === 'schema')).toHaveLength(0)
      expect(result.metrics.schemaTypes).toContain('Plumber')
    })

    it('BLOCKS an invalid JSON-LD', () => {
      // Was impact "medium", i.e. invisible to the gate. A broken script tag
      // means Google drops the markup and RankMath stores garbage.
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
        schemaMarkup: '<script type="application/ld+json">{invalid json</script>',
      })

      const error = result.errors.find(e => e.code === 'INVALID_JSON_LD')
      expect(error).toBeDefined()
      expect(error!.impact).toBe('high')
      expect(result.isValid).toBe(false)
    })

    it('blocks a structurally incomplete LocalBusiness', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
        schemas: {
          localBusiness: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: 'Plomberie Dupont',
          }),
        },
      })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.element === 'schema')).toBe(true)
    })

    it('treats the "{}" fallback as absent, not invalid', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
        schemas: { localBusiness: '{}', faqPage: '{}', breadcrumb: '{}' },
      })

      expect(result.errors.filter(e => e.element === 'schema')).toHaveLength(0)
      expect(result.warnings.some(w => w.code === 'NO_SCHEMA')).toBe(true)
    })

    it('warns when a page carries no structured data at all', () => {
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result.warnings.some(w => w.code === 'NO_SCHEMA')).toBe(true)
      expect(result.errors.filter(e => e.element === 'schema')).toHaveLength(0)
    })
  })

  describe('open graph', () => {
    it('stays silent when the payload is an article body with no meta tags', () => {
      // The old check searched for "og:title" inside the ARTICLE BODY, which
      // never contains meta tags: four permanent false warnings per page.
      const result = validator.validate({ title: 'Test', content: CONTENT, focusKeyword: KEYWORD })

      expect(result.warnings.some(w => w.code.startsWith('NO_OG_'))).toBe(false)
      expect(result.warnings.some(w => w.code === 'NO_TWITTER_CARD')).toBe(false)
    })

    it('checks the social metadata when the caller supplies it', () => {
      const result = validator.validate({
        title: 'Test',
        content: CONTENT,
        focusKeyword: KEYWORD,
        social: { title: 'Plombier Troyes', description: 'Depannage urgent' },
      })

      expect(result.metrics.hasOpenGraph).toBe(true)
      expect(result.warnings.some(w => w.code === 'NO_OG_TITLE')).toBe(false)
      expect(result.warnings.some(w => w.code === 'NO_OG_IMAGE')).toBe(true)
    })
  })

  describe('score calculation', () => {
    it('should calculate score based on errors', () => {
      const result = validator.validate({
        title: 'A'.repeat(120),
        content: '<p>Sans rapport.</p>'.repeat(10),
        focusKeyword: 'test keyword',
      })

      expect(result.score).toBeLessThan(100)
    })

    it('gives a clean page a high score', () => {
      const result = validator.validate({
        title: 'Plombier Troyes : depannage urgent et devis gratuit',
        metaTitle: 'Plombier Troyes : depannage urgent et devis gratuit',
        metaDescription: 'Plombier Troyes disponible 24h/24 pour vos fuites et urgences. '.padEnd(150, 'x'),
        content: CONTENT,
        url: 'https://site.fr/plombier-troyes-depannage-urgence-fuite-eau',
        focusKeyword: KEYWORD,
        schemas: { localBusiness: VALID_LOCAL_BUSINESS },
      })

      expect(result.isValid).toBe(true)
      expect(result.score).toBeGreaterThan(70)
    })
  })

  describe('createSeoValidator factory', () => {
    it('should create validator with default config', () => {
      expect(createSeoValidator()).toBeInstanceOf(SeoValidator)
    })

    it('should create validator with custom config', () => {
      const config: SeoValidationConfig = { metaTitleMaxLength: 70, keywordDensityMax: 4 }
      expect(createSeoValidator(config)).toBeInstanceOf(SeoValidator)
    })
  })
})
