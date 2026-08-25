// ─────────────────────────────────────────────────────────────────────────────
// ContentQualityValidator Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { ContentQualityValidator, createContentQualityValidator } from './ContentQualityValidator'
import type { ContentQualityConfig } from './ContentQualityValidator'

/** 33 French words, two sentences: the building block of the fixtures below. */
const PARAGRAPH =
  '<p>Notre equipe intervient rapidement dans toute la ville pour reparer une fuite, ' +
  'deboucher une canalisation ou installer un chauffe-eau. Chaque intervention commence ' +
  'par un diagnostic precis et un devis ecrit, sans frais caches.</p>'

/** A page shaped like what the generator is actually prompted to produce. */
const VALID_ARTICLE = [
  '<h1>Plombier a Troyes : depannage urgent et devis gratuit</h1>',
  PARAGRAPH.repeat(7),
  '<h2>Quels sont les tarifs d un plombier a Troyes ?</h2>',
  PARAGRAPH.repeat(7),
  '<h2>Comment choisir son plombier dans l Aube ?</h2>',
  PARAGRAPH.repeat(7),
  '<p><a href="/depannage-plomberie-urgence-fuite-eau-troyes">Nos interventions d urgence</a></p>',
].join('\n')

const TITLE = 'Plombier a Troyes : depannage urgent et devis gratuit'

