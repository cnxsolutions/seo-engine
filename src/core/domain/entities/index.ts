// ─────────────────────────────────────────────────────────────────────────────
// Domain Entities - SEO Engine Schema Federation
// Clean Core: Pure domain, no external dependencies
// ─────────────────────────────────────────────────────────────────────────────

import type { FieldType, FieldConfig, AcfFieldConfig, SeoConfig, PublishConfig } from './index'

// ─── Site Entity ───────────────────────────────────────────────────────────────

export interface FederatedSite {
  id: string
  name: string
  type: SiteType
  url: string
  credentials: SiteCredentials
  schema: ContentSchema | null
  lastSyncAt: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type SiteType = 'wordpress' | 'sanity'

export interface SiteCredentials {
  // WordPress
  wpUsername?: string
  wpAppPassword?: string
  wpRestBase?: string

  // Sanity
  sanityProjectId?: string
  sanityDataset?: string
  sanityToken?: string

  // GitHub (legacy, pour sites Next.js sans CMS)
  githubToken?: string
  githubRepo?: string
  githubMdxPath?: string
}

// ─── Content Schema Entity ─────────────────────────────────────────────────────

export interface ContentSchema {
  id: string
  siteId: string
  name: string
  label: string
  description?: string
  contentTypes: ContentType[]
  seoConfig: SeoConfig
  publishConfig: PublishConfig
  extractedAt: Date
  rawSource?: Record<string, unknown>
}

// ─── Content Type Entity ───────────────────────────────────────────────────────

export interface ContentType {
  key: string
  label: string
  description?: string
  fields: ContentField[]
  taxonomies?: Taxonomy[]
  supports: string[]
  parentKey?: string
}

// ─── Content Field Entity ──────────────────────────────────────────────────────

export interface ContentField {
  key: string
  label: string
  type: FieldType
  required: boolean
  description?: string
  config?: FieldConfig
  acfConfig?: AcfFieldConfig
  parentKey?: string
  children?: ContentField[]
  sortOrder: number
}

// ─── Taxonomy Entity (WordPress) ───────────────────────────────────────────────

export interface Taxonomy {
  key: string
  label: string
  hierarchical: boolean
  types: string[]
  terms?: Term[]
}

export interface Term {
  id: number | string
  name: string
  slug: string
  parentId?: number | string
  level: number
  children?: Term[]
}

// ─── Factory Functions ────────────────────────────────────────────────────────

export function createFederatedSite(
  partial: Partial<FederatedSite> & Pick<FederatedSite, 'name' | 'type' | 'url' | 'credentials'>
): FederatedSite {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    type: partial.type,
    url: partial.url,
    credentials: partial.credentials,
    schema: partial.schema ?? null,
    lastSyncAt: partial.lastSyncAt ?? null,
    isActive: partial.isActive ?? true,
    createdAt: partial.createdAt ?? new Date(),
    updatedAt: partial.updatedAt ?? new Date(),
  }
}

export function createContentSchema(
  partial: Partial<ContentSchema> & Pick<ContentSchema, 'siteId' | 'name' | 'label'>
): ContentSchema {
  return {
    id: partial.id ?? crypto.randomUUID(),
    siteId: partial.siteId,
    name: partial.name,
    label: partial.label,
    description: partial.description,
    contentTypes: partial.contentTypes ?? [],
    seoConfig: partial.seoConfig ?? { hasSeoPlugin: false, seoFields: [], schemaTypes: [] },
    publishConfig: partial.publishConfig ?? {
      requiresReview: false,
      defaultStatus: 'draft',
      supportedStatuses: ['draft'],
      autoPublish: false,
    },
    extractedAt: partial.extractedAt ?? new Date(),
    rawSource: partial.rawSource,
  }
}

export function createContentType(
  partial: Partial<ContentType> & Pick<ContentType, 'key' | 'label'>
): ContentType {
  return {
    key: partial.key,
    label: partial.label,
    description: partial.description,
    fields: partial.fields ?? [],
    taxonomies: partial.taxonomies,
    supports: partial.supports ?? [],
    parentKey: partial.parentKey,
  }
}

export function createContentField(
  partial: Partial<ContentField> & Pick<ContentField, 'key' | 'label' | 'type'>
): ContentField {
  return {
    key: partial.key,
    label: partial.label,
    type: partial.type,
    required: partial.required ?? false,
    description: partial.description,
    config: partial.config,
    acfConfig: partial.acfConfig,
    parentKey: partial.parentKey,
    children: partial.children,
    sortOrder: partial.sortOrder ?? 0,
  }
}

// ─── Validation Helpers ────────────────────────────────────────────────────────

export function isFieldRequired(schema: ContentSchema, contentTypeKey: string, fieldKey: string): boolean {
  const contentType = schema.contentTypes.find(ct => ct.key === contentTypeKey)
  if (!contentType) return false

  const field = contentType.fields.find(f => f.key === fieldKey)
  return field?.required ?? false
}

export function getFieldByKey(schema: ContentSchema, contentTypeKey: string, fieldKey: string): ContentField | undefined {
  const contentType = schema.contentTypes.find(ct => ct.key === contentTypeKey)
  return contentType?.fields.find(f => f.key === fieldKey)
}

export function getRequiredFields(schema: ContentSchema, contentTypeKey: string): ContentField[] {
  const contentType = schema.contentTypes.find(ct => ct.key === contentTypeKey)
  return contentType?.fields.filter(f => f.required) ?? []
}
