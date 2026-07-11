// ─────────────────────────────────────────────────────────────────────────────
// SEO Validator
// SEO Engine - Validation Pipeline
// Validates SEO elements and recommendations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration de validation SEO
 */
export interface SeoValidationConfig {
  // Meta
  metaTitleMinLength?: number
  metaTitleMaxLength?: number
  metaDescMinLength?: number
  metaDescMaxLength?: number

  // Keywords
  keywordDensityMin?: number
  keywordDensityMax?: number
  keywordInTitle?: boolean
  keywordInFirstParagraph?: boolean
  keywordInHeadings?: boolean

  // Technical
  checkCanonical?: boolean
  checkRobots?: boolean
  checkSchema?: boolean

  // URL
  urlMaxLength?: number
  urlContainsKeyword?: boolean

  // Open Graph
  checkOpenGraph?: boolean
  ogImageRequired?: boolean
}

/**
 * Résultat de validation SEO
 */
export interface SeoValidationResult {
  isValid: boolean
  score: number
  errors: SeoValidationError[]
  warnings: SeoValidationWarning[]
  recommendations: SeoRecommendation[]
  metrics: SeoMetrics
}

/**
 * Erreur SEO
 */
export interface SeoValidationError {
  element: 'title' | 'description' | 'keyword' | 'url' | 'heading' | 'schema' | 'technical'
  code: string
  message: string
  impact: 'high' | 'medium' | 'low'
}

/**
 * Avertissement SEO
 */
export interface SeoValidationWarning {
  element: 'title' | 'description' | 'keyword' | 'url' | 'heading' | 'schema' | 'technical'
  code: string
  message: string
  suggestion?: string
}

/**
 * Recommandation SEO
 */
export interface SeoRecommendation {
  priority: 'high' | 'medium' | 'low'
  element: string
  title: string
  description: string
  action: string
  estimatedImpact: string
}

/**
 * Métriques SEO
 */
export interface SeoMetrics {
  keywordDensity: number
  keywordOccurrences: number
  titleKeywordPosition?: number
  firstParagraphKeywordPosition?: number
  headingKeywordCount: number
  internalLinksKeywordCount: number
  externalLinksKeywordCount: number
  schemaTypes: string[]
  hasOpenGraph: boolean
  hasTwitterCard: boolean
  hasCanonical: boolean
}

/**
 * Validateur SEO
 */
export class SeoValidator {
  private config: SeoValidationConfig

