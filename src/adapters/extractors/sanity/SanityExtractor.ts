// ─────────────────────────────────────────────────────────────────────────────
// Sanity Extractor Adapter
// Extracts schema from Sanity CMS via Sanity API
// ─────────────────────────────────────────────────────────────────────────────

import type {
  FederatedSite,
  ContentSchema,
  ContentType,
  ContentField,
  SeoConfig,
} from '../../../core/domain/entities'
import { SANITY_TYPE_MAPPING } from '../../../core/domain/entities/field-types'
import type { ISchemaExtractor } from '../../../core/domain/repositories'
import type { ConnectionResult } from '../../../core/domain/value-objects'
import { createContentSchema as makeSchema, createContentType as makeType, createContentField as makeField } from '../../../core/domain/entities'

// ─── DTOs ─────────────────────────────────────────────────────────────────────

interface SanitySchemaDefinition {
  name: string
  title?: string
  description?: string
  type: string
  options?: SanityTypeOptions
  fields?: SanityFieldDefinition[]
  icon?: unknown
  preview?: unknown
}

interface SanityFieldDefinition {
  name: string
  title?: string
  description?: string
  type: string
  options?: SanityFieldOptions
  validation?: unknown[]
  hidden?: boolean
  readOnly?: boolean
  initialValue?: unknown
  fields?: SanityFieldDefinition[]
  to?: Array<{ type: string }>
  optionsType?: string
  of?: Array<{ type: string; name?: string; title?: string; options?: SanityFieldOptions }>
}

interface SanityTypeOptions {
  source?: string
  max?: number
  sortable?: boolean
  collapsible?: boolean
  collapsed?: boolean
  list?: Array<{ value: string; title: string } | string>
  isHighlighted?: boolean
  layout?: string
  of?: Array<{ type: string; name?: string; title?: string; options?: SanityFieldOptions }>
  group?: string | string[]
}

interface SanityFieldOptions {
  source?: string
  max?: number
  sortable?: boolean
  list?: Array<{ value: string; title: string } | string>
  layout?: string
  hidden?: boolean
  of?: Array<{ type: string; name?: string }>
  to?: Array<{ type: string }>
}

interface SanityProjectInfo {
  projectId: string
  dataset: string
  studioUrl?: string
}

// ─── Sanity Client ─────────────────────────────────────────────────────────────

export class SanityClient {
  private baseUrl: string
  private token?: string

  constructor(site: FederatedSite) {
    const projectId = site.credentials.sanityProjectId
    const dataset = site.credentials.sanityDataset || 'production'

    if (!projectId) {
      throw new Error('Sanity projectId is required')
    }

    this.baseUrl = `https://${projectId}.api.sanity.io/v2024-01-01`
    this.token = site.credentials.sanityToken
  }

