// ─────────────────────────────────────────────────────────────────────────────
// SEO Validator
// SEO Engine - Validation Pipeline
// Validates SEO elements and recommendations
// ─────────────────────────────────────────────────────────────────────────────

import { JsonLdValidator } from './JsonLdValidator'
import {
  containsKeywordPhrase,
  countKeywordOccurrences,
  estimatePixelWidth,
  extractHeadingOutline,
  keywordTokenCoverage,
  keywordTokens,
  normalizeForMatch,
  stripHtmlToText,
  type HeadingNode,
} from './text-utils'

/**
 * SEVERITY POLICY — only `impact: 'high'` errors block publication
 * (`isValid` ignores medium and low). What blocks here:
 *   - the title is missing;
 *   - the JSON-LD embedded in the page is malformed or structurally invalid;
 *   - the page is off-topic (almost none of the focus-keyword terms appear).
 * Everything else — lengths, keyword placement, Open Graph, external links —
 * warns.
 */

/**
 * Configuration de validation SEO
 */
export interface SeoValidationConfig {
  // Meta
  metaTitleMinLength?: number
  /** Soft character budget (~600 SERP pixels). Exceeding it warns. */
  metaTitleMaxLength?: number
  /** Pixel budget Google actually enforces on desktop. Default 600. */
  metaTitleMaxPixels?: number
  /** Absurd length above which we raise a (non-blocking) error. Default 90. */
  metaTitleHardMaxLength?: number
  metaDescMinLength?: number
  metaDescMaxLength?: number

  // Keywords
  /**
   * @deprecated Minimum keyword density is an obsolete criterion: it rewards
   * repeating the exact phrase, which is keyword stuffing. Kept in the type for
   * backward compatibility; the validator ignores it.
   */
  keywordDensityMin?: number
  /** Stuffing ceiling, in percent. Default 5 — a real spam signal, not 3. */
  keywordDensityMax?: number
  keywordInTitle?: boolean
  keywordInFirstParagraph?: boolean
  keywordInHeadings?: boolean
  /** Token coverage below which the page is considered off-topic. Default 0.5. */
  keywordMinCoverage?: number

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
  // ─── Added in wave 2 (optional: purely additive) ───
  /** Share of the focus-keyword tokens present in the body, 0 → 1. */
  keywordCoverage?: number
  /** Estimated SERP width of the title in pixels (Arial 20px). */
  titlePixelWidth?: number
  h1Count?: number
  h2Count?: number
  headingLevelSkips?: number
}

/** Open Graph / Twitter data, when the caller knows it out of band. */
export interface SocialMetaInput {
  title?: string
  description?: string
  image?: string
  twitterCard?: string
  twitterTitle?: string
  twitterDescription?: string
}

export interface SeoValidationInput {
  title?: string
  metaTitle?: string
  metaDescription?: string
  content: string
  url?: string
  focusKeyword: string
  schemaMarkup?: string
  /** Heading texts. Kept for backward compatibility. */
  headings?: string[]
  /** Heading texts WITH their level. Preferred: levels cannot be inferred from text. */
  headingOutline?: HeadingNode[]
  internalLinks?: string[]
  externalLinks?: string[]
  /** JSON-LD payloads keyed by slot, e.g. `{ localBusiness, faqPage, breadcrumb }`. */
  schemas?: Record<string, string | object | null | undefined>
  /** Social metadata, when it lives outside the HTML body. */
  social?: SocialMetaInput
}

/**
 * Validateur SEO
 */
export class SeoValidator {
  private config: SeoValidationConfig
  private jsonLdValidator: JsonLdValidator

