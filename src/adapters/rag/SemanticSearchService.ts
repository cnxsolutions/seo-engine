// ─────────────────────────────────────────────────────────────────────────────
// Semantic Search Service
// SEO Engine - RAG Infrastructure
// High-level search interface for content generation
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import { DEFAULT_MIN_SCORE, type SupabaseVectorStore } from './providers/SupabaseVectorStore'
import type {
  SearchConfig,
  SearchResult,
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
 * Score above which a keyword counts as already covered by an existing page.
 *
 * Higher than DEFAULT_MIN_SCORE on purpose: a gap is the absence of coverage, so
 * a page that merely brushes the subject must still close it.
 */
export const GAP_COVERAGE_SCORE = 0.5

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
      documentTypes: options.documentTypes as SearchConfig['documentTypes'],
      limit: options.limit || 10,
      // `?? ` and not `|| `: a caller asking for 0 means "no floor", not "0.7".
      minScore: options.minScore ?? DEFAULT_MIN_SCORE,
    }

    const results = await this.vectorStore.search(config)

    // Enrichir les résultats
    return Promise.all(
      results.map(async (result) => this.enrichResult(result))
    )
  }

  /**
   * Trouve des exemples similaires pour un type de contenu.
   *
   * Two changes over the original, both of which decided between "some results"
   * and "never any":
   *   - the 0.75 floor is gone. It is a near-duplicate threshold; a query and a
   *     genuinely related page score well below it;
   *   - when the requested content type has nothing yet — a site whose first
   *     article is not published still only has crawled pages — the search falls
   *     back to every content type, REUSING the embedding already paid for.
   */
  async findSimilarExamples(
    contentTypeKey: string,
    topic: string,
    options: {
      siteId?: string
      limit?: number
      excludeIds?: string[]
      minScore?: number
    } = {}
  ): Promise<EnrichedSearchResult[]> {
    const limit = options.limit || 5
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE
    const overFetch = limit + (options.excludeIds?.length || 0)

    // An empty topic is not a question: embedding it buys a vector pointing
    // nowhere. Callers use it to mean "the latest content", so answer that.
    if (!topic.trim()) {
      return this.searchByFilters(
        { siteId: options.siteId, contentTypeKey, documentTypes: ['content'] },
        overFetch
      ).then(results =>
        results.filter(r => !options.excludeIds?.includes(r.id)).slice(0, limit)
      )
    }

    const embedding = await this.vectorStore.generateEmbedding(topic)

    let results = await this.vectorStore.searchByEmbedding(embedding, {
      siteId: options.siteId,
      contentTypeKey,
      documentTypes: ['content'],
      limit: overFetch,
      minScore,
    })

    if (results.length === 0 && contentTypeKey) {
      results = await this.vectorStore.searchByEmbedding(embedding, {
        siteId: options.siteId,
        documentTypes: ['content'],
        limit: overFetch,
        minScore,
      })
    }

    const filtered = results
      .filter(r => !options.excludeIds?.includes(r.id))
      .slice(0, limit)

    return Promise.all(filtered.map(r => this.enrichResult(r)))
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
    const limit = options.limit || 5

    const results = await this.semanticSearch(topic, {
      siteId,
      documentTypes: ['content'],
      limit: limit + (options.existingLinks?.length || 0),
    })

    // `existingLinks` are slugs and URLs, never row ids — the previous filter
    // compared them to `r.id`, a uuid, so it never excluded anything and the
    // generator was regularly told to link to the page it was writing.
    const excluded = new Set(
      (options.existingLinks || []).map(link => normalizeLinkKey(link)).filter(Boolean)
    )

    return results
      .filter(r => {
        const url = r.metadata.url || ''
        return !excluded.has(normalizeLinkKey(url)) && !excluded.has(r.id)
      })
      .slice(0, limit)
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
      if (!keyword.trim()) continue

      // A gap means "no page really covers this", so the floor here is
      // deliberately HIGHER than a plain search: a loose match is still coverage.
      const results = await this.semanticSearch(keyword, {
        siteId,
        limit: 1,
        minScore: GAP_COVERAGE_SCORE,
      })

      if (results.length === 0) {
        gaps.push({
          keyword,
          existingContent: await this.mentionsKeyword(siteId, keyword),
          priority: 'high',
          suggestedApproach: this.suggestContentApproach(keyword),
        })
      }
    }

    return gaps
  }

  /**
   * Whether the keyword appears verbatim anywhere in the site's indexed text.
   *
   * A counting query: the previous version downloaded 100 full page bodies to
   * run `String.includes` on them, once per keyword.
   */
  private async mentionsKeyword(siteId: string, keyword: string): Promise<boolean> {
    const pattern = keyword.replace(/[%_\\]/g, ' ').trim()
    if (!pattern) return false

    const { count, error } = await this.supabase
      .from('vector_embeddings')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .ilike('content', `%${pattern}%`)

    if (error) return false
    return (count || 0) > 0
  }

  /**
   * Suggère des variations de contenu basées sur l'existant
   */
  async suggestContentVariations(
    sourceId: string,
    topic: string,
    siteId?: string
  ): Promise<ContentVariation[]> {
    // Read the source row directly. The previous version searched a site whose
    // id was the empty string and then looked for `sourceId` in a single result,
    // which could only ever return nothing.
    const { data } = await this.supabase
      .from('vector_embeddings')
      .select('id, content, metadata, site_id')
      .eq('id', sourceId)
      .maybeSingle()

    if (!data) {
      return []
    }

    const source = {
      id: data.id as string,
      content: data.content as string,
      metadata: data.metadata as SearchResult['metadata'],
      siteId: (data.site_id as string) || siteId,
    }

    // Trouver des documents similaires
    const similar = await this.findSimilarExamples(
      source.metadata?.contentTypeKey || 'post',
      topic,
      { siteId: source.siteId, excludeIds: [sourceId], limit: 5 }
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

// ─── Module Helpers ─────────────────────────────────────────────────────────

/**
 * Comparable form of a link, so a slug and a full URL for the same page match.
 * Keeps the path only, without host, leading/trailing slash or query string.
 */
function normalizeLinkKey(link: string): string {
  if (!link) return ''

  let value = link.trim().toLowerCase()

  const schemeless = value.replace(/^https?:\/\/[^/]+/, '')
  if (schemeless !== value) value = schemeless || '/'

  return value.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '')
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
