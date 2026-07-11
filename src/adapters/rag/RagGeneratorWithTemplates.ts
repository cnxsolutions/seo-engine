// ─────────────────────────────────────────────────────────────────────────────
// RAG Generator with Templates
// SEO Engine - Universal Template System
// Integrates templates with RAG content generation
// ─────────────────────────────────────────────────────────────────────────────

import type OpenAI from 'openai'
import type Anthropic from '@anthropic-ai/sdk'

import { createTemplateEngine, type RenderContext, type RenderResult } from './TemplateEngine'
import { getTemplate, CONTENT_TYPE_TEMPLATES } from './TemplateLibrary'
import { createSupabaseVectorStore } from './providers'
import { VectorIndexingService } from './VectorIndexingService'
import { SemanticSearchService } from './SemanticSearchService'
import type { ContentTemplate } from '@/src/core/domain/entities/ContentTemplate'

/**
 * Options de génération avec templates
 */
export interface TemplateGenerationOptions {
  // Site et type
  siteId: string
  platform: 'wordpress' | 'sanity' | 'nextjs'
  contentTypeKey: string

  // Template
  templateId?: string
  templateOverrides?: Partial<ContentTemplate>

  // Contexte de génération
  context: GenerationContext

  // AI
  model?: string
  temperature?: number

  // Options
  includeRagContext?: boolean
  validateOutput?: boolean
  maxTokens?: number
}

/**
 * Contexte de génération
 */
export interface GenerationContext {
  // Topic
  title?: string
  topic?: string
  primaryKeyword?: string
  secondaryKeywords?: string[]
  location?: string

  // Contenu
  targetWordCount?: number
  includeFaq?: boolean
  includeImages?: boolean
  contentFormat?: 'article' | 'guide' | 'list' | 'tutorial'

  // Taxonomie
  categories?: string[]
  tags?: string[]

  // SEO existant
  existingSlugs?: string[]
  competitorTopics?: string[]

  // Local
  localBusiness?: {
    name: string
    type: string
    address?: string
    phone?: string
  }
}

/**
 * Résultat de génération
 */
export interface TemplateGenerationResult {
  // Contenu généré
  content: GeneratedContent

  // Résultat du template
  templateResult: RenderResult

  // Stats
  stats: GenerationStats

  // Validation
  validation?: ContentValidation

  // Sources RAG
  sources: RagSource[]
}

/**
 * Contenu généré structuré
 */
export interface GeneratedContent {
  // Fields principaux
  title: string
  content: string
  excerpt?: string

  // SEO
  metaTitle?: string
  metaDescription?: string
  slug?: string
  focusKeyword?: string

  // Taxonomie
  categories?: string[]
  tags?: string[]

  // Platform-specific
  wordpressFields?: WordPressFields
  sanityFields?: SanityFields

  // Extra
  faq?: FaqItem[]
  schemaMarkup?: string
}

/**
 * Champs WordPress
 */
export interface WordPressFields {
  status?: 'draft' | 'publish' | 'pending'
  featuredMedia?: number
  categories?: number[]
  tags?: number[]
  meta?: Record<string, string>
  date?: string
}

/**
 * Champs Sanity
 */
export interface SanityFields {
  slug: { current: string }
  body: unknown[] // Portable Text blocks
  mainImage?: {
    asset: { _ref: string }
    alt?: string
  }
  publishedAt?: string
}

/**
 * Item FAQ
 */
export interface FaqItem {
  question: string
  answer: string
}

/**
 * Source RAG
 */
export interface RagSource {
  documentId: string
  title: string
  url?: string
  relevance: number
}

/**
 * Stats de génération
 */
export interface GenerationStats {
  templateRenderingTimeMs: number
  aiGenerationTimeMs: number
  validationTimeMs: number
  totalTimeMs: number
  tokensUsed?: number
  model: string
}

/**
 * Validation de contenu
 */
export interface ContentValidation {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  statsTimeMs?: number
}

export interface ValidationError {
  field: string
  message: string
  code: string
}

export interface ValidationWarning {
  field: string
  message: string
}

/**
 * Service de génération avec templates
 */
