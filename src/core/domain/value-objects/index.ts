// ─────────────────────────────────────────────────────────────────────────────
// Value Objects - Immutable domain primitives
// ─────────────────────────────────────────────────────────────────────────────

import type { FieldType } from '../entities/field-types'

// ─── Schema Key ────────────────────────────────────────────────────────────────

export class SchemaKey {
  constructor(
    public readonly siteId: string,
    public readonly contentType: string,
    public readonly field: string
  ) {}

  toString(): string {
    return `${this.siteId}:${this.contentType}:${this.field}`
  }

  static fromString(value: string): SchemaKey {
    const parts = value.split(':')
    if (parts.length !== 3) {
      throw new InvalidSchemaKeyError(value)
    }
    return new SchemaKey(parts[0], parts[1], parts[2])
  }

  equals(other: SchemaKey): boolean {
    return (
      this.siteId === other.siteId &&
      this.contentType === other.contentType &&
      this.field === other.field
    )
  }
}

export class InvalidSchemaKeyError extends Error {
  constructor(value: string) {
    super(`Invalid schema key format: "${value}". Expected "siteId:contentType:field"`)
    this.name = 'InvalidSchemaKeyError'
  }
}

// ─── Content Payload ───────────────────────────────────────────────────────────

export interface ContentPayload {
  type: string
  fields: Record<string, unknown>
  seo?: SeoFields
  metadata?: Record<string, unknown>
}

export interface SeoFields {
  title?: string
  description?: string
  focusKeyword?: string
  secondaryKeywords?: string[]
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  twitterTitle?: string
  twitterDescription?: string
  canonicalUrl?: string
  schemaMarkup?: Record<string, unknown>
}

export interface ValidatedContent extends ContentPayload {
  validation: ContentValidation
}

export interface ContentValidation {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  field: string
  message: string
  code: string
}

export interface ValidationWarning {
  field: string
  message: string
}

// ─── Publish Target ───────────────────────────────────────────────────────────

export class PublishTarget {
  constructor(
    public readonly type: 'wordpress' | 'sanity',
    public readonly siteId: string,
    public readonly contentType: string
  ) {}

  toString(): string {
    return `${this.type}://${this.siteId}/${this.contentType}`
  }

  static fromUrl(url: string): PublishTarget {
    const match = url.match(/^(wordpress|sanity):\/\/([^/]+)\/(.+)$/)
    if (!match) {
      throw new InvalidPublishTargetError(url)
    }
    return new PublishTarget(match[1] as 'wordpress' | 'sanity', match[2], match[3])
  }
}

export class InvalidPublishTargetError extends Error {
  constructor(value: string) {
    super(`Invalid publish target URL: "${value}". Expected "wordpress://siteId/type" or "sanity://siteId/type"`)
    this.name = 'InvalidPublishTargetError'
  }
}

// ─── Publish Status ────────────────────────────────────────────────────────────

export type PublishStatusValue = 'draft' | 'pending' | 'published' | 'trash'

export class PublishStatus {
  constructor(public readonly value: PublishStatusValue) {}

  canPublish(): boolean {
    return this.value !== 'trash'
  }

  isVisible(): boolean {
    return this.value === 'published'
  }

  requiresReview(): boolean {
    return this.value === 'pending'
  }

  static fromWordPress(status: string): PublishStatus {
    const mapping: Record<string, PublishStatusValue> = {
      draft: 'draft',
      pending: 'pending',
      publish: 'published',
      future: 'draft',
      private: 'published',
      trash: 'trash',
    }
    return new PublishStatus(mapping[status] ?? 'draft')
  }

  static fromSanity(status: string): PublishStatus {
    return new PublishStatus(status === 'published' ? 'published' : 'draft')
  }
}

// ─── Publish Result ───────────────────────────────────────────────────────────

export interface PublishResult {
  success: boolean
  remoteId?: string
  remoteUrl?: string
  error?: string
  warnings?: string[]
}

// ─── Connection Result ────────────────────────────────────────────────────────

export interface ConnectionResult {
  isConnected: boolean
  siteName?: string
  error?: string
  capabilities?: string[]
}

// ─── Sync Status ──────────────────────────────────────────────────────────────

export type SyncStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface SyncLog {
  id: string
  siteId: string
  status: SyncStatus
  fieldsCount: number
  contentTypesCount: number
  errors: string[]
  startedAt: Date
  completedAt?: Date
}

// ─── Generation Context ────────────────────────────────────────────────────────

export interface GenerationContext {
  businessType: string
  businessName: string
  targetCity: string
  department?: string
  targetKeywords: string[]
  siteUrl?: string
  competitorContent?: string[]
  existingPages?: string[]
  pillarPages?: PillarReference[]
}

export interface PillarReference {
  title: string
  slug: string
  url: string
  keywords: string[]
}

export interface GenerationConstraints {
  targetWordCount?: number
  requiredFields: string[]
  forbiddenPatterns?: string[]
  tone?: 'professional' | 'friendly' | 'technical' | 'casual'
  language?: 'fr' | 'en'
}

// ─── Generated Content ─────────────────────────────────────────────────────────

export interface GeneratedContent {
  payload: ContentPayload
  suggestions: ContentSuggestion[]
  warnings: string[]
  metadata?: {
    tokensUsed?: number
    model?: string
    generatedAt?: Date
  }
}

export interface ContentSuggestion {
  type: 'internal-link' | 'image-alt' | 'faq' | 'schema' | 'meta'
  content: string
  confidence: number
  targetField?: string
}

// ─── Builder Helpers ───────────────────────────────────────────────────────────

export function createEmptyPayload(type: string): ContentPayload {
  return {
    type,
    fields: {},
    seo: {},
    metadata: {},
  }
}

export function createSeoFields(overrides?: Partial<SeoFields>): SeoFields {
  return {
    title: overrides?.title,
    description: overrides?.description,
    focusKeyword: overrides?.focusKeyword,
    secondaryKeywords: overrides?.secondaryKeywords ?? [],
    ogTitle: overrides?.ogTitle,
    ogDescription: overrides?.ogDescription,
    ogImage: overrides?.ogImage,
    twitterTitle: overrides?.twitterTitle,
    twitterDescription: overrides?.twitterDescription,
    canonicalUrl: overrides?.canonicalUrl,
    schemaMarkup: overrides?.schemaMarkup,
  }
}
