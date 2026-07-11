// ─────────────────────────────────────────────────────────────────────────────
// Vector Indexing Service
// SEO Engine - RAG Infrastructure
// Handles automatic indexing of schemas and content from federated sites
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import type { SupabaseVectorStore } from './providers/SupabaseVectorStore'
import type {
  SchemaIndexInput,
  ContentIndexInput,
  ContentTypeIndexInput,
  FieldIndexInput,
  TaxonomyIndexInput,
  TermIndexInput,
  IndexingStatus,
} from './VectorStore'

/**
 * Service pour orchestrer l'indexation vectorielle
 */
export class VectorIndexingService {
  private vectorStore: SupabaseVectorStore
  private supabase = createServiceClient()

  constructor(vectorStore: SupabaseVectorStore) {
    this.vectorStore = vectorStore
  }

  /**
   * Indexe tous les schémas d'un site fédéré
   */
  async indexSiteSchemas(siteId: string): Promise<IndexingStatus> {
    // 1. Récupérer le site
    const { data: site, error: siteError } = await this.supabase
      .from('federated_sites')
      .select('*')
      .eq('id', siteId)
      .single()

    if (siteError || !site) {
      throw new Error(`Site not found: ${siteId}`)
    }

    // 2. Récupérer le schéma actuel
    const { data: schemas, error: schemasError } = await this.supabase
      .from('content_schemas')
      .select(`
        *,
        content_types (
          *,
          content_fields (*),
          taxonomies (
            *,
            taxonomy_terms (*)
          )
        )
      `)
      .eq('federated_site_id', siteId)
      .single()

    if (schemasError || !schemas) {
      throw new Error(`Schema not found for site: ${siteId}`)
    }

    // 3. Construire l'input pour l'indexation
    const schemaInput = this.buildSchemaInput(schemas)

    // 4. Indexer le schéma
    return this.vectorStore.indexSchema(siteId, schemaInput)
  }

  /**
   * Indexe le contenu existant d'un site WordPress ou Sanity
   */
  async indexSiteContent(
    siteId: string,
    options: {
      contentTypeKeys?: string[]
      batchSize?: number
    } = {}
  ): Promise<IndexingStatus> {
    // 1. Récupérer le site pour avoir les credentials
    const { data: site, error: siteError } = await this.supabase
      .from('federated_sites')
      .select('*')
      .eq('id', siteId)
      .single()

    if (siteError || !site) {
      throw new Error(`Site not found: ${siteId}`)
    }

    // 2. Extraire le contenu selon le type de CMS
    let documents: ContentDocument[] = []

    if (site.type === 'wordpress') {
      documents = await this.extractWordPressContent(site, options.contentTypeKeys)
    } else if (site.type === 'sanity') {
      documents = await this.extractSanityContent(site, options.contentTypeKeys)
    }

    // 3. Construire l'input pour l'indexation
    const contentInput: ContentIndexInput = {
      documents: documents.map(doc => ({
        contentTypeKey: doc.contentType,
        title: doc.title,
        content: doc.content,
        excerpt: doc.excerpt,
        url: doc.url,
        focusKeyword: doc.focusKeyword,
        taxonomyTerms: doc.taxonomyTerms,
        wordCount: doc.wordCount,
        hasImages: doc.hasImages,
        hasFaq: doc.hasFaq,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })),
    }

    // 4. Indexer le contenu
    return this.vectorStore.indexContent(siteId, contentInput)
  }

  /**
   * Re-indexe complètement un site
   */
  async reindexSite(siteId: string): Promise<IndexingStatus> {
    // 1. Supprimer les données existantes
    await this.vectorStore.deleteBySite(siteId)

    // 2. Ré-indexer les schémas
    const schemaStatus = await this.indexSiteSchemas(siteId)

    // 3. Ré-indexer le contenu
    const contentStatus = await this.indexSiteContent(siteId)

    // 4. Combiner les statuts
    return {
      operationId: crypto.randomUUID(),
      status: schemaStatus.status === 'completed' && contentStatus.status === 'completed'
        ? 'completed'
        : 'failed',
      documentsProcessed: schemaStatus.documentsProcessed + contentStatus.documentsProcessed,
      documentsFailed: schemaStatus.documentsFailed + contentStatus.documentsFailed,
      errors: [...schemaStatus.errors, ...contentStatus.errors],
      startedAt: schemaStatus.startedAt,
      completedAt: contentStatus.completedAt || new Date().toISOString(),
    }
  }

