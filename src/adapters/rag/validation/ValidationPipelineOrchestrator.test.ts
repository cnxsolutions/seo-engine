// ─────────────────────────────────────────────────────────────────────────────
// ValidationPipelineOrchestrator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import type { ContentSchema } from '@/src/core/domain/entities'
import {
  ValidationPipelineOrchestrator,
  createValidationPipeline,
  type ValidationPipelineContent,
} from './ValidationPipelineOrchestrator'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PARAGRAPH =
  '<p>Notre equipe intervient rapidement dans toute la ville pour reparer une fuite, ' +
  'deboucher une canalisation ou installer un chauffe-eau. Chaque intervention commence ' +
  'par un diagnostic precis et un devis ecrit, sans frais caches.</p>'

const HTML = [
  '<h1>Plombier Troyes : depannage urgent et devis gratuit</h1>',
  PARAGRAPH.repeat(7),
  '<h2>Quels sont les tarifs d un plombier Troyes ?</h2>',
  PARAGRAPH.repeat(7),
  '<h2>Comment joindre un plombier Troyes la nuit ?</h2>',
  PARAGRAPH.repeat(7),
  '<p><a href="/depannage-plomberie-urgence-fuite-eau-troyes">Nos interventions</a></p>',
].join('\n')

const LOCAL_BUSINESS = JSON.stringify({
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

const BREADCRUMB = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://plomberie-dupont.fr/' },
    { '@type': 'ListItem', position: 2, name: 'Plombier Troyes' },
  ],
})

function buildContent(overrides: Partial<ValidationPipelineContent> = {}): ValidationPipelineContent {
  return {
    fields: {},
    contentType: 'post',
    title: 'Plombier Troyes : depannage urgent et devis gratuit',
    metaTitle: 'Plombier Troyes : depannage urgent et devis gratuit',
    metaDescription:
      'Plombier Troyes disponible 24h/24 pour vos fuites et urgences. '.padEnd(150, 'x'),
    content: HTML,
    url: 'https://plomberie-dupont.fr/plombier-troyes-depannage-urgence-fuite-eau',
    focusKeyword: 'plombier Troyes',
    schemas: { localBusiness: LOCAL_BUSINESS, breadcrumb: BREADCRUMB },
    ...overrides,
  }
}

