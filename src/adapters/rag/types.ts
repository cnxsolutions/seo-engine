// ─────────────────────────────────────────────────────────────────────────────
// Vector Store - Type Definitions
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Représente un embedding vectoriel
 */
export interface VectorEmbedding {
  id: string
  values: number[]
  metadata?: Record<string, unknown>
}

/**
 * Document indexé dans le vector store
 */
export interface IndexedDocument {
  id: string
  content: string
  metadata: DocumentMetadata
  embedding?: number[]
}

/**
 * Métadonnées d'un document indexé
 */
export interface DocumentMetadata {
  // Identification
  documentId: string
  documentType: DocumentType

  // Source
  siteId: string
  contentTypeKey?: string
  fieldKey?: string

  // Content info
  title?: string
  excerpt?: string
  url?: string

  // Taxonomy
  taxonomyTerms?: string[]
  categories?: string[]
  tags?: string[]

  // SEO
  focusKeyword?: string
  metaDescription?: string
  wordCount?: number
  hasImages?: boolean
  hasFaq?: boolean

  // Timestamps
  createdAt: string
  updatedAt?: string
  indexedAt: string
}

/**
 * Types de documents indexables
 */
export type DocumentType =
  | 'schema'           // Schéma de contenu (types, champs)
  | 'content'         // Contenu de page/article
  | 'taxonomy_term'   // Terme de taxonomie
  | 'seo_data'        // Données SEO (meta, schema.org)
  | 'competitor'      // Contenu concurrent
  | 'example'         // Exemple de contenu pour RAG

/**
 * Configuration d'indexation
 */
export interface IndexConfig {
  siteId: string
  contentTypeKey?: string
  fieldKey?: string
  metadata?: Record<string, unknown>
}

/**
 * Résultat de recherche vectorielle
 */
export interface SearchResult {
  id: string
  content: string
  score: number
  metadata: DocumentMetadata
}

/**
 * Configuration de recherche
 */
export interface SearchConfig {
  query: string
  siteId?: string
  contentTypeKey?: string
  documentTypes?: DocumentType[]
  taxonomyTerms?: string[]
  limit?: number
  minScore?: number
  includeMetadata?: boolean
}

/**
 * Similar document query
 */
export interface SimilarityQuery {
  content: string
  siteId?: string
  contentTypeKey?: string
  excludeDocumentId?: string
  limit?: number
  threshold?: number
}

/**
 * Stats du vector store
 */
export interface VectorStoreStats {
  totalDocuments: number
  documentsByType: Record<DocumentType, number>
  documentsBySite: Record<string, number>
  averageDimension: number
  lastIndexingAt?: string
}

/**
 * Configuration du provider d'embeddings
 */
export interface EmbeddingConfig {
  provider: 'openai' | 'anthropic' | 'local'
  model: string
  dimension: number
  batchSize?: number
}

/**
 * Status d'une opération d'indexation
 */
export interface IndexingStatus {
  operationId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  documentsProcessed: number
  documentsFailed: number
  errors: IndexingError[]
  startedAt: string
  completedAt?: string
}

/**
 * Erreur d'indexation
 */
export interface IndexingError {
  documentId: string
  error: string
  timestamp: string
}

/**
 * Filters for vector search
 */
export interface VectorSearchFilters {
  siteId?: string
  contentTypeKey?: string
  fieldKey?: string
  documentTypes?: DocumentType[]
  taxonomyTerms?: string[]
  dateRange?: {
    start: string
    end: string
  }
  minWordCount?: number
  maxWordCount?: number
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
