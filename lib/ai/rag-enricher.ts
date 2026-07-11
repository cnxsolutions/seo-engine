// ─────────────────────────────────────────────────────────────────────────────
// RAG Context Enricher
// SEO Engine - Integrates RAG context into page generation prompts
// Reuses existing RAG infrastructure without duplication
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { createSupabaseVectorStore } from '@/src/adapters/rag/providers'
import { SemanticSearchService } from '@/src/adapters/rag/SemanticSearchService'
import type { PageType } from '@/lib/types'

// ─── RAG Context Types ─────────────────────────────────────────────────────────

export interface RagEnrichmentContext {
  // Similar content examples for style/tone reference
  similarExamples: RagExample[]

  // Internal link targets for maillage
  internalLinkTargets: InternalLinkTarget[]

  // Content gaps (keywords without coverage)
  contentGaps: ContentGap[]

  // Existing content to avoid duplication
  existingContent: ExistingContentSummary[]

  // Stats
  stats: RagStats
}

export interface RagExample {
  title: string
  content: string
  url?: string
  score: number
  wordCount: number
  pageType: PageType
}

export interface InternalLinkTarget {
  id: string
  title: string
  url: string
  score: number
  excerpt: string
}

export interface ContentGap {
  keyword: string
  priority: 'high' | 'medium' | 'low'
  suggestedApproach: string
}

export interface ExistingContentSummary {
  slug: string
  title: string
  focusKeyword: string
  wordCount: number
  publishedAt?: string
}

export interface RagStats {
  examplesFound: number
  linksFound: number
  gapsFound: number
  enrichmentTimeMs: number
}

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface RagEnrichmentConfig {
  // Enable/disable RAG enrichment
  enabled: boolean

  // Max examples to retrieve
  maxExamples: number

  // Max internal link targets
  maxInternalLinks: number

  // Min similarity score for examples
  minSimilarityScore: number

  // Include content gaps analysis
  includeGaps: boolean

  // Include existing content summary
  includeExisting: boolean

  // Timeout for RAG queries (ms)
  timeoutMs: number
}

const DEFAULT_CONFIG: RagEnrichmentConfig = {
  enabled: true,
  maxExamples: 3,
  maxInternalLinks: 5,
  minSimilarityScore: 0.7,
  includeGaps: true,
  includeExisting: true,
  timeoutMs: 5000,
}

// ─── RAG Context Builder ────────────────────────────────────────────────────────

export class RagContextBuilder {
  private config: RagEnrichmentConfig
  private searchService: SemanticSearchService | null = null
  private supabase = createServiceClient()

