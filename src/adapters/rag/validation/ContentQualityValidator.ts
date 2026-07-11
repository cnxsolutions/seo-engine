// ─────────────────────────────────────────────────────────────────────────────
// Content Quality Validator
// SEO Engine - Validation Pipeline
// Validates content quality metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration de validation qualité
 */
export interface ContentQualityConfig {
  minWordCount?: number
  maxWordCount?: number
  minParagraphCount?: number
  minHeadingCount?: number
  requiredHeadings?: string[]
  minImageCount?: number
  imageAltRequired?: boolean
  minInternalLinks?: number
  minExternalLinks?: number
  checkReadability?: boolean
  minReadabilityScore?: number
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
      maxWordCount: 5000,
      minParagraphCount: 3,
      minHeadingCount: 2,
      requiredHeadings: ['h2'],
      minImageCount: 1,
      imageAltRequired: true,
      minInternalLinks: 1,
      minExternalLinks: 0,
      checkReadability: true,
      minReadabilityScore: 60,
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
    // Compter les mots
    const text = html.replace(/<[^>]*>/g, ' ')
    const words = text.split(/\s+/).filter(w => w.length > 0)
    const wordCount = words.length

    // Compter les caractères
    const characterCount = text.length

    // Compter les paragraphes
    const paragraphs = html.split(/<\/p>|<\/div>/gi).filter(p => p.trim().length > 0)
    const paragraphCount = paragraphs.length

