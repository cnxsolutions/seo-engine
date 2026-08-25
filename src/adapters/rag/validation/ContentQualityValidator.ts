// ─────────────────────────────────────────────────────────────────────────────
// Content Quality Validator
// SEO Engine - Validation Pipeline
// Validates content quality metrics
// ─────────────────────────────────────────────────────────────────────────────

import {
  computeFrenchReadability,
  countSyllables,
  type FrenchReadabilityLabel,
} from './french-readability'
import {
  countImages,
  extractHeadingOutline,
  extractLinks,
  splitSentences,
  stripHtmlToText,
  tokenizeWords,
  type HeadingNode,
} from '@/src/core/domain/text/text-utils'

/**
 * SEVERITY POLICY — this validator gates publication, so severity is a product
 * decision, not a detail:
 *
 *   ERROR (blocks)   an article shipped with this defect cannot rank at all:
 *                    no title, no H1, thin content.
 *   WARNING (logs)   the article ranks worse than it could, but shipping it is
 *                    still better than shipping nothing: readability, images,
 *                    internal links, slightly-off lengths.
 *
 * Anything ambiguous is a warning. A gate that publishes nothing is a dead
 * engine.
 */

/**
 * Configuration de validation qualité
 */
export interface ContentQualityConfig {
  /** Hard floor below which the page is thin content. Blocking. */
  minWordCount?: number
  /** Editorial target; falling short only warns. */
  targetWordCount?: number
  /** Upper bound; exceeding it only warns (long-form is not a defect). */
  maxWordCount?: number
  minParagraphCount?: number
  minHeadingCount?: number
  requiredHeadings?: string[]
  /** Blocking: a body with no H1 has no declared subject. */
  requireH1?: boolean
  minImageCount?: number
  imageAltRequired?: boolean
  minInternalLinks?: number
  minExternalLinks?: number
  checkReadability?: boolean
  /** French Kandel & Moles score below which we warn. Default 50. */
  minReadabilityScore?: number
  /** French score below which the text is flagged as hard to read. Default 30. */
  readabilityFloor?: number
  checkSpelling?: boolean
  checkGrammar?: boolean
}

/**
 * Résultat de validation qualité
 */
export interface ContentQualityResult {
  isValid: boolean
  score: ContentQualityScore
  errors: ContentQualityError[]
  warnings: ContentQualityWarning[]
  metrics: ContentMetrics
  suggestions: QualitySuggestion[]
}

/**
 * Score de qualité
 */
export interface ContentQualityScore {
  overall: number
  structure: number
  readability: number
  completeness: number
  seo: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

/**
 * Erreur de qualité
 */
export interface ContentQualityError {
  category: 'structure' | 'readability' | 'completeness' | 'seo'
  code: string
  message: string
  value?: number
  threshold?: number
}

/**
 * Avertissement de qualité
 */
export interface ContentQualityWarning {
  category: 'structure' | 'readability' | 'completeness' | 'seo'
  code: string
  message: string
  suggestion?: string
}

/**
 * Métriques de contenu
 */
export interface ContentMetrics {
  wordCount: number
  characterCount: number
  paragraphCount: number
  sentenceCount: number
  headingCount: number
  h1Count: number
  h2Count: number
  h3Count: number
  imageCount: number
  imagesWithAlt: number
  internalLinkCount: number
  externalLinkCount: number
  listCount: number
  quoteCount: number
  codeBlockCount: number
  averageWordPerSentence: number
  averageSentencePerParagraph: number
  fleschReadingEase?: number
  fleschKincaidGrade?: number
  // ─── Added in wave 2 (all optional: purely additive for consumers) ───
  syllableCount?: number
  averageSyllablePerWord?: number
  readabilityLabel?: FrenchReadabilityLabel
  headingOutline?: HeadingNode[]
  /** Headings whose level jumps more than one step below its parent. */
  headingLevelSkips?: number
}

/**
 * Suggestion de qualité
 */
export interface QualitySuggestion {
  category: 'structure' | 'readability' | 'completeness' | 'seo'
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  impact: string
}

/**
 * Validateur de qualité de contenu
 */
export class ContentQualityValidator {
  private config: ContentQualityConfig

