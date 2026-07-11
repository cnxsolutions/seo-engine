// ─────────────────────────────────────────────────────────────────────────────
// Core Domain Index
// Exports all domain entities, value objects, and repository interfaces
// ─────────────────────────────────────────────────────────────────────────────

// Entities
export {
  type FederatedSite,
  type SiteType,
  type SiteCredentials,
  type ContentSchema,
  type ContentType,
  type ContentField,
  type Taxonomy,
  type Term,
  createFederatedSite,
  createContentSchema,
  createContentType,
  createContentField,
  isFieldRequired,
  getFieldByKey,
  getRequiredFields,
} from './entities'

// Field Types
export {
  type FieldType,
  type FieldConfig,
  type AcfFieldConfig,
  type AcfLocationRule,
  type AcfFlexibleLayout,
  ACF_TYPE_MAPPING,
  SANITY_TYPE_MAPPING,
  isTextType,
  isNumericType,
  isMediaType,
  isComplexType,
  isReferenceType,
  isSeoType,
  getDefaultExample,
  getFormatRule,
} from './entities/field-types'

// Value Objects
export {
  SchemaKey,
  InvalidSchemaKeyError,
  type ContentPayload,
  type SeoFields,
  type ValidatedContent,
  type ContentValidation,
  type ValidationError,
  type ValidationWarning,
  PublishTarget,
  InvalidPublishTargetError,
  PublishStatus,
  type PublishResult,
  type ConnectionResult,
  type SyncStatus,
  type SyncLog,
  type GenerationContext,
  type GenerationConstraints,
  type PillarReference,
  type GeneratedContent,
  type ContentSuggestion,
  createEmptyPayload,
  createSeoFields,
} from './value-objects'

// Repository Interfaces (Ports)
export {
  type ISiteRepository,
  type ISchemaRepository,
  type ITaxonomyRepository,
  type ISyncLogRepository,
  type IContentDraftRepository,
  type ISchemaExtractor,
  type IPublisher,
  type IRagGenerator,
  type IContentTransformer,
  type GenerateOptions,
} from './repositories'