  constructor(config: SeoValidationConfig = {}) {
    this.config = {
      // Meta defaults
      metaTitleMinLength: 30,
      metaTitleMaxLength: 60,
      metaTitleMaxPixels: 600,
      metaTitleHardMaxLength: 90,
      metaDescMinLength: 120,
      metaDescMaxLength: 160,

      // Keyword defaults
      keywordDensityMax: 5,
      keywordInTitle: true,
      keywordInFirstParagraph: true,
      keywordInHeadings: true,
      keywordMinCoverage: 0.5,

      // Technical defaults
      checkSchema: true,
      checkOpenGraph: true,

      // URL defaults
      urlMaxLength: 90,
      urlContainsKeyword: true,
      ...config,
    }

    this.jsonLdValidator = new JsonLdValidator()
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Valide les éléments SEO
   */
  validate(params: SeoValidationInput): SeoValidationResult {
    const errors: SeoValidationError[] = []
    const warnings: SeoValidationWarning[] = []
    const recommendations: SeoRecommendation[] = []

    const contentText = stripHtmlToText(params.content)
    const outline = params.headingOutline ?? extractHeadingOutline(params.content)
    const headings = params.headings ?? outline.map(h => h.text)

    const metrics = this.calculateMetrics(params, contentText, headings, outline)

    this.validateKeyword(params.focusKeyword, contentText, headings, errors, warnings, metrics)
    this.validateTitle(params.title, params.metaTitle, params.focusKeyword, errors, warnings, recommendations, metrics)
    this.validateMetaDescription(params.metaDescription, params.focusKeyword, warnings)

    if (params.url) {
      this.validateUrl(params.url, params.focusKeyword, warnings)
    }

    this.validateHeadings(outline, headings, params.focusKeyword, warnings)
    this.validateLinks(params.internalLinks, params.externalLinks, warnings)

    if (this.config.checkSchema) {
      this.validateSchema(params, errors, warnings, recommendations, metrics)
    }

    if (this.config.checkOpenGraph) {
      this.validateOpenGraph(params, warnings, metrics)
    }

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

  private calculateMetrics(
    params: SeoValidationInput,
    contentText: string,
    headings: string[],
    outline: HeadingNode[]
  ): SeoMetrics {
    const keyword = params.focusKeyword
    const words = normalizeForMatch(contentText).split(' ').filter(Boolean)
    const keywordOccurrences = countKeywordOccurrences(contentText, keyword)
    const tokenCount = keywordTokens(keyword).length || 1

    const keywordDensity = words.length > 0
      ? (keywordOccurrences * tokenCount / words.length) * 100
      : 0

    const titleText = params.metaTitle || params.title || ''
    const firstParagraph = contentText.slice(0, 500)

    const social = params.social
    const hasOpenGraph = Boolean(social?.title || social?.description) ||
      /property\s*=\s*["']og:(?:title|description)["']/i.test(params.content || '')
    const hasTwitterCard = Boolean(social?.twitterCard || social?.twitterTitle) ||
      /name\s*=\s*["']twitter:card["']/i.test(params.content || '')
    const hasCanonical = /rel\s*=\s*["']canonical["']/i.test(params.content || '')

    const schemaTypes = this.collectSchemaTypes(params)

    return {
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      keywordOccurrences,
      titleKeywordPosition: containsKeywordPhrase(titleText, keyword) ? 0 : undefined,
      firstParagraphKeywordPosition: containsKeywordPhrase(firstParagraph, keyword) ? 0 : undefined,
      headingKeywordCount: headings.filter(h => containsKeywordPhrase(h, keyword)).length,
      internalLinksKeywordCount: (params.internalLinks || []).filter(l => containsKeywordPhrase(l, keyword)).length,
      externalLinksKeywordCount: 0,
      schemaTypes,
      hasOpenGraph,
      hasTwitterCard,
      hasCanonical,
      keywordCoverage: keywordTokenCoverage(contentText, keyword),
      titlePixelWidth: estimatePixelWidth(titleText),
      h1Count: outline.filter(h => h.level === 1).length,
      h2Count: outline.filter(h => h.level === 2).length,
      headingLevelSkips: countHeadingLevelSkips(outline),
    }
  }

  /** Gathers the @type of every JSON-LD payload the caller handed over. */
  private collectSchemaTypes(params: SeoValidationInput): string[] {
    const types = new Set<string>()

    const collect = (payload: string | object | null | undefined) => {
      const result = this.jsonLdValidator.validate(payload, { label: 'schema' })
      for (const type of result.types) types.add(type)
    }

    if (params.schemas) {
      for (const payload of Object.values(params.schemas)) collect(payload)
    }
    if (params.schemaMarkup) collect(params.schemaMarkup)
    if (params.content && /application\/ld\+json/i.test(params.content)) collect(params.content)

    return [...types]
  }

  private validateKeyword(
    keyword: string,
    contentText: string,
    headings: string[],
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    metrics: SeoMetrics
  ): void {
    const coverage = metrics.keywordCoverage ?? 1
    const minCoverage = this.config.keywordMinCoverage ?? 0.5

    // Off-topic page: blocking. Note this is TOKEN coverage, not exact-phrase
    // matching. "plomberie Troyes" legitimately reads "plomberie à Troyes" in a
    // real French sentence, and the old exact-string test rejected it.
    if (coverage < minCoverage) {
      errors.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_FOUND',
        message: `Focus keyword "${keyword}" is largely absent from the content (${Math.round(coverage * 100)}% of its terms found)`,
        impact: 'high',
      })
    } else if (!containsKeywordPhrase(contentText, keyword)) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_PHRASE_NOT_EXACT',
        message: `Focus keyword "${keyword}" never appears as an exact phrase (its terms do)`,
        suggestion: 'Use the exact phrase at least once, where it reads naturally',
      })
    }

    // Keyword STUFFING only. There is deliberately no minimum-density rule:
    // Google has not used keyword density as a ranking factor for over a decade,
    // and a minimum threshold actively pushes the generator to repeat itself.
    const stuffingCeiling = this.config.keywordDensityMax ?? 5
    if (metrics.keywordDensity > stuffingCeiling) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_DENSITY_HIGH',
        message: `Keyword density (${metrics.keywordDensity.toFixed(2)}%) suggests keyword stuffing (ceiling ${stuffingCeiling}%)`,
        suggestion: `Replace some occurrences of "${keyword}" with semantic variants`,
      })
    }

    if (this.config.keywordInFirstParagraph && metrics.firstParagraphKeywordPosition === undefined) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_IN_FIRST_PAR',
        message: `Focus keyword "${keyword}" not found in the first 500 characters`,
        suggestion: 'Include the focus keyword early in the content',
      })
    }

    if (this.config.keywordInHeadings && headings.length > 0 && metrics.headingKeywordCount === 0) {
      warnings.push({
        element: 'keyword',
        code: 'KEYWORD_NOT_IN_HEADINGS',
        message: `Focus keyword "${keyword}" not found in any heading`,
        suggestion: 'Include the focus keyword in at least one heading',
      })
    }
  }

  /**
   * Title length.
   *
   * Google truncates on PIXEL width (~600px desktop), not on a character count,
   * so both are measured and neither blocks. The generator is instructed to
   * produce titles of "max 65 chars": erroring at 60 — as this validator used to
   * do, with `impact: 'high'` — would have rejected titles the engine was
   * explicitly told to write.
   */
  private validateTitle(
    title: string | undefined,
    metaTitle: string | undefined,
    keyword: string | undefined,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[],
    metrics: SeoMetrics
  ): void {
    const titleToCheck = metaTitle || title || ''
    const titleLength = titleToCheck.length

    if (!titleToCheck) {
      errors.push({
        element: 'title',
        code: 'TITLE_MISSING',
        message: 'Title is missing',
        impact: 'high',
      })
      return
    }

    if (titleLength < (this.config.metaTitleMinLength ?? 30)) {
      warnings.push({
        element: 'title',
        code: 'TITLE_TOO_SHORT',
        message: `Title (${titleLength} chars) is shorter than recommended (${this.config.metaTitleMinLength} chars)`,
        suggestion: 'Expand the title with more descriptive terms',
      })
    }

    const pixelBudget = this.config.metaTitleMaxPixels ?? 600
    const pixelWidth = metrics.titlePixelWidth ?? estimatePixelWidth(titleToCheck)
    const charBudget = this.config.metaTitleMaxLength ?? 60

    if (pixelWidth > pixelBudget || titleLength > charBudget) {
      warnings.push({
        element: 'title',
        code: 'TITLE_TOO_LONG',
        message: `Title (${titleLength} chars, ~${pixelWidth}px) exceeds the SERP budget (${charBudget} chars / ${pixelBudget}px) and will be truncated`,
        suggestion: 'Front-load the important words so the truncation costs nothing',
      })
    }

    // Truncation is a CTR problem, never a ranking one: a long title never
    // blocks. It is only reported as an error once it is plainly a defect.
    const hardMax = this.config.metaTitleHardMaxLength ?? 90
    if (titleLength > hardMax) {
      errors.push({
        element: 'title',
        code: 'TITLE_EXCESSIVELY_LONG',
        message: `Title (${titleLength} chars) is far beyond any usable length (${hardMax} chars)`,
        impact: 'medium',
      })
    }

    if (keyword && !containsKeywordPhrase(titleToCheck, keyword)) {
      warnings.push({
        element: 'title',
        code: 'KEYWORD_NOT_IN_TITLE',
        message: `Focus keyword "${keyword}" not found in title`,
        suggestion: 'Include the focus keyword in the title',
      })
    }

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

  /**
   * Meta description: 155-160 characters is the usable budget. Google rewrites
   * descriptions on the majority of queries anyway, so nothing here blocks.
   */
  private validateMetaDescription(
    metaDescription: string | undefined,
    keyword: string | undefined,
    warnings: SeoValidationWarning[]
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

    if (descLength < (this.config.metaDescMinLength ?? 120)) {
      warnings.push({
        element: 'description',
        code: 'DESCRIPTION_TOO_SHORT',
        message: `Meta description (${descLength} chars) is shorter than recommended (${this.config.metaDescMinLength} chars)`,
        suggestion: 'Expand the description to 150-160 characters',
      })
    }

    if (descLength > (this.config.metaDescMaxLength ?? 160)) {
      warnings.push({
        element: 'description',
        code: 'DESCRIPTION_TOO_LONG',
        message: `Meta description (${descLength} chars) exceeds the usable length (${this.config.metaDescMaxLength} chars) and will be truncated`,
        suggestion: 'Put the value proposition in the first 155 characters',
      })
    }

    if (keyword && !containsKeywordPhrase(metaDescription, keyword)) {
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
    warnings: SeoValidationWarning[]
  ): void {
    const path = (url || '').replace(/\/+$/, '').split('/').pop() || ''
    const urlLength = path.length

    if (urlLength > (this.config.urlMaxLength ?? 90)) {
      warnings.push({
        element: 'url',
        code: 'URL_TOO_LONG',
        message: `URL slug (${urlLength} chars) is quite long`,
        suggestion: 'Keep URLs short and descriptive',
      })
    }

    // The keyword is a phrase ("plombier Troyes"), the slug is hyphenated:
    // comparing them raw guaranteed a false warning on every single page.
    if (this.config.urlContainsKeyword && keyword) {
      const slugWords = normalizeForMatch(path.replace(/-/g, ' ')).split(' ').filter(Boolean)
      const missing = keywordTokens(keyword).filter(token => !slugWords.includes(token))
      if (missing.length > 0) {
        warnings.push({
          element: 'url',
          code: 'KEYWORD_NOT_IN_URL',
          message: `Focus keyword terms missing from URL slug: ${missing.join(', ')}`,
          suggestion: 'Include the focus keyword in the URL slug',
        })
      }
    }

    if (path && /[^a-z0-9-]/.test(path)) {
      warnings.push({
        element: 'url',
        code: 'URL_SPECIAL_CHARS',
        message: 'URL contains uppercase letters or special characters',
        suggestion: 'Use only lowercase letters, numbers, and hyphens',
      })
    }
  }

  /**
   * Heading hierarchy.
   *
   * The previous implementation tested `headingText.startsWith('h2')` on the
   * TEXT of each heading, which is never true — so it reported "no H2" on every
   * page that had H2s. Levels now come from the outline.
   */
  private validateHeadings(
    outline: HeadingNode[],
    headings: string[],
    keyword: string | undefined,
    warnings: SeoValidationWarning[]
  ): void {
    if (outline.length === 0) {
      if (headings.length === 0) {
        warnings.push({
          element: 'heading',
          code: 'NO_HEADINGS',
          message: 'No headings found in the content',
          suggestion: 'Structure the content with H2 sections',
        })
      }
      return
    }

    const h1Count = outline.filter(h => h.level === 1).length
    const h2Count = outline.filter(h => h.level === 2).length

    if (h1Count === 0) {
      warnings.push({
        element: 'heading',
        code: 'NO_H1',
        message: 'No H1 heading found',
        suggestion: 'Give the page exactly one H1 carrying its subject',
      })
    } else if (h1Count > 1) {
      warnings.push({
        element: 'heading',
        code: 'MULTIPLE_H1',
        message: `Content has ${h1Count} H1 headings, expected exactly one`,
        suggestion: 'Demote the extra H1 headings to H2',
      })
    }

    if (h2Count === 0) {
      warnings.push({
        element: 'heading',
        code: 'NO_H2',
        message: 'No H2 headings found',
        suggestion: 'Use H2 headings to structure your content',
      })
    }

    const skips = countHeadingLevelSkips(outline)
    if (skips > 0) {
      warnings.push({
        element: 'heading',
        code: 'HEADING_LEVEL_SKIP',
        message: `Heading hierarchy skips a level ${skips} time(s)`,
        suggestion: 'Keep the outline contiguous: H1 → H2 → H3',
      })
    }

    if (keyword) {
      const inHeadings = outline.filter(h => containsKeywordPhrase(h.text, keyword)).length
      if (inHeadings === 0) {
        warnings.push({
          element: 'heading',
          code: 'KEYWORD_NOT_IN_HEADINGS',
          message: `Focus keyword "${keyword}" not found in any heading`,
          suggestion: 'Include the focus keyword in at least one heading',
        })
      }
    }

    if (outline.length > 20) {
      warnings.push({
        element: 'heading',
        code: 'TOO_MANY_HEADINGS',
        message: `Content has ${outline.length} headings, which may be excessive`,
        suggestion: 'Consider consolidating some sections',
      })
    }
  }

  private validateLinks(
    internalLinks: string[] | undefined,
    externalLinks: string[] | undefined,
    warnings: SeoValidationWarning[]
  ): void {
    if (internalLinks && internalLinks.length === 0) {
      warnings.push({
        element: 'technical',
        code: 'NO_INTERNAL_LINKS',
        message: 'No internal links found',
        suggestion: 'Add links to related content on your site',
      })
    }

    if (externalLinks && externalLinks.length === 0) {
      warnings.push({
        element: 'technical',
        code: 'NO_EXTERNAL_LINKS',
        message: 'No external links found',
        suggestion: 'Consider adding links to authoritative external sources',
      })
    }
  }

  /**
   * Structured data.
   *
   * A malformed JSON-LD is BLOCKING (`impact: 'high'`): the page ships a broken
   * script tag, Google drops the markup entirely, and RankMath stores garbage in
   * post meta. It used to be `impact: 'medium'`, i.e. invisible to the gate.
   */
  private validateSchema(
    params: SeoValidationInput,
    errors: SeoValidationError[],
    warnings: SeoValidationWarning[],
    recommendations: SeoRecommendation[],
    metrics: SeoMetrics
  ): void {
    const payloads: Record<string, string | object | null | undefined> = {}

    if (params.schemas) {
      for (const [key, value] of Object.entries(params.schemas)) payloads[key] = value
    }
    if (params.schemaMarkup) payloads.schemaMarkup = params.schemaMarkup
    if (params.content && /application\/ld\+json/i.test(params.content)) {
      payloads.inlineContent = params.content
    }

    if (Object.keys(payloads).length === 0) {
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
        action: 'Add JSON-LD schema markup (LocalBusiness, BreadcrumbList, ...)',
        estimatedImpact: 'Rich snippets in search results',
      })
      return
    }

    const result = this.jsonLdValidator.validateAll(payloads)

    if (!result.isPresent) {
      warnings.push({
        element: 'schema',
        code: 'NO_SCHEMA',
        message: 'Structured data slots are present but empty',
        suggestion: 'Emit at least LocalBusiness and BreadcrumbList JSON-LD',
      })
      return
    }

    for (const issue of result.errors) {
      errors.push({
        element: 'schema',
        code: issue.code === 'MALFORMED_JSON' ? 'INVALID_JSON_LD' : `SCHEMA_${issue.code}`,
        message: `${issue.node}: ${issue.message}`,
        impact: 'high',
      })
    }

    for (const issue of [...result.warnings, ...result.infos]) {
      warnings.push({
        element: 'schema',
        code: `SCHEMA_${issue.code}`,
        message: `${issue.node}: ${issue.message}`,
      })
    }

    if (metrics.schemaTypes.length === 0) {
      metrics.schemaTypes.push(...result.types)
    }
  }

  /**
   * Open Graph.
   *
   * Only evaluated when the caller supplies social metadata or when the payload
   * genuinely contains `<meta>` tags. The previous version searched for
   * "og:title" inside the ARTICLE BODY — which never contains meta tags — and so
   * emitted four permanent false warnings on every page ever validated.
   */
  private validateOpenGraph(
    params: SeoValidationInput,
    warnings: SeoValidationWarning[],
    metrics: SeoMetrics
  ): void {
    const social = params.social
    const hasMetaTags = /<meta\b/i.test(params.content || '')

    if (!social && !hasMetaTags) return

    const content = params.content || ''
    const has = (key: string) => new RegExp(`["'](?:og|twitter):${key}["']`, 'i').test(content)

    if (!social?.title && !has('title')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_TITLE',
        message: 'Open Graph title (og:title) not found',
        suggestion: 'Add og:title meta tag for social sharing',
      })
    }

    if (!social?.description && !has('description')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_DESCRIPTION',
        message: 'Open Graph description (og:description) not found',
        suggestion: 'Add og:description meta tag for social sharing',
      })
    }

    if (!social?.image && !has('image')) {
      warnings.push({
        element: 'technical',
        code: 'NO_OG_IMAGE',
        message: 'Open Graph image (og:image) not found',
        suggestion: 'Add og:image for better social sharing',
      })
    }

    if (!metrics.hasTwitterCard) {
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
    let score = 100

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

    score -= warnings.length * 2

    return Math.max(0, Math.min(100, score))
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

export function createSeoValidator(config?: SeoValidationConfig): SeoValidator {
  return new SeoValidator(config)
}
