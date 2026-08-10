// ─────────────────────────────────────────────────────────────────────────────
// Validation Pipeline Orchestrator
// SEO Engine - Validation Pipeline
// Orchestrates all validation steps
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentSchema } from '@/src/core/domain/entities'
import { SchemaValidator } from './SchemaValidator'
import { ContentQualityValidator, type ContentQualityConfig } from './ContentQualityValidator'
import { SeoValidator, type SeoValidationConfig, type SocialMetaInput } from './SeoValidator'
import { DuplicateDetector, type DuplicateDetectionConfig } from './DuplicateDetector'
import { JsonLdValidator, type JsonLdValidationConfig } from './JsonLdValidator'
import { extractHeadingOutline, extractLinks } from './text-utils'

/**
 * Configuration globale du pipeline
 */
export interface ValidationPipelineConfig {
  // Validators à exécuter
  validators?: {
    schema?: boolean
    contentQuality?: boolean
    seo?: boolean
    duplicate?: boolean
    /** JSON-LD structural validation. Runs only when a payload is supplied. */
    jsonLd?: boolean
  }
  // Configurations individuelles
  schema?: {
    schema: ContentSchema
    config?: Parameters<SchemaValidator['validate']>[0] extends never
      ? never
      : ConstructorParameters<typeof SchemaValidator>[1]
  }
  contentQuality?: ContentQualityConfig
  seo?: SeoValidationConfig
  duplicate?: DuplicateDetectionConfig
  jsonLd?: JsonLdValidationConfig
  // Comportement
  stopOnFirstError?: boolean
  parallel?: boolean
}

/**
 * Résultat complet du pipeline
 */
export interface ValidationPipelineResult {
  valid: boolean
  timestamp: string
  duration: number
  overallScore: number
  results: {
    schema?: {
      passed: boolean
      result: ReturnType<SchemaValidator['validate']>
    }
    contentQuality?: {
      passed: boolean
      result: ReturnType<ContentQualityValidator['validate']>
    }
    seo?: {
      passed: boolean
      result: ReturnType<SeoValidator['validate']>
    }
    duplicate?: {
      passed: boolean
      result: Awaited<ReturnType<DuplicateDetector['findDuplicates']>>
    }
    jsonLd?: {
      passed: boolean
      result: ReturnType<JsonLdValidator['validateAll']>
    }
  }
  summary: ValidationSummary
  actions: ValidationAction[]
}

/**
 * Résumé de validation
 */
export interface ValidationSummary {
  totalValidators: number
  passedValidators: number
  failedValidators: number
  /** Number of BLOCKING issues. `canPublish` is exactly `totalErrors === 0`. */
  totalErrors: number
  totalWarnings: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  canPublish: boolean
  reasons: string[]
  // ─── Added in wave 2 (optional: purely additive) ───
  /** One human-readable line per blocking issue, ready for `error_message`. */
  blockingIssues?: string[]
}

/**
 * Action recommandée
 */
export interface ValidationAction {
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: 'schema' | 'quality' | 'seo' | 'duplicate'
  title: string
  description: string
  effort: 'quick' | 'moderate' | 'significant'
}

/** Content payload accepted by the pipeline. */
export interface ValidationPipelineContent {
  fields: Record<string, unknown>
  contentType: string
  title?: string
  metaTitle?: string
  metaDescription?: string
  content: string
  url?: string
  focusKeyword?: string
  schemaMarkup?: string
  // ─── Added in wave 2 (all optional: existing callers keep working) ───
  /** JSON-LD payloads keyed by slot, typically the generator's three strings. */
  schemas?: Record<string, string | object | null | undefined>
  /** Social metadata when it lives outside the HTML body. */
  social?: SocialMetaInput
  /** Site origin, so absolute links to the same domain count as internal. */
  siteOrigin?: string
}

/**
 * Orchestrateur de pipeline de validation
 */
export class ValidationPipelineOrchestrator {
  private config: ValidationPipelineConfig
  private schemaValidator?: SchemaValidator
  private contentQualityValidator?: ContentQualityValidator
  private seoValidator?: SeoValidator
  private duplicateDetector?: DuplicateDetector
  private jsonLdValidator?: JsonLdValidator