  constructor(config: SeoValidationConfig = {}) {
    this.config = {
      // Meta defaults
      metaTitleMinLength: 30,
      metaTitleMaxLength: 60,
      metaDescMinLength: 120,
      metaDescMaxLength: 160,

      // Keyword defaults
      keywordDensityMin: 0.5,
      keywordDensityMax: 3,
      keywordInTitle: true,
      keywordInFirstParagraph: true,
      keywordInHeadings: true,

      // Technical defaults
      checkSchema: true,
      checkOpenGraph: true,

      // URL defaults
      urlMaxLength: 75,
      urlContainsKeyword: true,
      ...config,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Valide les éléments SEO
   */
  validate(params: {
    title?: string
    metaTitle?: string
    metaDescription?: string
    content: string
    url?: string
    focusKeyword: string
    schemaMarkup?: string
    headings?: string[]
    internalLinks?: string[]
    externalLinks?: string[]
  }): SeoValidationResult {
    const errors: SeoValidationError[] = []
    const warnings: SeoValidationWarning[] = []
    const recommendations: SeoRecommendation[] = []

    // Parser le contenu
    const contentText = this.stripHtml(params.content)
    const headings = params.headings || this.extractHeadings(params.content)

    // Calculer les métriques
    const metrics = this.calculateMetrics(params, contentText, headings)

    // Valider le keyword
    this.validateKeyword(params.focusKeyword, contentText, headings, errors, warnings, recommendations, metrics)

    // Valider le title
    this.validateTitle(params.title, params.metaTitle, params.focusKeyword, errors, warnings, recommendations)

    // Valider la meta description
    this.validateMetaDescription(params.metaDescription, params.focusKeyword, errors, warnings, recommendations)

    // Valider l'URL
    if (params.url) {
      this.validateUrl(params.url, params.focusKeyword, errors, warnings, recommendations)
    }

    // Valider les headings
    this.validateHeadings(headings, params.focusKeyword, contentText, errors, warnings, recommendations)

    // Valider les liens
    this.validateLinks(params.internalLinks, params.externalLinks, contentText, errors, warnings)

    // Valider le schema.org
    if (this.config.checkSchema && params.schemaMarkup) {
      this.validateSchema(params.schemaMarkup, errors, warnings, recommendations)
    }

    // Valider Open Graph
    if (this.config.checkOpenGraph) {
      this.validateOpenGraph(params, errors, warnings, recommendations)
    }

    // Calculer le score
    const score = this.calculateScore(errors, warnings)

    const isValid = errors.filter(e => e.impact === 'high').length === 0

    return {
      isValid,
      score,
      errors,
      warnings,
      recommendations,
      metrics,
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractHeadings(html: string): string[] {
    const headings: string[] = []
    const regex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi
    let match
    while ((match = regex.exec(html)) !== null) {
      headings.push(match[1].replace(/<[^>]+>/g, '').trim())
    }
    return headings
  }

  private calculateMetrics(
    params: { focusKeyword: string; content: string; headings?: string[] },
    contentText: string,
    headings: string[]
  ): SeoMetrics {
    const keyword = params.focusKeyword.toLowerCase()
    const contentLower = contentText.toLowerCase()
    const keywordWords = keyword.split(/\s+/)

    // Keyword density
    const words = contentText.split(/\s+/).filter(w => w.length > 0)
    let keywordOccurrences = 0

    for (let i = 0; i <= words.length - keywordWords.length; i++) {
      const phrase = words.slice(i, i + keywordWords.length).join(' ').toLowerCase()
      if (phrase === keyword) {
        keywordOccurrences++
      }
    }

    const keywordDensity = words.length > 0 ? (keywordOccurrences * keywordWords.length / words.length) * 100 : 0

    // Keyword position in title
    const titleKeywordPosition = params.headings?.[0]?.toLowerCase().includes(keyword) ? 0 : undefined

    // Keyword in first paragraph (approx)
    const firstParagraph = contentText.slice(0, 300).toLowerCase()
    const firstParagraphKeywordPosition = firstParagraph.includes(keyword) ? 0 : undefined

    // Heading keyword count
    const headingKeywordCount = headings.filter(h => h.toLowerCase().includes(keyword)).length

    // Extract schema types
    const schemaTypes: string[] = []
    if (params.content) {
      const schemaMatch = params.content.match(/@type["\s]*:["\s]*["']?([^"'}\s]+)/gi)
      if (schemaMatch) {
        schemaMatch.forEach(s => {
          const type = s.replace(/@type["\s]*:["\s]*["']?/, '')
          if (type) schemaTypes.push(type)
        })
      }
    }

    // Check Open Graph
    const hasOpenGraph = params.content?.includes('og:title') || params.content?.includes('og:description')
    const hasTwitterCard = params.content?.includes('twitter:card')
    const hasCanonical = params.content?.includes('canonical')

    return {
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      keywordOccurrences,
      titleKeywordPosition,
      firstParagraphKeywordPosition,
      headingKeywordCount,
      internalLinksKeywordCount: 0,
      externalLinksKeywordCount: 0,
      schemaTypes: [...new Set(schemaTypes)],
      hasOpenGraph: !!hasOpenGraph,
      hasTwitterCard: !!hasTwitterCard,
      hasCanonical: !!hasCanonical,
    }
  }

  private validateKeyword(
    keyword: string,
    contentText: string,
    headings: string[],
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[],
    metrics: SeoMetrics
  ): void {
    const contentLower = contentText.toLowerCase()
    const keywordLower = keyword.toLowerCase()

    // Keyword absent
    if (!contentLower.includes(keywordLower)) {
      errors.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_FOUND',
        message: `Focus keyword "${keyword}" not found in content`,
        impact: 'high',
      })
    }

    // Keyword density trop bas
    if (metrics.keywordDensity < (this.config.keywordDensityMin || 0.5)) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_DENSITY_LOW',
        message: `Keyword density (${metrics.keywordDensity.toFixed(2)}%) is below minimum (${this.config.keywordDensityMin}%)`,
        suggestion: `Use the focus keyword "${keyword}" more times in the content`,
      })
    }

    // Keyword density trop haut
    if (metrics.keywordDensity > (this.config.keywordDensityMax || 3)) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_DENSITY_HIGH',
        message: `Keyword density (${metrics.keywordDensity.toFixed(2)}%) exceeds maximum (${this.config.keywordDensityMax}%)`,
        suggestion: `Reduce usage of "${keyword}" to avoid keyword stuffing`,
      })
    }

    // Keyword pas dans le title
    if (this.config.keywordInTitle && headings.length > 0 && !headings[0].toLowerCase().includes(keywordLower)) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_IN_TITLE',
        message: `Focus keyword "${keyword}" not found in title/H1`,
        suggestion: 'Include the focus keyword in the main title',
      })
    }

    // Keyword pas dans le premier paragraphe
    if (this.config.keywordInFirstParagraph && contentText.length > 0) {
      const firstParText = contentText.slice(0, 500).toLowerCase()
      if (!firstParText.includes(keywordLower)) {
        warnings.push({
          element: 'keyword',
          code: 'KEYWORD_NOT_IN_FIRST_PAR',
          message: `Focus keyword "${keyword}" not found in first 500 characters`,
          suggestion: 'Include the focus keyword early in the content',
        })
      }
    }

    // Keyword pas dans les headings
    if (this.config.keywordInHeadings && metrics.headingKeywordCount === 0) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_IN_HEADINGS',
        message: `Focus keyword "${keyword}" not found in any heading`,
        suggestion: 'Include the focus keyword in at least one heading',
      })
    }
  }

  private validateTitle(
    title: string | undefined,
    metaTitle: string | undefined,
    keyword: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    const titleToCheck = metaTitle || title || ''
    const titleLength = titleToCheck.length

    // Title manquant
    if (!titleToCheck) {
      errors.push({
        element: 'title',
        code: 'TITLE_MISSING',
        message: 'Title is missing',
        impact: 'high',
      })
      return
    }

    // Title trop court
    if (titleLength < (this.config.metaTitleMinLength || 30)) {
      warnings.push({
        element: 'title',
        code: 'TITLE_TOO_SHORT',
        message: `Title (${titleLength} chars) is shorter than recommended (${this.config.metaTitleMinLength} chars)`,
        suggestion: 'Expand the title with more descriptive terms',
      })
    }

    // Title trop long
    if (titleLength > (this.config.metaTitleMaxLength || 60)) {
      errors.push({
        element: 'title',
        code: 'TITLE_TOO_LONG',
        message: `Title (${titleLength} chars) exceeds recommended length (${this.config.metaTitleMaxLength} chars)`,
        impact: 'high',
      })
    }

    // Keyword pas dans le title
    if (keyword && !titleToCheck.toLowerCase().includes(keyword.toLowerCase())) {
      warnings.push({
        element: 'title',
        code: 'KEYWORD_NOT_IN_TITLE',
        message: `Focus keyword "${keyword}" not found in title`,
        suggestion: 'Include the focus keyword in the title',
      })
    }

    // Recommandations
    if (titleLength < 50) {
      recommendations.push({
        priority: 'low',
        element: 'title',
        title: 'Expand title for better CTR',
        description: 'Longer titles (50-60 chars) typically have higher CTR',
        action: 'Add more descriptive terms to the title',
        estimatedImpact: '+5-10% CTR',
      })
    }
  }

  private validateMetaDescription(
    metaDescription: string | undefined,
    keyword: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    if (!metaDescription) {
      warnings.push({
        element: 'description',
        code: 'DESCRIPTION_MISSING',
        message: 'Meta description is missing',
        suggestion: 'Add a compelling meta description',
      })
      return
    }

    const descLength = metaDescription.length

    // Trop courte
    if (descLength < (this.config.metaDescMinLength || 120)) {
      warnings.push({
        element: 'description',
        code: 'DESCRIPTION_TOO_SHORT',
        message: `Meta description (${descLength} chars) is shorter than recommended (${this.config.metaDescMinLength} chars)`,
        suggestion: 'Expand the description to 150-160 characters',
      })
    }

    // Trop longue
    if (descLength > (this.config.metaDescMaxLength || 160)) {
      errors.push({
        element: 'description',
        code: 'DESCRIPTION_TOO_LONG',
        message: `Meta description (${descLength} chars) exceeds recommended length (${this.config.metaDescMaxLength} chars)`,
        impact: 'medium',
      })
    }

    // Keyword pas dans la description
    if (keyword && !metaDescription.toLowerCase().includes(keyword.toLowerCase())) {
      warnings.push({
        element: 'description',
        code: 'KEYWORD_NOT_IN_DESCRIPTION',
        message: `Focus keyword "${keyword}" not found in meta description`,
        suggestion: 'Include the focus keyword in the meta description',
      })
    }
  }

  private validateUrl(
    url: string,
    keyword: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    const path = (url || '').split('/').pop() || ''
    const urlLength = path.length

    // URL trop longue
    if (urlLength > (this.config.urlMaxLength || 75)) {
      warnings.push({
        element: 'url',
        code: 'URL_TOO_LONG',
        message: `URL slug (${urlLength} chars) is quite long`,
        suggestion: 'Keep URLs short and descriptive',
      })
    }

    // Keyword pas dans l'URL
    if (this.config.urlContainsKeyword && keyword && !path.toLowerCase().includes(keyword.toLowerCase())) {
      warnings.push({
        element: 'url',
        code: 'KEYWORD_NOT_IN_URL',
        message: `Focus keyword "${keyword}" not found in URL`,
        suggestion: 'Include the focus keyword in the URL slug',
      })
    }

    // Mauvais caractères dans l'URL
    if (/[^a-z0-9-]/i.test(path)) {
      warnings.push({
        element: 'url',
        code: 'URL_SPECIAL_CHARS',
        message: 'URL contains special characters',
        suggestion: 'Use only lowercase letters, numbers, and hyphens',
      })
    }
  }

  private validateHeadings(
    headings: string[] | undefined,
    keyword: string | undefined,
    contentText: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    const headingsList = headings || []

    // Pas de H2
    const hasH2 = headingsList.some(h => h.toLowerCase().startsWith('h2'))
    if (headingsList.length > 0 && !hasH2) {
      warnings.push({
        element: 'heading',
        code: 'NO_H2',
        message: 'No H2 headings found',
        suggestion: 'Use H2 headings to structure your content',
      })
    }

    // Keyword pas dans les headings
    if (keyword) {
      const keywordInHeadings = headingsList.filter(h => h.toLowerCase().includes(keyword.toLowerCase())).length
      if (headingsList.length > 0 && keywordInHeadings === 0) {
        warnings.push({
          element: 'heading',
          code: 'KEYWORD_NOT_IN_HEADINGS',
          message: `Focus keyword "${keyword}" not found in any heading`,
          suggestion: 'Include the focus keyword in at least one heading',
        })
      }
    }

    // Nombre de headings (heuristique)
    if (headingsList.length > 15) {
      warnings.push({
        element: 'heading',
        code: 'TOO_MANY_HEADINGS',
        message: `Content has ${headingsList.length} headings, which may be excessive`,
        suggestion: 'Consider consolidating some sections',
      })
    }
  }

  private validateLinks(
    internalLinks: string[] | undefined,
    externalLinks: string[] | undefined,
    contentText: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[]
  ): void {
    // Pas de liens internes
    if (internalLinks && internalLinks.length === 0) {
      warnings.push({
        element: 'technical',
        code: 'NO_INTERNAL_LINKS',
        message: 'No internal links found',
        suggestion: 'Add links to related content on your site',
      })
    }

    // Pas de liens externes
    if (externalLinks && externalLinks.length === 0) {
      warnings.push({
        element: 'technical',
        code: 'NO_EXTERNAL_LINKS',
        message: 'No external links found',
        suggestion: 'Consider adding links to authoritative external sources',
      })
    }
  }

  private validateSchema(
    schemaMarkup: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    // Vérifier si le JSON-LD est valide
    try {
      const scripts = (schemaMarkup || '').match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
      let validSchemas = 0
      const schemaTypes: string[] = []

      for (const script of scripts) {
        const jsonMatch = script.match(/>([\s\S]*)<\/script>/)
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1])
            validSchemas++
            if (data['@type']) {
              schemaTypes.push(data['@type'])
            }
          } catch {
            errors.push({
              element: 'schema',
              code: 'INVALID_JSON_LD',
              message: 'Invalid JSON-LD schema found',
              impact: 'medium',
            })
          }
        }
      }

      if (validSchemas === 0) {
        warnings.push({
          element: 'schema',
          code: 'NO_SCHEMA',
          message: 'No structured data (JSON-LD) found',
          suggestion: 'Add structured data for rich snippets',
        })

        recommendations.push({
          priority: 'medium',
          element: 'schema',
          title: 'Add structured data',
          description: 'Structured data helps search engines understand your content',
          action: 'Add JSON-LD schema markup (Article, FAQPage, LocalBusiness, etc.)',
          estimatedImpact: 'Rich snippets in search results',
        })
      }

      // Types de schema recommandés
      if (!schemaTypes.includes('Article') && !schemaTypes.includes('WebPage')) {
        recommendations.push({
          priority: 'low',
          element: 'schema',
          title: 'Add Article schema',
          description: 'Article schema can improve appearance in search results',
          action: 'Add @type: Article structured data',
          estimatedImpact: 'Better rich snippets',
        })
      }
    } catch {
      errors.push({
        element: 'schema',
        code: 'SCHEMA_PARSE_ERROR',
        message: 'Failed to parse schema markup',
        impact: 'medium',
      })
    }
  }

  private validateOpenGraph(
    params: { content?: string },
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[]
  ): void {
    if (!params.content) return

    const content = params.content

    // og:title manquant
    if (!content.includes('og:title')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_TITLE',
        message: 'Open Graph title (og:title) not found',
        suggestion: 'Add og:title meta tag for social sharing',
      })
    }

    // og:description manquant
    if (!content.includes('og:description')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_DESCRIPTION',
        message: 'Open Graph description (og:description) not found',
        suggestion: 'Add og:description meta tag for social sharing',
      })
    }

    // og:image manquant
    if (!content.includes('og:image')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_IMAGE',
        message: 'Open Graph image (og:image) not found',
        suggestion: 'Add og:image for better social sharing',
      })
    }

    // Twitter card manquant
    if (!content.includes('twitter:card')) {
      warnings.push({
        element: 'technical',
        code: 'NO_TWITTER_CARD',
        message: 'Twitter Card meta tags not found',
        suggestion: 'Add twitter:card for Twitter sharing',
      })
    }
  }

  private calculateScore(
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[]
  ): number {
    // Score de base
    let score = 100

    // Déduire pour les erreurs
    for (const error of errors) {
      switch (error.impact) {
        case 'high':
          score -= 20
          break
        case 'medium':
          score -= 10
          break
        case 'low':
          score -= 5
          break
      }
    }

    // Déduire pour les avertissements
    score -= warnings.length * 2

    return Math.max(0, Math.min(100, score))
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSeoValidator(config?: SeoValidationConfig): SeoValidator {
  return new SeoValidator(config)
}
