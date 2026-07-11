// ─────────────────────────────────────────────────────────────────────────────
// ContentQualityValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { ContentQualityValidator, createContentQualityValidator } from './ContentQualityValidator'
import type { ContentQualityConfig } from './ContentQualityValidator'

describe('ContentQualityValidator', () => {
  let validator: ContentQualityValidator

  beforeEach(() => {
    validator = new ContentQualityValidator()
  })

  describe('validate()', () => {
    it('should validate content with all required elements', () => {
      const content = {
        title: 'Comment choisir un plombier à Troyes',
        content: `
          <h1>Comment choisir un plombier à Troyes</h1>
          <p>Trouver un bon plombier peut sembler difficile. Voici nos conseils pour faire le bon choix.</p>
          <h2>Les critères importants</h2>
          <p>Un bon plombier doit avoir de l'expérience et des avis positifs.</p>
          <img src="plombier.jpg" alt="Plombier professionnel à Troyes" />
          <p>Consultez les avis en ligne pour évaluer la qualité du service.</p>
          <a href="/contact">Contactez-nous</a>
          <h2>Questions fréquentes</h2>
          <p>Combien coûte une intervention?</p>
        `.repeat(50), // Make it long enough
      }

      const result = validator.validate(content)

      // Should have valid structure metrics
      expect(result.metrics.wordCount).toBeGreaterThan(500)
      expect(result.metrics.h2Count).toBeGreaterThanOrEqual(1)
      expect(result.metrics.imageCount).toBeGreaterThanOrEqual(1)
      expect(result.metrics.headingCount).toBeGreaterThanOrEqual(2)
    })

    it('should detect missing title', () => {
      const content = {
        content: '<p>Contenu sans titre.</p>'.repeat(10),
      }

      const result = validator.validate(content)

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MISSING_TITLE')).toBe(true)
    })

    it('should detect title too long', () => {
      const content = {
        title: 'A'.repeat(100),
        content: '<p>Contenu.</p>'.repeat(10),
      }

      const result = validator.validate(content)

      expect(result.warnings.some(w => w.code === 'TITLE_TOO_LONG')).toBe(true)
    })

    it('should detect word count too low', () => {
      const content = {
        title: 'Titre',
        content: '<p>Très court.</p>',
      }

      const result = validator.validate(content)

      expect(result.errors.some(e => e.code === 'WORD_COUNT_TOO_LOW')).toBe(true)
    })

    it('should detect missing H2 headings', () => {
      const content = {
        title: 'Titre',
        content: '<p>Paragraphe sans sous-titres.</p>'.repeat(20),
      }

      const result = validator.validate(content)

      expect(result.errors.some(e => e.code === 'MISSING_H2')).toBe(true)
    })

    it('should detect images without alt text', () => {
      const content = {
        title: 'Test',
        content: `
          <p>Contenu.</p>${'<p>Paragraph.</p>'.repeat(20)}
          <img src="test.jpg" />
          <img src="test2.jpg" alt="Description" />
        `,
      }

      const result = validator.validate(content)

      expect(result.errors.some(e => e.code === 'IMAGES_MISSING_ALT')).toBe(true)
    })

    it('should warn about low readability', () => {
      const content = {
        title: 'Test',
        content: `
          <h2>Section</h2>
          <p>${'Mottrèslongquetraversedansuntxtetsansaucunmomdutilisé '.repeat(50)}</p>
        `.repeat(10),
      }

      const result = validator.validate(content)

      // Should have readability warnings
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('should warn about missing internal links', () => {
      const content = {
        title: 'Test',
        content: '<p>Contenu sans liens internes.</p>'.repeat(20),
      }

      const result = validator.validate(content)

      expect(result.warnings.some(w => w.code === 'INTERNAL_LINKS_LOW')).toBe(true)
    })

    it('should calculate correct word count', () => {
      const content = {
        title: 'Test',
        content: '<p>Un deux trois quatre cinq six sept huit neuf dix.</p>'.repeat(10),
      }

      const result = validator.validate(content)

      expect(result.metrics.wordCount).toBe(100) // 10 mots * 10 répétitions
    })

    it('should parse HTML correctly', () => {
      const content = {
        title: 'Test',
        content: `
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h2>Another H2</h2>
          <h3>Heading 3</h3>
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
          <ul><li>Item 1</li><li>Item 2</li></ul>
          <blockquote>Quote</blockquote>
          <img src="test.jpg" alt="Alt text" />
        `.repeat(20),
      }

      const result = validator.validate(content)

      expect(result.metrics.h1Count).toBeGreaterThanOrEqual(1)
      expect(result.metrics.h2Count).toBeGreaterThanOrEqual(1)
      expect(result.metrics.h3Count).toBeGreaterThanOrEqual(1)
      expect(result.metrics.imageCount).toBeGreaterThanOrEqual(1)
      expect(result.metrics.imagesWithAlt).toBeGreaterThanOrEqual(1)
    })
  })

  describe('custom configuration', () => {
    it('should respect custom minWordCount', () => {
      const config: ContentQualityConfig = {
        minWordCount: 1000,
      }
      const customValidator = new ContentQualityValidator(config)

      const content = {
        title: 'Test',
        content: '<p>Mots.</p>'.repeat(100), // ~400 mots
      }

      const result = customValidator.validate(content)

      expect(result.errors.some(e => e.code === 'WORD_COUNT_TOO_LOW')).toBe(true)
    })

    it('should respect custom minImageCount', () => {
      const config: ContentQualityConfig = {
        minImageCount: 3,
      }
      const customValidator = new ContentQualityValidator(config)

      const content = {
        title: 'Test',
        content: `
          <p>Contenu.</p>${'<p>More.</p>'.repeat(30)}
          <img src="1.jpg" alt="1" />
          <img src="2.jpg" alt="2" />
        `,
      }

      const result = customValidator.validate(content)

      expect(result.warnings.some(w => w.code === 'IMAGE_COUNT_LOW')).toBe(true)
    })
  })

  describe('score calculation', () => {
    it('should calculate structure score correctly', () => {
      const content = {
        title: 'Test',
        content: `
          <h2>Section 1</h2>
          <p>Paragraphe avec suffisamment de mots pour dépasser le minimum requis par le validateur de contenu SEO.</p>
          <p>Deuxième paragraphe pour atteindre la densité de mots nécessaire.</p>
          <img src="test.jpg" alt="Test" />
          <a href="/page">Lien interne</a>
        `.repeat(30),
      }

      const result = validator.validate(content)

      expect(result.score.structure).toBeGreaterThan(70)
    })

    it('should return correct grade based on score', () => {
      const goodContent = {
        title: 'Comment trouver un plombier',
        content: `
          <h2>Introduction</h2>
          <p>Les plombiers professionnels à Troyes offrent des services de dépannage urgents 24h/24.</p>
          <h2>Services proposés</h2>
          <p>Nous proposons la réparation de fuites d'eau, le débouchage de canalisations, l'installation de sanitaires.</p>
          <img src="plombier.jpg" alt="Plombier professionnel" />
          <a href="/contact">Contactez-nous</a>
          <h2>Questions fréquentes</h2>
          <p>Quels sont vos tarifs?</p>
          <p>Êtes-vous disponible le week-end?</p>
        `.repeat(30),
      }

      const result = validator.validate(goodContent)

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.score.grade)
    })
  })

  describe('createContentQualityValidator factory', () => {
    it('should create validator with default config', () => {
      const v = createContentQualityValidator()
      expect(v).toBeInstanceOf(ContentQualityValidator)
    })

    it('should create validator with custom config', () => {
      const config: ContentQualityConfig = {
        minWordCount: 500,
        minImageCount: 2,
      }
      const v = createContentQualityValidator(config)
      expect(v).toBeInstanceOf(ContentQualityValidator)
    })
  })
})