describe('ContentQualityValidator', () => {
  let validator: ContentQualityValidator

  beforeEach(() => {
    validator = new ContentQualityValidator()
  })

  describe('a realistic generated article', () => {
    it('publishes without a single blocking error', () => {
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.errors).toEqual([])
      expect(result.isValid).toBe(true)
    })

    it('measures the structure it actually contains', () => {
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.metrics.wordCount).toBeGreaterThan(600)
      expect(result.metrics.h1Count).toBe(1)
      expect(result.metrics.h2Count).toBe(2)
      expect(result.metrics.headingCount).toBe(3)
      expect(result.metrics.internalLinkCount).toBe(1)
      expect(result.metrics.headingLevelSkips).toBe(0)
    })

    it('scores French prose as readable instead of unreadable', () => {
      // Regression guard on the syllable bug: counting vowel CHARACTERS drove
      // this ratio to ~2.7 and the Flesch score below zero, which made
      // READABILITY_DIFFICULT fire on 100% of French pages.
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.metrics.averageSyllablePerWord).toBeLessThan(2.1)
      expect(result.metrics.fleschReadingEase).toBeGreaterThan(40)
      expect(result.warnings.some(w => w.code === 'READABILITY_DIFFICULT')).toBe(false)
    })
  })

  describe('blocking errors', () => {
    it('blocks a missing title', () => {
      const result = validator.validate({ content: VALID_ARTICLE })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MISSING_TITLE')).toBe(true)
    })

    it('blocks a missing H1', () => {
      const withoutH1 = VALID_ARTICLE.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
      const result = validator.validate({ title: TITLE, content: withoutH1 })

      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'MISSING_H1')).toBe(true)
    })

    it('blocks thin content', () => {
      const result = validator.validate({ title: TITLE, content: `<h1>Titre</h1>${PARAGRAPH}` })

      expect(result.errors.some(e => e.code === 'WORD_COUNT_TOO_LOW')).toBe(true)
    })

    it('blocks a full-length article with no H2 at all', () => {
      const withoutH2 = VALID_ARTICLE.replace(/<h2[^>]*>[\s\S]*?<\/h2>/gi, '')
      const result = validator.validate({ title: TITLE, content: withoutH2 })

      expect(result.errors.some(e => e.code === 'MISSING_H2')).toBe(true)
    })

    it('can be told the H1 comes from the CMS title', () => {
      const withoutH1 = VALID_ARTICLE.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
      const lenient = new ContentQualityValidator({ requireH1: false })

      expect(lenient.validate({ title: TITLE, content: withoutH1 }).isValid).toBe(true)
    })
  })

  describe('warnings that must NOT block', () => {
    it('does not block a page without images', () => {
      // The generator returns image ALT SUGGESTIONS, never <img> tags, and
      // campaigns can disable images. NO_IMAGES used to be an error, which
      // would have rejected every page the engine produces.
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.metrics.imageCount).toBe(0)
      expect(result.errors.some(e => e.code === 'NO_IMAGES')).toBe(false)
      expect(result.warnings.some(w => w.code === 'IMAGE_COUNT_LOW')).toBe(true)
      expect(result.isValid).toBe(true)
    })

    it('does not block an image missing its alt text', () => {
      const result = validator.validate({
        title: TITLE,
        content: `${VALID_ARTICLE}<img src="/plombier.jpg">`,
      })

      expect(result.warnings.some(w => w.code === 'IMAGES_MISSING_ALT')).toBe(true)
      expect(result.errors.some(e => e.code === 'IMAGES_MISSING_ALT')).toBe(false)
      expect(result.isValid).toBe(true)
    })

    it('does not block a page without internal links', () => {
      const withoutLinks = VALID_ARTICLE.replace(/<a[\s\S]*?<\/a>/gi, '')
      const result = validator.validate({ title: TITLE, content: withoutLinks })

      expect(result.warnings.some(w => w.code === 'INTERNAL_LINKS_LOW')).toBe(true)
      expect(result.isValid).toBe(true)
    })

    it('does not block hard-to-read prose', () => {
      const dense =
        '<h1>Reglementation</h1>' +
        ('<p>La reglementation thermique impose desormais aux professionnels certifies une ' +
          'verification systematique des installations existantes avant toute intervention ' +
          'corrective sur les equipements de production de chaleur individuels ou collectifs ' +
          'situes en zone urbaine dense</p>').repeat(15) +
        '<h2>Precisions</h2>'

      const result = validator.validate({ title: TITLE, content: dense })

      expect(result.metrics.fleschReadingEase).toBeLessThan(40)
      expect(result.errors.some(e => e.category === 'readability')).toBe(false)
      expect(result.warnings.some(w => w.category === 'readability')).toBe(true)
    })

    it('does not block long-form content', () => {
      const long = [
        '<h1>Guide complet</h1>',
        PARAGRAPH.repeat(200),
        '<h2>Section</h2>',
      ].join('\n')

      const result = validator.validate({ title: TITLE, content: long })

      expect(result.metrics.wordCount).toBeGreaterThan(5000)
      expect(result.warnings.some(w => w.code === 'WORD_COUNT_TOO_HIGH')).toBe(true)
      expect(result.errors.some(e => e.code === 'WORD_COUNT_TOO_HIGH')).toBe(false)
    })

    it('warns about a long title without blocking', () => {
      const result = validator.validate({ title: 'A'.repeat(100), content: VALID_ARTICLE })

      expect(result.warnings.some(w => w.code === 'TITLE_TOO_LONG')).toBe(true)
      expect(result.isValid).toBe(true)
    })

    it('warns about several H1 without blocking', () => {
      const result = validator.validate({
        title: TITLE,
        content: `${VALID_ARTICLE}<h1>Un second titre</h1>`,
      })

      expect(result.warnings.some(w => w.code === 'MULTIPLE_H1')).toBe(true)
      expect(result.isValid).toBe(true)
    })

    it('warns about a skipped heading level', () => {
      const skipped = VALID_ARTICLE.replace('<h2>Comment', '<h4>Comment').replace(
        'l Aube ?</h2>',
        'l Aube ?</h4>'
      )
      const result = validator.validate({ title: TITLE, content: skipped })

      expect(result.metrics.headingLevelSkips).toBe(1)
      expect(result.warnings.some(w => w.code === 'HEADING_LEVEL_SKIP')).toBe(true)
      expect(result.isValid).toBe(true)
    })
  })

  describe('parsing', () => {
    it('calculates an exact word count', () => {
      const result = validator.validate({
        title: 'Test',
        content: '<p>Un deux trois quatre cinq six sept huit neuf dix.</p>'.repeat(10),
      })

      expect(result.metrics.wordCount).toBe(100)
    })

    it('counts single-quoted internal links, which is what the generator emits', () => {
      const result = validator.validate({
        title: TITLE,
        content: `${VALID_ARTICLE}<p><a href='/autre-page-longue-traine-troyes'>Autre page</a></p>`,
      })

      expect(result.metrics.internalLinkCount).toBe(2)
    })

    it('separates internal from external links', () => {
      const result = validator.validate({
        title: TITLE,
        content: `${VALID_ARTICLE}<p><a href="https://www.service-public.fr/x">Source</a></p>`,
      })

      expect(result.metrics.externalLinkCount).toBe(1)
      expect(result.metrics.internalLinkCount).toBe(1)
    })

    it('parses the heading outline with levels', () => {
      const result = validator.validate({
        title: TITLE,
        content: '<h1>A</h1><h2>B</h2><h3>C</h3>' + PARAGRAPH.repeat(12),
      })

      expect(result.metrics.headingOutline).toEqual([
        { level: 1, text: 'A' },
        { level: 2, text: 'B' },
        { level: 3, text: 'C' },
      ])
    })
  })

  describe('custom configuration', () => {
    it('respects a custom minWordCount', () => {
      const customValidator = new ContentQualityValidator({ minWordCount: 1000 })
      const result = customValidator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.errors.some(e => e.code === 'WORD_COUNT_TOO_LOW')).toBe(true)
    })

    it('respects a custom minImageCount', () => {
      const config: ContentQualityConfig = { minImageCount: 3 }
      const customValidator = new ContentQualityValidator(config)

      const result = customValidator.validate({
        title: TITLE,
        content: `${VALID_ARTICLE}<img src="1.jpg" alt="1"><img src="2.jpg" alt="2">`,
      })

      expect(result.warnings.some(w => w.code === 'IMAGE_COUNT_LOW')).toBe(true)
    })

    it('respects a custom readability floor', () => {
      const strict = new ContentQualityValidator({ minReadabilityScore: 95 })
      const result = strict.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.warnings.some(w => w.code === 'READABILITY_BELOW_RECOMMENDED')).toBe(true)
      expect(result.isValid).toBe(true)
    })
  })

  describe('score calculation', () => {
    it('gives a normal article a normal structure score', () => {
      // The old rubric subtracted (20 - imageCount) * 3 and (10 - links) * 5,
      // so a page with one image and two links scored 3/100.
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(result.score.structure).toBeGreaterThan(70)
      expect(result.score.overall).toBeGreaterThan(60)
    })

    it('collapses the score of a page that is missing everything', () => {
      const result = validator.validate({ content: '<p>Trop court.</p>' })

      expect(result.score.overall).toBeLessThan(60)
      expect(result.score.grade).toBe('F')
    })

    it('returns a grade in the expected range', () => {
      const result = validator.validate({ title: TITLE, content: VALID_ARTICLE })

      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.score.grade)
    })
  })

  describe('createContentQualityValidator factory', () => {
    it('should create validator with default config', () => {
      const v = createContentQualityValidator()
      expect(v).toBeInstanceOf(ContentQualityValidator)
    })

    it('should create validator with custom config', () => {
      const config: ContentQualityConfig = { minWordCount: 500, minImageCount: 2 }
      const v = createContentQualityValidator(config)
      expect(v).toBeInstanceOf(ContentQualityValidator)
    })
  })
})