function buildSchema(): ContentSchema {
  return {
    id: 'schema-1',
    siteId: 'site-1',
    name: 'wp',
    label: 'WordPress',
    contentTypes: [
      {
        key: 'post',
        label: 'Post',
        supports: ['title', 'editor'],
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true, sortOrder: 0 },
          { key: 'content', label: 'Content', type: 'html', required: true, sortOrder: 1 },
        ],
      },
    ],
    seoConfig: { hasSeoPlugin: true, seoFields: [], schemaTypes: [] },
    publishConfig: {
      requiresReview: false,
      defaultStatus: 'draft',
      supportedStatuses: ['draft', 'published'],
      autoPublish: false,
    },
    extractedAt: new Date(),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ValidationPipelineOrchestrator', () => {
  describe('a page the generator would realistically produce', () => {
    it('is allowed to publish', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({ content: buildContent() })

      expect(result.summary.blockingIssues).toEqual([])
      expect(result.summary.totalErrors).toBe(0)
      expect(result.summary.canPublish).toBe(true)
      expect(result.valid).toBe(true)
    })

    it('runs quality, seo and json-ld', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({ content: buildContent() })

      expect(result.results.contentQuality).toBeDefined()
      expect(result.results.seo).toBeDefined()
      expect(result.results.jsonLd).toBeDefined()
      expect(result.results.jsonLd!.result.types).toContain('Plumber')
    })

    it('does not run the duplicate detector unless asked', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent(),
        existingContents: [{ id: 'old', title: 'Autre', content: HTML }],
      })

      expect(result.results.duplicate).toBeUndefined()
    })
  })

  describe('blocking', () => {
    it('blocks a page with no H1', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ content: HTML.replace(/<h1[\s\S]*?<\/h1>/i, '') }),
      })

      expect(result.summary.canPublish).toBe(false)
      expect(result.summary.blockingIssues!.join(' ')).toContain('MISSING_H1')
    })

    it('blocks a page with no title', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ title: undefined, metaTitle: undefined }),
      })

      expect(result.summary.canPublish).toBe(false)
    })

    it('blocks an invalid JSON-LD', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ schemas: { localBusiness: '{ broken json' } }),
      })

      expect(result.summary.canPublish).toBe(false)
      expect(result.results.jsonLd!.passed).toBe(false)
    })

    it('blocks thin content', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ content: `<h1>Titre plombier Troyes</h1>${PARAGRAPH}` }),
      })

      expect(result.summary.canPublish).toBe(false)
      expect(result.summary.blockingIssues!.join(' ')).toContain('WORD_COUNT_TOO_LOW')
    })

    it('blocks a near-identical page when duplicate detection is on', async () => {
      const pipeline = createValidationPipeline({
        validators: { schema: false, duplicate: true },
      })

      const result = await pipeline.validate({
        content: buildContent(),
        existingContents: [{ id: 'old', title: 'Ancienne page', content: HTML }],
      })

      expect(result.results.duplicate!.passed).toBe(false)
      expect(result.summary.canPublish).toBe(false)
      expect(result.summary.blockingIssues!.join(' ')).toContain('duplicate')
    })

    it('reports the CMS schema errors it is given', async () => {
      const pipeline = createValidationPipeline({
        schema: { schema: buildSchema() },
      })

      const result = await pipeline.validate({
        content: buildContent({ fields: { title: 'Un titre' } }),
      })

      expect(result.results.schema!.passed).toBe(false)
      expect(result.summary.canPublish).toBe(false)
    })
  })

  describe('what must NOT block', () => {
    it('does not block on warnings alone', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        // No image, no meta description, no structured data, short title.
        content: buildContent({ metaDescription: undefined, schemas: {}, metaTitle: 'Court' }),
      })

      expect(result.summary.totalWarnings).toBeGreaterThan(0)
      expect(result.summary.canPublish).toBe(true)
    })

    it('does not block on a cannibalisation-only overlap', async () => {
      const pipeline = createValidationPipeline({
        validators: { schema: false, duplicate: true },
      })

      const shared =
        'Le plombier propose un devis avec assurance pour chaque intervention urgence fuite ' +
        'canalisation depannage'

      const result = await pipeline.validate({
        content: buildContent({
          title: 'Comment choisir un plombier Troyes pas cher',
          content:
            '<h1>Comment choisir un plombier Troyes pas cher</h1>' +
            '<h2>Nos interventions a Troyes</h2>' +
            `<p>${shared} a Troyes dans le centre historique du quartier gare.</p>`.repeat(16),
        }),
        existingContents: [
          {
            id: 'old',
            title: 'Comment choisir un plombier Troyes pas cher',
            content: `${shared} a Reims dans la zone industrielle pres de la cathedrale Marne. `.repeat(16),
          },
        ],
      })

      const duplicates = result.results.duplicate!.result.duplicates
      expect(duplicates).toHaveLength(1)
      expect(duplicates[0].reason).toBe('cannibalization')
      expect(result.results.duplicate!.passed).toBe(true)
    })

    it('does not block on a long title', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const longTitle = 'Plombier Troyes : depannage urgent, devis gratuit et intervention rapide 24h'
      const result = await pipeline.validate({
        content: buildContent({ title: longTitle, metaTitle: longTitle }),
      })

      expect(longTitle.length).toBeGreaterThan(60)
      expect(result.summary.canPublish).toBe(true)
    })

    it('treats the "{}" schema fallback as absent, not invalid', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ schemas: { localBusiness: '{}', faqPage: '{}', breadcrumb: '{}' } }),
      })

      expect(result.results.jsonLd).toBeUndefined()
      expect(result.summary.canPublish).toBe(true)
    })
  })

  describe('configuration', () => {
    it('merges a partial validators map with the defaults', async () => {
      // Passing `{ duplicate: true }` used to wipe out every other validator.
      const pipeline = createValidationPipeline({ validators: { duplicate: true } })
      const result = await pipeline.validate({ content: buildContent() })

      expect(result.results.contentQuality).toBeDefined()
      expect(result.results.seo).toBeDefined()
    })

    it('stops at the first failing validator when asked', async () => {
      const pipeline = createValidationPipeline({
        validators: { schema: false },
        stopOnFirstError: true,
      })

      const result = await pipeline.validate({
        content: buildContent({ content: `<h1>Titre plombier Troyes</h1>${PARAGRAPH}` }),
      })

      expect(result.results.contentQuality!.passed).toBe(false)
      expect(result.results.seo).toBeUndefined()
    })
  })

  describe('single-validator entry points', () => {
    it('exposes validateContentQuality', () => {
      const pipeline = new ValidationPipelineOrchestrator({})
      const result = pipeline.validateContentQuality({ title: 'Titre', content: HTML })

      expect(result.metrics.h1Count).toBe(1)
    })

    it('exposes validateSeo and derives the heading outline itself', () => {
      const pipeline = new ValidationPipelineOrchestrator({})
      const result = pipeline.validateSeo({ content: HTML, focusKeyword: 'plombier Troyes' })

      expect(result.metrics.h2Count).toBe(2)
      expect(result.warnings.some(w => w.code === 'NO_H2')).toBe(false)
    })

    it('exposes validateJsonLd', () => {
      const pipeline = new ValidationPipelineOrchestrator({})
      const result = pipeline.validateJsonLd({ localBusiness: LOCAL_BUSINESS, breadcrumb: BREADCRUMB })

      expect(result.isValid).toBe(true)
    })

    it('exposes checkDuplicates against a candidate list', async () => {
      const pipeline = new ValidationPipelineOrchestrator({ validators: { duplicate: true } })
      const result = await pipeline.checkDuplicates(
        { id: 'new', title: 'Titre', content: HTML },
        [{ id: 'old', title: 'Titre', content: HTML }]
      )

      expect(result.hasDuplicates).toBe(true)
    })

    it('throws when a validator was not configured', () => {
      const pipeline = new ValidationPipelineOrchestrator({ validators: { seo: false } })

      expect(() => pipeline.validateSeo({ content: HTML, focusKeyword: 'x' })).toThrow()
      expect(() => pipeline.validateSchema({ fields: {}, contentType: 'post' })).toThrow()
    })
  })

  describe('summary', () => {
    it('reports a grade and a score', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({ content: buildContent() })

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.summary.grade)
      expect(result.overallScore).toBeGreaterThan(60)
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('lists actionable fixes, most critical first', async () => {
      const pipeline = createValidationPipeline({ validators: { schema: false } })
      const result = await pipeline.validate({
        content: buildContent({ schemas: { localBusiness: '{ broken json' } }),
      })

      expect(result.actions.length).toBeGreaterThan(0)
      expect(result.actions[0].priority).toBe('critical')
    })
  })
})
