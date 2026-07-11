// ─────────────────────────────────────────────────────────────────────────────
// Unified Context Aggregator
// SEO Engine - Context Enrichment
// Combines all context sources into a single RAG context
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { createSupabaseVectorStore } from '../providers'
import { SemanticSearchService, type EnrichedSearchResult } from '../SemanticSearchService'
import { TaxonomyContextBuilder, type TaxonomyContextConfig } from './TaxonomyContextBuilder'
import { CompetitorContextBuilder, type CompetitorContextConfig } from './CompetitorContextBuilder'
import { GoogleContextBuilder, type GoogleContextConfig } from './GoogleContextBuilder'

/**
 * Configuration de l'agrégateur
 */
export interface UnifiedContextConfig {
  siteId: string
  includeTaxonomy?: boolean
  includeCompetitor?: boolean
  includeGoogle?: boolean
  includeRag?: boolean
  cacheResults?: boolean
  cacheTtlMs?: number
}

/**
 * Configuration des sources
 */
export interface ContextSourcesConfig {
  taxonomy?: TaxonomyContextConfig
  competitor?: CompetitorContextConfig
  google?: GoogleContextConfig
  rag?: {
    maxExamples?: number
    minSimilarity?: number
  }
}

/**
 * Contexte unifié complet
 */
export interface UnifiedContext {
  // Sources
  site: SiteContext
  taxonomy?: TaxonomyContextData
  competitor?: CompetitorContextData
  google?: GoogleContextData
  rag?: RagContextData

  // Agrégés
  keywords: AggregatedKeywords
  topics: AggregatedTopics

  // Contexte pour génération
  generationContext: FullGenerationContext

  // Métadonnées
  metadata: ContextMetadata
}

/**
 * Contexte du site
 */
export interface SiteContext {
  siteId: string
  siteName: string
  platform: 'wordpress' | 'sanity' | 'nextjs'
  url: string
  contentTypes: string[]
  contentCount: number
}

/**
 * Données taxonomiques
 */
export interface TaxonomyContextData {
  taxonomies: string[]
  suggestedTerms: string[]
  primaryCategories: string[]
  suggestedTags: string[]
  hierarchicalContext?: string
}

/**
 * Données concurrentielles
 */
export interface CompetitorContextData {
  competitors: string[]
  gaps: ContentGapSummary[]
  opportunities: OpportunitySummary[]
  recommendations: string[]
  contentFormats: string[]
}

/**
 * Résumé de gap de contenu
 */
export interface ContentGapSummary {
  keyword: string
  priority: 'high' | 'medium' | 'low'
  recommendedFormat: string
}

/**
 * Résumé d'opportunité
 */
export interface OpportunitySummary {
  keyword: string
  intent: 'informational' | 'transactional' | 'navigational'
  suggestedFormat: string
  priority: 'high' | 'medium' | 'low'
}

/**
 * Données Google
 */
export interface GoogleContextData {
  topKeywords: string[]
  trendingTopics: string[]
  localKeywords: string[]
  reviewThemes: string[]
  businessContext?: {
    name: string
    rating: number
  }
  opportunities: string[]
}

/**
 * Données RAG
 */
export interface RagContextData {
  similarExamples: SimilarExample[]
  internalLinks: InternalLinkSuggestion[]
  schemaContext: string[]
}

/**
 * Exemple similaire
 */
export interface SimilarExample {
  title: string
  content: string
  score: number
  url?: string
}

/**
 * Suggestion de lien interne
 */
export interface InternalLinkSuggestion {
  targetTitle: string
  targetUrl: string
  relevanceScore: number
  anchorTextSuggestion?: string
}

/**
 * Keywords agrégés
 */
export interface AggregatedKeywords {
  primary: string[]
  secondary: string[]
  longTail: string[]
  local: string[]
  trending: string[]
  opportunities: KeywordOpportunity[]
}

/**
 * Opportunité de keyword
 */
