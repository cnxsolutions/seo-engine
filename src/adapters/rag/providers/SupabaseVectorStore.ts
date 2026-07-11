// ─────────────────────────────────────────────────────────────────────────────
// Supabase pg_vector Implementation
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import type {
  IVectorStore,
  IndexedDocument,
  DocumentMetadata,
  DocumentType,
  IndexConfig,
  SearchResult,
  SearchConfig,
  SimilarityQuery,
  VectorStoreStats,
  EmbeddingConfig,
  IndexingStatus,
  VectorSearchFilters,
  RagContext,
  RagContextParams,
  SchemaIndexInput,
  ContentIndexInput,
  ContentTypeIndexInput,
  FieldIndexInput,
  TaxonomyIndexInput,
  TermIndexInput,
  SeoContext,
} from '../VectorStore'

/**
 * Configuration pour SupabaseVectorStore
 */
export interface SupabaseVectorStoreConfig {
  supabaseUrl: string
  supabaseKey: string
  serviceRoleKey?: string
  embeddingConfig: EmbeddingConfig
}

/**
 * Implémentation Supabase pg_vector du VectorStore
 */
export class SupabaseVectorStore implements IVectorStore {
  private client: SupabaseClient
  private serviceClient: SupabaseClient | null = null
  private embeddingConfig: EmbeddingConfig
  private initialized = false

  constructor(client: SupabaseClient, embeddingConfig?: EmbeddingConfig)
  constructor(config: SupabaseVectorStoreConfig)
  constructor(
    clientOrConfig: SupabaseClient | SupabaseVectorStoreConfig,
    embeddingConfig?: EmbeddingConfig
  ) {
    // Check if it's a config object by looking for supabaseUrl
    if (clientOrConfig && typeof clientOrConfig === 'object' && 'supabaseUrl' in clientOrConfig) {
      const config = clientOrConfig as SupabaseVectorStoreConfig
      // Config object
      this.client = new (require('@supabase/supabase-js').createClient)(
        config.supabaseUrl,
        config.supabaseKey
      )
      if (config.serviceRoleKey) {
        this.serviceClient = new (require('@supabase/supabase-js').createClient)(
          config.supabaseUrl,
          config.serviceRoleKey
        )
      }
      this.embeddingConfig = config.embeddingConfig
    } else {
      // SupabaseClient
      this.client = clientOrConfig as SupabaseClient
      this.embeddingConfig = embeddingConfig || {
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimension: 1536,
      }
    }
  }

  /**
   * Retourne le client service (avec droits admin) ou le client standard
   */
  private getClient(forWrite = false): SupabaseClient {
    return forWrite && this.serviceClient ? this.serviceClient : this.client
  }

  // ─── Configuration ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Vérifier que les tables existent
    const { error } = await this.client
      .from('vector_embeddings')
      .select('id')
      .limit(1)

    if (error) {
      throw new Error(`Vector store not initialized: ${error.message}`)
    }

    this.initialized = true
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('vector_embeddings')
        .select('id')
        .limit(1)

