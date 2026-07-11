// ─────────────────────────────────────────────────────────────────────────────
// RAG Adapters Index
// Exports RAG content generation adapters
// ─────────────────────────────────────────────────────────────────────────────

// RAG Generator with Templates
export {
  RagGeneratorWithTemplates,
  createRagGeneratorWithTemplates,
  type TemplateGenerationOptions,
  type GenerationContext,
  type TemplateGenerationResult,
  type GeneratedContent,
  type WordPressFields,
  type SanityFields,
  type FaqItem,
  type RagSource,
  type GenerationStats,
  type ContentValidation,
  type ValidationError,
  type ValidationWarning,
} from './RagGeneratorWithTemplates'

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

export type {
  SupabaseVectorStoreConfig,
} from './providers/SupabaseVectorStore'

// Vector Indexing Service
export {
  VectorIndexingService,
  getIndexingService,
} from './VectorIndexingService'

// Semantic Search Service
export {
  SemanticSearchService,
  getSearchService,
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
