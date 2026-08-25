// ─────────────────────────────────────────────────────────────────────────────
// Validation Module Exports
// SEO Engine - Validation Pipeline
// ─────────────────────────────────────────────────────────────────────────────

// Schema Validator (CMS field schema)
export {
  SchemaValidator,
  createSchemaValidator,
  type SchemaValidationConfig,
  type SchemaValidationResult,
  type SchemaValidationError,
  type SchemaValidationWarning,
  type ValidatableContent,
} from './SchemaValidator'

// JSON-LD Validator (schema.org markup)
export {
  JsonLdValidator,
  createJsonLdValidator,
  type JsonLdValidationConfig,
  type JsonLdValidationResult,
  type JsonLdIssue,
  type JsonLdIssueCode,
  type JsonLdSeverity,
  type JsonLdExpectation,
} from './JsonLdValidator'

// Content Quality Validator
export {
  ContentQualityValidator,
  createContentQualityValidator,
  type ContentQualityConfig,
  type ContentQualityResult,
  type ContentQualityScore,
  type ContentQualityError,
  type ContentQualityWarning,
  type ContentMetrics,
  type QualitySuggestion,
} from './ContentQualityValidator'

// SEO Validator
export {
  SeoValidator,
  createSeoValidator,
  type SeoValidationConfig,
  type SeoValidationInput,
  type SeoValidationResult,
  type SeoValidationError,
  type SeoValidationWarning,
  type SeoRecommendation,
  type SeoMetrics,
  type SocialMetaInput,
} from './SeoValidator'

// Duplicate Detector
export {
  DuplicateDetector,
  createDuplicateDetector,
  type DuplicateDetectionConfig,
  type DuplicateDetectionResult,
  type DuplicateMatch,
  type DuplicateSignals,
  type DuplicateStats,
  type ContentToCheck,
} from './DuplicateDetector'

// Validation Pipeline Orchestrator
export {
  ValidationPipelineOrchestrator,
  createValidationPipeline,
  type ValidationPipelineConfig,
  type ValidationPipelineContent,
  type ValidationPipelineResult,
  type ValidationSummary,
  type ValidationAction,
} from './ValidationPipelineOrchestrator'

// French readability (exported so a caller can score text without a validator)
export {
  countFrenchSyllables,
  countSyllables,
  computeFrenchReadability,
  describeFrenchReadability,
  type FrenchReadabilityResult,
  type FrenchReadabilityLabel,
} from './french-readability'

// Shared text helpers
export {
  extractHeadingOutline,
  extractLinks,
  stripHtmlToText,
  normalizeForMatch,
  estimatePixelWidth,
  type HeadingNode,
  type ExtractedLinks,
} from '@/src/core/domain/text/text-utils'
