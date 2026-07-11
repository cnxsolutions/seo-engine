// ─────────────────────────────────────────────────────────────────────────────
// Validation Module Exports
// SEO Engine - Validation Pipeline
// ─────────────────────────────────────────────────────────────────────────────

// Schema Validator
export {
  SchemaValidator,
  createSchemaValidator,
  type SchemaValidationConfig,
  type SchemaValidationResult,
  type SchemaValidationError,
  type SchemaValidationWarning,
  type ValidatableContent,
} from './SchemaValidator'

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
  type SeoValidationResult,
  type SeoValidationError,
  type SeoValidationWarning,
  type SeoRecommendation,
  type SeoMetrics,
} from './SeoValidator'

// Duplicate Detector
export {
  DuplicateDetector,
  createDuplicateDetector,
  type DuplicateDetectionConfig,
  type DuplicateDetectionResult,
  type DuplicateMatch,
  type DuplicateStats,
  type ContentToCheck,
} from './DuplicateDetector'

// Validation Pipeline Orchestrator
export {
  ValidationPipelineOrchestrator,
  createValidationPipeline,
  type ValidationPipelineConfig,
  type ValidationPipelineResult,
  type ValidationSummary,
  type ValidationAction,
} from './ValidationPipelineOrchestrator'