    // Compter les phrases (approximatif)
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10)
    const sentenceCount = sentences.length

    // Compter les headings
    const h1Matches = html.match(/<h1[^>]*>/gi) || []
    const h2Matches = html.match(/<h2[^>]*>/gi) || []
    const h3Matches = html.match(/<h3[^>]*>/gi) || []
    const headingCount = h1Matches.length + h2Matches.length + h3Matches.length

    // Compter les images
    const imgMatches = html.match(/<img[^>]*>/gi) || []
    const imageCount = imgMatches.length

    // Images avec alt
    const imagesWithAlt = imgMatches.filter(img => img.includes('alt=')).length

    // Compter les liens
    const internalLinks = html.match(/href="\/[^"]+"/gi) || []
    const externalLinks = html.match(/href="https?:\/\/[^"]+"/gi) || []
    const internalLinkCount = internalLinks.length
    const externalLinkCount = externalLinks.length

    // Compter les listes
    const listMatches = html.match(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi) || []
    const listCount = Math.floor(listMatches.length / 2)

    // Compter les citations
    const quoteMatches = html.match(/<blockquote[^>]*>/gi) || []
    const quoteCount = quoteMatches.length

    // Compter les blocs de code
    const codeMatches = html.match(/<pre[^>]*>|<\/pre>|<code[^>]*>/gi) || []
    const codeBlockCount = Math.floor(codeMatches.length / 2)

    // Calculer les moyennes
    const averageWordPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0
    const averageSentencePerParagraph = paragraphCount > 0 ? sentenceCount / paragraphCount : 0

    // Flesch Reading Ease (approximatif pour français)
    const { fleschReadingEase, fleschKincaidGrade } = this.calculateReadabilityMetrics(
      text,
      sentenceCount,
      wordCount
    )

    return {
      wordCount,
      characterCount,
      paragraphCount,
      sentenceCount,
      headingCount,
      h1Count: h1Matches.length,
      h2Count: h2Matches.length,
      h3Count: h3Matches.length,
      imageCount,
      imagesWithAlt,
      internalLinkCount,
      externalLinkCount,
      listCount,
      quoteCount,
      codeBlockCount,
      averageWordPerSentence,
      averageSentencePerParagraph,
      fleschReadingEase,
      fleschKincaidGrade,
    }
  }

  private calculateReadabilityMetrics(
    text: string,
    sentences: number,
    words: number
  ): { fleschReadingEase?: number; fleschKincaidGrade?: number } {
    if (sentences === 0 || words === 0) {
      return {}
    }

    // Approximation Flesch pour français (simplifié)
    // Formule: 206.835 - 1.015 × (words/sentences) - 84.6 × (syllables/words)
    const avgWordsPerSentence = words / sentences

    // Syllables approximation: count vowel groups
    const syllableCount = (text.match(/[aeiouyàâäéèêëïîôùûüÿœæ]/gi) || []).length
    const avgSyllablesPerWord = words > 0 ? syllableCount / words : 0

    // Flesch Reading Ease (adapté pour français)
    const fleschReadingEase = Math.round(
      206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord)
    )

    // Flesch-Kincaid Grade Level
    const fleschKincaidGrade = Math.round(
      (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59
    )

    return {
      fleschReadingEase: Math.max(0, Math.min(100, fleschReadingEase)),
      fleschKincaidGrade: Math.max(0, fleschKincaidGrade),
    }
  }

  private validateStructure(
    metrics: ContentMetrics,
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[],
    suggestions: QualitySuggestion[]
  ): void {
    // Word count
    if (metrics.wordCount < (this.config.minWordCount || 300)) {
      errors.push({
        category: 'structure',
        code: 'WORD_COUNT_TOO_LOW',
        message: `Word count (${metrics.wordCount}) is below minimum (${this.config.minWordCount})`,
        value: metrics.wordCount,
        threshold: this.config.minWordCount,
      })
    }

    if (metrics.wordCount > (this.config.maxWordCount || 5000)) {
      errors.push({
        category: 'structure',
        code: 'WORD_COUNT_TOO_HIGH',
        message: `Word count (${metrics.wordCount}) exceeds maximum (${this.config.maxWordCount})`,
        value: metrics.wordCount,
        threshold: this.config.maxWordCount,
      })
    }

    // Paragraph count
    if (metrics.paragraphCount < (this.config.minParagraphCount || 3)) {
      errors.push({
        category: 'structure',
        code: 'PARAGRAPH_COUNT_TOO_LOW',
        message: `Paragraph count (${metrics.paragraphCount}) is below minimum (${this.config.minParagraphCount})`,
        value: metrics.paragraphCount,
        threshold: this.config.minParagraphCount,
      })
    }

    // Heading count
    if (metrics.headingCount < (this.config.minHeadingCount || 2)) {
      errors.push({
        category: 'structure',
        code: 'HEADING_COUNT_TOO_LOW',
        message: `Heading count (${metrics.headingCount}) is below minimum (${this.config.minHeadingCount})`,
        value: metrics.headingCount,
        threshold: this.config.minHeadingCount,
      })
    }

    // Required headings
    if (this.config.requiredHeadings?.includes('h2') && metrics.h2Count === 0) {
      errors.push({
        category: 'structure',
        code: 'MISSING_H2',
        message: 'At least one H2 heading is required',
        value: metrics.h2Count,
        threshold: 1,
      })
    }

    // Image count
    if (metrics.imageCount < (this.config.minImageCount || 1)) {
      warnings.push({
        category: 'structure',
        code: 'IMAGE_COUNT_LOW',
        message: `Image count (${metrics.imageCount}) is below recommended (${this.config.minImageCount || 1})`,
        suggestion: 'Add relevant images to improve engagement',
      })

      if (metrics.imageCount === 0) {
        errors.push({
          category: 'structure',
          code: 'NO_IMAGES',
          message: 'No images found in content',
          value: 0,
        })
      }
    }

    // Images sans alt
    if (this.config.imageAltRequired && metrics.imageCount > 0) {
      const missingAlt = metrics.imageCount - metrics.imagesWithAlt
      if (missingAlt > 0) {
        errors.push({
          category: 'seo',
          code: 'IMAGES_MISSING_ALT',
          message: `${missingAlt} image(s) are missing alt text`,
          value: missingAlt,
        })
      }
    }

    // Liens internes
    if (metrics.internalLinkCount < (this.config.minInternalLinks || 1)) {
      warnings.push({
        category: 'structure',
        code: 'INTERNAL_LINKS_LOW',
        message: `Internal link count (${metrics.internalLinkCount}) is below recommended (${this.config.minInternalLinks || 1})`,
        suggestion: 'Add internal links to related content',
      })
    }

    // Liens externes
    if (metrics.externalLinkCount < (this.config.minExternalLinks || 0)) {
      warnings.push({
        category: 'structure',
        code: 'EXTERNAL_LINKS_LOW',
        message: `External link count (${metrics.externalLinkCount}) is below minimum (${this.config.minExternalLinks || 0})`,
      })
    }
  }

  private validateReadability(
    metrics: ContentMetrics,
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[],
    suggestions: QualitySuggestion[]
  ): void {
    // Flesch Reading Ease
    if (this.config.checkReadability && metrics.fleschReadingEase !== undefined) {
      if (metrics.fleschReadingEase < 50) {
        errors.push({
          category: 'readability',
          code: 'READABILITY_DIFFICULT',
          message: `Readability score (${metrics.fleschReadingEase}) indicates difficult content`,
          value: metrics.fleschReadingEase,
          threshold: 50,
        })

        suggestions.push({
          category: 'readability',
          priority: 'high',
          title: 'Improve readability',
          description: 'Use shorter sentences and simpler words',
          impact: 'Better user experience and SEO',
        })
      } else if (metrics.fleschReadingEase < (this.config.minReadabilityScore || 60)) {
        warnings.push({
          category: 'readability',
          code: 'READABILITY_BELOW_RECOMMENDED',
          message: `Readability score (${metrics.fleschReadingEase}) is below recommended (${this.config.minReadabilityScore || 60})`,
          suggestion: 'Consider simplifying sentence structure',
        })
      }
    }

    // Average words per sentence (trop long = difficile)
    if (metrics.averageWordPerSentence > 25) {
      warnings.push({
        category: 'readability',
        code: 'SENTENCES_TOO_LONG',
        message: `Average sentence length (${metrics.averageWordPerSentence.toFixed(1)} words) is quite high`,
        suggestion: 'Break long sentences into shorter ones',
      })
    }

    // Average sentences per paragraph (trop long = lourd)
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
    // Titre
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
        suggestion: 'Keep title under 60 characters for SEO',
      })
    }

    // Contenu trop court
    if (metrics.wordCount < 100) {
      warnings.push({
        category: 'completeness',
        code: 'CONTENT_VERY_SHORT',
        message: `Content is very short (${metrics.wordCount} words)`,
        suggestion: 'Add more detailed information',
      })
    }

    // FAQ manquante (suggestion)
    const hasFaq = content.content.toLowerCase().includes('faq')
    if (!hasFaq && metrics.wordCount > 500) {
      suggestions.push({
        category: 'seo',
        priority: 'medium',
        title: 'Consider adding FAQ section',
        description: 'FAQ sections can improve SEO and answer user questions',
        impact: 'Better search visibility',
      })
    }
  }

  private calculateScore(
    metrics: ContentMetrics,
    errors: ContentQualityError[],
    warnings: ContentQualityWarning[]
  ): ContentQualityScore {
    // Score de structure (0-100)
    let structureScore = 100
    structureScore -= Math.max(0, (this.config.minWordCount || 300) - metrics.wordCount) / 10
    structureScore -= metrics.headingCount === 0 ? 30 : 0
    structureScore -= Math.max(0, 20 - metrics.imageCount) * 3
    structureScore -= Math.max(0, 10 - metrics.internalLinkCount) * 5

    // Score de lisibilité (0-100)
    let readabilityScore = 100
    if (metrics.fleschReadingEase !== undefined) {
      readabilityScore = metrics.fleschReadingEase
    }

    // Score de complétude (0-100)
    let completenessScore = 100
    completenessScore -= errors.filter(e => e.category === 'completeness').length * 20
    completenessScore -= warnings.filter(w => w.category === 'completeness').length * 10

    // Score SEO (0-100)
    let seoScore = 100
    seoScore -= errors.filter(e => e.category === 'seo').length * 25
    seoScore -= warnings.filter(w => w.category === 'seo').length * 10

    // Score global
    const overall = Math.round((structureScore + readabilityScore + completenessScore + seoScore) / 4)

    // Déterminer la note
    let grade: ContentQualityScore['grade']
    if (overall >= 90) grade = 'A'
    else if (overall >= 80) grade = 'B'
    else if (overall >= 70) grade = 'C'
    else if (overall >= 60) grade = 'D'
    else grade = 'F'

    return {
      overall: Math.max(0, Math.min(100, overall)),
      structure: Math.max(0, Math.min(100, Math.round(structureScore))),
      readability: Math.max(0, Math.min(100, Math.round(readabilityScore))),
      completeness: Math.max(0, Math.min(100, Math.round(completenessScore))),
      seo: Math.max(0, Math.min(100, Math.round(seoScore))),
      grade,
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createContentQualityValidator(
  config?: ContentQualityConfig
): ContentQualityValidator {
  return new ContentQualityValidator(config)
}