export class RagGeneratorWithTemplates {
  private templateEngine = createTemplateEngine()
  private vectorStore = createSupabaseVectorStore(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  private indexingService = new VectorIndexingService(this.vectorStore)
  private searchService = new SemanticSearchService(this.vectorStore)
  private openAiClient?: OpenAI
  private anthropicClient?: Anthropic

  constructor(openAiClient?: OpenAI, anthropicClient?: Anthropic) {
    this.openAiClient = openAiClient
    this.anthropicClient = anthropicClient
  }

  /**
   * Génère du contenu en utilisant un template
   */
  async generate(options: TemplateGenerationOptions): Promise<TemplateGenerationResult> {
    const startTime = Date.now()
    const templateStartTime = Date.now()

    // 1. Récupérer le template
    let template = options.templateId
      ? CONTENT_TYPE_TEMPLATES[options.templateId]
      : getTemplate(options.platform, options.contentTypeKey)

    if (!template) {
      // Template par défaut basé sur le content type
      template = this.createDefaultTemplate(options.platform, options.contentTypeKey)
    }

    // Appliquer les overrides si fournis
    if (options.templateOverrides) {
      template = { ...template, ...options.templateOverrides } as ContentTemplate
    }

    // 2. Construire le contexte RAG si demandé
    let ragContext: RagContextResult | null = null
    if (options.includeRagContext !== false) {
      ragContext = await this.buildRagContext(options)
    }

    // 3. Construire le contexte de rendu
    const renderContext: RenderContext = {
      title: options.context.title,
      content: options.context.topic,
      excerpt: options.context.primaryKeyword,
      keywords: options.context.secondaryKeywords,
      primaryKeyword: options.context.primaryKeyword,
      location: options.context.location,
      metaTitle: options.context.primaryKeyword
        ? `${options.context.title || options.context.topic} - ${options.context.primaryKeyword}`
        : options.context.title,
      metaDescription: this.generateMetaDescription(options.context),
      categories: options.context.categories,
      tags: options.context.tags,
      focusKeyword: options.context.primaryKeyword,
      targetWordCount: options.context.targetWordCount,
      includeFaq: options.context.includeFaq,
      includeImages: options.context.includeImages,
      wordpressFields: {
        categories: options.context.categories,
        tags: options.context.tags,
      },
    }

    // 4. Rendre le template (récupère les instructions)
    const templateResult = await this.templateEngine.render(template, renderContext)
    const templateRenderingTime = Date.now() - templateStartTime

    // 5. Appeler l'IA avec le contexte enrichi
    const aiStartTime = Date.now()
    const generatedContent = await this.generateWithAI(
      templateResult,
      ragContext,
      options
    )
    const aiGenerationTime = Date.now() - aiStartTime

    // 6. Valider si demandé
    let validation: ContentValidation | undefined
    if (options.validateOutput !== false) {
      const validationStart = Date.now()
      validation = this.validateOutput(generatedContent, template.seoRequirements)
      validation.statsTimeMs = Date.now() - validationStart
    }

    // 7. Construire le résultat final
    const result: TemplateGenerationResult = {
      content: generatedContent,
      templateResult,
      stats: {
        templateRenderingTimeMs: templateRenderingTime,
        aiGenerationTimeMs: aiGenerationTime,
        validationTimeMs: validation?.statsTimeMs || 0,
        totalTimeMs: Date.now() - startTime,
        model: options.model || 'gpt-4o',
      },
      validation,
      sources: ragContext?.sources || [],
    }

    return result
  }

  /**
   * Construit le contexte RAG
   */
  private async buildRagContext(
    options: TemplateGenerationOptions
  ): Promise<RagContextResult | null> {
    try {
      const context = await this.searchService.buildRagContext({
        siteId: options.siteId,
        contentTypeKey: options.contentTypeKey,
        topic: options.context.topic || options.context.title,
        keywords: options.context.secondaryKeywords,
        location: options.context.location,
        limit: 5,
      })

      return {
        similarExamples: context.similarExamples.map(e => ({
          title: e.title,
          content: e.content,
          score: e.score,
          url: e.sourceUrl,
        })),
        sources: context.sources.map(s => ({
          documentId: s.documentId,
          title: s.title,
          url: undefined,
          relevance: s.relevanceScore,
        })),
        taxonomyContext: context.taxonomyContext ? {
          taxonomies: context.taxonomyContext.taxonomies.map((t: { key: string }) => ({ key: t.key }))
        } : undefined,
      }
    } catch (error) {
      console.warn('Failed to build RAG context:', error)
      return null
    }
  }

  /**
   * Génère le contenu via IA
   */
  private async generateWithAI(
    templateResult: RenderResult,
    ragContext: RagContextResult | null,
    options: TemplateGenerationOptions
  ): Promise<GeneratedContent> {
    // Construire le prompt enrichi
    const prompt = this.buildGenerationPrompt(templateResult, ragContext, options)

    // Appeler l'IA
    const response = await this.callAI(prompt, {
      model: options.model || 'gpt-4o',
      temperature: options.temperature || 0.7,
      maxTokens: options.maxTokens || 4000,
    })

    // Parser la réponse
    return this.parseGeneratedContent(response)
  }

  /**
   * Construit le prompt de génération
   */
  private buildGenerationPrompt(
    templateResult: RenderResult,
    ragContext: RagContextResult | null,
    options: TemplateGenerationOptions
  ): string {
    const parts: string[] = []

    // Contexte du site
    parts.push(`# Génération de Contenu

## Site
- Platform: ${options.platform}
- Type de contenu: ${options.contentTypeKey}
- Mot-clé principal: ${options.context.primaryKeyword || 'Non spécifié'}
- Mots-clés secondaires: ${options.context.secondaryKeywords?.join(', ') || 'Aucun'}
${options.context.location ? `- Localisation: ${options.context.location}` : ''}
`)

    // Template/Instructions
    parts.push(`## Instructions de Génération
${templateResult.fields.main_content ?
  `# Instructions pour le corps principal:
${(templateResult.fields.main_content as Record<string, unknown>)?.instructions || ''}` :
  `Génère du contenu pertinent sur le sujet.`}

## Requirements SEO
- Longueur cible: ${options.context.targetWordCount || 1000} mots
- Format: ${options.context.contentFormat || 'article'}
${options.context.includeFaq ? '- Inclure une section FAQ' : ''}
`)

    // Contexte RAG
    if (ragContext && ragContext.similarExamples.length > 0) {
      parts.push(`## Contenu Existant Similaire (pour référence)
Les exemples suivants peuvent servir de guide pour le style et le ton:
`)
      ragContext.similarExamples.slice(0, 3).forEach((example, i) => {
        parts.push(`### Exemple ${i + 1}: ${example.title}
${example.content.slice(0, 500)}...
`)
      })
    }

    // Taxonomie
    if (options.context.categories?.length || options.context.tags?.length) {
      parts.push(`## Catégories et Tags suggérés
- Catégories: ${options.context.categories?.join(', ') || 'À déterminer'}
- Tags: ${options.context.tags?.join(', ') || 'À déterminer'}
`)
    }

    // Local Business
    if (options.context.localBusiness) {
      parts.push(`## Contexte Local Business
- Nom: ${options.context.localBusiness.name}
- Type: ${options.context.localBusiness.type}
${options.context.localBusiness.address ? `- Adresse: ${options.context.localBusiness.address}` : ''}
${options.context.localBusiness.phone ? `- Téléphone: ${options.context.localBusiness.phone}` : ''}
`)
    }

    // Instructions de format
    parts.push(`## Format de Sortie
Réponds UNIQUEMENT avec un JSON valide sans markdown:

\`\`\`json
{
  "title": "Titre SEO optimisé",
  "content": "Contenu HTML complet...",
  "excerpt": "Résumé de 2-3 phrases...",
  "metaTitle": "Meta title (max 60 chars)",
  "metaDescription": "Meta description (120-160 chars)",
  "slug": "url-friendly-slug",
  "focusKeyword": "${options.context.primaryKeyword || ''}",
  "faq": [
    { "question": "Question 1?", "answer": "Réponse 1..." }
  ]
}
\`\`\`
`)

    return parts.join('\n')
  }

  /**
   * Appelle l'IA
   */
  private async callAI(
    prompt: string,
    options: { model: string; temperature: number; maxTokens: number }
  ): Promise<string> {
    if (this.openAiClient) {
      const response = await this.openAiClient.chat.completions.create({
        model: options.model,
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert SEO et rédacteur de contenu web français. Réponds UNIQUEMENT avec le JSON demandé.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        response_format: { type: 'json_object' },
      })

      return response.choices[0]?.message?.content || '{}'
    } else if (this.anthropicClient) {
      const response = await this.anthropicClient.messages.create({
        model: options.model.includes('claude') ? options.model : 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        system: 'Tu es un expert SEO et rédacteur de contenu web français. Réponds UNIQUEMENT avec le JSON demandé.',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      const text = response.content[0]
      if (text?.type === 'text') {
        return text.text
      }
      return '{}'
    } else {
      throw new Error('No AI client configured')
    }
  }

  /**
   * Parse le contenu généré
   */
  private parseGeneratedContent(raw: string): GeneratedContent {
    try {
      let jsonStr = raw.trim()
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '')
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '')
      }

      const parsed = JSON.parse(jsonStr)

      return {
        title: parsed.title || '',
        content: parsed.content || '',
        excerpt: parsed.excerpt,
        metaTitle: parsed.metaTitle,
        metaDescription: parsed.metaDescription,
        slug: parsed.slug,
        focusKeyword: parsed.focusKeyword,
        categories: parsed.categories,
        tags: parsed.tags,
        faq: parsed.faq,
        schemaMarkup: parsed.schemaMarkup,
        wordpressFields: parsed.wordpressFields,
        sanityFields: parsed.sanityFields,
      }
    } catch (error) {
      console.error('Failed to parse generated content:', error)
      throw new Error('La réponse IA n\'est pas un JSON valide')
    }
  }

