// ─────────────────────────────────────────────────────────────────────────────
// Validation Pipeline Orchestrator
// SEO Engine - Validation Pipeline
// Orchestrates all validation steps
// ─────────────────────────────────────────────────────────────────────────────

import type { ContentSchema } from '@/src/core/domain/entities'
import { SchemaValidator } from './SchemaValidator'
import { ContentQualityValidator, type ContentQualityConfig } from './ContentQualityValidator'
import { SeoValidator, type SeoValidationConfig } from './SeoValidator'
import { DuplicateDetector, type DuplicateDetectionConfig } from './DuplicateDetector'

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
      result: ReturnType<DuplicateDetector['findDuplicates']>
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
  totalErrors: number
  totalWarnings: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  canPublish: boolean
  reasons: string[]
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

/**
 * Orchestrateur de pipeline de validation
 */
export class ValidationPipelineOrchestrator {
  private config: ValidationPipelineConfig
  private schemaValidator?: SchemaValidator
  private contentQualityValidator?: ContentQualityValidator
  private seoValidator?: SeoValidator
  private duplicateDetector?: DuplicateDetector

  constructor(config: ValidationPipelineConfig) {
    this.config = {
      validators: {
        schema: true,
        contentQuality: true,
        seo: true,
        duplicate: false, // Désactivé par défaut (coûteux)
      },
      stopOnFirstError: false,
      parallel: true,
      ...config,
    }

    this.initializeValidators()
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Exécute le pipeline de validation complet
   */
  async validate(params: {
    content: {
      fields: Record<string, unknown>
      contentType: string
      title?: string
      metaTitle?: string
      metaDescription?: string
      content: string
      url?: string
      focusKeyword?: string
      schemaMarkup?: string
    }
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
      // Extraire les headings du contenu
      const headings = this.extractHeadings(content.content)
      const internalLinks = this.extractInternalLinks(content.content)
      const externalLinks = this.extractExternalLinks(content.content)

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
          headings,
          internalLinks,
          externalLinks,
        }),
      }
      results.seo.passed = results.seo.result.isValid

      if (!results.seo.passed && this.config.stopOnFirstError) {
        return this.buildResult(results, startTime)
      }
    }

    // ─── 4. Détection de duplicats ──────────────────────────────────
    if (this.config.validators?.duplicate && this.duplicateDetector && existingContents.length > 0) {
      const contentToCheck = {
        id: 'new',
        title: content.title || content.metaTitle || 'Untitled',
        content: content.content,
        url: content.url,
      }

      results.duplicate = {
        passed: true,
        result: await this.duplicateDetector.findDuplicates([contentToCheck, ...existingContents]),
      }
      results.duplicate.passed = !results.duplicate.result.hasDuplicates

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
  }) {
    if (!this.seoValidator) {
      throw new Error('SEO validator not configured')
    }
    return this.seoValidator.validate(params)
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
    return this.duplicateDetector.findDuplicates([newContent, ...existingContents])
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

  private extractInternalLinks(html: string): string[] {
    const links: string[] = []
    const regex = /href="\/[^"]+"/gi
    let match
    while ((match = regex.exec(html)) !== null) {
      links.push(match[0])
    }
    return links
  }

  private extractExternalLinks(html: string): string[] {
    const links: string[] = []
    const regex = /href="https?:\/\/[^"]+"/gi
    let match
    while ((match = regex.exec(html)) !== null) {
      links.push(match[0])
    }
    return links
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

  private calculateSummary(results: ValidationPipelineResult['results']): ValidationSummary {
    const totalValidators = Object.keys(results).length
    let passedValidators = 0
    let totalErrors = 0
    let totalWarnings = 0
    const reasons: string[] = []

    // Schema
    if (results.schema) {
      if (results.schema.passed) passedValidators++
      totalErrors += results.schema.result.errors.length
      totalWarnings += results.schema.result.warnings.length
      if (!results.schema.passed) {
        reasons.push(`Schema: ${results.schema.result.errors.length} error(s)`)
      }
    }

    // Content Quality
    if (results.contentQuality) {
      if (results.contentQuality.passed) passedValidators++
      totalErrors += results.contentQuality.result.errors.length
      totalWarnings += results.contentQuality.result.warnings.length
      if (!results.contentQuality.passed) {
        reasons.push(`Quality: ${results.contentQuality.result.errors.length} error(s)`)
      }
    }

    // SEO
    if (results.seo) {
      if (results.seo.passed) passedValidators++
      totalErrors += results.seo.result.errors.filter(e => e.impact === 'high').length
      totalWarnings += results.seo.result.warnings.length
      if (!results.seo.passed) {
        const highErrors = results.seo.result.errors.filter(e => e.impact === 'high').length
        if (highErrors > 0) {
          reasons.push(`SEO: ${highErrors} critical error(s)`)
        }
      }
    }

    // Duplicate
    if (results.duplicate) {
      if (results.duplicate.passed) passedValidators++
      if (!results.duplicate.passed) {
        totalErrors++
        reasons.push(`Duplicate: Similar content exists`)
      }
    }

    const failedValidators = totalValidators - passedValidators

    // Calculer la note
    let grade: ValidationSummary['grade']
    const errorRatio = totalErrors / Math.max(totalValidators, 1)
    if (errorRatio === 0 && totalWarnings <= 2) grade = 'A'
    else if (errorRatio < 0.25 && totalWarnings <= 5) grade = 'B'
    else if (errorRatio < 0.5) grade = 'C'
    else if (errorRatio < 0.75) grade = 'D'
    else grade = 'F'

    // Peut publier si pas d'erreurs critiques
    const canPublish = totalErrors === 0 && grade !== 'F'

    return {
      totalValidators,
      passedValidators,
      failedValidators,
      totalErrors,
      totalWarnings,
      grade,
      canPublish,
      reasons,
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

    if (results.duplicate) {
      totalScore += results.duplicate.passed ? 100 : 0
      count++
    }

    return count > 0 ? Math.round(totalScore / count) : 100
  }

  private generateActions(results: ValidationPipelineResult['results']): ValidationAction[] {
    const actions: ValidationAction[] = []

    // Actions basées sur les erreurs de schéma
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

    // Actions basées sur la qualité
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

      // Suggestions
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

    // Actions basées sur SEO
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

      // Recommandations SEO
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

    // Actions basées sur les duplicats
    if (results.duplicate && !results.duplicate.passed) {
      for (const dup of results.duplicate.result.duplicates.slice(0, 2)) {
        actions.push({
          priority: 'critical',
          category: 'duplicate',
          title: `Potential duplicate: ${dup.targetTitle}`,
          description: `Similarity: ${(dup.similarity * 100).toFixed(1)}%`,
          effort: 'significant',
        })
      }
    }

    // Trier par priorité
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  private estimateEffort(code: string): ValidationAction['effort'] {
    const quickCodes = ['WORD_COUNT_TOO_LOW', 'MISSING_TITLE', 'TITLE_TOO_LONG']
    const significantCodes = ['READABILITY_DIFFICULT', 'NO_IMAGES']

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