  constructor(config: Partial<RagEnrichmentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Build RAG context for page generation
   */
  async buildContext(params: {
    siteId: string
    pageType: PageType
    focusKeyword: string
    secondaryKeywords?: string[]
    city?: string
    department?: string
    existingSlugs?: string[]
    existingKeywords?: string[]
  }): Promise<RagEnrichmentContext> {
    const startTime = Date.now()

    if (!this.config.enabled) {
      return this.emptyContext()
    }

    try {
      // Initialize search service lazily
      await this.ensureSearchService()

      const {
        siteId,
        pageType,
        focusKeyword,
        secondaryKeywords = [],
        city,
        department,
        existingSlugs = [],
        existingKeywords = [],
      } = params

      // Build queries based on page type
      const queries = this.buildQueries(pageType, focusKeyword, city, department)

      // Execute RAG queries in parallel with timeout
      const results = await Promise.allSettled([
        this.fetchSimilarExamples(queries.mainQuery, siteId, pageType),
        this.fetchInternalLinkTargets(focusKeyword, siteId, existingSlugs),
        this.config.includeGaps
          ? this.fetchContentGaps(siteId, [focusKeyword, ...secondaryKeywords])
          : Promise.resolve([]),
        this.config.includeExisting
          ? this.fetchExistingContent(siteId, existingSlugs)
          : Promise.resolve([]),
      ])

      const [examples, links, gaps, existing] = results.map(r =>
        r.status === 'fulfilled' ? r.value : []
      ) as [RagExample[], InternalLinkTarget[], ContentGap[], ExistingContentSummary[]]

      return {
        similarExamples: examples.slice(0, this.config.maxExamples),
        internalLinkTargets: links.slice(0, this.config.maxInternalLinks),
        contentGaps: gaps,
        existingContent: existing,
        stats: {
          examplesFound: examples.length,
          linksFound: links.length,
          gapsFound: gaps.length,
          enrichmentTimeMs: Date.now() - startTime,
        },
      }
    } catch (error) {
      console.warn('[RAG] Failed to build context:', error)
      return this.emptyContext()
    }
  }

  /**
   * Format RAG context as a prompt block for AI
   */
  formatAsPromptBlock(context: RagEnrichmentContext, pageType: PageType): string {
    const blocks: string[] = []

    // Similar examples for style reference
    if (context.similarExamples.length > 0) {
      blocks.push('## CONTEXTE RAG - EXEMPLES SIMILILAIRES')
      blocks.push('Les exemples suivants peuvent servir de référence pour le style et le ton (NE PAS COPIER, utiliser comme inspiration):')
      blocks.push('')

      for (const example of context.similarExamples) {
        blocks.push(`### ${example.title}`)
        blocks.push(`Type: ${example.pageType} | Mots: ${example.wordCount} | Pertinence: ${Math.round(example.score * 100)}%`)
        // Include first 500 chars as style reference
        const excerpt = example.content.slice(0, 500).replace(/<[^>]*>/g, ' ')
        blocks.push(excerpt + '...')
        blocks.push('')
      }
    }

    // Internal links for maillage
    if (context.internalLinkTargets.length > 0 && pageType !== 'pillar') {
      blocks.push('## PAGES EXISTANTES À LIÉER (maillage interne)')
      blocks.push('Suggestions de pages existantes vers lesquelles créer des liens:')
      blocks.push('')

      for (const target of context.internalLinkTargets) {
        blocks.push(`- **${target.title}** (${target.url})`)
        blocks.push(`  Excerpt: ${target.excerpt.slice(0, 100)}...`)
      }
      blocks.push('')
    }

    // Pillar links for child pages
    if (pageType === 'child' && context.internalLinkTargets.length > 0) {
      const pillars = context.internalLinkTargets.filter(t => t.title.toLowerCase().includes('pilier') || t.score > 0.9)
      if (pillars.length > 0) {
        blocks.push('## PAGE PILIER PARENTE')
        blocks.push(`Inclure un lien retour vers la page pilier: ${pillars[0].url}`)
        blocks.push('')
      }
    }

    // Content gaps
    if (context.contentGaps.length > 0) {
      blocks.push('## OPPORTUNITÉS IDENTIFIÉES (gaps de contenu)')
      blocks.push('Keywords sans couverture détaillée actuelle:')
      blocks.push('')

      for (const gap of context.contentGaps.slice(0, 5)) {
        blocks.push(`- **${gap.keyword}** (priorité: ${gap.priority})`)
        blocks.push(`  Approche suggérée: ${gap.suggestedApproach}`)
      }
      blocks.push('')
    }

    // Existing content to avoid duplication
    if (context.existingContent.length > 0) {
      blocks.push('## CONTENU EXISTANT À ÉVITER')
      blocks.push('Ne pas répliquer les sujets/cas suivants (angle différent requis):')
      blocks.push('')

      for (const existing of context.existingContent.slice(0, 3)) {
        blocks.push(`- ${existing.title} (${existing.focusKeyword})`)
      }
      blocks.push('')
    }

    // Stats
    if (context.stats.examplesFound > 0 || context.stats.linksFound > 0) {
      blocks.push(`_RAG: ${context.stats.examplesFound} exemples, ${context.stats.linksFound} liens suggérés, ${context.stats.gapsFound} gaps (${context.stats.enrichmentTimeMs}ms)_`)
    }

    return blocks.join('\n')
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private async ensureSearchService(): Promise<void> {
    if (!this.searchService) {
      const vectorStore = createSupabaseVectorStore(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
      this.searchService = new SemanticSearchService(vectorStore)
    }
  }

  private buildQueries(
    pageType: PageType,
    focusKeyword: string,
    city?: string,
    department?: string
  ): { mainQuery: string; variationQueries: string[] } {
    const queries: string[] = [focusKeyword]

    // Add geographic variations for local SEO
    if (city) {
      queries.push(`${focusKeyword} ${city}`)
      queries.push(`${focusKeyword} ${department || ''}`)
    }

    // Add type-specific variations
    switch (pageType) {
      case 'pillar':
        queries.push(focusKeyword) // Pillar is the main topic
        break
      case 'child':
        queries.push(`${focusKeyword} guide`)
        queries.push(`${focusKeyword} avis`)
        break
      case 'alternative':
        queries.push(`alternative ${focusKeyword}`)
        queries.push(`${focusKeyword} comparatif`)
        break
      case 'comparative':
        queries.push(`${focusKeyword} vs`)
        queries.push(`comparatif ${focusKeyword}`)
        break
      case 'local_pack':
        queries.push(`${focusKeyword} ${city}`)
        queries.push(`urgence ${focusKeyword}`)
        break
    }

    return {
      mainQuery: queries[0],
      variationQueries: queries.slice(1),
    }
  }

  private async fetchSimilarExamples(
    query: string,
    siteId: string,
    pageType: PageType
  ): Promise<RagExample[]> {
    if (!this.searchService) return []

    try {
      const results = await this.searchService.findSimilarExamples(
        'post', // content type
        query,
        {
          siteId,
          limit: this.config.maxExamples + 2, // Fetch extra for filtering
        }
      )

      return results
        .filter(r => (r as unknown as { score: number }).score >= this.config.minSimilarityScore)
        .map(r => {
          const sr = r as unknown as { score: number; content: string; metadata: { title?: string; url?: string } }
          return {
            title: sr.metadata?.title || 'Untitled',
            content: sr.content,
            url: sr.metadata?.url,
            score: sr.score,
            wordCount: sr.content.split(/\s+/).length,
            pageType: pageType,
          } satisfies RagExample
        })
    } catch (error) {
      console.warn('[RAG] Failed to fetch examples:', error)
      return []
    }
  }

  private async fetchInternalLinkTargets(
    keyword: string,
    siteId: string,
    existingSlugs: string[]
  ): Promise<InternalLinkTarget[]> {
    if (!this.searchService) return []

    try {
      const results = await this.searchService.findInternalLinkTargets(
        keyword,
        siteId,
        {
          limit: this.config.maxInternalLinks + 3,
          existingLinks: existingSlugs,
        }
      )

      return results.map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        score: r.score,
        excerpt: r.excerpt,
      }))
    } catch (error) {
      console.warn('[RAG] Failed to fetch internal links:', error)
      return []
    }
  }

