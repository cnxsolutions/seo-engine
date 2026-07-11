// ─────────────────────────────────────────────────────────────────────────────
// Full RAG Integration for SEO Page Generation
// SEO Engine - Complete RAG Context → Prompt Pipeline
// Uses: UnifiedContextAggregator + TemplateEngine + All Context Builders
// ─────────────────────────────────────────────────────────────────────────────

import type { PageType, PlanItemBrief, Campaign } from '@/lib/types'
import { createUnifiedContextAggregator } from '@/src/adapters/rag/context/UnifiedContextAggregator'
import type { UnifiedContextConfig, ContextSourcesConfig, UnifiedContext } from '@/src/adapters/rag/context/UnifiedContextAggregator'
import { createTemplateEngine, type RenderContext } from '@/src/adapters/rag/TemplateEngine'
import { getTemplate, CONTENT_TYPE_TEMPLATES } from '@/src/adapters/rag/TemplateLibrary'
import type { ContentTemplate } from '@/src/core/domain/entities/ContentTemplate'

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface FullRagConfig {
  // Enable/disable RAG
  enabled: boolean

  // Context sources
  includeTaxonomy: boolean
  includeCompetitor: boolean
  includeGoogle: boolean
  includeRag: boolean

  // Templates
  useTemplates: boolean

  // Prompt enrichment
  enrichPrompts: boolean

  // Cache
  cacheResults: boolean
  cacheTtlMs: number

  // Limits
  maxExamples: number
  maxKeywords: number
  maxInternalLinks: number
}

const DEFAULT_CONFIG: FullRagConfig = {
  enabled: true,
  includeTaxonomy: true,
  includeCompetitor: true,
  includeGoogle: true,
  includeRag: true,
  useTemplates: true,
  enrichPrompts: true,
  cacheResults: true,
  cacheTtlMs: 300000, // 5 minutes
  maxExamples: 3,
  maxKeywords: 10,
  maxInternalLinks: 5,
}

// ─── RAG Generation Context ────────────────────────────────────────────────────

// Extended context that includes all fields from UnifiedContext
export interface RagGenerationContext {
  // Unified context data (extended with all fields)
  unified: UnifiedContext

  // Template result
  template: {
    fields: Record<string, unknown>
    instructions: string
  }

  // Enriched prompt blocks
  promptBlocks: PromptBlocks

  // Metrics
  stats: {
    buildTimeMs: number
    sourcesUsed: string[]
    keywordsIncluded: number
    examplesFound: number
    linksSuggested: number
  }
}

export interface PromptBlocks {
  // Taxonomy block
  taxonomy: string

  // Competitor block
  competitor: string

  // Google block
  google: string

  // RAG examples block
  ragExamples: string

  // Internal links block
  internalLinks: string

  // Structure/sections block
  structure: string

  // Instructions block
  instructions: string

  // Anti-duplicate block
  antiDuplicate: string
}

// ─── Main Builder ──────────────────────────────────────────────────────────────

export class FullRagContextBuilder {
  private config: FullRagConfig
  private templateEngine = createTemplateEngine()