export interface KeywordOpportunity {
  keyword: string
  source: 'gsc' | 'competitor' | 'taxonomy' | 'rag'
  priority: 'high' | 'medium' | 'low'
  reasoning: string
}

/**
 * Topics agrégés
 */
export interface AggregatedTopics {
  main: string[]
  related: string[]
  trending: string[]
  underserved: string[]
}

/**
 * Contexte complet pour génération
 */
export interface FullGenerationContext {
  // Topic principal
  topic?: string
  primaryKeyword?: string

  // Keywords à utiliser
  keywords: {
    primary: string[]
    secondary: string[]
    toInclude: string[]
    toAvoid: string[]
  }

  // Contexte taxonomique
  taxonomy: {
    categories: string[]
    tags: string[]
    suggestedTerms: string[]
  }

  // Structure suggérée
  structure: {
    suggestedFormat: 'article' | 'guide' | 'list' | 'comparison' | 'tutorial'
    estimatedWordCount: number
    sections: string[]
    requiredElements: string[]
  }

  // Contexte business
  business?: {
    name: string
    rating?: number
    strengths: string[]
    localKeywords: string[]
  }

  // Exemples
  examples: Array<{
    title: string
    content: string
    score: number
  }>

  // Liens internes
  internalLinks: InternalLinkSuggestion[]

  // Instructions finales
  instructions: string

  // Warnings
  warnings: string[]
}

/**
 * Métadonnées du contexte
 */
export interface ContextMetadata {
  siteId: string
  generatedAt: string
  sources: ContextSource[]
  totalTokens?: number
  cacheHit: boolean
}

/**
 * Source de contexte
 */
export interface ContextSource {
  name: string
  type: 'taxonomy' | 'competitor' | 'google' | 'rag' | 'schema'
  itemCount: number
  lastUpdated: string
}

/**
 * Agrégateur de contexte
 */
export class UnifiedContextAggregator {
  private supabase = createServiceClient()
  private config: UnifiedContextConfig
  private sourcesConfig: ContextSourcesConfig
  private cache?: {
    context: UnifiedContext
    expiresAt: number
  }

