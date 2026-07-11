// ─────────────────────────────────────────────────────────────────────────────
// VectorStore Interface
// SEO Engine - RAG Infrastructure
// Clean Architecture: Interface definition (no implementation details)
// ─────────────────────────────────────────────────────────────────────────────

import type {
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
  IndexingError,
  VectorSearchFilters,
} from './types'

// Re-export types from types.ts
export type {
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
  IndexingError,
  VectorSearchFilters,
} from './types'

/**
 * Interface abstraite pour le Vector Store
 * Implémentations possibles: Supabase pg_vector, Pinecone, Qdrant, etc.
 */
export interface IVectorStore {
  // ─── Configuration ────────────────────────────────────────────────────────

  /**
   * Initialise le vector store
   */
  initialize(): Promise<void>

  /**
   * Vérifie si le vector store est disponible
   */
  healthCheck(): Promise<boolean>

  /**
   * Retourne les statistiques du vector store
   */
  getStats(): Promise<VectorStoreStats>

  // ─── Embeddings ──────────────────────────────────────────────────────────

  /**
   * Génère un embedding pour un texte
   */
  generateEmbedding(text: string): Promise<number[]>

  /**
   * Génère des embeddings pour un batch de textes
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>

  // ─── Indexing ────────────────────────────────────────────────────────────

  /**
   * Indexe un document avec son embedding
   */
  indexDocument(document: IndexedDocument): Promise<string>

  /**
   * Indexe plusieurs documents en batch
   */
  indexDocuments(documents: IndexedDocument[]): Promise<IndexingStatus>

  /**
   * Indexe un schéma de contenu complet
   */
  indexSchema(siteId: string, schema: SchemaIndexInput): Promise<IndexingStatus>

  /**
   * Indexe du contenu existant
   */
  indexContent(siteId: string, content: ContentIndexInput): Promise<IndexingStatus>

  /**
   * Met à jour un document existant
   */
  updateDocument(id: string, document: Partial<IndexedDocument>): Promise<void>

  /**
   * Supprime un document
   */
  deleteDocument(id: string): Promise<void>

  /**
   * Supprime tous les documents d'un site
   */
  deleteBySite(siteId: string): Promise<number>

  /**
   * Supprime par type de contenu
   */
  deleteByContentType(siteId: string, contentTypeKey: string): Promise<number>

  // ─── Search ──────────────────────────────────────────────────────────────

  /**
   * Recherche sémantique
   */
  search(config: SearchConfig): Promise<SearchResult[]>

  /**
   * Recherche par similarité de contenu
   */
  findSimilar(query: SimilarityQuery): Promise<SearchResult[]>

  /**
   * Recherche par métadonnées
   */
  searchByMetadata(filters: VectorSearchFilters, limit?: number): Promise<SearchResult[]>

  // ─── Context Building ────────────────────────────────────────────────────

  /**
   * Construit un contexte RAG pour la génération
   */
  buildRagContext(params: RagContextParams): Promise<RagContext>

  /**
   * Récupère des exemples similaires pour un type de contenu
   */
  getExamplesForContentType(
    siteId: string,
    contentTypeKey: string,
    limit?: number
  ): Promise<IndexedDocument[]>

  /**
   * Récupère le contexte SEO pertinent
   */
  getSeoContext(siteId: string, keyword: string): Promise<SeoContext | null>

  // ─── Maintenance ────────────────────────────────────────────────────────

  /**
   * Réindexe un site complet
   */
  reindexSite(siteId: string): Promise<IndexingStatus>

  /**
   * Nettoie les entrées orphelines
   */
  cleanup(): Promise<number>
}

// ─── Input Types ─────────────────────────────────────────────────────────────

/**
 * Input pour indexer un schéma
 */
export interface SchemaIndexInput {
  schemaId: string
  schemaName: string
  contentTypes: ContentTypeIndexInput[]
  taxonomies?: TaxonomyIndexInput[]
  seoConfig?: Record<string, unknown>
}

/**
 * Input pour indexer un type de contenu
 */
export interface ContentTypeIndexInput {
  key: string
  label: string
  description?: string
  fields: FieldIndexInput[]
  supports?: string[]
}

/**
 * Input pour indexer un champ
 */
export interface FieldIndexInput {
  key: string
  label: string
  type: string
  required: boolean
  description?: string
  config?: Record<string, unknown>
}

/**
 * Input pour indexer une taxonomie
 */
export interface TaxonomyIndexInput {
  key: string
  label: string
  hierarchical: boolean
  terms?: TermIndexInput[]
}

/**
 * Input pour indexer un terme
 */
