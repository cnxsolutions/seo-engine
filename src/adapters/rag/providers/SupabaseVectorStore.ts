// ─────────────────────────────────────────────────────────────────────────────
// Supabase pg_vector Implementation
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { SupabaseClient, createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import type {
  IVectorStore,
  IndexedDocument,
  DocumentMetadata,
  DocumentType,
  IndexConfig,
  SearchResult,
  SearchConfig,
  EmbeddingSearchConfig,
  SimilarityQuery,
  VectorStoreStats,
  EmbeddingConfig,
  IndexingOutcome,
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

// ─── Embedding constants ──────────────────────────────────────────────────────

/**
 * Dimension of the `embedding VECTOR(1536)` column created by migration 005.
 *
 * This is a hard contract with the database, not a preference: pgvector rejects
 * any vector of another length, so a model switched to `text-embedding-3-large`
 * (3072) would make every insert fail at runtime. `dimensions` is therefore sent
 * on every request and every returned vector is measured before it is written.
 */
export const EMBEDDING_DIMENSION = 1536

/** Model whose native output already matches EMBEDDING_DIMENSION. */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Texts sent per embeddings request.
 *
 * OpenAI's endpoint accepts an array of inputs, so a 50-page crawl costs two
 * HTTP round-trips instead of fifty. 32 × ~2 000 tokens stays an order of
 * magnitude below the 300 000-token request budget while keeping one failed
 * request cheap to retry.
 */
export const EMBEDDING_BATCH_SIZE = 32

/**
 * Hard cap on the characters embedded for one document.
 *
 * `text-embedding-3-small` accepts 8 191 tokens; ~24 000 characters of French
 * prose sit just under that. Anything longer is truncated rather than rejected —
 * the opening of a page carries its topic well enough for retrieval.
 */
export const MAX_EMBEDDING_CHARS = 24000

/**
 * Default cosine-similarity floor for a query-to-document search.
 *
 * Calibration, not taste: with `text-embedding-3-small` a short French query and
 * a genuinely relevant page land around 0.30–0.55 — cosine similarity between a
 * few words and a full page is structurally low. The 0.7 default this code
 * shipped with is a NEAR-DUPLICATE threshold; it discarded every real match and
 * made a correctly filled index look empty.
 */
export const DEFAULT_MIN_SCORE = 0.35

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

  /** Billed embedding requests since construction, for cost observability. */
  private embeddingRequests = 0

  constructor(client: SupabaseClient, embeddingConfig?: EmbeddingConfig)
  constructor(config: SupabaseVectorStoreConfig)
  constructor(
    clientOrConfig: SupabaseClient | SupabaseVectorStoreConfig,
    embeddingConfig?: EmbeddingConfig
  ) {
    // Discriminate on a method only a client has, never on `supabaseUrl`.
    //
    // `SupabaseClient` exposes its own `supabaseUrl` property at runtime (the
    // `protected` keyword is erased by TypeScript), so `'supabaseUrl' in x` is
    // TRUE for a client as well as for a config object. Every caller passing a
    // real client therefore took the config branch, read `config.embeddingConfig`
    // — which a client does not have — and threw
    // "Cannot read properties of undefined (reading 'dimension')".
    //
    // The whole RAG context was lost to this: the builder caught the throw and
    // carried on, so pages were generated with competitor context only and no
    // semantic retrieval at all, silently.
    const looksLikeClient = typeof (clientOrConfig as SupabaseClient)?.from === 'function'

    if (!looksLikeClient && clientOrConfig && typeof clientOrConfig === 'object' && 'supabaseUrl' in clientOrConfig) {
      const config = clientOrConfig as SupabaseVectorStoreConfig
      // Config object.
      //
      // Statically imported, not `require()`d. This module is ESM: `require` is
      // not defined at runtime, so this branch could only throw the moment
      // anyone constructed the store from a config object rather than from a
      // client. It was also calling `createClient` with `new` — it is a factory
      // function, not a constructor.
      this.client = createClient(config.supabaseUrl, config.supabaseKey)
      if (config.serviceRoleKey) {
        this.serviceClient = createClient(config.supabaseUrl, config.serviceRoleKey)
      }
      this.embeddingConfig = config.embeddingConfig
    } else {
      // SupabaseClient
      this.client = clientOrConfig as SupabaseClient
      this.embeddingConfig = embeddingConfig || {
        provider: 'openai',
        model: DEFAULT_EMBEDDING_MODEL,
        dimension: EMBEDDING_DIMENSION,
      }
    }

    // The column is VECTOR(1536). Accepting another dimension here would only
    // move the failure to insert time, one paid embedding batch later.
    if (this.embeddingConfig.dimension !== EMBEDDING_DIMENSION) {
      console.warn(
        `[vector-store] embedding dimension ${this.embeddingConfig.dimension} does not match the vector_embeddings column (${EMBEDDING_DIMENSION}); forcing ${EMBEDDING_DIMENSION}`
      )
      this.embeddingConfig = { ...this.embeddingConfig, dimension: EMBEDDING_DIMENSION }
    }
  }

  /** Billed embedding requests made by this instance. */
  getEmbeddingRequestCount(): number {
    return this.embeddingRequests
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
    const [embedding] = await this.generateEmbeddings([text])
    return embedding
  }

  /**
   * Génère des embeddings en batch.
   *
   * One request per EMBEDDING_BATCH_SIZE texts, not one per text: the previous
   * implementation fanned out `Promise.all` over 100 individual HTTP calls,
   * which is how a 50-page crawl used to look like a rate-limit attack.
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    if (this.embeddingConfig.provider === 'anthropic') {
      // Anthropic ships no embeddings API; OpenAI is the only backend here.
      console.warn('[vector-store] Anthropic embeddings not available, using OpenAI')
    } else if (this.embeddingConfig.provider !== 'openai') {
      throw new Error(`Unsupported embedding provider: ${this.embeddingConfig.provider}`)
    }

    const batchSize = this.embeddingConfig.batchSize || EMBEDDING_BATCH_SIZE
    const results: number[][] = []

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      results.push(...(await this.embedOpenAIBatch(batch)))
    }

    return results
  }

  private async embedOpenAIBatch(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const model = this.embeddingConfig.model || DEFAULT_EMBEDDING_MODEL

    const body: Record<string, unknown> = {
      model,
      // The API rejects an empty input. Substituting a placeholder keeps the
      // response aligned with the batch instead of failing all 32 documents
      // because one of them happened to be blank.
      input: texts.map(text => truncateForEmbedding(text).trim() || '(vide)'),
    }

    // Only the text-embedding-3 family accepts `dimensions`; ada-002 rejects the
    // parameter outright. Sending it is what pins any 3-* model to the column
    // width instead of letting 3-large return 3072 floats the table cannot store.
    if (model.startsWith('text-embedding-3')) {
      body.dimensions = this.embeddingConfig.dimension
    }

    this.embeddingRequests++

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`OpenAI embeddings error ${response.status}: ${detail.slice(0, 300) || response.statusText}`)
    }

    const data = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>
    }

    if (!data.data || data.data.length !== texts.length) {
      throw new Error(
        `OpenAI embeddings returned ${data.data?.length ?? 0} vectors for ${texts.length} inputs`
      )
    }

    // The API documents that results may come back out of order.
    const ordered = [...data.data].sort((a, b) => a.index - b.index).map(d => d.embedding)

    for (const vector of ordered) {
      if (vector.length !== this.embeddingConfig.dimension) {
        throw new Error(
          `Embedding model "${model}" returned ${vector.length} dimensions, but vector_embeddings.embedding is VECTOR(${this.embeddingConfig.dimension})`
        )
      }
    }

    return ordered
  }

  // ─── Indexing ──────────────────────────────────────────────────────────────

  async indexDocument(document: IndexedDocument): Promise<string> {
    const outcome = await this.indexDocuments([document])

    if (outcome.documentsFailed > 0) {
      throw new Error(`Failed to index document: ${outcome.errors[0]?.error ?? 'unknown error'}`)
    }

    return documentKeyOf(document)
  }

  /**
   * Indexes a batch of documents, paying only for what actually changed.
   *
   * Order matters and is the whole point:
   *   1. de-duplicate on the document key — two identical keys in one payload
   *      make PostgreSQL reject the entire statement ("ON CONFLICT DO UPDATE
   *      cannot affect row a second time"), and a crawl produces duplicates
   *      routinely (pagination stubs, empty archives);
   *   2. read the hashes already stored for those keys and drop the unchanged
   *      ones BEFORE embedding — embeddings are billed, and re-embedding a site
   *      that has not moved is pure loss;
   *   3. embed and upsert what is left, per batch, so one failing batch does not
   *      discard the ones that succeeded.
   */
  async indexDocuments(documents: IndexedDocument[]): Promise<IndexingOutcome> {
    const operationId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const errors: { documentId: string; error: string; timestamp: string }[] = []
    const embeddingRequestsBefore = this.embeddingRequests

    let documentsProcessed = 0
    let documentsFailed = 0
    let documentsSkipped = 0

    // ─── 1. De-duplicate on the document key (last occurrence wins) ───────────
    const byKey = new Map<string, IndexedDocument>()
    for (const doc of documents) {
      const key = documentKeyOf(doc)
      if (byKey.has(key)) documentsSkipped++
      byKey.set(key, doc)
    }

    // ─── 2. Drop documents whose content has not moved ────────────────────────
    const candidates = [...byKey.entries()].map(([key, doc]) => ({
      key,
      doc,
      hash: this.hashContent(doc.content),
    }))

    const knownHashes = await this.getStoredHashes(candidates.map(c => ({
      siteId: c.doc.metadata.siteId,
      key: c.key,
    })))

    const changed = candidates.filter(candidate => {
      const known = knownHashes.get(hashLookupKey(candidate.doc.metadata.siteId, candidate.key))
      if (known === candidate.hash) {
        documentsSkipped++
        return false
      }
      return true
    })

    if (changed.length === 0) {
      return {
        operationId,
        status: 'completed',
        documentsProcessed: 0,
        documentsFailed: 0,
        documentsSkipped,
        embeddingRequests: 0,
        errors,
        startedAt,
        completedAt: new Date().toISOString(),
      }
    }

    // ─── 3. Embed and write, batch by batch ───────────────────────────────────
    const batchSize = this.embeddingConfig.batchSize || EMBEDDING_BATCH_SIZE

    for (let i = 0; i < changed.length; i += batchSize) {
      const batch = changed.slice(i, i + batchSize)

      try {
        const missing = batch.filter(c => !c.doc.embedding)
        const generated = missing.length > 0
          ? await this.generateEmbeddings(missing.map(c => c.doc.content))
          : []

        let generatedIndex = 0
        const now = new Date().toISOString()

        // Every optional column is written as an explicit null, never left out:
        // supabase-js serialises `undefined` away, and PostgREST rejects a bulk
        // upsert whose rows do not all carry the same keys ("All object keys
        // must match") — one page without a focus keyword would fail its batch.
        const records = batch.map(candidate => {
          const embedding = candidate.doc.embedding ?? generated[generatedIndex++]
          if (!embedding) {
            throw new Error(`missing embedding for document ${candidate.key}`)
          }

          return {
            embedding,
            content: candidate.doc.content,
            content_hash: candidate.hash,
            document_key: candidate.key,
            metadata: { ...candidate.doc.metadata, indexedAt: now },
            site_id: candidate.doc.metadata.siteId,
            document_type: candidate.doc.metadata.documentType,
            content_type_key: candidate.doc.metadata.contentTypeKey ?? null,
            focus_keyword: truncate(candidate.doc.metadata.focusKeyword, 500) ?? null,
            word_count: candidate.doc.metadata.wordCount ?? null,
            updated_at: now,
          }
        })

        const { error } = await this.getClient(true)
          .from('vector_embeddings')
          .upsert(records, {
            onConflict: 'site_id,document_key',
            ignoreDuplicates: false,
          })

        if (error) throw new Error(error.message)

        documentsProcessed += batch.length
      } catch (error) {
        documentsFailed += batch.length
        errors.push({
          documentId: batch.map(c => c.key).join(', ').slice(0, 300),
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        })
      }
    }

    return {
      operationId,
      status: documentsFailed > 0 && documentsProcessed === 0 ? 'failed' : 'completed',
      documentsProcessed,
      documentsFailed,
      documentsSkipped,
      embeddingRequests: this.embeddingRequests - embeddingRequestsBefore,
      errors,
      startedAt,
      completedAt: new Date().toISOString(),
    }
  }

  /**
   * Content hashes already stored for the given (site, document key) pairs.
   *
   * A failure here is deliberately non-fatal: not knowing what is stored costs
   * embeddings, whereas refusing to index costs the whole feature.
   */
  private async getStoredHashes(
    refs: Array<{ siteId: string; key: string }>
  ): Promise<Map<string, string>> {
    const stored = new Map<string, string>()
    const siteIds = [...new Set(refs.map(r => r.siteId).filter(Boolean))]
    if (siteIds.length === 0) return stored

    const wanted = new Set(refs.map(r => hashLookupKey(r.siteId, r.key)))

    // PostgREST caps a response at its `max-rows` setting (1 000 by default), so
    // a site with more documents than that would look partly un-indexed and be
    // re-embedded — at full price — on every run. Hence the paging.
    const pageSize = 1000

    for (const siteId of siteIds) {
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await this.client
          .from('vector_embeddings')
          .select('site_id, document_key, content_hash')
          .eq('site_id', siteId)
          .range(offset, offset + pageSize - 1)

        if (error) {
          console.warn(`[vector-store] could not read existing hashes for site ${siteId}: ${error.message}`)
          break
        }

        for (const row of data || []) {
          const lookup = hashLookupKey(row.site_id as string, row.document_key as string)
          if (wanted.has(lookup)) {
            stored.set(lookup, row.content_hash as string)
          }
        }

        if (!data || data.length < pageSize) break
      }
    }

    return stored
  }

  async indexSchema(siteId: string, schema: SchemaIndexInput): Promise<IndexingOutcome> {
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

  async indexContent(siteId: string, content: ContentIndexInput): Promise<IndexingOutcome> {
    const documents: IndexedDocument[] = []
    const now = new Date().toISOString()

    for (const doc of content.documents) {
      // Keyed on the URL when there is one: a title is not unique and, worse, it
      // changes when the page is edited — which would index the edited page as a
      // second document instead of replacing the first.
      const key = `content:${doc.url || `${doc.contentTypeKey}/${doc.title.slice(0, 120)}`}`

      documents.push({
        id: key,
        content: `${doc.title}\n\n${doc.content}`,
        metadata: {
          documentId: key,
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

  // supabase-js only populates `count` when the request asks for it; without
  // `{ count: 'exact' }` these both reported 0 deletions whatever they deleted.
  async deleteBySite(siteId: string): Promise<number> {
    const { count, error } = await this.getClient(true)
      .from('vector_embeddings')
      .delete({ count: 'exact' })
      .eq('site_id', siteId)

    if (error) {
      throw new Error(`Failed to delete by site: ${error.message}`)
    }

    return count || 0
  }

  async deleteByContentType(siteId: string, contentTypeKey: string): Promise<number> {
    const { count, error } = await this.getClient(true)
      .from('vector_embeddings')
      .delete({ count: 'exact' })
      .eq('site_id', siteId)
      .eq('content_type_key', contentTypeKey)

    if (error) {
      throw new Error(`Failed to delete by content type: ${error.message}`)
    }

    return count || 0
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  async search(config: SearchConfig): Promise<SearchResult[]> {
    if (!config.query.trim()) return []

    const queryEmbedding = await this.generateEmbedding(config.query)
    return this.searchByEmbedding(queryEmbedding, config)
  }

  /**
   * Same search, on an embedding the caller already paid for.
   *
   * Exists so a caller can probe several filters (this content type, then any)
   * without buying the same vector twice.
   */
  async searchByEmbedding(
    embedding: number[],
    config: EmbeddingSearchConfig = {}
  ): Promise<SearchResult[]> {
    const { data, error } = await this.client.rpc('vector_search', {
      p_embedding: embedding,
      p_limit: config.limit || 10,
      p_threshold: config.minScore ?? DEFAULT_MIN_SCORE,
      p_site_id: config.siteId || null,
      p_document_type: config.documentTypes?.[0] || null,
      p_content_type_key: config.contentTypeKey || null,
    })

    if (error) {
      throw new Error(`Search failed: ${error.message}`)
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      score: Number(row.score),
      metadata: row.metadata as DocumentMetadata,
    }))
  }

  /**
   * Nearest documents to a piece of text.
   *
   * This used to fetch every row of the site and score each one against an EMPTY
   * vector — `cosineSimilarity(query, [])` returns 0 on a length mismatch, so
   * every result scored exactly 0 and every threshold above 0 discarded all of
   * them. The search has never returned a single row in its life; it now runs in
   * PostgreSQL, on the HNSW index, like the rest of the search surface.
   */
  async findSimilar(query: SimilarityQuery): Promise<SearchResult[]> {
    if (!query.content.trim()) return []

    const limit = query.limit || 10
    const queryEmbedding = await this.generateEmbedding(query.content)

    const results = await this.searchByEmbedding(queryEmbedding, {
      siteId: query.siteId,
      contentTypeKey: query.contentTypeKey,
      documentTypes: ['content'],
      minScore: query.threshold ?? DEFAULT_MIN_SCORE,
      // Over-fetch so the post-filter below cannot empty an otherwise full page.
      limit: query.excludeDocumentId ? limit + 1 : limit,
    })

    return results
      .filter(r => r.id !== query.excludeDocumentId)
      .slice(0, limit)
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
      // PostgREST JSON path syntax: `metadata->>fieldKey`, unquoted. The quoted
      // form this used to send was parsed as a column name and errored out.
      query = query.eq('metadata->>fieldKey', filters.fieldKey)
    }

    if (filters.documentTypes?.length) {
      query = query.in('document_type', filters.documentTypes)
    }

    if (filters.taxonomyTerms?.length) {
      // `contains` maps to jsonb `@>`; `overlaps` has no jsonb operator and
      // returned a PostgREST error rather than a filtered set.
      query = query.contains('metadata->taxonomyTerms', filters.taxonomyTerms)
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

  /**
   * Drops a site's documents. Re-filling them is the indexing service's job —
   * the store knows about vectors, not about where a site's pages live.
   *
   * Prefer `reindexSite()` from VectorIndexingService, which does both.
   */
  async reindexSite(siteId: string): Promise<IndexingOutcome> {
    const deleted = await this.deleteBySite(siteId)
    const now = new Date().toISOString()

    console.info(`[vector-store] cleared ${deleted} document(s) for site ${siteId}`)

    return {
      operationId: crypto.randomUUID(),
      status: 'completed',
      documentsProcessed: 0,
      documentsFailed: 0,
      documentsSkipped: 0,
      embeddingRequests: 0,
      errors: [],
      startedAt: now,
      completedAt: now,
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

  /**
   * Change detector, not a key: the hash decides whether a document must be
   * re-embedded. It covers the text actually sent to the provider, truncation
   * included, so a change past the truncation point does not buy a new vector
   * identical to the old one.
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(truncateForEmbedding(content)).digest('hex')
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
    // `sites` is the product's table. This read used to target `federated_sites`,
    // a migration-001 table that no site row has ever been written to, so the
    // context was always null.
    const { data, error } = await this.client
      .from('sites')
      .select('name, type')
      .eq('id', siteId)
      .single()

    if (error || !data) {
      return null
    }

    const { count } = await this.client
      .from('vector_embeddings')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('document_type', 'content')

    return {
      siteId,
      siteName: data.name,
      siteType: data.type as 'wordpress' | 'sanity',
      existingContentCount: count || 0,
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

// ─── Module Helpers ──────────────────────────────────────────────────────────

/**
 * Stable identity of a document inside its site.
 *
 * `IndexedDocument.id` is a caller-chosen string, never the database uuid — the
 * row id is generated by PostgreSQL. Using it as the upsert key is what lets a
 * second crawl replace a page instead of duplicating it.
 */
export function documentKeyOf(document: IndexedDocument): string {
  const key = document.id || document.metadata.documentId
  if (key) return key.slice(0, 500)

  // No key at all would mean an unbounded pile of near-identical rows; fall back
  // to the content itself so the document is at least idempotent.
  return `anon:${createHash('sha256').update(document.content).digest('hex').slice(0, 32)}`
}

function hashLookupKey(siteId: string, documentKey: string): string {
  return `${siteId}::${documentKey}`
}

/** Keeps one document under the provider's per-input token limit. */
export function truncateForEmbedding(text: string): string {
  return text.length > MAX_EMBEDDING_CHARS ? text.slice(0, MAX_EMBEDDING_CHARS) : text
}

/** Fits a value into a VARCHAR(n) column instead of letting the insert fail. */
function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  return value.length > max ? value.slice(0, max) : value
}