  constructor(config: Partial<FullRagConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Build complete RAG context for SEO page generation
   */
  async buildContext(params: {
    siteId: string
    campaign: Campaign
    pageType: PageType
    focusKeyword: string
    secondaryKeywords?: string[]
    city?: string
    department?: string
    existingSlugs?: string[]
    existingKeywords?: string[]
    planBrief?: PlanItemBrief
  }): Promise<RagGenerationContext> {
    const startTime = Date.now()

    if (!this.config.enabled) {
      return this.emptyContext()
    }

    // 1. Build unified context with all sources
    const unifiedContext = await this.buildUnifiedContext(params)

    // 2. Get template for page type
    const templateResult = await this.buildTemplateContext(params, unifiedContext)

    // 3. Build prompt blocks
    const promptBlocks = await this.buildPromptBlocks(params, unifiedContext)

    // 4. Calculate stats
    const stats = {
      buildTimeMs: Date.now() - startTime,
      sourcesUsed: this.getSourcesUsed(unifiedContext),
      keywordsIncluded: this.countKeywords(unifiedContext),
      examplesFound: unifiedContext.generationContext.examples?.length || 0,
      linksSuggested: unifiedContext.generationContext.internalLinks?.length || 0,
    }

    return {
      unified: unifiedContext,
      template: templateResult,
      promptBlocks,
      stats,
    }
  }

  /**
   * Format as markdown prompt block
   */
  formatAsPrompt(context: RagGenerationContext): string {
    const { promptBlocks } = context

    const sections: string[] = []

    // Taxonomy
    if (promptBlocks.taxonomy) {
      sections.push('## CONTEXTE TAXONOMIQUE')
      sections.push(promptBlocks.taxonomy)
      sections.push('')
    }

    // Competitor
    if (promptBlocks.competitor) {
      sections.push('## ANALYSE CONCURRENTIELLE')
      sections.push(promptBlocks.competitor)
      sections.push('')
    }

    // Google
    if (promptBlocks.google) {
      sections.push('## DONNÉES GOOGLE (GSC + GBP)')
      sections.push(promptBlocks.google)
      sections.push('')
    }

    // RAG Examples
    if (promptBlocks.ragExamples) {
      sections.push('## EXEMPLES SIMILAIRES (RAG)')
      sections.push(promptBlocks.ragExamples)
      sections.push('')
    }

    // Internal Links
    if (promptBlocks.internalLinks) {
      sections.push('## MAILLAGE INTERNE')
      sections.push(promptBlocks.internalLinks)
      sections.push('')
    }

    // Structure
    if (promptBlocks.structure) {
      sections.push('## STRUCTURE RECOMMANDÉE')
      sections.push(promptBlocks.structure)
      sections.push('')
    }

    // Instructions
    if (promptBlocks.instructions) {
      sections.push('## INSTRUCTIONS SPÉCIFIQUES')
      sections.push(promptBlocks.instructions)
      sections.push('')
    }

    // Anti-duplicate
    if (promptBlocks.antiDuplicate) {
      sections.push('## ANTI-DUPLICAT')
      sections.push(promptBlocks.antiDuplicate)
    }

    return sections.join('\n')
  }

  /**
   * Format RAG context as a prompt block for AI (alias for formatAsPrompt)
   */
  formatAsPromptBlock(context: RagGenerationContext, pageType?: PageType): string {
    return this.formatAsPrompt(context)
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private async buildUnifiedContext(params: {
    siteId: string
    campaign: Campaign
    pageType: PageType
    focusKeyword: string
    secondaryKeywords?: string[]
  }): Promise<UnifiedContext> {
    const unifiedConfig: UnifiedContextConfig = {
      siteId: params.siteId,
      includeTaxonomy: this.config.includeTaxonomy,
      includeCompetitor: this.config.includeCompetitor,
      includeGoogle: this.config.includeGoogle,
      includeRag: this.config.includeRag,
      cacheResults: this.config.cacheResults,
      cacheTtlMs: this.config.cacheTtlMs,
    }

    const sourcesConfig: ContextSourcesConfig = {
      competitor: {
        siteId: params.siteId,
        targetKeywords: params.campaign.keywords,
      },
      rag: {
        maxExamples: this.config.maxExamples,
      },
    }

    const aggregator = createUnifiedContextAggregator(unifiedConfig, sourcesConfig)
    const context = await aggregator.buildContext()

    return context
  }

  private async buildTemplateContext(
    params: { pageType: PageType; focusKeyword: string; city?: string },
    unifiedContext: UnifiedContext
  ): Promise<{ fields: Record<string, unknown>; instructions: string }> {
    if (!this.config.useTemplates) {
      return { fields: {}, instructions: '' }
    }

    const template = getTemplate('universal', params.pageType) || CONTENT_TYPE_TEMPLATES[params.pageType]

    if (!template) {
      return { fields: {}, instructions: '' }
    }

    const renderContext: RenderContext = {
      title: params.focusKeyword,
      content: unifiedContext.generationContext.topic || params.focusKeyword,
      keywords: unifiedContext.generationContext.keywords.toInclude?.slice(0, this.config.maxKeywords),
      primaryKeyword: params.focusKeyword,
      location: params.city,
      targetWordCount: unifiedContext.generationContext.structure.estimatedWordCount,
      includeFaq: true,
      includeImages: true,
    }

    try {
      const result = await this.templateEngine.render(template, renderContext)
      return {
        fields: result.fields,
        instructions: typeof result.fields.main_content === 'object'
          ? (result.fields.main_content as { instructions?: string })?.instructions || ''
          : String(result.fields.main_content || ''),
      }
    } catch {
      return { fields: {}, instructions: '' }
    }
  }

  private async buildPromptBlocks(
    params: {
      focusKeyword: string
      secondaryKeywords?: string[]
      city?: string
      pageType: PageType
      existingSlugs?: string[]
      existingKeywords?: string[]
    },
    unifiedContext: UnifiedContext
  ): Promise<PromptBlocks> {
    const blocks: PromptBlocks = {
      taxonomy: '',
      competitor: '',
      google: '',
      ragExamples: '',
      internalLinks: '',
      structure: '',
      instructions: '',
      antiDuplicate: '',
    }

    // Taxonomy block
    if (unifiedContext.taxonomy?.primaryCategories?.length || unifiedContext.taxonomy?.suggestedTags?.length) {
      blocks.taxonomy = this.buildTaxonomyBlock(unifiedContext)
    }

    // Competitor block
    if (unifiedContext.generationContext.keywords.toInclude?.length) {
      blocks.competitor = this.buildCompetitorBlock(unifiedContext)
    }

    // Google block (if available)
    if (unifiedContext.keywords.trending?.length || unifiedContext.keywords.local?.length) {
      blocks.google = this.buildGoogleBlock(unifiedContext)
    }

    // RAG Examples
    if (unifiedContext.generationContext.examples?.length) {
      blocks.ragExamples = this.buildRagExamplesBlock(unifiedContext)
    }

    // Internal Links
    if (unifiedContext.generationContext.internalLinks?.length) {
      blocks.internalLinks = this.buildInternalLinksBlock(unifiedContext)
    }

    // Structure
    blocks.structure = this.buildStructureBlock(unifiedContext)

    // Instructions
    blocks.instructions = this.buildInstructionsBlock(params, unifiedContext)

    // Anti-duplicate
    blocks.antiDuplicate = this.buildAntiDuplicateBlock(params)

    return blocks
  }

  private buildTaxonomyBlock(context: UnifiedContext): string {
    const parts: string[] = []

    // Categories
    if (context.taxonomy?.primaryCategories?.length) {
      parts.push(`Catégories suggérées: ${context.taxonomy.primaryCategories.join(', ')}`)
    }

    // Tags
    if (context.taxonomy?.suggestedTags?.length) {
      parts.push(`Tags suggérés: ${context.taxonomy.suggestedTags.slice(0, 10).join(', ')}`)
    }

    // Suggested terms
    if (context.taxonomy?.suggestedTerms?.length) {
      parts.push(`Termes sémantiques: ${context.taxonomy.suggestedTerms.slice(0, 15).join(', ')}`)
    }

    return parts.join('\n')
  }

  private buildCompetitorBlock(context: UnifiedContext): string {
    const parts: string[] = []

    // Keywords to include
    const toInclude = context.generationContext.keywords.toInclude || []
    if (toInclude.length > 0) {
      parts.push(`Keywords à intégrer naturellement:`)
      toInclude.slice(0, this.config.maxKeywords).forEach((kw: string) => {
        parts.push(`- "${kw}"`)
      })
    }

    // Keywords to avoid (if any)
    const toAvoid = context.generationContext.keywords.toAvoid || []
    if (toAvoid.length > 0) {
      parts.push(`\nKeywords à éviter: ${toAvoid.join(', ')}`)
    }

    // Business context
    if (context.generationContext.business) {
      const biz = context.generationContext.business
      parts.push(`\nContexte business: ${biz.name}`)
      if (biz.rating) {
        parts.push(`Note: ${biz.rating}/5`)
      }
      if (biz.strengths?.length) {
        parts.push(`Points forts: ${biz.strengths.join(', ')}`)
      }
    }

    return parts.join('\n')
  }

  private buildGoogleBlock(context: UnifiedContext): string {
    const parts: string[] = []

    // Trending keywords
    if (context.keywords.trending?.length) {
      parts.push(`Tendances actuelles: ${context.keywords.trending.slice(0, 5).join(', ')}`)
    }

    // Local keywords
    if (context.keywords.local?.length) {
      parts.push(`Keywords locaux: ${context.keywords.local.slice(0, 10).join(', ')}`)
    }

    // Opportunities
    const opportunities = context.keywords.opportunities?.slice(0, 5) || []
    if (opportunities.length > 0) {
      parts.push(`\nOpportunités identifiées:`)
      opportunities.forEach((opp: { keyword: string; priority: string; reasoning: string }) => {
        parts.push(`- ${opp.keyword} (${opp.priority}) - ${opp.reasoning}`)
      })
    }

    return parts.join('\n')
  }

  private buildRagExamplesBlock(context: UnifiedContext): string {
    const parts: string[] = []
    const examples = context.generationContext.examples || []

    if (examples.length === 0) return ''

    parts.push('Les exemples suivants peuvent servir de référence pour le style et le ton (NE PAS COPIER, utiliser comme inspiration):')
    parts.push('')

    examples.slice(0, this.config.maxExamples).forEach((ex: { title: string; content: string; score: number }, i: number) => {
      parts.push(`### Exemple ${i + 1}: ${ex.title}`)
      parts.push(`Pertinence: ${Math.round(ex.score * 100)}%`)
      // Include first 400 chars as style reference
      const excerpt = ex.content.slice(0, 400).replace(/<[^>]*>/g, ' ')
      parts.push(excerpt + '...')
      parts.push('')
    })

    return parts.join('\n')
  }

  private buildInternalLinksBlock(context: UnifiedContext): string {
    const parts: string[] = []
    const links = context.generationContext.internalLinks || []

    if (links.length === 0) return ''

    parts.push('Suggestions de pages existantes vers lesquelles créer des liens:')
    parts.push('')

    links.slice(0, this.config.maxInternalLinks).forEach((link: { targetTitle: string; targetUrl: string; anchorTextSuggestion?: string }) => {
      parts.push(`- **${link.targetTitle}**`)
      parts.push(`  URL: ${link.targetUrl}`)
      if (link.anchorTextSuggestion) {
        parts.push(`  Ancre suggérée: "${link.anchorTextSuggestion}"`)
      }
    })

    return parts.join('\n')
  }

  private buildStructureBlock(context: UnifiedContext): string {
    const parts: string[] = []
    const { structure } = context.generationContext

    parts.push(`Format suggéré: ${structure.suggestedFormat}`)
    parts.push(`Nombre de mots estimé: ~${structure.estimatedWordCount}`)
    parts.push('')

    // Sections
    if (structure.sections?.length) {
      parts.push('Sections recommandées:')
      structure.sections.forEach((section: string, i: number) => {
        parts.push(`${i + 1}. ${section}`)
      })
    }

    // Required elements
    if (structure.requiredElements?.length) {
      parts.push('')
      parts.push(`Éléments requis: ${structure.requiredElements.join(', ')}`)
    }

    return parts.join('\n')
  }

  private buildInstructionsBlock(
    params: { focusKeyword: string; city?: string; pageType: PageType },
    context: UnifiedContext
  ): string {
    const parts: string[] = []

    parts.push(`Mot-clé focus: "${params.focusKeyword}"`)
    if (params.city) {
      parts.push(`Ville cible: ${params.city}`)
    }

    // Add format-specific instructions
    const { suggestedFormat } = context.generationContext.structure
    switch (suggestedFormat) {
      case 'guide':
        parts.push('Format: Guide complet avec introduction, sections détaillées, FAQ et conclusion.')
        break
      case 'tutorial':
        parts.push('Format: Tutoriel paso a paso avec instructions claires et exemples.')
        break
      case 'list':
        parts.push('Format: Liste avec introduction, items numérotés et conclusion.')
        break
      case 'comparison':
        parts.push('Format: Comparatif avec tableau, analyse et recommandation finale.')
        break
    }

    // Warnings
    if (context.generationContext.warnings?.length) {
      parts.push('')
      parts.push('⚠️ Avertissements:')
      context.generationContext.warnings.forEach((w: string) => {
        parts.push(`- ${w}`)
      })
    }

    return parts.join('\n')
  }

  private buildAntiDuplicateBlock(params: {
    existingSlugs?: string[]
    existingKeywords?: string[]
  }): string {
    const parts: string[] = []

    // Existing slugs to avoid
    if (params.existingSlugs && params.existingSlugs.length > 0) {
      parts.push(`Slugs existants (NE PAS réutiliser): ${params.existingSlugs.slice(0, 20).join(', ')}`)
    }

    // Existing keywords to vary
    if (params.existingKeywords && params.existingKeywords.length > 0) {
      parts.push(`Keywords déjà ciblés (varier l'angle): ${params.existingKeywords.slice(0, 20).join(', ')}`)
    }

    return parts.join('\n')
  }

  private mapPageTypeToFormat(pageType: PageType): 'article' | 'guide' | 'list' | 'comparison' | 'tutorial' {
    switch (pageType) {
      case 'pillar':
        return 'guide'
      case 'child':
        return 'article'
      case 'comparative':
        return 'comparison'
      case 'alternative':
        return 'list'
      case 'local_pack':
        return 'article'
      default:
        return 'article'
    }
  }

  private getSourcesUsed(context: UnifiedContext): string[] {
    const sources: string[] = []

    if (context.taxonomy?.primaryCategories?.length) sources.push('taxonomy')
    if (context.keywords.primary?.length) sources.push('competitor')
    if (context.keywords.trending?.length || context.keywords.local?.length) sources.push('google')
    if (context.generationContext.examples?.length) sources.push('rag')

    return sources
  }

  private countKeywords(context: UnifiedContext): number {
    const keywords = new Set([
      ...(context.keywords.primary || []),
      ...(context.keywords.secondary || []),
      ...(context.generationContext.keywords.toInclude || []),
      ...(context.keywords.local || []),
      ...(context.keywords.trending || []),
    ])
    return keywords.size
  }

  private emptyContext(): RagGenerationContext {
    return {
      unified: {
        site: {
          siteId: '',
          siteName: '',
          platform: 'wordpress',
          url: '',
          contentTypes: [],
          contentCount: 0,
        },
        keywords: {
          primary: [],
          secondary: [],
          longTail: [],
          local: [],
          trending: [],
          opportunities: [],
        },
        topics: {
          main: [],
          related: [],
          trending: [],
          underserved: [],
        },
        generationContext: {
          keywords: {
            primary: [],
            secondary: [],
            toInclude: [],
            toAvoid: [],
          },
          taxonomy: {
            categories: [],
            tags: [],
            suggestedTerms: [],
          },
          structure: {
            suggestedFormat: 'article' as const,
            estimatedWordCount: 800,
            sections: [],
            requiredElements: [],
          },
          examples: [],
          internalLinks: [],
          instructions: '',
          warnings: [],
        },
        metadata: {
          siteId: '',
          generatedAt: new Date().toISOString(),
          sources: [],
          cacheHit: false,
        },
      },
      template: { fields: {}, instructions: '' },
      promptBlocks: {
        taxonomy: '',
        competitor: '',
        google: '',
        ragExamples: '',
        internalLinks: '',
        structure: '',
        instructions: '',
        antiDuplicate: '',
      },
      stats: {
        buildTimeMs: 0,
        sourcesUsed: [],
        keywordsIncluded: 0,
        examplesFound: 0,
        linksSuggested: 0,
      },
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let cachedBuilder: FullRagContextBuilder | null = null

export function getFullRagContextBuilder(config?: Partial<FullRagConfig>): FullRagContextBuilder {
  if (!cachedBuilder) {
    cachedBuilder = new FullRagContextBuilder(config)
  }
  return cachedBuilder
}

export function createFullRagContextBuilder(config?: Partial<FullRagConfig>): FullRagContextBuilder {
  return new FullRagContextBuilder(config)
}