  constructor(config: ValidationPipelineConfig) {
    this.config = {
      stopOnFirstError: false,
      parallel: true,
      ...config,
      // Merged, not replaced: passing `{ duplicate: true }` used to silently
      // disable every other validator because the spread overwrote the whole
      // object.
      validators: {
        schema: true,
        contentQuality: true,
        seo: true,
        duplicate: false, // Désactivé par défaut (coûteux)
        jsonLd: true,
        ...config.validators,
      },
    }

    this.initializeValidators()
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Exécute le pipeline de validation complet
   */
  async validate(params: {
    content: ValidationPipelineContent
    existingContents?: Array<{
      id: string
      title: string
      content: string
      url?: string
    }>
  }): Promise<ValidationPipelineResult> {
    const startTime = Date.now()
    const results: ValidationPipelineResult['results'] = {}

    const {
      content,
      existingContents = [],
    } = params

    // ─── 1. Validation de schéma ─────────────────────────────────────
    if (this.config.validators?.schema && this.schemaValidator) {
      results.schema = {
        passed: false,
        result: this.schemaValidator.validate({
          fields: content.fields,
          contentType: content.contentType,
        }),
      }
      results.schema.passed = results.schema.result.isValid

      if (!results.schema.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    // ─── 2. Validation de qualité ───────────────────────────────────
    if (this.config.validators?.contentQuality && this.contentQualityValidator) {
      results.contentQuality = {
        passed: false,
        result: this.contentQualityValidator.validate({
          title: content.title || content.metaTitle,
          content: content.content,
        }),
      }
      results.contentQuality.passed = results.contentQuality.result.isValid

      if (!results.contentQuality.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    // ─── 3. Validation SEO ───────────────────────────────────────────
    if (this.config.validators?.seo && this.seoValidator && content.focusKeyword) {
      const headingOutline = extractHeadingOutline(content.content)
      const links = extractLinks(content.content, content.siteOrigin)

      results.seo = {
        passed: false,
        result: this.seoValidator.validate({
          title: content.title,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          content: content.content,
          url: content.url,
          focusKeyword: content.focusKeyword,
          schemaMarkup: content.schemaMarkup,
          schemas: content.schemas,
          social: content.social,
          headingOutline,
          headings: headingOutline.map(h => h.text),
          internalLinks: links.internal,
          externalLinks: links.external,
        }),
      }
      results.seo.passed = results.seo.result.isValid

      if (!results.seo.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    // ─── 4. Validation JSON-LD ──────────────────────────────────────
    const jsonLdPayloads = this.collectJsonLdPayloads(content)
    if (this.config.validators?.jsonLd && this.jsonLdValidator && Object.keys(jsonLdPayloads).length > 0) {
      results.jsonLd = {
        passed: false,
        result: this.jsonLdValidator.validateAll(jsonLdPayloads, {
          localBusiness: { expectedType: 'LocalBusiness' },
          faqPage: { expectedType: 'FAQPage' },
          breadcrumb: { expectedType: 'BreadcrumbList' },
        }),
      }
      results.jsonLd.passed = results.jsonLd.result.isValid

      if (!results.jsonLd.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    // ─── 5. Détection de duplicats ──────────────────────────────────
    if (this.config.validators?.duplicate && this.duplicateDetector && existingContents.length > 0) {
      const contentToCheck = {
        id: 'new',
        title: content.title || content.metaTitle || 'Untitled',
        content: content.content,
        url: content.url,
      }

      // Targeted comparison: only pairs involving the NEW page. Comparing every
      // pair meant two already-published look-alikes blocked an original article.
      const result = await this.duplicateDetector.findDuplicatesFor(contentToCheck, existingContents)

      results.duplicate = {
        // Only literal duplication blocks. Cannibalisation and partial overlap
        // are reported, so an editor can merge, but they do not stop the press.
        passed: !result.duplicates.some(d => d.matchType === 'exact' || d.matchType === 'near'),
        result,
      }

      if (!results.duplicate.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    return this.buildResult(results, startTime)
  }

  /**
   * Valide uniquement le schéma
   */
  validateSchema(content: { fields: Record<string, unknown>; contentType: string }) {
    if (!this.schemaValidator) {
      throw new Error('Schema validator not configured')
    }
    return this.schemaValidator.validate(content)
  }

  /**
   * Valide uniquement la qualité
   */
  validateContentQuality(content: { title?: string; content: string }) {
    if (!this.contentQualityValidator) {
      throw new Error('Content quality validator not configured')
    }
    return this.contentQualityValidator.validate(content)
  }

  /**
   * Valide uniquement le SEO
   */
  validateSeo(params: {
    title?: string
    metaTitle?: string
    metaDescription?: string
    content: string
    url?: string
    focusKeyword: string
    schemaMarkup?: string
    schemas?: Record<string, string | object | null | undefined>
    social?: SocialMetaInput
  }) {
    if (!this.seoValidator) {
      throw new Error('SEO validator not configured')
    }

    const headingOutline = extractHeadingOutline(params.content)
    const links = extractLinks(params.content)

    return this.seoValidator.validate({
      ...params,
      headingOutline,
      headings: headingOutline.map(h => h.text),
      internalLinks: links.internal,
      externalLinks: links.external,
    })
  }

  /**
   * Valide uniquement le JSON-LD (schema.org) d'une page.
   */
  validateJsonLd(schemas: Record<string, string | object | null | undefined>) {
    if (!this.jsonLdValidator) {
      throw new Error('JSON-LD validator not configured')
    }
    return this.jsonLdValidator.validateAll(schemas, {
      localBusiness: { expectedType: 'LocalBusiness' },
      faqPage: { expectedType: 'FAQPage' },
      breadcrumb: { expectedType: 'BreadcrumbList' },
    })
  }

  /**
   * Vérifie les duplicats
   */
  async checkDuplicates(
    newContent: { id: string; title: string; content: string; url?: string },
    existingContents: Array<{ id: string; title: string; content: string; url?: string }>
  ) {
    if (!this.duplicateDetector) {
      throw new Error('Duplicate detector not configured')
    }
    return this.duplicateDetector.findDuplicatesFor(newContent, existingContents)
  }

  // ─── Private Methods ────────────────────────────────────────────────

  private initializeValidators() {
    // Schema Validator
    if (this.config.validators?.schema && this.config.schema) {
      this.schemaValidator = new SchemaValidator(
        this.config.schema.schema,
        this.config.schema.config
      )
    }

    // Content Quality Validator
    if (this.config.validators?.contentQuality) {
      this.contentQualityValidator = new ContentQualityValidator(
        this.config.contentQuality
      )
    }

    // SEO Validator
    if (this.config.validators?.seo) {
      this.seoValidator = new SeoValidator(this.config.seo)
    }

    // Duplicate Detector
    if (this.config.validators?.duplicate) {
      this.duplicateDetector = new DuplicateDetector(this.config.duplicate)
    }

    // JSON-LD Validator
    if (this.config.validators?.jsonLd) {
      this.jsonLdValidator = new JsonLdValidator(this.config.jsonLd)
    }
  }

  /**
   * Gathers every JSON-LD payload attached to the page: the explicit `schemas`
   * map (the generator's `schemaLocalBusiness` / `schemaFaqPage` /
   * `schemaBreadcrumb`), the legacy `schemaMarkup` HTML blob, and any inline
   * `<script type="application/ld+json">` in the body.
   */
  private collectJsonLdPayloads(
    content: ValidationPipelineContent
  ): Record<string, string | object | null | undefined> {
    const payloads: Record<string, string | object | null | undefined> = {}

    if (content.schemas) {
      for (const [key, value] of Object.entries(content.schemas)) {
        if (value === null || value === undefined) continue
        if (typeof value === 'string' && (value.trim() === '' || value.trim() === '{}')) continue
        payloads[key] = value
      }
    }

    if (content.schemaMarkup && content.schemaMarkup.trim() && content.schemaMarkup.trim() !== '{}') {
      payloads.schemaMarkup = content.schemaMarkup
    }

    if (content.content && /application\/ld\+json/i.test(content.content)) {
      payloads.inlineContent = content.content
    }

    return payloads
  }

  private buildResult(
    results: ValidationPipelineResult['results'],
    startTime: number
  ): ValidationPipelineResult {
    const summary = this.calculateSummary(results)
    const actions = this.generateActions(results)

    return {
      valid: summary.canPublish,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      overallScore: this.calculateOverallScore(results),
      results,
      summary,
      actions,
    }
  }

  /**
   * Aggregation.
   *
   * `totalErrors` counts BLOCKING issues only — content-quality errors, schema
   * errors, high-impact SEO errors (which now include an invalid JSON-LD), and
   * literal duplication. Medium/low SEO errors and every warning are reported
   * but never stop a publication.
   */
  private calculateSummary(results: ValidationPipelineResult['results']): ValidationSummary {
    const totalValidators = Object.keys(results).length
    let passedValidators = 0
    let totalErrors = 0
    let totalWarnings = 0
    const reasons: string[] = []
    const blockingIssues: string[] = []

    // Schema (CMS fields)
    if (results.schema) {
      if (results.schema.passed) passedValidators++
      totalErrors += results.schema.result.errors.length
      totalWarnings += results.schema.result.warnings.length
      if (!results.schema.passed) {
        reasons.push(`Schema: ${results.schema.result.errors.length} error(s)`)
        for (const error of results.schema.result.errors) {
          blockingIssues.push(`[schema] ${error.field}: ${error.message}`)
        }
      }
    }

    // Content Quality
    if (results.contentQuality) {
      if (results.contentQuality.passed) passedValidators++
      totalErrors += results.contentQuality.result.errors.length
      totalWarnings += results.contentQuality.result.warnings.length
      if (!results.contentQuality.passed) {
        reasons.push(`Quality: ${results.contentQuality.result.errors.length} error(s)`)
        for (const error of results.contentQuality.result.errors) {
          blockingIssues.push(`[quality] ${error.code}: ${error.message}`)
        }
      }
    }

    // SEO
    if (results.seo) {
      if (results.seo.passed) passedValidators++
      const highErrors = results.seo.result.errors.filter(e => e.impact === 'high')
      totalErrors += highErrors.length
      totalWarnings += results.seo.result.warnings.length +
        results.seo.result.errors.filter(e => e.impact !== 'high').length
      if (highErrors.length > 0) {
        reasons.push(`SEO: ${highErrors.length} critical error(s)`)
        for (const error of highErrors) {
          blockingIssues.push(`[seo] ${error.code}: ${error.message}`)
        }
      }
    }

    // JSON-LD
    if (results.jsonLd) {
      if (results.jsonLd.passed) passedValidators++
      totalErrors += results.jsonLd.result.errors.length
      totalWarnings += results.jsonLd.result.warnings.length
      if (!results.jsonLd.passed) {
        reasons.push(`JSON-LD: ${results.jsonLd.result.errors.length} error(s)`)
        for (const error of results.jsonLd.result.errors) {
          blockingIssues.push(`[json-ld] ${error.node}: ${error.message}`)
        }
      }
    }

    // Duplicate
    if (results.duplicate) {
      if (results.duplicate.passed) passedValidators++
      const blocking = results.duplicate.result.duplicates.filter(
        d => d.matchType === 'exact' || d.matchType === 'near'
      )
      totalWarnings += results.duplicate.result.duplicates.length - blocking.length
      if (blocking.length > 0) {
        totalErrors += blocking.length
        reasons.push(`Duplicate: ${blocking.length} near-identical page(s)`)
        for (const match of blocking) {
          blockingIssues.push(
            `[duplicate] ${(match.similarity * 100).toFixed(1)}% similar to "${match.targetTitle}"`
          )
        }
      }
    }

    const failedValidators = totalValidators - passedValidators

    let grade: ValidationSummary['grade']
    const errorRatio = totalErrors / Math.max(totalValidators, 1)
    if (errorRatio === 0 && totalWarnings <= 2) grade = 'A'
    else if (errorRatio === 0 && totalWarnings <= 8) grade = 'B'
    else if (errorRatio === 0) grade = 'C'
    else if (errorRatio < 0.5) grade = 'D'
    else grade = 'F'

    // Warnings never block. A gate that refuses to publish anything is a dead
    // engine; the grade is a report card, not a permission.
    const canPublish = totalErrors === 0

    return {
      totalValidators,
      passedValidators,
      failedValidators,
      totalErrors,
      totalWarnings,
      grade,
      canPublish,
      reasons,
      blockingIssues,
    }
  }

  private calculateOverallScore(results: ValidationPipelineResult['results']): number {
    let totalScore = 0
    let count = 0

    if (results.schema) {
      totalScore += results.schema.result.isValid ? 100 : 50
      count++
    }

    if (results.contentQuality) {
      totalScore += results.contentQuality.result.score.overall
      count++
    }

    if (results.seo) {
      totalScore += results.seo.result.score
      count++
    }

    if (results.jsonLd) {
      totalScore += results.jsonLd.result.isValid
        ? Math.max(60, 100 - results.jsonLd.result.warnings.length * 5)
        : 40
      count++
    }

    if (results.duplicate) {
      totalScore += results.duplicate.passed ? 100 : 0
      count++
    }

    return count > 0 ? Math.round(totalScore / count) : 100
  }

  private generateActions(results: ValidationPipelineResult['results']): ValidationAction[] {
    const actions: ValidationAction[] = []

    if (results.schema && !results.schema.passed) {
      for (const error of results.schema.result.errors.slice(0, 3)) {
        actions.push({
          priority: 'critical',
          category: 'schema',
          title: `Fix: ${error.field}`,
          description: error.message,
          effort: 'quick',
        })
      }
    }

    if (results.jsonLd && !results.jsonLd.passed) {
      for (const error of results.jsonLd.result.errors.slice(0, 3)) {
        actions.push({
          priority: 'critical',
          category: 'schema',
          title: `Fix JSON-LD: ${error.code}`,
          description: `${error.node}: ${error.message}`,
          effort: 'quick',
        })
      }
    }

    if (results.contentQuality && !results.contentQuality.passed) {
      for (const error of results.contentQuality.result.errors.slice(0, 3)) {
        actions.push({
          priority: 'high',
          category: 'quality',
          title: `Improve: ${error.code}`,
          description: error.message,
          effort: this.estimateEffort(error.code),
        })
      }

      for (const suggestion of results.contentQuality.result.suggestions.slice(0, 2)) {
        actions.push({
          priority: suggestion.priority === 'high' ? 'medium' : 'low',
          category: 'quality',
          title: suggestion.title,
          description: suggestion.description,
          effort: 'moderate',
        })
      }
    }

    if (results.seo && !results.seo.passed) {
      for (const error of results.seo.result.errors.filter(e => e.impact === 'high').slice(0, 3)) {
        actions.push({
          priority: 'critical',
          category: 'seo',
          title: `Fix SEO: ${error.code}`,
          description: error.message,
          effort: 'quick',
        })
      }

      for (const rec of results.seo.result.recommendations.slice(0, 2)) {
        actions.push({
          priority: rec.priority === 'high' ? 'high' : 'medium',
          category: 'seo',
          title: rec.title,
          description: rec.description,
          effort: 'moderate',
        })
      }
    }

    if (results.duplicate && results.duplicate.result.duplicates.length > 0) {
      for (const dup of results.duplicate.result.duplicates.slice(0, 2)) {
        actions.push({
          priority: dup.matchType === 'partial' ? 'medium' : 'critical',
          category: 'duplicate',
          title: dup.reason === 'cannibalization'
            ? `Cannibalization risk: ${dup.targetTitle}`
            : `Potential duplicate: ${dup.targetTitle}`,
          description: `Similarity: ${(dup.similarity * 100).toFixed(1)}%`,
          effort: 'significant',
        })
      }
    }

    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  private estimateEffort(code: string): ValidationAction['effort'] {
    const quickCodes = ['MISSING_TITLE', 'MISSING_H1', 'MISSING_H2', 'TITLE_TOO_LONG']
    const significantCodes = ['WORD_COUNT_TOO_LOW', 'READABILITY_DIFFICULT']

    if (quickCodes.some(c => code.includes(c))) return 'quick'
    if (significantCodes.some(c => code.includes(c))) return 'significant'
    return 'moderate'
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createValidationPipeline(
  config: ValidationPipelineConfig
): ValidationPipelineOrchestrator {
  return new ValidationPipelineOrchestrator(config)
}
