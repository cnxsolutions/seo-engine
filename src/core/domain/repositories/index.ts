// ─────────────────────────────────────────────────────────────────────────────
// Repository Interfaces (Ports) - Clean Architecture
// These are interfaces only, implementations are in the adapters layer
// ─────────────────────────────────────────────────────────────────────────────

import type {
  FederatedSite,
  ContentSchema,
  ContentType,
  ContentField,
  Taxonomy,
  Term,
} from '../entities'
import type {
  ContentPayload,
  ContentValidation,
  PublishResult,
  PublishStatus,
  ConnectionResult,
  SyncLog,
  GenerationContext,
  GenerationConstraints,
  GeneratedContent,
} from '../value-objects'

// ─── Site Repository ──────────────────────────────────────────────────────────

export interface ISiteRepository {
  findById(id: string): Promise<FederatedSite | null>
  findByType(type: 'wordpress' | 'sanity'): Promise<FederatedSite[]>
  findActive(): Promise<FederatedSite[]>
  save(site: FederatedSite): Promise<FederatedSite>
  update(id: string, values: Partial<FederatedSite>): Promise<FederatedSite>
  delete(id: string): Promise<void>
  exists(id: string): Promise<boolean>
}

// ─── Schema Repository ────────────────────────────────────────────────────────

export interface ISchemaRepository {
  findBySiteId(siteId: string): Promise<ContentSchema | null>
  findById(id: string): Promise<ContentSchema | null>
  save(schema: ContentSchema): Promise<ContentSchema>
  update(id: string, values: Partial<ContentSchema>): Promise<ContentSchema>
  delete(siteId: string): Promise<void>
  getContentType(schemaId: string, typeKey: string): Promise<ContentType | null>
  getField(schemaId: string, typeKey: string, fieldKey: string): Promise<ContentField | null>
}

// ─── Taxonomy Repository ─────────────────────────────────────────────────────

export interface ITaxonomyRepository {
  findByContentType(contentTypeId: string): Promise<Taxonomy[]>
  findTerms(taxonomyId: string): Promise<Term[]>
  findTermBySlug(taxonomyId: string, slug: string): Promise<Term | null>
  findTermById(taxonomyId: string, id: number | string): Promise<Term | null>
  saveTerms(taxonomyId: string, terms: Term[]): Promise<Term[]>
}

// ─── Sync Log Repository ─────────────────────────────────────────────────────

export interface ISyncLogRepository {
  create(siteId: string): Promise<SyncLog>
  update(id: string, values: Partial<SyncLog>): Promise<SyncLog>
  findBySiteId(siteId: string, limit?: number): Promise<SyncLog[]>
  findLastSuccessful(siteId: string): Promise<SyncLog | null>
}

// ─── Content Draft Repository ────────────────────────────────────────────────

export interface IContentDraftRepository {
  save(siteId: string, payload: ContentPayload): Promise<string>
  findById(id: string): Promise<{ id: string; payload: ContentPayload } | null>
  findBySiteId(siteId: string, limit?: number): Promise<Array<{ id: string; payload: ContentPayload }>>
  delete(id: string): Promise<void>
}

// ─── Schema Extractor Port ────────────────────────────────────────────────────

export interface ISchemaExtractor {
  readonly sourceType: 'wordpress' | 'sanity'

  canHandle(site: FederatedSite): boolean

  extract(site: FederatedSite): Promise<ContentSchema>

  extractContentType(site: FederatedSite, type: string): Promise<ContentType>

  validateConnection(site: FederatedSite): Promise<ConnectionResult>
}

// ─── Publisher Port ────────────────────────────────────────────────────────────

export interface IPublisher {
  readonly targetType: 'wordpress' | 'sanity'

  canHandle(site: FederatedSite): boolean

  publish(site: FederatedSite, content: ContentPayload): Promise<PublishResult>

  update(site: FederatedSite, remoteId: string, content: ContentPayload): Promise<PublishResult>

  unpublish(site: FederatedSite, remoteId: string): Promise<void>

  getStatus(site: FederatedSite, remoteId: string): Promise<PublishStatus>
}

// ─── RAG Generator Port ───────────────────────────────────────────────────────

export interface IRagGenerator {
  generate(options: GenerateOptions): Promise<GeneratedContent>

  enrich(schema: ContentSchema, content: ContentPayload): Promise<ContentPayload>

  validate(content: ContentPayload, contentType: ContentType): ContentValidation
}

export interface GenerateOptions {
  schema: ContentSchema
  contentType: string
  context: GenerationContext
  constraints: GenerationConstraints
}

// ─── Content Transformer Port ─────────────────────────────────────────────────

export interface IContentTransformer {
  readonly sourceType: 'generic' | 'wordpress' | 'sanity'
  readonly targetType: 'wordpress' | 'sanity'

  canTransform(content: ContentPayload, sourceType: string): boolean

  transform(content: ContentPayload, targetContentType: string): ContentPayload
}