  private async fetchContentGaps(
    siteId: string,
    keywords: string[]
  ): Promise<ContentGap[]> {
    if (!this.searchService) return []

    try {
      const gaps = await this.searchService.findContentGaps(siteId, keywords)
      return gaps.map(g => ({
        keyword: g.keyword,
        priority: g.priority,
        suggestedApproach: g.suggestedApproach,
      }))
    } catch (error) {
      console.warn('[RAG] Failed to fetch content gaps:', error)
      return []
    }
  }

  private async fetchExistingContent(
    siteId: string,
    slugs: string[]
  ): Promise<ExistingContentSummary[]> {
    if (slugs.length === 0) return []

    try {
      const { data } = await this.supabase
        .from('generations')
        .select('slug, title, focus_keyword, content, published_url, updated_at')
        .eq('site_id', siteId)
        .in('slug', slugs)
        .eq('status', 'published')
        .limit(10)

      if (!data) return []

      return data.map(g => ({
        slug: g.slug || '',
        title: g.title || '',
        focusKeyword: g.focus_keyword || '',
        wordCount: g.content?.split(/\s+/).length || 0,
        publishedAt: g.updated_at,
      }))
    } catch (error) {
      console.warn('[RAG] Failed to fetch existing content:', error)
      return []
    }
  }

  private emptyContext(): RagEnrichmentContext {
    return {
      similarExamples: [],
      internalLinkTargets: [],
      contentGaps: [],
      existingContent: [],
      stats: {
        examplesFound: 0,
        linksFound: 0,
        gapsFound: 0,
        enrichmentTimeMs: 0,
      },
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let cachedBuilder: RagContextBuilder | null = null

export function getRagContextBuilder(
  config?: Partial<RagEnrichmentConfig>
): RagContextBuilder {
  if (!cachedBuilder) {
    cachedBuilder = new RagContextBuilder(config)
  }
  return cachedBuilder
}

export function createRagContextBuilder(
  config?: Partial<RagEnrichmentConfig>
): RagContextBuilder {
  return new RagContextBuilder(config)
}
