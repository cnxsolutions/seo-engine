// ─────────────────────────────────────────────────────────────────────────────
// Publishers Index
// SEO Engine - Publishing Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

// Note: WordPress and Next.js publishers are in lib/publishers/

// Sanity Publisher (new)
export {
  SanityPublisher,
  SanityClient,
  SanityDocumentBuilder,
  SanityMonitoringService,
  createSanityPublisher,
  createSanityPublisherFromClient,
  createSanityClient,
  createSanityClientFromCredentials,
  createSanityDocumentBuilder,
  createSanityImageUploader,
  createSanityMonitoringService,
} from './sanity'

export type {
  SanityPublishContent,
  SanityPublishOptions,
  SanityPublishResult,
  SanityDocument,
  SanityOperationResult,
  SanityError,
  SanityClientConfig,
  SanityBlock,
  SanitySpan,
  SanityMarkDef,
  SanityImageAsset,
  SanitySeoFields,
  SanityDocumentResult,
  DocumentValidation,
  HealthStatus,
  HealthCheck,
  PerformanceMetrics,
  QuotaUsage,
  RateLimitStatus,
  MonitoringIncident,
} from './sanity'

// ─── Unified Publisher Interface ──────────────────────────────────────────────

/**
 * Interface unifiée pour tous les publishers
 */
export interface IPublisher {
  publish(content: PublishableContent): Promise<PublishResult>
  update(documentId: string, content: Partial<PublishableContent>): Promise<PublishResult>
  delete(documentId: string): Promise<PublishResult>
  getStatus(documentId: string): Promise<DocumentStatus | null>
  healthCheck(): Promise<PublisherHealthStatus>
}

/**
 * Contenu publishable (format commun)
 */
export interface PublishableContent {
  title: string
  slug: string
  content: string
  excerpt?: string
  featuredImage?: string
  categories?: string[]
  tags?: string[]
  author?: string
  publishedAt?: string
  seo?: {
    metaTitle?: string
    metaDescription?: string
    focusKeyword?: string
    canonicalUrl?: string
  }
  customFields?: Record<string, unknown>
}

/**
 * Résultat de publication (format commun)
 */
export interface PublishResult {
  success: boolean
  documentId?: string
  publishedUrl?: string
  error?: {
    code: string
    message: string
    canRetry?: boolean
  }
  metadata?: {
    publishedAt: string
    durationMs: number
  }
}

/**
 * Status de document (format commun)
 */
export interface DocumentStatus {
  documentId: string
  exists: boolean
  title: string
  slug: string
  lastModified: string
}

/**
 * Status de santé (format commun)
 */
export type PublisherHealthStatus = {
  healthy: boolean
  latencyMs: number
  checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn'
    message?: string
  }>
}
