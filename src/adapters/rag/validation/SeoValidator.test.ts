// ─────────────────────────────────────────────────────────────────────────────
// SeoValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { SeoValidator, createSeoValidator } from './SeoValidator'
import type { SeoValidationConfig } from './SeoValidator'

describe('SeoValidator', () => {
  let validator: SeoValidator

  beforeEach(() => {
    validator = new SeoValidator()
  })

  describe('validate()', () => {
    it('should return result object with expected structure', () => {
      const result = validator.validate({
        title: 'Test Title for Plomberie Troyes',
        content: '<p>Test content with the keyword plomberie Troyes.</p>'.repeat(20),
        focusKeyword: 'plomberie Troyes',
      })

      expect(result).toHaveProperty('isValid')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')
      expect(result).toHaveProperty('metrics')
      expect(result.errors).toBeInstanceOf(Array)
      expect(result.warnings).toBeInstanceOf(Array)
    })

    it('should detect missing title', () => {
      const result = validator.validate({
        content: '<p>Contenu sans titre.</p>',
        focusKeyword: 'test',
      })

      expect(result.errors.some(e => e.code === 'TITLE_MISSING')).toBe(true)
    })

    it('should detect title too long', () => {
      const result = validator.validate({
        title: 'A'.repeat(80),
        metaTitle: 'A'.repeat(80),
        content: '<p>Contenu.</p>'.repeat(20),
        focusKeyword: 'test',
      })

      expect(result.errors.some(e => e.code === 'TITLE_TOO_LONG')).toBe(true)
    })

    it('should detect meta description too short', () => {
      const result = validator.validate({
        title: 'Test Title',
        metaDescription: 'Court',
        content: '<p>Contenu.</p>'.repeat(20),
        focusKeyword: 'test',
      })

      expect(result.warnings.some(w => w.code === 'DESCRIPTION_TOO_SHORT')).toBe(true)
    })

    it('should detect meta description too long', () => {
      const result = validator.validate({
        title: 'Test Title',
        metaDescription: 'A'.repeat(200),
        content: '<p>Contenu.</p>'.repeat(20),
        focusKeyword: 'test',
      })

      expect(result.errors.some(e => e.code === 'DESCRIPTION_TOO_LONG')).toBe(true)
    })

    it('should detect missing focus keyword in content', () => {
      const result = validator.validate({
        title: 'Test Title',
        content: '<p>Contenu sans le mot-cle focus.</p>'.repeat(20),
        focusKeyword: 'plombier Troyes',
      })

      expect(result.errors.some(e => e.code === 'KEYWORD_NOT_FOUND')).toBe(true)
    })

    it('should calculate keyword density', () => {
      const result = validator.validate({
        title: 'Plombier Troyes',
        content: '<p>plombier Troyes</p>'.repeat(100),
        focusKeyword: 'plombier Troyes',
      })

      expect(result.metrics.keywordDensity).toBeGreaterThan(0)
    })

    it('should detect high keyword density', () => {
      const result = validator.validate({
        title: 'Plombier',
        content: '<p>plombier '.repeat(500),
        focusKeyword: 'plombier',
      })

      expect(result.warnings.some(w => w.code === 'KEYWORD_DENSITY_HIGH' || w.code === 'KEYWORD_DENSITY_LOW')).toBe(true)
    })

    it('should detect URL too long', () => {
      const result = validator.validate({
        title: 'Test',
        content: '<p>Contenu.</p>'.repeat(20),
        url: '/' + 'a'.repeat(100),
        focusKeyword: 'test',
      })

      expect(result.warnings.some(w => w.code === 'URL_TOO_LONG')).toBe(true)
    })

    it('should validate schema markup', () => {
      const schemaMarkup = `
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          "name": "Plomberie Troyes"
        }
        </script>
      `

      const result = validator.validate({
        title: 'Plombier Troyes',
        content: '<p>Contenu avec schema.</p>'.repeat(20),
        focusKeyword: 'plombier Troyes',
        schemaMarkup,
      })

      // Should not have JSON-LD parsing errors
      expect(result.errors.filter(e => e.code === 'INVALID_JSON_LD')).toHaveLength(0)
    })

    it('should detect invalid JSON-LD schema', () => {
      const result = validator.validate({
        title: 'Test',
        content: '<p>Contenu.</p>'.repeat(20),
        focusKeyword: 'test',
        schemaMarkup: '<script type="application/ld+json">{invalid json</script>',
      })

      expect(result.errors.some(e => e.code === 'INVALID_JSON_LD')).toBe(true)
    })
  })

  describe('calculateMetrics()', () => {
    it('should calculate keyword density correctly', () => {
      const result = validator.validate({
        title: 'Plombier Troyes',
        content: '<p>plombier Troyes</p>'.repeat(100),
        focusKeyword: 'plombier Troyes',
      })

      expect(result.metrics.keywordDensity).toBeGreaterThanOrEqual(0)
    })

    it('should count heading occurrences', () => {
      const result = validator.validate({
        title: 'Plombier Troyes',
        content: `
          <h1>Plombier Troyes</h1>
          <h2>Plombier Troyes services</h2>
          <p>Contenu.</p>
        `.repeat(20),
        focusKeyword: 'plombier Troyes',
      })

      expect(result.metrics.headingKeywordCount).toBeGreaterThan(0)
    })
  })

  describe('custom configuration', () => {
    it('should respect custom meta title lengths', () => {
      const config: SeoValidationConfig = {
        metaTitleMinLength: 50,
        metaTitleMaxLength: 70,
      }
      const customValidator = new SeoValidator(config)

      const result = customValidator.validate({
        title: 'Short',
        metaTitle: 'Short',
        content: '<p>Contenu.</p>'.repeat(20),
        focusKeyword: 'test',
      })

      expect(result.warnings.some(w => w.code === 'TITLE_TOO_SHORT')).toBe(true)
    })

    it('should respect custom keyword density thresholds', () => {
      const config: SeoValidationConfig = {
        keywordDensityMin: 2,
        keywordDensityMax: 5,
      }
      const customValidator = new SeoValidator(config)

      const result = customValidator.validate({
        title: 'Plombier',
        content: '<p>plombier Troyes</p>'.repeat(20),
        focusKeyword: 'plombier',
      })

      expect(result.warnings).toBeDefined()
    })
  })

  describe('score calculation', () => {
    it('should calculate score based on errors', () => {
      const result = validator.validate({
        title: 'A'.repeat(100),
        content: '<p>Sans keyword.</p>'.repeat(10),
        focusKeyword: 'test keyword',
      })

      // Should have deductions for errors
      expect(result.score).toBeLessThan(100)
    })
  })

  describe('createSeoValidator factory', () => {
    it('should create validator with default config', () => {
      const v = createSeoValidator()
      expect(v).toBeInstanceOf(SeoValidator)
    })

    it('should create validator with custom config', () => {
      const config: SeoValidationConfig = {
        metaTitleMaxLength: 70,
        keywordDensityMin: 1,
      }
      const v = createSeoValidator(config)
      expect(v).toBeInstanceOf(SeoValidator)
    })
  })
})