export interface TermIndexInput {
  name: string
  slug: string
  description?: string
  level: number
  children?: TermIndexInput[]
}

/**
 * Input pour indexer du contenu
 */
export interface ContentIndexInput {
  documents: ContentDocumentInput[]
}

/**
 * Input pour un document de contenu
 */
export interface ContentDocumentInput {
  contentTypeKey: string
  title: string
  content: string
  excerpt?: string
  url?: string
  focusKeyword?: string
  taxonomyTerms?: string[]
  metaDescription?: string
  wordCount?: number
  hasImages?: boolean
  hasFaq?: boolean
  createdAt?: string
  updatedAt?: string
}

// ─── RAG Context ─────────────────────────────────────────────────────────────

/**
 * Paramètres pour construire le contexte RAG
 */
export interface RagContextParams {
  siteId: string
  contentTypeKey: string
  fieldKey?: string
  topic?: string
  keywords?: string[]
  location?: string
  limit?: number
}

/**
 * Contexte RAG pour la génération de contenu
 */
export interface RagContext {
  // Contexte général
  siteContext: SiteContext | null
  schemaContext: SchemaContext | null
  taxonomyContext: TaxonomyContext | null

  // Exemples similaires
  similarExamples: SimilarExample[]

  // Contexte SEO
  seoContext: SeoContext | null

  // Sources utilisées
  sources: RagSource[]
}

/**
 * Contexte du site
 */
export interface SiteContext {
  siteId: string
  siteName: string
  siteType: 'wordpress' | 'sanity'
  existingContentCount: number
  contentTypes: string[]
}

/**
 * Contexte du schéma
 */
export interface SchemaContext {
  contentTypeKey: string
  contentTypeLabel: string
  requiredFields: FieldContext[]
  optionalFields: FieldContext[]
  fieldInstructions: string
}

/**
 * Contexte d'un champ
 */
export interface FieldContext {
  key: string
  label: string
  type: string
  instructions: string
  examples?: string[]
}

/**
 * Contexte taxonomique
 */
export interface TaxonomyContext {
  taxonomies: TaxonomyInfo[]
  suggestedTerms: TermSuggestion[]
}

/**
 * Info de taxonomie
 */
export interface TaxonomyInfo {
  key: string
  label: string
  hierarchical: boolean
  terms: string[]
}

/**
 * Terme suggéré
 */
export interface TermSuggestion {
  name: string
  slug: string
  taxonomyKey: string
  relevanceScore: number
}

/**
 * Exemple similaire
 */
export interface SimilarExample {
  documentId: string
  title: string
  content: string
  score: number
  sourceUrl?: string
}

/**
 * Contexte SEO
 */
export interface SeoContext {
  focusKeyword: string
  relatedKeywords: string[]
  competitorGaps: string[]
  contentGuidelines: string[]
}

/**
 * Source RAG
 */
export interface RagSource {
  documentId: string
  type: DocumentType
  title: string
  relevanceScore: number
}

// ─── SEO Context ────────────────────────────────────────────────────────────

/**
 * Stats SEO pour le contexte
 */
export interface SeoStats {
  averageWordCount: number
  averageKeywordDensity: number
  commonHeadingStructure: string[]
  topKeywords: KeywordStats[]
}

/**
 * Stats pour un keyword
 */
export interface KeywordStats {
  keyword: string
  count: number
  avgPosition?: number
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Configuration pour créer un VectorStore
 */
export interface VectorStoreFactoryConfig {
  provider: 'supabase' | 'pinecone' | 'qdrant'

  // Supabase
  supabaseUrl?: string
  supabaseKey?: string

  // Pinecone
  pineconeApiKey?: string
  pineconeEnvironment?: string
  pineconeIndex?: string

  // Qdrant
  qdrantUrl?: string
  qdrantApiKey?: string
  qdrantCollection?: string

  // Embeddings
  embeddingConfig: EmbeddingConfig
}

/**
 * Crée une instance de VectorStore
 */
export function createVectorStore(config: VectorStoreFactoryConfig): IVectorStore {
  switch (config.provider) {
    case 'supabase':
      return createSupabaseVectorStore(config)
    // case 'pinecone':
    //   return createPineconeVectorStore(config)
    // case 'qdrant':
    //   return createQdrantVectorStore(config)
    default:
      throw new Error(`Unsupported vector store provider: ${config.provider}`)
  }
}

// Lazy loading des implémentations
function createSupabaseVectorStore(config: VectorStoreFactoryConfig): IVectorStore {
  // Dynamic import pour éviter les dépendances circulaires
  const { SupabaseVectorStore } = require('./providers/SupabaseVectorStore')
  return new SupabaseVectorStore(config)
}