  /**
   * Met à jour l'index quand un schéma change
   */
  async onSchemaChange(siteId: string, schemaId: string): Promise<void> {
    // Ré-indexer uniquement ce schéma
    await this.indexSiteSchemas(siteId)
  }

  /**
   * Met à jour l'index quand du contenu change
   */
  async onContentChange(
    siteId: string,
    contentId: string,
    contentType: string
  ): Promise<void> {
    // Extraire et ré-indexer le contenu spécifique
    const site = await this.getSite(siteId)
    if (!site) return

    let documents: ContentDocument[] = []

    if (site.type === 'wordpress') {
      documents = await this.extractWordPressContent(site, [contentType])
    } else if (site.type === 'sanity') {
      documents = await this.extractSanityContent(site, [contentType])
    }

    if (documents.length > 0) {
      await this.vectorStore.indexContent(siteId, { documents })
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private async getSite(siteId: string) {
    const { data } = await this.supabase
      .from('federated_sites')
      .select('*')
      .eq('id', siteId)
      .single()

    return data
  }

  private buildSchemaInput(schema: SchemaData): SchemaIndexInput {
    return {
      schemaId: schema.id,
      schemaName: schema.name,
      contentTypes: schema.content_types?.map(ct => this.buildContentTypeInput(ct)) || [],
      taxonomies: schema.content_types?.flatMap(ct =>
        ct.taxonomies?.map(t => this.buildTaxonomyInput(t)) || []
      ) || [],
      seoConfig: schema.seo_config,
    }
  }

  private buildContentTypeInput(contentType: ContentTypeData): ContentTypeIndexInput {
    return {
      key: contentType.key,
      label: contentType.label,
      description: contentType.description,
      fields: contentType.content_fields
        ?.filter(f => !f.parent_field_id) // Uniquement champs racines
        .map(f => this.buildFieldInput(f)) || [],
      supports: contentType.supports || [],
    }
  }

  private buildFieldInput(field: FieldData): FieldIndexInput {
    return {
      key: field.key,
      label: field.label,
      type: field.field_type,
      required: field.is_required,
      description: field.description,
      config: field.config,
    }
  }

  private buildTaxonomyInput(taxonomy: TaxonomyData): TaxonomyIndexInput {
    return {
      key: taxonomy.key,
      label: taxonomy.label,
      hierarchical: taxonomy.is_hierarchical,
      terms: taxonomy.taxonomy_terms?.map(t => this.buildTermInput(t)) || [],
    }
  }

  private buildTermInput(term: TermData): TermIndexInput {
    return {
      name: term.name,
      slug: term.slug,
      description: term.description || undefined,
      level: term.level,
    }
  }

  private async extractWordPressContent(
    site: SiteData,
    contentTypeKeys?: string[]
  ): Promise<ContentDocument[]> {
    const credentials = site.credentials as WPCredentials
    const baseUrl = site.url.replace(/\/$/, '')
    const apiBase = `${baseUrl}/wp-json/wp/v2`

    // Récupérer les types de contenu si non spécifiés
    const types = contentTypeKeys || ['post', 'page']

    const documents: ContentDocument[] = []

    for (const type of types) {
      try {
        let page = 1
        let hasMore = true

        while (hasMore) {
          const response = await fetch(
            `${apiBase}/${type}?per_page=100&page=${page}&_embed`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(
                  `${credentials.wpUsername}:${credentials.wpAppPassword}`
                ).toString('base64')}`,
              },
            }
          )

          if (!response.ok) {
            hasMore = false
            continue
          }

          const items = await response.json() as WPContentItem[]

          if (!items || items.length === 0) {
            hasMore = false
            continue
          }

          for (const item of items) {
            documents.push({
              contentTypeKey: type,
              contentType: type.charAt(0).toUpperCase() + type.slice(1),
              title: item.title?.rendered?.replace(/<[^>]*>/g, '') || '',
              content: item.content?.rendered || '',
              excerpt: item.excerpt?.rendered?.replace(/<[^>]*>/g, ''),
              url: item.link,
              focusKeyword: item._embedded?.['wp:term']?.[0]?.[0]?.name,
              taxonomyTerms: item._embedded?.['wp:term']
                ?.flat()
                ?.map((t: { name: string }) => t.name) || [],
              wordCount: this.countWords(item.content?.rendered || ''),
              hasImages: item.content?.rendered?.includes('<img') || false,
              hasFaq: item.content?.rendered?.includes('faq') || false,
              createdAt: item.date,
              updatedAt: item.modified,
            })
          }

          // Check si plus de pages
          const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '1')
          hasMore = page < totalPages
          page++
        }
      } catch (error) {
        console.error(`Failed to extract ${type} from WordPress:`, error)
      }
    }

    return documents
  }

  private async extractSanityContent(
    site: SiteData,
    contentTypeKeys?: string[]
  ): Promise<ContentDocument[]> {
    const credentials = site.credentials as SanityCredentials
    const baseUrl = `https://${credentials.sanityProjectId}.api.sanity.io/v2024-01-01/data/query/${credentials.sanityDataset}`

    const types = contentTypeKeys || ['post', 'article']

    const documents: ContentDocument[] = []

    for (const type of types) {
      try {
        // GROQ query pour récupérer les documents
        const query = encodeURIComponent(
          `*[_type == "${type}" && !(_id in path("drafts.**"))] | order(_createdAt desc)[0...100] {
            _id,
            _type,
            title,
            body,
            excerpt,
            slug,
            _createdAt,
            _updatedAt,
            categories[]->{title},
            tags[]->{title}
          }`
        )

        const response = await fetch(`${baseUrl}?query=${query}`, {
          headers: {
            Authorization: `Bearer ${credentials.sanityToken}`,
          },
        })

        if (!response.ok) {
          continue
        }

        const data = await response.json() as { result?: SanityContentItem[] }

        for (const item of data.result || []) {
          documents.push({
            contentTypeKey: type,
            contentType: type.charAt(0).toUpperCase() + type.slice(1),
            title: item.title || '',
            content: typeof item.body === 'string' ? item.body : JSON.stringify(item.body),
            excerpt: item.excerpt,
            url: item.slug?.current ? `${site.url}/${item.slug.current}` : undefined,
            taxonomyTerms: [
              ...(item.categories?.map((c: { title: string }) => c.title) || []),
              ...(item.tags?.map((t: { title: string }) => t.title) || []),
            ],
            wordCount: this.countWords(typeof item.body === 'string' ? item.body : JSON.stringify(item.body)),
            hasImages: JSON.stringify(item.body)?.includes('image') || false,
            hasFaq: JSON.stringify(item.body)?.includes('faq') || false,
            createdAt: item._createdAt,
            updatedAt: item._updatedAt,
          })
        }
      } catch (error) {
        console.error(`Failed to extract ${type} from Sanity:`, error)
      }
    }

    return documents
  }

  private countWords(text: string): number {
    if (!text) return 0
    return text.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length
  }
}

// ─── Types temporaires ────────────────────────────────────────────────────────

interface SiteData {
  id: string
  type: 'wordpress' | 'sanity'
  url: string
  credentials: WPCredentials | SanityCredentials
}

interface WPCredentials {
  wpUsername: string
  wpAppPassword: string
}

interface SanityCredentials {
  sanityProjectId: string
  sanityDataset: string
  sanityToken: string
}

interface SchemaData {
  id: string
  name: string
  seo_config?: Record<string, unknown>
  content_types?: ContentTypeData[]
}

interface ContentTypeData {
  key: string
  label: string
  description?: string
  supports?: string[]
  content_fields?: FieldData[]
  taxonomies?: TaxonomyData[]
}

interface FieldData {
  key: string
  label: string
  field_type: string
  is_required: boolean
  description?: string
  config?: Record<string, unknown>
  parent_field_id?: string
}

interface TaxonomyData {
  key: string
  label: string
  is_hierarchical: boolean
  taxonomy_terms?: TermData[]
}

interface TermData {
  name: string
  slug: string
  description?: string
  level: number
}

interface WPContentItem {
  id: number
  title?: { rendered: string }
  content?: { rendered: string }
  excerpt?: { rendered: string }
  link?: string
  date?: string
  modified?: string
  _embedded?: {
    'wp:term'?: Array<Array<{ name: string }>>
  }
}

interface SanityContentItem {
  _id: string
  _type: string
  _createdAt: string
  _updatedAt: string
  title?: string
  body?: unknown
  excerpt?: string
  slug?: { current: string }
  categories?: Array<{ title: string }>
  tags?: Array<{ title: string }>
}

interface ContentDocument {
  contentTypeKey: string
  contentType: string
  title: string
  content: string
  excerpt?: string
  url?: string
  focusKeyword?: string
  taxonomyTerms?: string[]
  wordCount?: number
  hasImages?: boolean
  hasFaq?: boolean
  createdAt?: string
  updatedAt?: string
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let indexingService: VectorIndexingService | null = null

export function getIndexingService(vectorStore: SupabaseVectorStore): VectorIndexingService {
  if (!indexingService) {
    indexingService = new VectorIndexingService(vectorStore)
  }
  return indexingService
}
