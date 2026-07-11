// ─────────────────────────────────────────────────────────────────────────────
// Semantic Search Service
// SEO Engine - RAG Infrastructure
// High-level search interface for content generation
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import type { SupabaseVectorStore } from './providers/SupabaseVectorStore'
import type {
  SearchConfig,
  SearchResult,
  SimilarityQuery,
  VectorSearchFilters,
  RagContext,
  RagContextParams,
} from './VectorStore'

/**
 * Configuration de recherche sémantique
 */
export interface SemanticSearchOptions {
  siteId?: string
  contentTypeKey?: string
  documentTypes?: string[]
  taxonomyTerms?: string[]
  dateRange?: {
    start: string
    end: string
  }
  minWordCount?: number
  maxWordCount?: number
  limit?: number
  minScore?: number
}

/**
 * Résultats de recherche enrichis
 */
export interface EnrichedSearchResult extends SearchResult {
  highlights: string[]
  sourceUrl?: string
  publishedAt?: string
  author?: string
}

/**
 * Service de recherche sémantique de haut niveau
 */
export class SemanticSearchService {
  private vectorStore: SupabaseVectorStore
  private supabase = createServiceClient()

  constructor(vectorStore: SupabaseVectorStore) {
    this.vectorStore = vectorStore
  }

  /**
   * Recherche sémantique avec highlighting
   */
  async semanticSearch(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<EnrichedSearchResult[]> {
    const config: SearchConfig = {
      query,
      siteId: options.siteId,
      contentTypeKey: options.contentTypeKey,
      documentTypes: options.documentTypes as any,
      limit: options.limit || 10,
      minScore: options.minScore || 0.7,
    }

    const results = await this.vectorStore.search(config)

    // Enrichir les résultats
    return Promise.all(
      results.map(async (result) => this.enrichResult(result))
    )
  }

  /**
   * Trouve des exemples similaires pour un type de contenu
   */
  async findSimilarExamples(
    contentTypeKey: string,
    topic: string,
    options: {
      siteId?: string
      limit?: number
      excludeIds?: string[]
    } = {}
  ): Promise<EnrichedSearchResult[]> {
    const query: SimilarityQuery = {
      content: topic,
      siteId: options.siteId,
      contentTypeKey,
      limit: options.limit || 5,
      threshold: 0.75,
    }

    const results = await this.vectorStore.findSimilar(query)

    // Filtrer les exclusions
    const filtered = results.filter(
      r => !options.excludeIds?.includes(r.id)
    )

    return Promise.all(
      filtered.map(r => this.enrichResult(r))
    )
  }

  /**
   * Recherche par filtres sans embedding (filtrage pur)
   */
  async searchByFilters(
    filters: VectorSearchFilters,
    limit = 10
  ): Promise<EnrichedSearchResult[]> {
    const results = await this.vectorStore.searchByMetadata(filters, limit)

    return Promise.all(
      results.map(r => this.enrichResult(r))
    )
  }

  /**
   * Construit un contexte RAG complet pour la génération
   */
  async buildRagContext(params: RagContextParams): Promise<RagContext> {
    return this.vectorStore.buildRagContext(params)
  }

  /**
   * Trouve des articles internes pertinents pour lier
   */
  async findInternalLinkTargets(
    topic: string,
    siteId: string,
    options: {
      limit?: number
      existingLinks?: string[]
    } = {}
  ): Promise<InternalLinkTarget[]> {
    const results = await this.semanticSearch(topic, {
      siteId,
      documentTypes: ['content'],
      limit: options.limit || 5,
    })

    return results
      .filter(r => !options.existingLinks?.includes(r.id))
      .map(r => ({
        id: r.id,
        title: r.metadata.title || 'Untitled',
        url: r.metadata.url || '',
        score: r.score,
        excerpt: r.metadata.excerpt || r.content.slice(0, 150) + '...',
      }))
  }

  /**
   * Trouve des gaps de contenu (keywords sans contenu)
   */
  async findContentGaps(
    siteId: string,
    keywords: string[]
  ): Promise<ContentGap[]> {
    const gaps: ContentGap[] = []

    for (const keyword of keywords) {
      const results = await this.semanticSearch(keyword, {
        siteId,
        limit: 1,
        minScore: 0.8,
      })

      if (results.length === 0) {
        // Vérifier si le keyword existe quelque part
        const allResults = await this.vectorStore.searchByMetadata(
          { siteId },
          100
        )

        const hasPartialMatch = allResults.some(r =>
          r.content.toLowerCase().includes(keyword.toLowerCase())
        )

        gaps.push({
          keyword,
          existingContent: hasPartialMatch,
          priority: 'high',
          suggestedApproach: this.suggestContentApproach(keyword),
        })
      }
    }

    return gaps
  }

  /**
   * Suggère des variations de contenu basées sur l'existant
   */
  async suggestContentVariations(
    sourceId: string,
    topic: string
  ): Promise<ContentVariation[]> {
    const source = await this.vectorStore.searchByMetadata(
      { siteId: '' }, // TODO: récupérer le siteId depuis le document
      1
    ).then(results => results.find(r => r.id === sourceId))

    if (!source) {
      return []
    }

    // Trouver des documents similaires
    const similar = await this.findSimilarExamples(
      source.metadata.contentTypeKey || 'post',
      topic,
      { excludeIds: [sourceId], limit: 5 }
    )

    return similar.map(s => ({
      sourceId: sourceId,
      targetTitle: s.metadata.title || topic,
      similarityScore: s.score,
      differences: this.identifyDifferences(source.content, s.content),
    }))
  }

  /**
   * Aggregate content statistics for a site
   */
  async getSiteContentStats(siteId: string): Promise<SiteContentStats> {
    const { data, error } = await this.supabase
      .from('vector_embeddings')
      .select(`
        document_type,
        content_type_key,
        word_count,
        focus_keyword,
        created_at
      `)
      .eq('site_id', siteId)

    if (error || !data) {
      return {
        totalDocuments: 0,
        byType: {},
        byContentType: {},
        averageWordCount: 0,
        topKeywords: [],
      }
    }

    const stats: SiteContentStats = {
      totalDocuments: data.length,
      byType: {},
      byContentType: {},
      averageWordCount: 0,
      topKeywords: [],
    }

    let totalWords = 0
    const keywordCounts: Record<string, number> = {}

    for (const row of data) {
      // Count by type
      const docType = row.document_type || 'unknown'
      stats.byType[docType] = (stats.byType[docType] || 0) + 1

      // Count by content type
      const contentType = row.content_type_key || 'unknown'
      stats.byContentType[contentType] = (stats.byContentType[contentType] || 0) + 1

      // Word count
      if (row.word_count) {
        totalWords += row.word_count
      }

      // Keywords
      if (row.focus_keyword) {
        keywordCounts[row.focus_keyword] = (keywordCounts[row.focus_keyword] || 0) + 1
      }
    }

    // Calculate averages
    const docsWithWords = data.filter(r => r.word_count).length
    if (docsWithWords > 0) {
      stats.averageWordCount = Math.round(totalWords / docsWithWords)
    }

    // Top keywords
    stats.topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }))

    return stats
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private async enrichResult(result: SearchResult): Promise<EnrichedSearchResult> {
    const highlights = this.extractHighlights(result.content, result.score)

    return {
      ...result,
      highlights,
      sourceUrl: result.metadata.url,
      publishedAt: result.metadata.createdAt,
    }
  }

  private extractHighlights(content: string, score: number): string[] {
    const highlights: string[] = []
    const maxHighlights = 3

    // Extract sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20)

    // Take the most relevant sentences (first ones usually)
    for (let i = 0; i < Math.min(sentences.length, maxHighlights); i++) {
      const sentence = sentences[i].trim()
      if (sentence.length > 50) {
        highlights.push(sentence.slice(0, 200) + (sentence.length > 200 ? '...' : ''))
      }
    }

    return highlights
  }

  private suggestContentApproach(keyword: string): string {
    // Simple heuristic based on keyword patterns
    const lower = keyword.toLowerCase()

    if (lower.includes('how to') || lower.includes('tutoriel')) {
      return 'Tutorial-style article with step-by-step instructions'
    }
    if (lower.includes('best') || lower.includes('top')) {
      return 'Comparison or listicle format'
    }
    if (lower.includes('vs') || lower.includes('versus')) {
      return 'Comparison article'
    }
    if (lower.includes('guide') || lower.includes('conseils')) {
      return 'Comprehensive guide with multiple sections'
    }
    if (lower.includes('review') || lower.includes('avis')) {
      return 'Review format with pros/cons'
    }

    return 'Standard informational article'
  }

  private identifyDifferences(content1: string, content2: string): string[] {
    const differences: string[] = []

    // Simple word-based comparison
    const words1 = new Set(content1.toLowerCase().split(/\s+/))
    const words2 = new Set(content2.toLowerCase().split(/\s+/))

    // Words only in content1
    const onlyIn1 = [...words1].filter(w => w.length > 4 && !words2.has(w))
    if (onlyIn1.length > 0) {
      differences.push(`Unique terms in source: ${onlyIn1.slice(0, 5).join(', ')}`)
    }

    // Length difference
    const lenDiff = Math.abs(content1.length - content2.length)
    if (lenDiff > 500) {
      differences.push(`Significant length difference: ${lenDiff} characters`)
    }

    return differences
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InternalLinkTarget {
  id: string
  title: string
  url: string
  score: number
  excerpt: string
}

export interface ContentGap {
  keyword: string
  existingContent: boolean
  priority: 'high' | 'medium' | 'low'
  suggestedApproach: string
}

export interface ContentVariation {
  sourceId: string
  targetTitle: string
  similarityScore: number
  differences: string[]
}

export interface SiteContentStats {
  totalDocuments: number
  byType: Record<string, number>
  byContentType: Record<string, number>
  averageWordCount: number
  topKeywords: Array<{ keyword: string; count: number }>
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let searchService: SemanticSearchService | null = null

export function getSearchService(vectorStore: SupabaseVectorStore): SemanticSearchService {
  if (!searchService) {
    searchService = new SemanticSearchService(vectorStore)
  }
  return searchService
}