  /**
   * Valide le contenu généré
   */
  private validateOutput(
    content: GeneratedContent,
    requirements: ContentTemplate['seoRequirements']
  ): ContentValidation {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Word count
    const wordCount = content.content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length
    if (requirements.minWordCount && wordCount < requirements.minWordCount) {
      errors.push({
        field: 'content',
        message: `Le contenu (${wordCount} mots) est en dessous du minimum requis (${requirements.minWordCount})`,
        code: 'WORD_COUNT_TOO_LOW',
      })
    }

    // Meta title
    if (requirements.metaTitle && content.metaTitle) {
      const len = content.metaTitle.length
      if (len < requirements.metaTitle.minLength) {
        errors.push({
          field: 'metaTitle',
          message: `Meta title trop court (${len}/${requirements.metaTitle.minLength} chars)`,
          code: 'META_TITLE_TOO_SHORT',
        })
      }
      if (len > requirements.metaTitle.maxLength) {
        warnings.push({
          field: 'metaTitle',
          message: `Meta title dépasse la longueur recommandée (${len}/${requirements.metaTitle.maxLength} chars)`,
        })
      }
    }

    // Meta description
    if (requirements.metaDescription && content.metaDescription) {
      const len = content.metaDescription.length
      if (len < requirements.metaDescription.minLength) {
        errors.push({
          field: 'metaDescription',
          message: `Meta description trop courte (${len}/${requirements.metaDescription.minLength} chars)`,
          code: 'META_DESC_TOO_SHORT',
        })
      }
      if (len > requirements.metaDescription.maxLength) {
        warnings.push({
          field: 'metaDescription',
          message: `Meta description dépasse la longueur recommandée (${len}/${requirements.metaDescription.maxLength} chars)`,
        })
      }
    }

    // Keyword density
    if (content.focusKeyword && content.content) {
      const density = this.calculateKeywordDensity(content.content, content.focusKeyword)
      if (requirements.keywordDensity) {
        if (density < requirements.keywordDensity.min) {
          warnings.push({
            field: 'content',
            message: `Densité du mot-clé (${density.toFixed(2)}%) en dessous du minimum (${requirements.keywordDensity.min}%)`,
          })
        }
        if (density > requirements.keywordDensity.max) {
          warnings.push({
            field: 'content',
            message: `Densité du mot-clé (${density.toFixed(2)}%) au-dessus du maximum (${requirements.keywordDensity.max}%)`,
          })
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  private calculateKeywordDensity(content: string, keyword: string): number {
    const words = content.toLowerCase().replace(/<[^>]*>/g, '').split(/\s+/)
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

  private generateMetaDescription(context: GenerationContext): string {
    if (context.primaryKeyword) {
      return `${context.topic || context.title} - Découvrez tout ce qu'il faut savoir sur ${context.primaryKeyword}${context.location ? ` à ${context.location}` : ''}.`
    }
    return ''
  }

  private createDefaultTemplate(platform: string, contentTypeKey: string): ContentTemplate {
    return {
      id: `default-${platform}-${contentTypeKey}`,
      name: `Default ${contentTypeKey} (${platform})`,
      platform: platform as 'wordpress' | 'sanity' | 'nextjs',
      contentTypeKey,
      structure: {
        sections: [
          {
            id: 'main_content',
            name: 'Corps Principal',
            type: 'main_content',
            instructions: 'Génère du contenu pertinent et bien structuré.',
            config: { targetWords: 800 },
          },
        ],
        requiredFields: ['title', 'content'],
        optionalFields: [],
        fieldMapping: [],
        blocks: [],
      },
      variants: [],
      seoRequirements: {
        minWordCount: 500,
        targetWordCount: 1000,
      },
      config: {},
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}

// ─── Types internes ───────────────────────────────────────────────────────────

interface RagContextResult {
  similarExamples: Array<{
    title: string
    content: string
    score: number
    url?: string
  }>
  sources: RagSource[]
  taxonomyContext?: {
    taxonomies: Array<{ key: string }>
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRagGeneratorWithTemplates(
  openAiClient?: OpenAI,
  anthropicClient?: Anthropic
): RagGeneratorWithTemplates {
  return new RagGeneratorWithTemplates(openAiClient, anthropicClient)
}