  constructor(config: ContentQualityConfig = {}) {
    this.config = {
      minWordCount: 300,
      targetWordCount: 600,
      maxWordCount: 5000,
      minParagraphCount: 3,
      minHeadingCount: 2,
      requiredHeadings: ['h2'],
      requireH1: true,
      minImageCount: 1,
      imageAltRequired: true,
      minInternalLinks: 1,
      minExternalLinks: 0,
      checkReadability: true,
      minReadabilityScore: 50,
      readabilityFloor: 30,
      checkSpelling: false,
      checkGrammar: false,
      ...config,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Valide la qualité du contenu
   */
  validate(content: {
    title?: string
    content: string
    html?: string
  }): ContentQualityResult {
    const errors: ContentQualityError[] = []
    const warnings: ContentQualityWarning[] = []
    const suggestions: QualitySuggestion[] = []

    // Parser le contenu
    const metrics = this.parseContent(content.content || content.html || '')

    // Valider la structure
    this.validateStructure(metrics, errors, warnings, suggestions)

    // Valider la lisibilité
    this.validateReadability(metrics, errors, warnings, suggestions)

    // Valider la complétude
    this.validateCompleteness(metrics, content, errors, warnings, suggestions)

    // Calculer le score
    const score = this.calculateScore(metrics, errors, warnings)

    const isValid = errors.length === 0

    return {
      isValid,
      score,
      errors,
      warnings,
      metrics,
      suggestions,
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private parseContent(html: string): ContentMetrics {
    const text = stripHtmlToText(html)

    const words = tokenizeWords(text)
    const wordCount = words.length
    const characterCount = text.length

    // Paragraphs: count the opening tags rather than splitting on the closing
    // ones, which used to count trailing whitespace as a paragraph.
    const paragraphMatches = html.match(/<p\b[^>]*>/gi) || []
    const paragraphCount = paragraphMatches.length > 0
      ? paragraphMatches.length
      : text.split(/\n{2,}/).filter(block => block.trim().length > 0).length

    // Sentences: every non-empty fragment counts. Dropping fragments shorter
    // than 10 characters (the previous rule) silently inflated the average
    // sentence length of any text with short sentences.
    const sentenceCount = splitSentences(text).length

    const headingOutline = extractHeadingOutline(html)
    const h1Count = headingOutline.filter(h => h.level === 1).length
    const h2Count = headingOutline.filter(h => h.level === 2).length
    const h3Count = headingOutline.filter(h => h.level === 3).length
    const headingCount = headingOutline.length
    const headingLevelSkips = countHeadingLevelSkips(headingOutline)

    const images = countImages(html)
    const links = extractLinks(html)

    const listCount = (html.match(/<(?:ul|ol)\b[^>]*>/gi) || []).length
    const quoteCount = (html.match(/<blockquote\b[^>]*>/gi) || []).length
    const codeBlockCount = (html.match(/<pre\b[^>]*>/gi) || []).length

    const averageWordPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0
    const averageSentencePerParagraph = paragraphCount > 0 ? sentenceCount / paragraphCount : 0

    const readability = computeFrenchReadability({
      words: wordCount,
      sentences: sentenceCount,
      syllables: countSyllables(words),
    })

    return {
      wordCount,
      characterCount,
      paragraphCount,
      sentenceCount,
      headingCount,
      h1Count,
      h2Count,
      h3Count,
      imageCount: images.total,
      imagesWithAlt: images.withAlt,
      internalLinkCount: links.internal.length,
      externalLinkCount: links.external.length,
      listCount,
      quoteCount,
      codeBlockCount,
      averageWordPerSentence,
      averageSentencePerParagraph,
      fleschReadingEase: readability?.score,
      fleschKincaidGrade: readability?.gradeLevel,
      syllableCount: readability?.syllables,
      averageSyllablePerWord: readability?.averageSyllablesPerWord,
      readabilityLabel: readability?.label,
      headingOutline,
      headingLevelSkips,
    }
  }

  private validateStructure(
    metrics: ContentMetrics,
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[],
    suggestions: QualitySuggestion[]
  ): void {
    const minWordCount = this.config.minWordCount ?? 300
    const targetWordCount = this.config.targetWordCount ?? 600
    const maxWordCount = this.config.maxWordCount ?? 5000

    // ─── Blocking: thin content ───────────────────────────────────────
    if (metrics.wordCount < minWordCount) {
      errors.push({
        category: 'structure',
        code: 'WORD_COUNT_TOO_LOW',
        message: `Word count (${metrics.wordCount}) is below minimum (${minWordCount})`,
        value: metrics.wordCount,
        threshold: minWordCount,
      })
    } else if (metrics.wordCount < targetWordCount) {
      warnings.push({
        category: 'structure',
        code: 'WORD_COUNT_BELOW_TARGET',
        message: `Word count (${metrics.wordCount}) is below the editorial target (${targetWordCount})`,
        suggestion: 'Develop the sections the brief asked for',
      })
    }

    // Long-form content is not a defect: warn, never block.
    if (metrics.wordCount > maxWordCount) {
      warnings.push({
        category: 'structure',
        code: 'WORD_COUNT_TOO_HIGH',
        message: `Word count (${metrics.wordCount}) exceeds maximum (${maxWordCount})`,
        suggestion: 'Consider splitting the page into a pillar and child pages',
      })
    }

    // ─── Blocking: no H1 ──────────────────────────────────────────────
    if (this.config.requireH1 && metrics.h1Count === 0) {
      errors.push({
        category: 'structure',
        code: 'MISSING_H1',
        message: 'No H1 heading found in the content',
        value: 0,
        threshold: 1,
      })
    }

    // Several H1 is a structural smell, not a ranking blocker: Google picks one.
    if (metrics.h1Count > 1) {
      warnings.push({
        category: 'structure',
        code: 'MULTIPLE_H1',
        message: `Content has ${metrics.h1Count} H1 headings, expected exactly one`,
        suggestion: 'Demote the extra H1 headings to H2',
      })
    }

    // ─── Blocking: no section structure on a real article ─────────────
    const requiresH2 = this.config.requiredHeadings?.includes('h2') ?? false
    if (requiresH2 && metrics.h2Count === 0 && metrics.wordCount >= minWordCount) {
      errors.push({
        category: 'structure',
        code: 'MISSING_H2',
        message: 'At least one H2 heading is required',
        value: metrics.h2Count,
        threshold: 1,
      })
    } else if (requiresH2 && metrics.h2Count === 0) {
      warnings.push({
        category: 'structure',
        code: 'MISSING_H2',
        message: 'No H2 heading found',
        suggestion: 'Structure the content with H2 sections',
      })
    }

    if (metrics.headingCount < (this.config.minHeadingCount ?? 2)) {
      warnings.push({
        category: 'structure',
        code: 'HEADING_COUNT_TOO_LOW',
        message: `Heading count (${metrics.headingCount}) is below recommended (${this.config.minHeadingCount})`,
        suggestion: 'Break the content into more sections',
      })
    }

    if ((metrics.headingLevelSkips ?? 0) > 0) {
      warnings.push({
        category: 'structure',
        code: 'HEADING_LEVEL_SKIP',
        message: `Heading hierarchy skips a level ${metrics.headingLevelSkips} time(s) (e.g. H2 followed by H4)`,
        suggestion: 'Keep the outline contiguous: H1 → H2 → H3',
      })
    }

    if (metrics.paragraphCount < (this.config.minParagraphCount ?? 3)) {
      warnings.push({
        category: 'structure',
        code: 'PARAGRAPH_COUNT_TOO_LOW',
        message: `Paragraph count (${metrics.paragraphCount}) is below recommended (${this.config.minParagraphCount})`,
        suggestion: 'Split the text into readable paragraphs',
      })
    }

    // ─── Images: warnings only ────────────────────────────────────────
    //
    // The generator returns image ALT SUGGESTIONS (`imageAlts`), it does not
    // put <img> tags in `htmlContent`, and campaigns can disable images
    // entirely. Blocking on a missing image would reject 100% of the pages the
    // engine produces.
    if (metrics.imageCount < (this.config.minImageCount ?? 1)) {
      warnings.push({
        category: 'structure',
        code: 'IMAGE_COUNT_LOW',
        message: `Image count (${metrics.imageCount}) is below recommended (${this.config.minImageCount ?? 1})`,
        suggestion: 'Add relevant images to improve engagement',
      })
    }

    if (this.config.imageAltRequired && metrics.imageCount > 0) {
      const missingAlt = metrics.imageCount - metrics.imagesWithAlt
      if (missingAlt > 0) {
        warnings.push({
          category: 'seo',
          code: 'IMAGES_MISSING_ALT',
          message: `${missingAlt} image(s) are missing alt text`,
          suggestion: 'Describe every image for accessibility and image search',
        })
      }
    }

    // ─── Links: warnings only ─────────────────────────────────────────
    if (metrics.internalLinkCount < (this.config.minInternalLinks ?? 1)) {
      warnings.push({
        category: 'structure',
        code: 'INTERNAL_LINKS_LOW',
        message: `Internal link count (${metrics.internalLinkCount}) is below recommended (${this.config.minInternalLinks ?? 1})`,
        suggestion: 'Add internal links to related content',
      })

      suggestions.push({
        category: 'seo',
        priority: 'high',
        title: 'Add internal links',
        description: 'Link the page to its pillar and to sibling pages',
        impact: 'Crawl depth and topical authority',
      })
    }

    if (metrics.externalLinkCount < (this.config.minExternalLinks ?? 0)) {
      warnings.push({
        category: 'structure',
        code: 'EXTERNAL_LINKS_LOW',
        message: `External link count (${metrics.externalLinkCount}) is below minimum (${this.config.minExternalLinks ?? 0})`,
      })
    }
  }

  private validateReadability(
    metrics: ContentMetrics,
    _errors: ContentQualityError[],
    warnings: ContentQualityWarning[],
    suggestions: QualitySuggestion[]
  ): void {
    // Readability NEVER blocks. It is an estimate built on a formula whose
    // French calibration is approximate; refusing to publish on it would be
    // trading a certain loss (no page) for an uncertain gain.
    if (this.config.checkReadability && metrics.fleschReadingEase !== undefined) {
      const floor = this.config.readabilityFloor ?? 30
      const target = this.config.minReadabilityScore ?? 50

      if (metrics.fleschReadingEase < floor) {
        warnings.push({
          category: 'readability',
          code: 'READABILITY_DIFFICULT',
          message: `Readability score (${metrics.fleschReadingEase}/100, "${metrics.readabilityLabel}") indicates difficult content`,
          suggestion: 'Use shorter sentences and simpler words',
        })

        suggestions.push({
          category: 'readability',
          priority: 'high',
          title: 'Improve readability',
          description: 'Use shorter sentences and simpler words',
          impact: 'Better user experience and SEO',
        })
      } else if (metrics.fleschReadingEase < target) {
        warnings.push({
          category: 'readability',
          code: 'READABILITY_BELOW_RECOMMENDED',
          message: `Readability score (${metrics.fleschReadingEase}/100) is below recommended (${target})`,
          suggestion: 'Consider simplifying sentence structure',
        })
      }
    }

    if (metrics.averageWordPerSentence > 25) {
      warnings.push({
        category: 'readability',
        code: 'SENTENCES_TOO_LONG',
        message: `Average sentence length (${metrics.averageWordPerSentence.toFixed(1)} words) is quite high`,
        suggestion: 'Break long sentences into shorter ones',
      })
    }

    if (metrics.averageSentencePerParagraph > 8) {
      warnings.push({
        category: 'readability',
        code: 'PARAGRAPHS_TOO_LONG',
        message: `Average paragraph has ${metrics.averageSentencePerParagraph.toFixed(1)} sentences`,
        suggestion: 'Break long paragraphs into shorter ones',
      })
    }
  }

  private validateCompleteness(
    metrics: ContentMetrics,
    content: { title?: string; content: string },
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[],
    suggestions: QualitySuggestion[]
  ): void {
    // ─── Blocking: no title ───────────────────────────────────────────
    if (!content.title || content.title.trim().length === 0) {
      errors.push({
        category: 'completeness',
        code: 'MISSING_TITLE',
        message: 'Title is missing',
      })
    } else if (content.title.length > 70) {
      warnings.push({
        category: 'completeness',
        code: 'TITLE_TOO_LONG',
        message: `Title (${content.title.length} chars) exceeds 70 characters`,
        suggestion: 'Keep the title around 60 characters so Google does not truncate it',
      })
    }

    if (metrics.wordCount < 100) {
      warnings.push({
        category: 'completeness',
        code: 'CONTENT_VERY_SHORT',
        message: `Content is very short (${metrics.wordCount} words)`,
        suggestion: 'Add more detailed information',
      })
    }

    const hasFaq = /faq|question/i.test(content.content)
    if (!hasFaq && metrics.wordCount > 500) {
      suggestions.push({
        category: 'seo',
        priority: 'medium',
        title: 'Consider adding FAQ section',
        description: 'A question/answer block answers long-tail queries directly',
        impact: 'Better coverage of People Also Ask intents',
      })
    }
  }

  /**
   * Rubric-based scoring.
   *
   * The previous formula subtracted `(20 - imageCount) * 3` and
   * `(10 - internalLinks) * 5`, so a perfectly normal page carrying one image
   * and two internal links scored 3/100 on structure. Every penalty here is
   * bounded and tied to a defect that was actually raised.
   */
  private calculateScore(
    metrics: ContentMetrics,
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[]
  ): ContentQualityScore {
    const minWordCount = this.config.minWordCount ?? 300
    const targetWordCount = this.config.targetWordCount ?? 600

    let structureScore = 100
    if (metrics.wordCount < minWordCount) structureScore -= 35
    else if (metrics.wordCount < targetWordCount) structureScore -= 12
    if (metrics.h1Count === 0) structureScore -= 15
    if (metrics.h1Count > 1) structureScore -= 5
    if (metrics.h2Count === 0) structureScore -= 15
    if (metrics.headingCount < (this.config.minHeadingCount ?? 2)) structureScore -= 8
    if ((metrics.headingLevelSkips ?? 0) > 0) structureScore -= 5
    if (metrics.paragraphCount < (this.config.minParagraphCount ?? 3)) structureScore -= 8
    if (metrics.internalLinkCount === 0) structureScore -= 10
    if (metrics.imageCount === 0) structureScore -= 5

    // Readability is expressed on the French Kandel & Moles scale, where
    // ordinary press prose sits around 50-65. Rescale so that "standard French"
    // does not look like a failing grade. Below 100 words the measurement is
    // noise, so it contributes a neutral value rather than a flattering one.
    let readabilityScore = 70
    if (metrics.fleschReadingEase !== undefined && metrics.wordCount >= 100) {
      readabilityScore = Math.round(Math.min(100, 40 + metrics.fleschReadingEase))
    }

    let completenessScore = 100
    completenessScore -= errors.filter(e => e.category === 'completeness').length * 30
    completenessScore -= warnings.filter(w => w.category === 'completeness').length * 8

    let seoScore = 100
    seoScore -= errors.filter(e => e.category === 'seo').length * 25
    seoScore -= warnings.filter(w => w.category === 'seo').length * 8

    const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

    const structure = clamp(structureScore)
    const readability = clamp(readabilityScore)
    const completeness = clamp(completenessScore)
    const seo = clamp(seoScore)

    // Weighted, not averaged: a page with no title and forty words must not be
    // rescued by a flattering readability figure.
    const overall = clamp(structure * 0.35 + completeness * 0.3 + seo * 0.2 + readability * 0.15)

    let grade: ContentQualityScore['grade']
    if (overall >= 90) grade = 'A'
    else if (overall >= 80) grade = 'B'
    else if (overall >= 70) grade = 'C'
    else if (overall >= 60) grade = 'D'
    else grade = 'F'

    return { overall, structure, readability, completeness, seo, grade }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Counts every jump larger than one level in a heading outline. */
function countHeadingLevelSkips(outline: HeadingNode[]): number {
  let skips = 0
  let previous = 0

  for (const heading of outline) {
    if (previous !== 0 && heading.level > previous + 1) skips++
    previous = heading.level
  }

  return skips
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createContentQualityValidator(
  config?: ContentQualityConfig
): ContentQualityValidator {
  return new ContentQualityValidator(config)
}