  constructor(config: UnifiedContextConfig, sourcesConfig: ContextSourcesConfig = {}) {
    this.config = {
      includeTaxonomy: true,
      includeCompetitor: true,
      includeGoogle: true,
      includeRag: true,
      cacheResults: true,
      cacheTtlMs: 300000, // 5 minutes
      ...config,
    }

    this.sourcesConfig = sourcesConfig
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Construit le contexte unifié complet
   */
  async buildContext(): Promise<UnifiedContext> {
    // Vérifier le cache
    if (this.config.cacheResults && this.cache) {
      if (Date.now() < this.cache.expiresAt) {
        return {
          ...this.cache.context,
          metadata: {
            ...this.cache.context.metadata,
            cacheHit: true,
          },
        }
      }
    }

    const startTime = Date.now()
    const sources: ContextSource[] = []

    // 1. Récupérer le contexte du site
    const siteContext = await this.getSiteContext()
    const site: SiteContext = {
      siteId: this.config.siteId,
      siteName: siteContext.name,
      platform: siteContext.type as SiteContext['platform'],
      url: siteContext.url,
      contentTypes: [], // À remplir depuis les données
      contentCount: 0,
    }

    // 2. Construire le contexte taxonomique
    let taxonomyContext: TaxonomyContextData | undefined
    if (this.config.includeTaxonomy) {
      try {
        const taxonomyBuilder = new TaxonomyContextBuilder({
          siteId: this.config.siteId,
          ...this.sourcesConfig.taxonomy,
        })
        const taxonomy = await taxonomyBuilder.buildContext()

        taxonomyContext = {
          taxonomies: taxonomy.taxonomies.map(t => t.label),
          suggestedTerms: taxonomy.suggestions.slice(0, 10).map(s => s.name),
          primaryCategories: taxonomy.suggestions
            .filter(s => taxonomy.taxonomies.find(t => t.key === s.taxonomyKey)?.hierarchical)
            .slice(0, 5)
            .map(s => s.name),
          suggestedTags: taxonomy.suggestions
            .filter(s => !taxonomy.taxonomies.find(t => t.key === s.taxonomyKey)?.hierarchical)
            .slice(0, 10)
            .map(s => s.name),
        }

        sources.push({
          name: 'Taxonomy',
          type: 'taxonomy',
          itemCount: taxonomy.suggestions.length,
          lastUpdated: new Date().toISOString(),
        })
      } catch (error) {
        console.warn('Failed to build taxonomy context:', error)
      }
    }

    // 3. Construire le contexte concurrentiel
    let competitorContext: CompetitorContextData | undefined
    if (this.config.includeCompetitor && this.sourcesConfig.competitor?.targetKeywords) {
      try {
        const competitorBuilder = new CompetitorContextBuilder({
          siteId: this.config.siteId,
          targetKeywords: this.sourcesConfig.competitor.targetKeywords,
        })
        const competitor = await competitorBuilder.buildContext()

        competitorContext = {
          competitors: competitor.competitors.map(c => c.domain),
          gaps: competitor.gaps.map(g => ({
            keyword: g.keyword,
            priority: g.priority,
            recommendedFormat: g.recommendedApproach,
          })),
          opportunities: competitor.opportunities.map(o => ({
            keyword: o.keyword,
            intent: o.intent,
            suggestedFormat: o.suggestedFormat,
            priority: o.intent === 'transactional' ? 'high' : 'medium',
          })),
          recommendations: competitor.recommendations.slice(0, 5).map(r => r.reasoning),
          contentFormats: [...new Set(competitor.opportunities.map(o => o.suggestedFormat))],
        }

        sources.push({
          name: 'Competitor',
          type: 'competitor',
          itemCount: competitor.gaps.length + competitor.opportunities.length,
          lastUpdated: competitor.lastUpdated,
        })
      } catch (error) {
        console.warn('Failed to build competitor context:', error)
      }
    }

    // 4. Construire le contexte Google
    let googleContext: GoogleContextData | undefined
    if (this.config.includeGoogle) {
      try {
        const googleBuilder = new GoogleContextBuilder({
          siteId: this.config.siteId,
          includeGsc: true,
          includeGbp: true,
          ...this.sourcesConfig.google,
        })
        const google = await googleBuilder.buildContext()

        googleContext = {
          topKeywords: google.gsc?.topQueries.slice(0, 10).map(q => q.query) || [],
          trendingTopics: google.gsc?.topQueries.slice(0, 5).map(q => q.query) || [],
          localKeywords: google.localOpportunities
            .filter(o => o.type === 'local')
            .map(o => o.title),
          reviewThemes: google.gbp?.reviewsSummary.commonThemes || [],
          businessContext: google.gbp ? {
            name: google.gbp.businessName,
            rating: google.gbp.rating || 0,
          } : undefined,
          opportunities: google.recommendations.slice(0, 5).map(r => r.action),
        }

        sources.push({
          name: 'Google',
          type: 'google',
          itemCount: (google.gsc?.topQueries.length || 0) + (google.gbp?.reviewsSummary.commonThemes.length || 0),
          lastUpdated: google.lastSyncedAt,
        })
      } catch (error) {
        console.warn('Failed to build Google context:', error)
      }
    }

    // 5. Construire le contexte RAG
    let ragContext: RagContextData | undefined
    if (this.config.includeRag) {
      try {
        const vectorStore = createSupabaseVectorStore(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const searchService = new SemanticSearchService(vectorStore)

        const ragConfig = this.sourcesConfig.rag || {}

        // Chercher des exemples similaires
        const examples = await searchService.findSimilarExamples(
          'post', // À paramétrer
          '', // Topic vide = derniers contenus
          {
            siteId: this.config.siteId,
            limit: ragConfig.maxExamples || 5,
          }
        )

        // Chercher des cibles de liens internes
        const internalLinks = await searchService.findInternalLinkTargets(
          '', // À paramétrer avec le topic
          this.config.siteId,
          { limit: 5 }
        )

        ragContext = {
          similarExamples: examples.map(e => ({
            title: e.metadata.title || 'Untitled',
            content: e.content,
            score: e.score,
            url: e.metadata.url,
          })),
          internalLinks: internalLinks.map(l => ({
            targetTitle: l.title,
            targetUrl: l.url,
            relevanceScore: l.score,
          })),
          schemaContext: [], // À récupérer depuis le schema registry
        }

        sources.push({
          name: 'RAG',
          type: 'rag',
          itemCount: ragContext.similarExamples.length,
          lastUpdated: new Date().toISOString(),
        })
      } catch (error) {
        console.warn('Failed to build RAG context:', error)
      }
    }

    // 6. Agréger les keywords
    const keywords = this.aggregateKeywords(taxonomyContext, competitorContext, googleContext)

    // 7. Agréger les topics
    const topics = this.aggregateTopics(competitorContext, googleContext)

    // 8. Construire le contexte pour génération
    const generationContext = this.buildGenerationContext(
      site,
      taxonomyContext,
      competitorContext,
      googleContext,
      ragContext,
      keywords,
      topics
    )

    const context: UnifiedContext = {
      site,
      taxonomy: taxonomyContext,
      competitor: competitorContext,
      google: googleContext,
      rag: ragContext,
      keywords,
      topics,
      generationContext,
      metadata: {
        siteId: this.config.siteId,
        generatedAt: new Date().toISOString(),
        sources,
        cacheHit: false,
      },
    }

    // Mettre en cache
    if (this.config.cacheResults) {
      this.cache = {
        context,
        expiresAt: Date.now() + (this.config.cacheTtlMs || 300000),
      }
    }

    return context
  }

  /**
   * Construit le contexte pour une génération spécifique
   */
  async buildContextForGeneration(params: {
    topic?: string
    primaryKeyword?: string
    targetWordCount?: number
    format?: 'article' | 'guide' | 'list' | 'comparison' | 'tutorial'
  }): Promise<FullGenerationContext> {
    const context = await this.buildContext()

    // Adapter le contexte selon les params
    return {
      ...context.generationContext,
      topic: params.topic || context.generationContext.topic,
      primaryKeyword: params.primaryKeyword || context.generationContext.primaryKeyword,
      structure: {
        ...context.generationContext.structure,
        estimatedWordCount: params.targetWordCount || context.generationContext.structure.estimatedWordCount,
        suggestedFormat: params.format || context.generationContext.structure.suggestedFormat,
      },
    }
  }

  /**
   * Invalide le cache
   */
  invalidateCache(): void {
    this.cache = undefined
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private async getSiteContext(): Promise<{
    name: string
    type: string
    url: string
  }> {
    // Try federated_sites first (legacy)
    let data = null
    try {
      const result = await this.supabase
        .from('federated_sites')
        .select('name, type, url')
        .eq('id', this.config.siteId)
        .single()
      data = result.data
    } catch {
      data = null
    }

    // Fall back to campaigns table
    if (!data) {
      try {
        const result = await this.supabase
          .from('campaigns')
          .select('business_name, site_url')
          .eq('site_id', this.config.siteId)
          .single()
        data = result.data

        if (data) {
          return {
            name: data.business_name || 'Unknown Site',
            type: 'campaign',
            url: data.site_url || '',
          }
        }
      } catch {
        data = null
      }
    }

    if (!data) {
      return {
        name: 'Site',
        type: 'unknown',
        url: '',
      }
    }

    return {
      name: data.name || 'Unknown Site',
      type: data.type || 'unknown',
      url: data.url || '',
    }
  }

  private aggregateKeywords(
    taxonomy?: TaxonomyContextData,
    competitor?: CompetitorContextData,
    google?: GoogleContextData
  ): AggregatedKeywords {
    const primary: string[] = []
    const secondary: string[] = []
    const longTail: string[] = []
    const local: string[] = []
    const trending: string[] = []
    const opportunities: KeywordOpportunity[] = []

    // Keywords depuis Google (les plus fiables)
    if (google) {
      // Mots-clés à fort volume
      for (const keyword of google.topKeywords.slice(0, 5)) {
        if (!primary.includes(keyword)) {
          primary.push(keyword)
        }
      }

      // Tendances
      trending.push(...google.trendingTopics.slice(0, 5))

      // Locaux
      local.push(...google.localKeywords.slice(0, 10))

      // Opportunités
      for (const opp of google.opportunities.slice(0, 5)) {
        opportunities.push({
          keyword: opp,
          source: 'gsc',
          priority: 'high',
          reasoning: ' Opportunité identifiée par GSC avec haut potentiel',
        })
      }
    }

    // Keywords depuis les concurrents
    if (competitor) {
      // Gaps = opportunités
      for (const gap of competitor.gaps.filter(g => g.priority === 'high')) {
        if (!primary.includes(gap.keyword)) {
          primary.push(gap.keyword)
        }
        opportunities.push({
          keyword: gap.keyword,
          source: 'competitor',
          priority: gap.priority,
          reasoning: `Gap concurrent: ${gap.recommendedFormat}`,
        })
      }

      // Opportunités long tail
      for (const opp of competitor.opportunities) {
        if (opp.keyword.split(/\s+/).length > 3) {
          longTail.push(opp.keyword)
        }
        opportunities.push({
          keyword: opp.keyword,
          source: 'competitor',
          priority: opp.priority,
          reasoning: `Opportunité concurrentielle: ${opp.suggestedFormat}`,
        })
      }
    }

    // Keywords depuis la taxonomie
    if (taxonomy) {
      // Termes suggérés comme secondaires
      secondary.push(...taxonomy.suggestedTerms.slice(0, 10))

      // Catégories
      primary.push(...taxonomy.primaryCategories.slice(0, 3))
    }

    return {
      primary: [...new Set(primary)],
      secondary: [...new Set(secondary)],
      longTail: [...new Set(longTail)].slice(0, 10),
      local: [...new Set(local)],
      trending: [...new Set(trending)],
      opportunities: opportunities.slice(0, 20),
    }
  }

  private aggregateTopics(
    competitor?: CompetitorContextData,
    google?: GoogleContextData
  ): AggregatedTopics {
    const main: string[] = []
    const related: string[] = []
    const trending: string[] = []
    const underserved: string[] = []

    // Topics principaux depuis les opportunités concurrentes
    if (competitor) {
      for (const opp of competitor.opportunities.filter(o => o.priority === 'high')) {
        main.push(opp.keyword)
      }

      // Formats suggérés comme topics
      for (const format of competitor.contentFormats) {
        related.push(format)
      }
    }

    // Tendances depuis Google
    if (google) {
      trending.push(...google.trendingTopics.slice(0, 5))
    }

    // Topics underserved
    if (competitor) {
      for (const gap of competitor.gaps.filter(g => g.priority === 'high')) {
        underserved.push(gap.keyword)
      }
    }

    return {
      main: [...new Set(main)],
      related: [...new Set(related)],
      trending: [...new Set(trending)],
      underserved: [...new Set(underserved)],
    }
  }

  private buildGenerationContext(
    site: SiteContext,
    taxonomy?: TaxonomyContextData,
    competitor?: CompetitorContextData,
    google?: GoogleContextData,
    rag?: RagContextData,
    keywords?: AggregatedKeywords,
    topics?: AggregatedTopics
  ): FullGenerationContext {
    const instructions: string[] = []
    const warnings: string[] = []
    const toInclude: string[] = []
    const toAvoid: string[] = []

    // Instructions générales
    instructions.push(`Site: ${site.siteName} (${site.platform})`)

    // Keywords
    if (keywords) {
      if (keywords.primary.length > 0) {
        instructions.push(`Keywords principaux: ${keywords.primary.slice(0, 3).join(', ')}`)
        toInclude.push(...keywords.primary.slice(0, 5))
      }

      if (keywords.local.length > 0) {
        instructions.push(`Keywords locaux: ${keywords.local.slice(0, 3).join(', ')}`)
        toInclude.push(...keywords.local.slice(0, 5))
      }
    }

    // Taxonomie
    if (taxonomy) {
      if (taxonomy.primaryCategories.length > 0) {
        instructions.push(`Catégories: ${taxonomy.primaryCategories.join(', ')}`)
      }
      if (taxonomy.suggestedTerms.length > 0) {
        instructions.push(`Tags suggérés: ${taxonomy.suggestedTerms.slice(0, 5).join(', ')}`)
      }
    }

    // Business context
    let business: FullGenerationContext['business']
    if (google?.businessContext) {
      business = {
        name: google.businessContext.name,
        rating: google.businessContext.rating,
        strengths: google.reviewThemes.slice(0, 3),
        localKeywords: google.localKeywords.slice(0, 5),
      }
      instructions.push(`Contexte business: ${google.businessContext.name}, note ${google.businessContext.rating}/5`)
    }

    // Recommandations concurrentes
    if (competitor?.recommendations.length) {
      instructions.push(`Recommandations: ${competitor.recommendations[0]}`)
    }

    // Warnings
    if (keywords?.opportunities.some(o => o.source === 'competitor')) {
      warnings.push('Plusieurs opportunités identifiées par l\'analyse concurrentielle.')
    }

    // Déterminer le format
    let suggestedFormat: FullGenerationContext['structure']['suggestedFormat'] = 'article'
    if (competitor?.opportunities.length) {
      const highPriority = competitor.opportunities.find(o => o.priority === 'high')
      if (highPriority) {
        suggestedFormat = highPriority.suggestedFormat as FullGenerationContext['structure']['suggestedFormat']
      }
    }

    return {
      primaryKeyword: keywords?.primary[0],
      keywords: {
        primary: keywords?.primary || [],
        secondary: keywords?.secondary || [],
        toInclude: [...new Set(toInclude)],
        toAvoid: [...new Set(toAvoid)],
      },
      taxonomy: {
        categories: taxonomy?.primaryCategories || [],
        tags: taxonomy?.suggestedTags || [],
        suggestedTerms: taxonomy?.suggestedTerms || [],
      },
      structure: {
        suggestedFormat,
        estimatedWordCount: suggestedFormat === 'guide' ? 2000 : suggestedFormat === 'list' ? 1500 : 1000,
        sections: this.getSectionsForFormat(suggestedFormat),
        requiredElements: this.getRequiredElements(suggestedFormat),
      },
      business,
      examples: rag?.similarExamples || [],
      internalLinks: rag?.internalLinks || [],
      instructions: instructions.join('\n'),
      warnings,
    }
  }

  private getSectionsForFormat(format: string): string[] {
    switch (format) {
      case 'guide':
        return ['Introduction', 'Section principale', 'Sous-sections', 'FAQ', 'Conclusion']
      case 'list':
        return ['Introduction', 'Liste principale', 'Ressources', 'Conclusion']
      case 'tutorial':
        return ['Introduction', 'Prérequis', 'Étapes', 'FAQ', 'Conclusion']
      case 'comparison':
        return ['Introduction', 'Comparaison', 'Tableau', 'Verdict', 'Conclusion']
      default:
        return ['Introduction', 'Corps', 'FAQ', 'Conclusion']
    }
  }

  private getRequiredElements(format: string): string[] {
    switch (format) {
      case 'guide':
        return ['headings', 'lists', 'examples', 'faq']
      case 'list':
        return ['numbered_list', 'images', 'links']
      case 'tutorial':
        return ['numbered_list', 'code_blocks', 'screenshots']
      case 'comparison':
        return ['table', 'pros_cons', 'links']
      default:
        return ['headings', 'faq']
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createUnifiedContextAggregator(
  config: UnifiedContextConfig,
  sourcesConfig?: ContextSourcesConfig
): UnifiedContextAggregator {
  return new UnifiedContextAggregator(config, sourcesConfig)
}
