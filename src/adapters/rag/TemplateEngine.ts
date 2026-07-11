// ─────────────────────────────────────────────────────────────────────────────
// TemplateEngine
// SEO Engine - Universal Template System
// Processes templates and renders content based on context
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ContentTemplate,
  TemplateSection,
  TemplateVariant,
  TemplateStructure,
  SeoRequirements,
  FieldMapping,
  FieldTransform,
} from '@/src/core/domain/entities/ContentTemplate'

/**
 * Contexte de rendu
 */
export interface RenderContext {
  // Données d'entrée
  title?: string
  content?: string
  excerpt?: string
  keywords?: string[]
  primaryKeyword?: string
  location?: string

  // Meta
  metaTitle?: string
  metaDescription?: string

  // Taxonomy
  categories?: string[]
  tags?: string[]

  // SEO
  focusKeyword?: string
  wordCount?: number

  // Configuration
  targetWordCount?: number
  includeFaq?: boolean
  includeImages?: boolean

  // Platform-specific
  wordpressFields?: Record<string, unknown>
  sanityFields?: Record<string, unknown>

  // User context
  userAgent?: string
  userLocale?: string
  userDate?: Date

  // Custom
  [key: string]: unknown
}

/**
 * Résultat du rendu
 */
export interface RenderResult {
  // Fields rendered
  fields: Record<string, unknown>

  // Platform-specific output
  wordpressOutput?: WordPressOutput
  sanityOutput?: SanityOutput

  // SEO
  seo: SeoOutput

  // Stats
  stats: RenderStats

  // Applied variant
  appliedVariant?: string
}

/**
 * Output WordPress
 */
export interface WordPressOutput {
  title: string
  content: string
  excerpt?: string
  status: 'draft' | 'publish' | 'pending'
  featuredMedia?: number
  categories?: number[]
  tags?: number[]
  meta?: Record<string, string>
  slug?: string
  date?: string
}

/**
 * Output Sanity
 */
export interface SanityOutput {
  _type: string
  title: string
  slug: { current: string }
  body: SanityBlock[]
  excerpt?: string
  mainImage?: SanityImage
  categories?: SanityReference[]
  publishedAt?: string
  seo?: {
    metaTitle?: string
    metaDescription?: string
  }
}

/**
 * Block Sanity Portable Text
 */
export interface SanityBlock {
  _type: string
  _key: string
  style?: string
  children?: SanitySpan[]
  markDefs?: SanityMarkDef[]
  [key: string]: unknown
}

export interface SanitySpan {
  _type: string
  _key: string
  text: string
  marks?: string[]
}

export interface SanityMarkDef {
  _key: string
  _type: string
  href?: string
}

export interface SanityImage {
  _type: string
  asset: {
    _ref: string
    _type: string
  }
  alt?: string
}

export interface SanityReference {
  _type: string
  _ref: string
}

/**
 * Output SEO
 */
export interface SeoOutput {
  metaTitle?: string
  metaDescription?: string
  focusKeyword?: string
  slug?: string
  schemaMarkup?: string
  openGraph?: OpenGraphData
}

/**
 * Open Graph data
 */
export interface OpenGraphData {
  title?: string
  description?: string
  image?: string
  url?: string
  type?: string
}

/**
 * Stats de rendu
 */
export interface RenderStats {
  wordCount: number
  sectionCount: number
  sectionsRendered: number
  sectionsSkipped: number
  renderingTimeMs: number
  validationWarnings: string[]
  validationErrors: string[]
}

/**
 * Configuration du moteur
 */
export interface TemplateEngineConfig {
  // Helpers
  helpers: TemplateHelper[]

  // Transformers
  transformers: FieldTransformer[]

  // Validators
  validators: TemplateValidator[]

  // Mode
  strictMode: boolean
  skipInvalidSections: boolean

  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug'
}

/**
 * Helper de template
 */
export interface TemplateHelper {
  name: string
  description: string
  execute: (input: unknown, context: RenderContext) => string | Promise<string>
}

/**
 * Transformer de champ
 */
