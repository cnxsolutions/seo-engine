// ─────────────────────────────────────────────────────────────────────────────
// Sanity Publisher Module Index
// SEO Engine - Publishing Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

// Client
export {
  SanityClient,
  SanityApiError,
  createSanityClient,
  createSanityClientFromCredentials,
  type SanityClientConfig,
  type SanityDocument,
  type SanityOperationResult,
  type SanityError,
  type SanityResponse,
  type SanityReference,
  type SanityPatchOperation,
  type SanityTransactionOperation,
  type SanityHistoryEntry,
} from './SanityClient'

// Document Builder
export {
  SanityDocumentBuilder,
  SanityImageUploader,
  createSanityDocumentBuilder,
  createSanityImageUploader,
  type SanityPublishContent,
  type SanityBlock,
  type SanitySpan,
  type SanityMarkDef,
  type SanityImageAsset,
  type SanityTerm,
  type SanityAuthor,
  type SanitySeoFields,
  type SanityDocumentResult,
  type DocumentValidation,
  type ValidationError,
  type ValidationWarning,
} from './SanityDocumentBuilder'

// Publisher
export {
  SanityPublisher,
  createSanityPublisher,
  createSanityPublisherFromClient,
  type SanityPublishOptions,
  type SanityPublishResult,
  type RollbackInfo,
  type PublishError,
  type PublishMetadata,
  type PublishStats,
  type DocumentStatus,
} from './SanityPublisher'

// Monitoring
export {
  SanityMonitoringService,
  createSanityMonitoringService,
  type SanityMonitoringConfig,
  type HealthStatus,
  type HealthCheck,
  type PerformanceMetrics,
  type QuotaUsage,
  type RateLimitStatus,
  type MonitoringIncident,
} from './SanityMonitoringService'