      return !error
    } catch {
      return false
    }
  }

  async getStats(): Promise<VectorStoreStats> {
    const { data, error } = await this.client.rpc('get_vector_store_stats')

    if (error || !data) {
      return {
        totalDocuments: 0,
        documentsByType: {} as Record<DocumentType, number>,
        documentsBySite: {},
        averageDimension: 1536,
      }
    }

    const stats = Array.isArray(data) ? data[0] : data

    return {
      totalDocuments: Number(stats.total_documents) || 0,
      documentsByType: stats.documents_by_type || {},
      documentsBySite: stats.documents_by_site || {},
      averageDimension: Number(stats.avg_dimension) || 1536,
    }
  }

  // ─── Embeddings ────────────────────────────────────────────────────────────

  /**
   * Génère un embedding via OpenAI
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (this.embeddingConfig.provider === 'openai') {
      return this.generateOpenAIEmbedding(text)
    } else if (this.embeddingConfig.provider === 'anthropic') {
      return this.generateAnthropicEmbedding(text)
    } else {
      throw new Error(`Unsupported embedding provider: ${this.embeddingConfig.provider}`)
    }
  }

  /**
   * Génère des embeddings en batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const batchSize = this.embeddingConfig.batchSize || 100
    const results: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      )
      results.push(...batchResults)
    }

    return results
  }

  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    // Use OpenAI API directly instead of LangChain
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.embeddingConfig.model || 'text-embedding-3-small',
        input: text,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`)
    }

    const data = await response.json()
    return data.data[0].embedding
  }

  private async generateAnthropicEmbedding(text: string): Promise<number[]> {
    // Anthropic n'a pas encore d'API d'embeddings
    // On utilise OpenAI comme fallback
    console.warn('Anthropic embeddings not available, using OpenAI fallback')
    return this.generateOpenAIEmbedding(text)
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  async indexDocument(document: IndexedDocument): Promise<string> {
    const embedding = document.embedding || await this.generateEmbedding(document.content)
    const contentHash = this.hashContent(document.content)

    const { data, error } = await this.getClient(true)
      .from('vector_embeddings')
      .insert({
        embedding,
        content: document.content,
        content_hash: contentHash,
        metadata: document.metadata,
        site_id: document.metadata.siteId,
        document_type: document.metadata.documentType,
        content_type_key: document.metadata.contentTypeKey,
        focus_keyword: document.metadata.focusKeyword,
        word_count: document.metadata.wordCount,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        // Duplicate - on met à jour
        const { data: existing } = await this.client
          .from('vector_embeddings')
          .select('id')
          .eq('content_hash', contentHash)
          .single()

        if (existing) {
          await this.updateDocument(existing.id, document)
          return existing.id
        }
      }
      throw new Error(`Failed to index document: ${error.message}`)
    }

    return data.id
  }

  async indexDocuments(documents: IndexedDocument[]): Promise<IndexingStatus> {
    const operationId = crypto.randomUUID()
    const errors: { documentId: string; error: string; timestamp: string }[] = []
    let documentsProcessed = 0
    let documentsFailed = 0

    const startTime = new Date().toISOString()

    // Générer les embeddings en batch
    const texts = documents.map(d => d.content)
    const embeddings = await this.generateEmbeddings(texts)

    // Préparer les données pour insertion
    const records = documents.map((doc, index) => {
      const embedding = doc.embedding || embeddings[index]
      const contentHash = this.hashContent(doc.content)

      return {
        embedding,
        content: doc.content,
        content_hash: contentHash,
        metadata: doc.metadata,
        site_id: doc.metadata.siteId,
        document_type: doc.metadata.documentType,
        content_type_key: doc.metadata.contentTypeKey,
        focus_keyword: doc.metadata.focusKeyword,
        word_count: doc.metadata.wordCount,
      }
    })

    // Insertion par batch de 100
    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)

      const { error } = await this.getClient(true)
        .from('vector_embeddings')
        .upsert(batch, {
          onConflict: 'content_hash',
          ignoreDuplicates: false,
        })

      if (error) {
        documentsFailed += batch.length
        errors.push({
          documentId: 'batch',
          error: error.message,
          timestamp: new Date().toISOString(),
        })
      } else {
        documentsProcessed += batch.length
      }
    }

    const completedAt = new Date().toISOString()

    return {
      operationId,
      status: documentsFailed > 0 ? 'completed' : 'completed',
      documentsProcessed,
      documentsFailed,
      errors,
      startedAt: startTime,
      completedAt,
    }
  }

  async indexSchema(siteId: string, schema: SchemaIndexInput): Promise<IndexingStatus> {
    const documents: IndexedDocument[] = []
    const now = new Date().toISOString()

    // Indexer chaque type de contenu
    for (const contentType of schema.contentTypes) {
      // Document pour le type complet
      const typeContent = this.buildSchemaTypeContent(contentType)
      documents.push({
        id: `${schema.schemaId}-${contentType.key}`,
        content: typeContent,
        metadata: {
          documentId: `${schema.schemaId}-${contentType.key}`,
          documentType: 'schema',
          siteId,
          contentTypeKey: contentType.key,
          title: contentType.label,
          createdAt: now,
          indexedAt: now,
        },
      })

      // Documents pour chaque champ
      for (const field of contentType.fields) {
        const fieldContent = this.buildFieldContent(contentType.key, field)
        documents.push({
          id: `${schema.schemaId}-${contentType.key}-${field.key}`,
          content: fieldContent,
          metadata: {
            documentId: `${schema.schemaId}-${contentType.key}-${field.key}`,
            documentType: 'schema',
            siteId,
            contentTypeKey: contentType.key,
            fieldKey: field.key,
            createdAt: now,
            indexedAt: now,
          },
        })
      }
    }

    // Indexer les taxonomies
    if (schema.taxonomies) {
      for (const taxonomy of schema.taxonomies) {
        const taxonomyContent = this.buildTaxonomyContent(taxonomy)
        documents.push({
          id: `${schema.schemaId}-taxonomy-${taxonomy.key}`,
          content: taxonomyContent,
          metadata: {
            documentId: `${schema.schemaId}-taxonomy-${taxonomy.key}`,
            documentType: 'taxonomy_term',
            siteId,
            taxonomyTerms: taxonomy.terms?.map((t: TermIndexInput) => t.name) || [],
            createdAt: now,
            indexedAt: now,
          },
        })
      }
    }

    return this.indexDocuments(documents)
  }

  async indexContent(siteId: string, content: ContentIndexInput): Promise<IndexingStatus> {
    const documents: IndexedDocument[] = []
    const now = new Date().toISOString()

    for (const doc of content.documents) {
      documents.push({
        id: `${siteId}-${doc.contentTypeKey}-${doc.title.slice(0, 50)}`,
        content: `${doc.title}\n\n${doc.content}`,
        metadata: {
          documentId: `${siteId}-${doc.contentTypeKey}-${doc.title.slice(0, 50)}`,
          documentType: 'content',
          siteId,
          contentTypeKey: doc.contentTypeKey,
          title: doc.title,
          excerpt: doc.excerpt,
          url: doc.url,
          focusKeyword: doc.focusKeyword,
          taxonomyTerms: doc.taxonomyTerms,
          metaDescription: doc.metaDescription,
          wordCount: doc.wordCount,
          hasImages: doc.hasImages,
          hasFaq: doc.hasFaq,
          createdAt: doc.createdAt || now,
          indexedAt: now,
        },
      })
    }

    return this.indexDocuments(documents)
  }

  async updateDocument(id: string, document: Partial<IndexedDocument>): Promise<void> {
    const updates: Record<string, unknown> = {}

    if (document.content !== undefined) {
      updates.content = document.content
      updates.content_hash = this.hashContent(document.content)
      updates.embedding = document.embedding || await this.generateEmbedding(document.content)
    }

    if (document.metadata !== undefined) {
      updates.metadata = document.metadata
      updates.site_id = document.metadata.siteId
      updates.document_type = document.metadata.documentType
      updates.content_type_key = document.metadata.contentTypeKey
      updates.focus_keyword = document.metadata.focusKeyword
      updates.word_count = document.metadata.wordCount
    }

    updates.updated_at = new Date().toISOString()

    const { error } = await this.getClient(true)
      .from('vector_embeddings')
      .update(updates)
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update document: ${error.message}`)
    }
  }

  async deleteDocument(id: string): Promise<void> {
    const { error } = await this.getClient(true)
      .from('vector_embeddings')
      .delete()
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to delete document: ${error.message}`)
    }
  }

  async deleteBySite(siteId: string): Promise<number> {
    const { count, error } = await this.getClient(true)
      .from('vector_embeddings')
      .delete()
      .eq('site_id', siteId)

    if (error) {
      throw new Error(`Failed to delete by site: ${error.message}`)
    }

    return count || 0
  }

  async deleteByContentType(siteId: string, contentTypeKey: string): Promise<number> {
    const { count, error } = await this.getClient(true)
      .from('vector_embeddings')
      .delete()
      .eq('site_id', siteId)
      .eq('content_type_key', contentTypeKey)

    if (error) {
      throw new Error(`Failed to delete by content type: ${error.message}`)
    }

    return count || 0
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  async search(config: SearchConfig): Promise<SearchResult[]> {
    const queryEmbedding = await this.generateEmbedding(config.query)

    let query = this.client
      .rpc('vector_search', {
        p_embedding: queryEmbedding,
        p_limit: config.limit || 10,
        p_threshold: config.minScore || 0.7,
        p_site_id: config.siteId || null,
        p_document_type: config.documentTypes?.[0] || null,
        p_content_type_key: config.contentTypeKey || null,
      })

    const { data, error } = await query

    if (error) {
      throw new Error(`Search failed: ${error.message}`)
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      score: row.score as number,
      metadata: row.metadata as DocumentMetadata,
    }))
  }

  async findSimilar(query: SimilarityQuery): Promise<SearchResult[]> {
    const queryEmbedding = await this.generateEmbedding(query.content)

    let dbQuery = this.client
      .from('vector_embeddings')
      .select('id, content, metadata')
      .eq('document_type', 'content')

    if (query.siteId) {
      dbQuery = dbQuery.eq('site_id', query.siteId)
    }

    if (query.contentTypeKey) {
      dbQuery = dbQuery.eq('content_type_key', query.contentTypeKey)
    }

    if (query.excludeDocumentId) {
      dbQuery = dbQuery.neq('id', query.excludeDocumentId)
    }

    const { data, error } = await dbQuery

    if (error) {
      throw new Error(`Similarity search failed: ${error.message}`)
    }

    // Calculer la similarité manuellement
    const results = (data || [])
      .map((row: Record<string, unknown>) => {
        const metadata = row.metadata as DocumentMetadata
        return {
          id: row.id as string,
          content: row.content as string,
          metadata,
          similarity: this.cosineSimilarity(
            queryEmbedding,
            [] // On n'a pas l'embedding stocké directement
          ),
        }
      })
      .filter(r => !query.threshold || r.similarity >= query.threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, query.limit || 10)

    return results.map(r => ({
      id: r.id,
      content: r.content,
      score: r.similarity,
      metadata: r.metadata,
    }))
  }

  async searchByMetadata(
    filters: VectorSearchFilters,
    limit = 10
  ): Promise<SearchResult[]> {
    let query = this.client
      .from('vector_embeddings')
      .select('id, content, metadata')

    if (filters.siteId) {
      query = query.eq('site_id', filters.siteId)
    }

    if (filters.contentTypeKey) {
      query = query.eq('content_type_key', filters.contentTypeKey)
    }

    if (filters.fieldKey) {
      query = query.eq('metadata->>\'fieldKey\'', filters.fieldKey)
    }

    if (filters.documentTypes?.length) {
      query = query.in('document_type', filters.documentTypes)
    }

    if (filters.taxonomyTerms?.length) {
      query = query.overlaps('metadata->\'taxonomyTerms\'', filters.taxonomyTerms)
    }

    if (filters.dateRange) {
      query = query
        .gte('created_at', filters.dateRange.start)
        .lte('created_at', filters.dateRange.end)
    }

    if (filters.minWordCount !== undefined) {
      query = query.gte('word_count', filters.minWordCount)
    }

    if (filters.maxWordCount !== undefined) {
      query = query.lte('word_count', filters.maxWordCount)
    }

    query = query.limit(limit)

    const { data, error } = await query

    if (error) {
      throw new Error(`Metadata search failed: ${error.message}`)
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      score: 1, // Pas de score pour recherche par metadata
      metadata: row.metadata as DocumentMetadata,
    }))
  }

  // ─── Context Building ───────────────────────────────────────────────────────

  async buildRagContext(params: RagContextParams): Promise<RagContext> {
    // 1. Récupérer le contexte du site
    const siteContext = await this.getSiteContext(params.siteId)

    // 2. Récupérer le contexte du schéma
    const schemaContext = await this.getSchemaContext(params.siteId, params.contentTypeKey)

    // 3. Récupérer le contexte taxonomique
    const taxonomyContext = await this.getTaxonomyContext(params.siteId)

    // 4. Trouver des exemples similaires
    const similarExamples = await this.findSimilar({
      content: `${params.topic || ''} ${(params.keywords || []).join(' ')} ${params.location || ''}`,
      siteId: params.siteId,
      contentTypeKey: params.contentTypeKey,
      limit: params.limit || 5,
    })

    // 5. Récupérer le contexte SEO
    const seoContext = params.keywords?.[0]
      ? await this.getSeoContext(params.siteId, params.keywords[0])
      : null

    return {
      siteContext,
      schemaContext,
      taxonomyContext,
      similarExamples: similarExamples.map(e => ({
        documentId: e.id,
        title: e.metadata.title || 'Untitled',
        content: e.content,
        score: e.score,
        sourceUrl: e.metadata.url,
      })),
      seoContext,
      sources: similarExamples.map(e => ({
        documentId: e.id,
        type: e.metadata.documentType,
        title: e.metadata.title || 'Untitled',
        relevanceScore: e.score,
      })),
    }
  }

  async getExamplesForContentType(
    siteId: string,
    contentTypeKey: string,
    limit = 5
  ): Promise<IndexedDocument[]> {
    const { data, error } = await this.client
      .from('vector_embeddings')
      .select('id, content, metadata')
      .eq('site_id', siteId)
      .eq('content_type_key', contentTypeKey)
      .eq('document_type', 'content')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to get examples: ${error.message}`)
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      metadata: row.metadata as DocumentMetadata,
    }))
  }

  async getSeoContext(_siteId: string, _keyword: string): Promise<SeoContext | null> {
    // TODO: Implémenter avec les données GSC
    return null
  }

  // ─── Maintenance ───────────────────────────────────────────────────────────

  async reindexSite(siteId: string): Promise<IndexingStatus> {
    // Supprimer tous les documents du site
    await this.deleteBySite(siteId)

    // TODO: Re-extract et re-index depuis les sources
    // Pour l'instant, on retourne un statut vide
    return {
      operationId: crypto.randomUUID(),
      status: 'completed',
      documentsProcessed: 0,
      documentsFailed: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
  }

  async cleanup(): Promise<number> {
    const { data, error } = await this.client.rpc('cleanup_expired_cache')

    if (error) {
      throw new Error(`Cleanup failed: ${error.message}`)
    }

    const result = Array.isArray(data) ? data[0] : data
    return Number(result?.deleted_count) || 0
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  private buildSchemaTypeContent(contentType: ContentTypeIndexInput): string {
    const fields = contentType.fields
      .map(f => `- ${f.label} (${f.type})${f.required ? ' [REQUIRED]' : ''}: ${f.description || 'No description'}`)
      .join('\n')

    return `
Content Type: ${contentType.label}
Key: ${contentType.key}
Description: ${contentType.description || 'No description'}

Supported Features: ${contentType.supports?.join(', ') || 'Standard'}

Fields:
${fields}
    `.trim()
  }

  private buildFieldContent(contentTypeKey: string, field: FieldIndexInput): string {
    return `
Field: ${field.label}
Content Type: ${contentTypeKey}
Key: ${field.key}
Type: ${field.type}
Required: ${field.required ? 'Yes' : 'No'}
Description: ${field.description || 'No description'}
Configuration: ${JSON.stringify(field.config || {})}
    `.trim()
  }

  private buildTaxonomyContent(taxonomy: TaxonomyIndexInput): string {
    const terms = taxonomy.terms
      ?.map(t => `- ${t.name}${t.level > 0 ? ` (level ${t.level})` : ''}`)
      .join('\n') || 'No terms'

    return `
Taxonomy: ${taxonomy.label}
Key: ${taxonomy.key}
Hierarchical: ${taxonomy.hierarchical ? 'Yes' : 'No'}

Terms:
${terms}
    `.trim()
  }

  private async getSiteContext(siteId: string): Promise<RagContext['siteContext']> {
    const { data, error } = await this.client
      .from('federated_sites')
      .select('name, type')
      .eq('id', siteId)
      .single()

    if (error || !data) {
      return null
    }

    // Compter les types de contenu
    const { count: contentTypesCount } = await this.client
      .from('content_types')
      .select('id', { count: 'exact', head: true })

    return {
      siteId,
      siteName: data.name,
      siteType: data.type as 'wordpress' | 'sanity',
      existingContentCount: 0,
      contentTypes: [],
    }
  }

  private async getSchemaContext(
    siteId: string,
    contentTypeKey: string
  ): Promise<RagContext['schemaContext']> {
    // TODO: Implémenter complètement
    return {
      contentTypeKey,
      contentTypeLabel: contentTypeKey,
      requiredFields: [],
      optionalFields: [],
      fieldInstructions: '',
    }
  }

  private async getTaxonomyContext(
    siteId: string
  ): Promise<RagContext['taxonomyContext']> {
    // TODO: Implémenter complètement
    return {
      taxonomies: [],
      suggestedTerms: [],
    }
  }
}
