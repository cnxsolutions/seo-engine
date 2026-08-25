// ─────────────────────────────────────────────────────────────────────────────
// RAG Adapters Index
// Exports RAG content generation adapters
// ─────────────────────────────────────────────────────────────────────────────

// `RagGeneratorWithTemplates` was exported here, and the barrel was its only
// consumer: no production code ever called it. It built its own vector store in
// a field initialiser with `process.env...!`, so merely constructing it threw
// without the environment variables — a competing, partial implementation of the
// generation path, kept alive by this export alone.
//
// A barrel must only export what lives.

// Template Engine
export {
  TemplateEngine,
  getTemplateEngine,
  createTemplateEngine,
  type RenderContext,
  type RenderResult,
  type WordPressOutput,
  type SanityOutput,
  type SeoOutput,
  type OpenGraphData,
  type RenderStats,
  type TemplateEngineConfig,
  type TemplateHelper,
  type FieldTransformer,
  type TemplateValidator,
  type ValidationResult,
  type ValidationError as TemplateValidationError,
  type ValidationWarning as TemplateValidationWarning,
} from './TemplateEngine'

// Template Library
export {
  WORDPRESS_TEMPLATES,
  SANITY_TEMPLATES,
  NEXTJS_TEMPLATES,
  CONTENT_TYPE_TEMPLATES,
  getTemplate,
  listTemplates,
  createTemplateFromSchema,
} from './TemplateLibrary'

// Vector Store (RAG Infrastructure)
export {
  createSupabaseVectorStore,
  SupabaseVectorStore,
} from './providers'

export type {
  IVectorStore,
  VectorStoreFactoryConfig,
  IndexedDocument,
  DocumentMetadata,
  DocumentType,
  SearchResult,
  SearchConfig,
  SimilarityQuery,
  VectorStoreStats,
  IndexingStatus,
  IndexingError,
  VectorSearchFilters,
  RagContext,
  RagContextParams,
  SchemaIndexInput,
  ContentIndexInput,
  ContentTypeIndexInput,
  FieldIndexInput,
  TaxonomyIndexInput,
  TermIndexInput,
} from './VectorStore'

export {
  EMBEDDING_DIMENSION,
  EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MIN_SCORE,
  MAX_EMBEDDING_CHARS,
} from './providers/SupabaseVectorStore'

export type {
  SupabaseVectorStoreConfig,
} from './providers/SupabaseVectorStore'

export type {
  IndexingOutcome,
  EmbeddingSearchConfig,
} from './VectorStore'

// ─── Vector Indexing — the public entry points ────────────────────────────────
//
// These four functions are how the rest of the application fills the index.
// None of them throws: indexing is an enrichment, never a reason to fail the
// crawl or the publication that triggered it.
export {
  indexSitePages,
  indexGeneratedPage,
  reindexSite,
  getSiteIndexStatus,
  VectorIndexingService,
  getIndexingService,
  INDEXING_BATCH_SIZE,
  MIN_INDEXABLE_CHARS,
  CONTENT_TYPE_CRAWLED_PAGE,
  CONTENT_TYPE_GENERATED_POST,
  type IndexingOptions,
  type IndexingReport,
  type IndexingSource,
  type SiteIndexStatus,
} from './VectorIndexingService'

// Semantic Search Service
export {
  SemanticSearchService,
  getSearchService,
  GAP_COVERAGE_SCORE,
  type SemanticSearchOptions,
  type EnrichedSearchResult,
  type InternalLinkTarget,
  type ContentGap,
  type ContentVariation,
  type SiteContentStats,
} from './SemanticSearchService'

// Context Enrichment
export * from './context'

// Types
export * from './types'

// Validation Pipeline
export * from './validation'