export interface FieldTransformer {
  name: string
  transform: (value: unknown, config: Record<string, unknown>) => unknown
}

/**
 * Validateur de template
 */
export interface TemplateValidator {
  name: string
  validate: (result: RenderResult, requirements: SeoRequirements) => ValidationResult
}

/**
 * Résultat de validation
 */
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  field: string
  message: string
  severity: 'error'
}

export interface ValidationWarning {
  field: string
  message: string
  severity: 'warning'
}

/**
 * TemplateEngine principal
 */
export class TemplateEngine {
  private config: TemplateEngineConfig
  private helperRegistry: Map<string, TemplateHelper> = new Map()
  private transformerRegistry: Map<string, FieldTransformer> = new Map()
  private validatorRegistry: Map<string, TemplateValidator> = new Map()

  constructor(config: Partial<TemplateEngineConfig> = {}) {
    // Config par défaut
    this.config = {
      helpers: [],
      transformers: [],
      validators: [],
      strictMode: false,
      skipInvalidSections: false,
      logLevel: 'warn',
      ...config,
    }

    // Enregistrer les helpers par défaut
    this.registerDefaultHelpers()
    this.registerDefaultTransformers()

    // Enregistrer les helpers/configurés
    for (const helper of this.config.helpers) {
      this.registerHelper(helper)
    }
    for (const transformer of this.config.transformers) {
      this.registerTransformer(transformer)
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Rend un template complet
   */
  async render(
    template: ContentTemplate,
    context: RenderContext
  ): Promise<RenderResult> {
    const startTime = Date.now()
    const warnings: string[] = []
    const errors: string[] = []

    // 1. Sélectionner le variant approprié
    const selectedVariant = this.selectVariant(template, context)

    // 2. Appliquer les modifications du variant
    const modifiedTemplate = selectedVariant
      ? this.applyVariant(template, selectedVariant)
      : template

    // 3. Construire le contexte de rendu
    const renderContext = this.buildRenderContext(context, modifiedTemplate)

    // 4. Rendre les sections
    const fields: Record<string, unknown> = {}
    let sectionsRendered = 0
    let sectionsSkipped = 0

    for (const section of modifiedTemplate.structure.sections) {
      // Vérifier les conditions
      if (!this.evaluateConditions(section.conditions, renderContext)) {
        sectionsSkipped++
        continue
      }

      try {
        const sectionResult = await this.renderSection(section, renderContext)
        Object.assign(fields, sectionResult)
        sectionsRendered++
      } catch (error) {
        const errorMsg = `Failed to render section "${section.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
        errors.push(errorMsg)
        this.log('error', errorMsg)

        if (this.config.strictMode) {
          throw error
        }
      }
    }

    // 5. Appliquer le mapping des champs
    const mappedFields = this.applyFieldMapping(fields, modifiedTemplate.structure.fieldMapping)

    // 6. Générer l'output platform-specific
    const wordpressOutput = this.generateWordPressOutput(mappedFields, context)
    const sanityOutput = this.generateSanityOutput(mappedFields, context)

    // 7. Générer l'output SEO
    const seoOutput = this.generateSeoOutput(mappedFields, context, modifiedTemplate.seoRequirements)

    // 8. Valider le résultat
    const renderStats: RenderStats = {
      wordCount: this.countWords(String(fields.content || '')),
      sectionCount: modifiedTemplate.structure.sections.length,
      sectionsRendered,
      sectionsSkipped,
      renderingTimeMs: Date.now() - startTime,
      validationWarnings: warnings,
      validationErrors: errors,
    }

    return {
      fields: mappedFields,
      wordpressOutput,
      sanityOutput,
      seo: seoOutput,
      stats: renderStats,
      appliedVariant: selectedVariant?.id,
    }
  }

  /**
   * Valide le résultat contre les SEO requirements
   */
  validate(
    result: RenderResult,
    requirements: SeoRequirements
  ): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Word count
    if (requirements.minWordCount && result.stats.wordCount < requirements.minWordCount) {
      errors.push({
        field: 'wordCount',
        message: `Word count (${result.stats.wordCount}) is below minimum (${requirements.minWordCount})`,
        severity: 'error',
      })
    }

    if (requirements.maxWordCount && result.stats.wordCount > requirements.maxWordCount) {
      errors.push({
        field: 'wordCount',
        message: `Word count (${result.stats.wordCount}) exceeds maximum (${requirements.maxWordCount})`,
        severity: 'error',
      })
    }

    // Meta title
    if (requirements.metaTitle && result.seo.metaTitle) {
      const titleLen = result.seo.metaTitle.length
      if (titleLen < requirements.metaTitle.minLength) {
        errors.push({
          field: 'metaTitle',
          message: `Meta title (${titleLen} chars) is too short (min: ${requirements.metaTitle.minLength})`,
          severity: 'error',
        })
      }
      if (titleLen > requirements.metaTitle.maxLength) {
        errors.push({
          field: 'metaTitle',
          message: `Meta title (${titleLen} chars) exceeds max length (${requirements.metaTitle.maxLength})`,
          severity: 'error',
        })
      }
    }

    // Meta description
    if (requirements.metaDescription && result.seo.metaDescription) {
      const descLen = result.seo.metaDescription.length
      if (descLen < requirements.metaDescription.minLength) {
        errors.push({
          field: 'metaDescription',
          message: `Meta description (${descLen} chars) is too short (min: ${requirements.metaDescription.minLength})`,
          severity: 'error',
        })
      }
      if (descLen > requirements.metaDescription.maxLength) {
        errors.push({
          field: 'metaDescription',
          message: `Meta description (${descLen} chars) exceeds max length (${requirements.metaDescription.maxLength})`,
          severity: 'error',
        })
      }
    }

    // Keyword density
    if (requirements.keywordDensity && result.seo.focusKeyword && result.fields.content) {
      const density = this.calculateKeywordDensity(
        String(result.fields.content),
        result.seo.focusKeyword
      )

      if (density < requirements.keywordDensity.min) {
        warnings.push({
          field: 'keywordDensity',
          message: `Keyword density (${density.toFixed(2)}%) is below minimum (${requirements.keywordDensity.min}%)`,
          severity: 'warning',
        })
      }
      if (density > requirements.keywordDensity.max) {
        warnings.push({
          field: 'keywordDensity',
          message: `Keyword density (${density.toFixed(2)}%) exceeds maximum (${requirements.keywordDensity.max}%)`,
          severity: 'warning',
        })
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  // ─── Variant Selection ───────────────────────────────────────────────────

  /**
   * Sélectionne le variant approprié
   */
  selectVariant(
    template: ContentTemplate,
    context: RenderContext
  ): TemplateVariant | null {
    const activeVariants = template.variants.filter(v => v.isActive)

    if (activeVariants.length === 0) {
      return null
    }

    // Calculer le score de chaque variant
    const scored = activeVariants.map(variant => ({
      variant,
      score: this.calculateVariantScore(variant, context),
    }))

    // Trier par score décroissant
    scored.sort((a, b) => b.score - a.score)

    // Retourner le meilleur score s'il est > 0
    return scored[0].score > 0 ? scored[0].variant : null
  }

  private calculateVariantScore(
    variant: TemplateVariant,
    context: RenderContext
  ): number {
    let score = 0

    for (const rule of variant.selectionRules) {
      const value = this.getContextValue(context, rule.field)
      let matches = false

      switch (rule.operator) {
        case 'equals':
          matches = value === rule.value
          break
        case 'not_equals':
          matches = value !== rule.value
          break
        case 'contains':
          matches = String(value).includes(String(rule.value))
          break
        case 'in':
          matches = Array.isArray(rule.value) && rule.value.includes(String(value))
          break
        case 'date_range':
          if (typeof rule.value === 'object' && 'start' in rule.value) {
            const now = context.userDate || new Date()
            const start = new Date(rule.value.start)
            const end = new Date(rule.value.end)
            matches = now >= start && now <= end
          }
          break
        case 'user_agent':
          matches = context.userAgent?.includes(String(rule.value)) || false
          break
      }

      if (matches) {
        score += rule.weight || 1
      }
    }

    return score
  }

  private getContextValue(context: RenderContext, field: string): unknown {
    const parts = field.split('.')
    let value: unknown = context

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return value
  }

  /**
   * Applique les modifications d'un variant
   */
  private applyVariant(
    template: ContentTemplate,
    variant: TemplateVariant
  ): ContentTemplate {
    const modified = JSON.parse(JSON.stringify(template)) as ContentTemplate

    // Sections à ajouter
    if (variant.modifications.addSections) {
      for (const sectionId of variant.modifications.addSections) {
        // TODO: Récupérer la section depuis une library
      }
    }

    // Sections à supprimer
    if (variant.modifications.removeSections) {
      modified.structure.sections = modified.structure.sections.filter(
        s => !variant.modifications.removeSections?.includes(s.id)
      )
    }

    // Modifications de sections
    if (variant.modifications.modifySections) {
      for (const [sectionId, mods] of Object.entries(variant.modifications.modifySections)) {
        const section = modified.structure.sections.find(s => s.id === sectionId)
        if (section) {
          Object.assign(section, mods)
        }
      }
    }

    // Modifications de prompts
    if (variant.modifications.modifyInstructions) {
      for (const [sectionId, instruction] of Object.entries(variant.modifications.modifyInstructions)) {
        const section = modified.structure.sections.find(s => s.id === sectionId)
        if (section) {
          section.instructions = instruction
        }
      }
    }

    // SEO overrides
    if (variant.modifications.seoOverrides) {
      Object.assign(modified.seoRequirements, variant.modifications.seoOverrides)
    }

    return modified
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  private buildRenderContext(
    context: RenderContext,
    template: ContentTemplate
  ): RenderContext {
    return {
      ...context,
      // Ajouter les helpers disponibles
      helpers: this.helperRegistry,
      // Config du template
      templateConfig: template.config,
      // SEO requirements
      seoRequirements: template.seoRequirements,
    }
  }

  private async renderSection(
    section: TemplateSection,
    context: RenderContext
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}

    // Remplacer les variables dans les instructions
    const processedInstructions = this.processTemplate(section.instructions, context)

    // Ajouter au contexte
    result[`_${section.id}_instructions`] = processedInstructions

    // Instructions déjà prêtes pour le prompt
    result[section.id] = {
      instructions: processedInstructions,
      config: section.config,
    }

    return result
  }

  /**
   * Traite un template string avec le contexte
   */
  processTemplate(template: string, context: RenderContext): string {
    let result = template

    // Helpers simples
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(context[key] ?? '')
    })

    // Conditionnels {#if key}...{/if}
    result = result.replace(
      /\{#if\s+(\w+)\}([\s\S]*?)\{\/if\}/g,
      (_, key, content) => {
        return context[key] ? content : ''
      }
    )

    // Helpers {#each items as item}...{/each}
    result = result.replace(
      /\{#each\s+(\w+)\s+as\s+(\w+)\}([\s\S]*?)\{\/each\}/g,
      (_, arrayKey, itemKey, content) => {
        const array = context[arrayKey] as unknown[]
        if (!Array.isArray(array)) return ''

        return array.map((item, index) => {
          const itemContext = { ...context, [itemKey]: item, index }
          return this.processTemplate(content, itemContext)
        }).join('')
      }
    )

    return result
  }

  private applyFieldMapping(
    fields: Record<string, unknown>,
    mappings: FieldMapping[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...fields }

    for (const mapping of mappings) {
      const sourceValue = fields[mapping.templateField]

      if (sourceValue !== undefined) {
        // Appliquer la transformation si nécessaire
        let value: unknown = sourceValue
        if (mapping.transform) {
          value = this.applyTransform(value, mapping.transform)
        }

        // Stocker dans le champ correspondant
        result[mapping.templateField] = value
      }
    }

    return result
  }

  private applyTransform(value: unknown, transform: FieldTransform): unknown {
    const transformer = this.transformerRegistry.get(transform.type)
    if (transformer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (transformer.transform as (v: unknown, c: unknown) => unknown)(value, {})
    }

    // Transform par défaut
    switch (transform.type) {
      case 'html_to_plain':
        return String(value).replace(/<[^>]*>/g, '').trim()
      case 'plain_to_html':
        return `<p>${String(value).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
      default:
        return value
    }
  }

  private evaluateConditions(
    conditions: TemplateSection['conditions'],
    context: RenderContext
  ): boolean {
    if (!conditions || conditions.length === 0) {
      return true
    }

    return conditions.every(condition => {
      const value = this.getContextValue(context, condition.field)

      switch (condition.operator) {
        case 'equals':
          return value === condition.value
        case 'not_equals':
          return value !== condition.value
        case 'contains':
          return String(value).includes(String(condition.value))
        case 'exists':
          return value !== undefined && value !== null
        case 'greater_than':
          return Number(value) > Number(condition.value)
        case 'less_than':
          return Number(value) < Number(condition.value)
        default:
          return true
      }
    })
  }

  // ─── Output Generation ───────────────────────────────────────────────────

  private generateWordPressOutput(
    fields: Record<string, unknown>,
    context: RenderContext
  ): WordPressOutput {
    return {
      title: String(fields.title || context.title || ''),
      content: String(fields.content || context.content || ''),
      excerpt: String(fields.excerpt || context.excerpt || ''),
      status: 'draft',
      slug: this.slugify(String(fields.title || context.title || '')),
      categories: context.wordpressFields?.categories as number[] | undefined,
      tags: context.wordpressFields?.tags as number[] | undefined,
      meta: {
        ...(fields.meta_title ? { _rank_math_title: String(fields.meta_title) } : {}),
        ...(fields.meta_description ? { _rank_math_description: String(fields.meta_description) } : {}),
      },
    }
  }

  private generateSanityOutput(
    fields: Record<string, unknown>,
    context: RenderContext
  ): SanityOutput {
    const content = String(fields.content || context.content || '')
    const blocks = this.htmlToPortableText(content)

    return {
      _type: 'article',
      title: String(fields.title || context.title || ''),
      slug: { current: this.slugify(String(fields.title || context.title || '')) },
      body: blocks,
      excerpt: String(fields.excerpt || context.excerpt || ''),
      publishedAt: new Date().toISOString(),
      seo: {
        metaTitle: String(fields.meta_title || context.metaTitle || ''),
        metaDescription: String(fields.meta_description || context.metaDescription || ''),
      },
    }
  }

  private generateSeoOutput(
    fields: Record<string, unknown>,
    context: RenderContext,
    requirements: SeoRequirements
  ): SeoOutput {
    return {
      metaTitle: String(fields.meta_title || context.metaTitle || ''),
      metaDescription: String(fields.meta_description || context.metaDescription || ''),
      focusKeyword: context.focusKeyword || context.primaryKeyword,
      slug: this.slugify(String(fields.title || context.title || '')),
      schemaMarkup: this.generateSchemaMarkup(context, requirements),
    }
  }

  private generateSchemaMarkup(
    context: RenderContext,
    requirements: SeoRequirements
  ): string | undefined {
    if (!requirements.requiredSchemaTypes?.length) {
      return undefined
    }

    // Générer un Schema.org Article basique
    if (requirements.requiredSchemaTypes.includes('Article')) {
      return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: context.title,
        description: context.metaDescription,
        keywords: context.keywords?.join(', '),
      })
    }

    return undefined
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private registerDefaultHelpers(): void {
    this.registerHelper({
      name: 'formatDate',
      description: 'Formate une date',
      execute: (input: unknown) => {
        const date = input instanceof Date ? input : new Date(String(input))
        return date.toLocaleDateString('fr-FR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      },
    })

    this.registerHelper({
      name: 'slugify',
      description: 'Convertit en slug URL-friendly',
      execute: (input: unknown) => this.slugify(String(input)),
    })

    this.registerHelper({
      name: 'truncate',
      description: 'Tronque un texte',
      execute: (input: unknown, ctx: RenderContext) => {
        const maxLength = (ctx.maxLength as number) || 150
        const text = String(input)
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + '...'
      },
    })

    this.registerHelper({
      name: 'wordCount',
      description: 'Compte les mots',
      execute: (input: unknown) => {
        return String(String(input).split(/\s+/).filter(Boolean).length)
      },
    })

    this.registerHelper({
      name: 'uppercase',
      description: 'Met en majuscules',
      execute: (input: unknown) => String(input).toUpperCase(),
    })

    this.registerHelper({
      name: 'lowercase',
      description: 'Met en minuscules',
      execute: (input: unknown) => String(input).toLowerCase(),
    })

    this.registerHelper({
      name: 'capitalize',
      description: 'Met la première lettre en majuscule',
      execute: (input: unknown) => {
        const str = String(input)
        return str.charAt(0).toUpperCase() + str.slice(1)
      },
    })
  }

  private registerDefaultTransformers(): void {
    this.registerTransformer({
      name: 'html_to_portable_text',
      transform: (value: unknown) => {
        const html = String(value)
        return this.htmlToPortableText(html)
      },
    })

    this.registerTransformer({
      name: 'portable_text_to_html',
      transform: (value: unknown) => {
        const blocks = value as SanityBlock[]
        return this.portableTextToHtml(blocks)
      },
    })
  }

  private registerHelper(helper: TemplateHelper): void {
    this.helperRegistry.set(helper.name, helper)
  }

  private registerTransformer(transformer: FieldTransformer): void {
    this.transformerRegistry.set(transformer.name, transformer)
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private countWords(text: string): number {
    return text.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length
  }

  private calculateKeywordDensity(text: string, keyword: string): number {
    const words = text.toLowerCase().split(/\s+/)
    const keywordWords = keyword.toLowerCase().split(/\s+/)
    const totalWords = words.length

    if (totalWords === 0) return 0

    let matches = 0
    for (let i = 0; i <= words.length - keywordWords.length; i++) {
      const phrase = words.slice(i, i + keywordWords.length).join(' ')
      if (phrase === keywordWords.join(' ')) {
        matches++
      }
    }

    return (matches / totalWords) * 100
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  private htmlToPortableText(html: string): SanityBlock[] {
    const blocks: SanityBlock[] = []
    const paragraphs = html.split(/<\/p>|<\/h[1-6]>/gi)

    let keyIndex = 0

    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (!trimmed) continue

      // Détecter le type
      const hMatch = trimmed.match(/^<(h[1-6])[^>]*>([\s\S]*)$/i)
      if (hMatch) {
        blocks.push({
          _type: 'block',
          _key: `block_${keyIndex++}`,
          style: hMatch[1].toLowerCase(),
          children: [{
            _type: 'span',
            _key: `span_${keyIndex++}`,
            text: hMatch[2].trim(),
            marks: [],
          }],
          markDefs: [],
        })
      } else {
        // Paragraph avec HTML interne
        const cleanText = trimmed
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .trim()

        if (cleanText) {
          blocks.push({
            _type: 'block',
            _key: `block_${keyIndex++}`,
            style: 'normal',
            children: [{
              _type: 'span',
              _key: `span_${keyIndex++}`,
              text: cleanText,
              marks: [],
            }],
            markDefs: [],
          })
        }
      }
    }

    return blocks
  }

  private portableTextToHtml(blocks: SanityBlock[]): string {
    return blocks.map(block => {
      const text = block.children?.map(span => span.text).join('') || ''

      switch (block.style) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
          return `<${block.style}>${text}</${block.style}>`
        default:
          return `<p>${text}</p>`
      }
    }).join('\n')
  }

  private log(level: 'error' | 'warn' | 'info' | 'debug', message: string): void {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 }
    if (levels[level] <= levels[this.config.logLevel]) {
      console[level](`[TemplateEngine] ${message}`)
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let engineInstance: TemplateEngine | null = null

export function getTemplateEngine(): TemplateEngine {
  if (!engineInstance) {
    engineInstance = new TemplateEngine()
  }
  return engineInstance
}

export function createTemplateEngine(config?: Partial<TemplateEngineConfig>): TemplateEngine {
  return new TemplateEngine(config)
}