  async query<T>(groq: string, params?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl}/data/query/production?query=${encodeURIComponent(groq)}`, {
      headers: this.buildHeaders(),
    })

    if (!response.ok) {
      throw new SanityApiError(response.status, groq, await response.text())
    }

    const result = await response.json()
    return result.result
  }

  async fetchSchema(): Promise<SanitySchemaDefinition[]> {
    // Fetch all schema types from Sanity
    const schemas = await this.query<SanitySchemaDefinition[]>(`
      *[_type == "_type" && !(_id match "_.*")] {
        "name": _id,
        type: _type
      }
    `)

    // If that doesn't work, try to get it from the schema API
    if (!schemas || schemas.length === 0) {
      return this.fetchSchemaFromApi()
    }

    return schemas
  }

  private async fetchSchemaFromApi(): Promise<SanitySchemaDefinition[]> {
    // Try to fetch from Sanity's schema endpoint
    const response = await fetch(`${this.baseUrl}/schemas`, {
      headers: this.buildHeaders(),
    })

    if (!response.ok) {
      // Fallback to common Sanity document types
      return this.getCommonSchemaTypes()
    }

    return response.json()
  }

  private getCommonSchemaTypes(): SanitySchemaDefinition[] {
    // Common Sanity schema types that are often present
    return [
      { name: 'document', type: 'document', title: 'Document' },
      { name: 'object', type: 'object', title: 'Object' },
      { name: 'string', type: 'string', title: 'String' },
      { name: 'text', type: 'text', title: 'Text' },
      { name: 'number', type: 'number', title: 'Number' },
      { name: 'boolean', type: 'boolean', title: 'Boolean' },
      { name: 'date', type: 'date', title: 'Date' },
      { name: 'datetime', type: 'datetime', title: 'DateTime' },
      { name: 'image', type: 'image', title: 'Image' },
      { name: 'file', type: 'file', title: 'File' },
      { name: 'url', type: 'url', title: 'URL' },
      { name: 'email', type: 'email', title: 'Email' },
      { name: 'slug', type: 'slug', title: 'Slug' },
      { name: 'reference', type: 'reference', title: 'Reference' },
      { name: 'array', type: 'array', title: 'Array' },
      { name: 'block', type: 'block', title: 'Block' },
      { name: 'span', type: 'span', title: 'Span' },
    ]
  }

  async getProjectInfo(): Promise<SanityProjectInfo | null> {
    try {
      const info = await this.query<{ projectId: string; dataset: string }>(`
        *[_id == "__projectInfo__"][0] {
          projectId,
          dataset
        }
      `)
      return info || null
    } catch {
      return null
    }
  }

  async testConnection(): Promise<{ success: boolean; dataset?: string }> {
    try {
      await this.query<unknown>('*[_type == "siteConfig"][0]{_id}')
      return { success: true }
    } catch {
      // Try a simpler query
      try {
        await this.query<unknown>('{ "count": count(*) }')
        return { success: true, dataset: 'production' }
      } catch {
        return { success: false }
      }
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    return headers
  }
}

// ─── Sanity Type Analyzer ─────────────────────────────────────────────────────

export class SanityTypeAnalyzer {
  analyze(schema: SanitySchemaDefinition): {
    isDocument: boolean
    isContentType: boolean
    supports: string[]
  } {
    const isDocument = schema.type === 'document'
    const isContentType = this.isLikelyContentType(schema)

    const supports: string[] = []
    if (schema.fields) {
      if (schema.fields.some(f => f.name === 'title' || f.name === 'name')) {
        supports.push('title')
      }
      if (schema.fields.some(f => f.name === 'body' || f.name === 'content' || f.type === 'block')) {
        supports.push('editor')
      }
      if (schema.fields.some(f => f.name === 'mainImage' || f.name === 'image')) {
        supports.push('image')
      }
      if (schema.fields.some(f => f.name === 'slug')) {
        supports.push('slug')
      }
    }

    return { isDocument, isContentType, supports }
  }

  private isLikelyContentType(schema: SanitySchemaDefinition): boolean {
    if (schema.type !== 'document') return false

    const contentTypeIndicators = [
      'article', 'post', 'page', 'product', 'service',
      'event', 'project', 'case_study', 'testimonial',
      'faq', 'team', 'location'
    ]

    return contentTypeIndicators.some(indicator =>
      schema.name.toLowerCase().includes(indicator)
    )
  }
}

// ─── Sanity Schema Extractor ──────────────────────────────────────────────────

export class SanityExtractor implements ISchemaExtractor {
  readonly sourceType = 'sanity' as const

  constructor(
    private client: SanityClient,
    private analyzer: SanityTypeAnalyzer
  ) {}

  canHandle(site: FederatedSite): boolean {
    return site.type === 'sanity' || !!site.credentials.sanityProjectId
  }

  async extract(site: FederatedSite): Promise<ContentSchema> {
    // Get all document types from Sanity
    const schemas = await this.getAllSchemas()

    // Filter to actual content types (documents with fields)
    const contentTypes = schemas
      .filter(schema => this.isContentType(schema))
      .map(schema => this.mapSchemaToContentType(schema))

    // Extract SEO configuration
    const seoConfig = this.extractSeoConfig(schemas)

    return makeSchema({
      siteId: site.id,
      name: site.name,
      label: `Sanity - ${site.name}`,
      description: `Schema extrait de Sanity (${site.credentials.sanityDataset || 'production'})`,
      contentTypes,
      seoConfig,
      publishConfig: {
        requiresReview: false,
        defaultStatus: 'draft',
        supportedStatuses: ['draft', 'published'],
        autoPublish: false,
      },
      rawSource: { schemas: schemas.map(s => ({ name: s.name, type: s.type })) },
    })
  }

  async extractContentType(site: FederatedSite, type: string): Promise<ContentType> {
    const schema = await this.extract(site)
    const contentType = schema.contentTypes.find(ct => ct.key === type)

    if (!contentType) {
      throw new Error(`Content type "${type}" not found in Sanity schema`)
    }

    return contentType
  }

  async validateConnection(site: FederatedSite): Promise<ConnectionResult> {
    try {
      const result = await this.client.testConnection()
      return {
        isConnected: result.success,
        capabilities: result.success ? ['groq', 'schemas', 'api'] : [],
      }
    } catch (error) {
      return {
        isConnected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }

  private async getAllSchemas(): Promise<SanitySchemaDefinition[]> {
    // Get all unique document types
    const documentTypes = await this.client.query<string[]>(`
      *[_type in ["__schema", "_type"] || !(_type match "_*")] {
        _type
      }._type | unique
    `)

    // If we can't get the list, use common types
    const typesToFetch = documentTypes?.length
      ? documentTypes
      : [
          'article', 'page', 'post', 'hero', 'section',
          'faq', 'service', 'testimonial', 'teamMember',
          'location', 'category', 'tag', 'author',
          'siteSettings', 'navigation', 'blockContent',
          'seo', 'openGraph', 'meta'
        ]

    // Build schemas for each type
    const schemas: SanitySchemaDefinition[] = []

    for (const typeName of typesToFetch) {
      try {
        // Try to get a sample document of this type
        const sample = await this.client.query<unknown>(`*[_type == "${typeName}"][0]{_type}`)
        if (sample) {
          schemas.push({ name: typeName, type: 'document' })
        }
      } catch {
        // Type might not exist, skip
      }
    }

    // Add base types
    schemas.push(
      ...this.getBaseTypes()
    )

    return schemas
  }

  private getBaseTypes(): SanitySchemaDefinition[] {
    return [
      {
        name: 'blockContent',
        title: 'Block Content',
        type: 'array',
        fields: [
          { name: '_type', type: 'string', options: { hidden: true } },
          { name: 'children', type: 'array', of: [{ type: 'span' }] },
          { name: 'style', type: 'string' },
        ],
      },
      {
        name: 'seo',
        title: 'SEO',
        type: 'object',
        fields: [
          { name: 'metaTitle', title: 'Meta Title', type: 'string' },
          { name: 'metaDescription', title: 'Meta Description', type: 'text' },
          { name: 'keywords', title: 'Keywords', type: 'array', options: { of: [{ type: 'string' }] } },
          { name: 'noIndex', title: 'No Index', type: 'boolean' },
        ],
      },
      {
        name: 'openGraph',
        title: 'Open Graph',
        type: 'object',
        fields: [
          { name: 'title', title: 'Title', type: 'string' },
          { name: 'description', title: 'Description', type: 'text' },
          { name: 'image', title: 'Image', type: 'image' },
        ],
      },
      {
        name: 'imageAlt',
        title: 'Image with Alt',
        type: 'object',
        fields: [
          { name: 'asset', title: 'Image', type: 'image' },
          { name: 'alt', title: 'Alt Text', type: 'string' },
          { name: 'caption', title: 'Caption', type: 'string' },
        ],
      },
    ]
  }

  private isContentType(schema: SanitySchemaDefinition): boolean {
    if (schema.type !== 'document') return false

    const analysis = this.analyzer.analyze(schema)
    return analysis.isContentType || analysis.supports.length >= 2
  }

  private mapSchemaToContentType(schema: SanitySchemaDefinition): ContentType {
    const analysis = this.analyzer.analyze(schema)

    return makeType({
      key: schema.name,
      label: schema.title || schema.name,
      description: schema.description,
      fields: schema.fields
        ? schema.fields
            .filter(f => !f.hidden && f.type !== 'file' || f.name !== '_type')
            .map((field, index) => this.mapField(field, index))
        : [],
      supports: analysis.supports,
    })
  }

  private mapField(field: SanityFieldDefinition, sortOrder: number): ContentField {
    const type = SANITY_TYPE_MAPPING[field.type] ?? 'text'

    let config: import('../../../core/domain/entities/field-types').FieldConfig | undefined

    if (field.options) {
      config = {}

      if (field.options.list) {
        config.options = field.options.list.map(item =>
          typeof item === 'string' ? item : item.value
        )
      }

      if (field.options.of) {
        const blockTypes = field.options.of.map(o => o.type)
        if (blockTypes.includes('block')) {
          config.blockTypes = blockTypes
        }
      }

      if (field.options.max) {
        config.maxItems = field.options.max
      }
    }

    const contentField = makeField({
      key: field.name,
      label: field.title || field.name,
      type,
      required: !!field.validation?.length,
      description: field.description,
      config,
      sortOrder,
    })

    // Handle nested fields for object/group types
    if (field.fields && ['object', 'group'].includes(field.type)) {
      contentField.children = field.fields.map((subField, index) =>
        this.mapField(subField, index)
      )
    }

    // Handle array types
    if (field.type === 'array' && field.options?.of) {
      contentField.config = {
        ...contentField.config,
        fields: (field.options.of as SanityFieldDefinition[])
          .filter(o => o.type !== 'block' && o.type !== 'span')
          .map((o, index) => ({
            key: o.name || o.type,
            label: o.title || o.type,
            type: SANITY_TYPE_MAPPING[o.type] ?? 'text' as import('../../../core/domain/entities/field-types').FieldType,
            required: false,
            sortOrder: index,
          })),
      }
    }

    return contentField
  }

  private extractSeoConfig(schemas: SanitySchemaDefinition[]): SeoConfig {
    const seoSchemas = schemas.filter(s =>
      s.name.includes('seo') ||
      s.name.includes('meta') ||
      s.name.includes('openGraph') ||
      s.name.includes('open-graph') ||
      s.type === 'openGraph'
    )

    const seoFields: string[] = []

    seoSchemas.forEach(schema => {
      if (schema.fields) {
        schema.fields.forEach(field => {
          seoFields.push(field.name)
        })
      }
    })

    // Infer schema types from schema names
    const schemaTypes: string[] = []
    if (schemas.some(s => s.name.includes('article') || s.name.includes('post'))) {
      schemaTypes.push('Article')
    }
    if (schemas.some(s => s.name.includes('faq'))) {
      schemaTypes.push('FAQPage')
    }
    if (schemas.some(s => s.name.includes('local') || s.name.includes('location'))) {
      schemaTypes.push('LocalBusiness')
    }
    if (schemas.some(s => s.name.includes('product'))) {
      schemaTypes.push('Product')
    }
    if (schemas.some(s => s.name.includes('event'))) {
      schemaTypes.push('Event')
    }

    return {
      hasSeoPlugin: seoSchemas.length > 0,
      seoFields,
      schemaTypes,
    }
  }
}

// ─── Error Class ───────────────────────────────────────────────────────────────

export class SanityApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly query: string,
    public readonly details: string
  ) {
    super(`Sanity API error ${statusCode}: ${details}`)
    this.name = 'SanityApiError'
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSanityExtractor(site: FederatedSite): SanityExtractor {
  const client = new SanityClient(site)
  const analyzer = new SanityTypeAnalyzer()
  return new SanityExtractor(client, analyzer)
}
