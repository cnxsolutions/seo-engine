// ─────────────────────────────────────────────────────────────────────────────
// WordPress Extractor Adapter
// Extracts schema from WordPress sites via REST API + ACF
// ─────────────────────────────────────────────────────────────────────────────

import type {
  FederatedSite,
  ContentSchema,
  ContentType,
  ContentField,
  Taxonomy,
  Term,
} from '../../../core/domain/entities'
import type { createContentSchema, createContentType, createContentField } from '../../../core/domain/entities'
import { ACF_TYPE_MAPPING } from '../../../core/domain/entities/field-types'
import type { ISchemaExtractor } from '../../../core/domain/repositories'
import type { ConnectionResult } from '../../../core/domain/value-objects'
import { createContentSchema as makeSchema, createContentType as makeType, createContentField as makeField } from '../../../core/domain/entities'

// ─── DTOs ─────────────────────────────────────────────────────────────────────

interface WpPostType {
  slug: string
  name: string
  label: string
  description: string
  rest_base: string
  supports: string[]
  taxonomies: string[]
}

interface WpTaxonomy {
  slug: string
  name: string
  label: string
  description: string
  hierarchical: boolean
  types: string[]
}

interface WpAcfGroup {
  key: string
  title: string
  location: Array<Array<{ param: string; operator: string; value: string }>>
  fields: WpAcfField[]
}

interface WpAcfField {
  key: string
  label: string
  name: string
  type: string
  required: number
  description: string
  parent: number
  sub_fields?: WpAcfField[]
  conditional_logic?: unknown[]
  default_value?: unknown
  max_length?: number
  min?: number
  max?: number
  step?: number
  choices?: Record<string, string>
  allow_null?: number
  multiple?: number
  return_format?: string
}

interface WpSeoPlugin {
  type: string
  name: string
  fields: Array<{ key: string; type: string; label: string }>
}

// ─── WordPress REST Extractor ────────────────────────────────────────────────────

export class WordPressRestExtractor {
  private baseUrl: string
  private auth: string

  constructor(site: FederatedSite) {
    this.baseUrl = site.url.replace(/\/$/, '')
    this.auth = this.buildAuth(site)
  }

  private buildAuth(site: FederatedSite): string {
    if (site.credentials.wpAppPassword && site.credentials.wpUsername) {
      const encoded = Buffer.from(`${site.credentials.wpUsername}:${site.credentials.wpAppPassword}`).toString('base64')
      return `Basic ${encoded}`
    }
    return ''
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/${endpoint}`, {
      ...options,
      headers: {
        'Authorization': this.auth,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new WordPressApiError(response.status, endpoint, error)
    }

    return response.json()
  }

  async getPostTypes(): Promise<WpPostType[]> {
    const types = await this.fetch<Record<string, WpPostType>>('types')

    return Object.entries(types)
      .filter(([slug]) => !['attachment', 'revision', 'nav_menu_item'].includes(slug))
      .map(([slug, type]) => ({
        slug,
        name: type.name,
        label: type.label,
        description: type.description,
        rest_base: type.rest_base || slug,
        supports: this.parseSupports(type as unknown as Record<string, unknown>),
        taxonomies: [],
      }))
  }

  private parseSupports(type: Record<string, unknown>): string[] {
    const supports = (type.supports as Record<string, boolean>) || {}
    return Object.entries(supports)
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature)
  }

  async getTaxonomies(): Promise<WpTaxonomy[]> {
    const taxonomies = await this.fetch<Record<string, WpTaxonomy>>('taxonomies')

    return Object.entries(taxonomies).map(([slug, taxonomy]) => ({
      slug,
      name: taxonomy.name,
      label: taxonomy.label,
      description: taxonomy.description,
      hierarchical: taxonomy.hierarchical,
      types: taxonomy.types || [],
    }))
  }

  async getTermsForTaxonomy(taxonomy: string): Promise<Term[]> {
    const terms = await this.fetch<Array<{ id: number; name: string; slug: string; description: string; parent: number }>>(`${taxonomy}?per_page=100`)

    // Build tree with properly typed IDs
    const typedTerms: Array<{ id: number; name: string; slug: string; parentId: number | undefined }> = terms
      .filter(t => t.id > 0)
      .map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        parentId: t.parent > 0 ? t.parent : undefined,
      }))

    return this.buildTermTree(typedTerms)
  }

  private buildTermTree(terms: Array<{ id: number; name: string; slug: string; parentId?: number }>): Term[] {
    interface TermNode {
      id: number
      name: string
      slug: string
      level: number
      children: Term[]
    }

    const termMap = new Map<number, TermNode>()
    const roots: Term[] = []

    // Create nodes
    terms.forEach(term => {
      termMap.set(term.id, {
        id: term.id,
        name: term.name,
        slug: term.slug,
        level: 0,
        children: [],
      })
    })

    // Build hierarchy
    terms.forEach(term => {
      const node = termMap.get(term.id)!
      if (term.parentId) {
        const parent = termMap.get(term.parentId)
        if (parent) {
          node.level = (parent.level || 0) + 1
          parent.children.push(node as unknown as Term)
        } else {
          roots.push(node as unknown as Term)
        }
      } else {
        roots.push(node as unknown as Term)
      }
    })

    return roots
  }

  async testConnection(): Promise<{ success: boolean; siteName?: string }> {
    try {
      const response = await this.fetch<{ name: string }>('')
      return { success: true, siteName: response.name }
    } catch {
      return { success: false }
    }
  }
}

// ─── ACF Extractor ─────────────────────────────────────────────────────────────

export class AcfExtractor {
  private baseUrl: string
  private auth: string

  constructor(site: FederatedSite) {
    this.baseUrl = site.url.replace(/\/$/, '')
    this.auth = this.buildAuth(site)
  }

  private buildAuth(site: FederatedSite): string {
    if (site.credentials.wpAppPassword && site.credentials.wpUsername) {
      const encoded = Buffer.from(`${site.credentials.wpUsername}:${site.credentials.wpAppPassword}`).toString('base64')
      return `Basic ${encoded}`
    }
    return ''
  }

  async getAcfGroups(sitePostType?: string): Promise<WpAcfGroup[]> {
    try {
      const response = await fetch(`${this.baseUrl}/wp-json/acf/v3/groups`, {
        headers: {
          'Authorization': this.auth,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        console.warn('ACF API not available, skipping ACF extraction')
        return []
      }

      const groups: WpAcfGroup[] = await response.json()

      // Filter by post type if specified
      const filteredGroups = sitePostType
        ? groups.filter(group => this.groupAppliesToPostType(group, sitePostType))
        : groups

      return filteredGroups.map(group => ({
        ...group,
        fields: group.fields.map(field => this.parseAcfField(field, group.key)),
      }))
    } catch {
      console.warn('ACF plugin not installed or not accessible')
      return []
    }
  }

  private groupAppliesToPostType(group: WpAcfGroup, postType: string): boolean {
    return group.location.some(locationRule =>
      locationRule.some(rule =>
        rule.param === 'post_type' &&
        (rule.value === postType || rule.value === 'all')
      )
    )
  }

  private parseAcfField(field: WpAcfField, groupKey: string): WpAcfField {
    const parsed: WpAcfField = {
      ...field,
      key: field.key,
      name: field.name,
      type: field.type,
    }

    if (field.sub_fields) {
      parsed.sub_fields = field.sub_fields.map(subField =>
        this.parseAcfField(subField, groupKey)
      )
    }

    return parsed
  }
}

// ─── SEO Meta Extractor ────────────────────────────────────────────────────────

export class SeoMetaExtractor {
  private baseUrl: string
  private auth: string

  constructor(site: FederatedSite) {
    this.baseUrl = site.url.replace(/\/$/, '')
    this.auth = this.buildAuth(site)
  }

  private buildAuth(site: FederatedSite): string {
    if (site.credentials.wpAppPassword && site.credentials.wpUsername) {
      const encoded = Buffer.from(`${site.credentials.wpUsername}:${site.credentials.wpAppPassword}`).toString('base64')
      return `Basic ${encoded}`
    }
    return ''
  }

  async extract(): Promise<{
    plugin: string | null
    fields: Array<{ key: string; label: string; type: string }>
    schemaTypes: string[]
  }> {
    const [rankMathFields, yoastFields, aioFields] = await Promise.all([
      this.detectRankMath(),
      this.detectYoast(),
      this.detectAllInOne(),
    ])

    if (rankMathFields) return { plugin: 'rankmath', ...rankMathFields }
    if (yoastFields) return { plugin: 'yoast', ...yoastFields }
    if (aioFields) return { plugin: 'all-in-one', ...aioFields }

    return { plugin: null, fields: [], schemaTypes: [] }
  }

  private async detectRankMath(): Promise<{ fields: Array<{ key: string; label: string; type: string }>; schemaTypes: string[] } | null> {
    try {
      // Check if RankMath is active by trying to access a post's meta
      const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/pages?per_page=1`, {
        headers: { 'Authorization': this.auth },
      })

      if (!response.ok) return null

      // RankMath uses specific meta keys
      const fields: Array<{ key: string; label: string; type: string }> = [
        { key: 'rank_math_title', label: 'RankMath Title', type: 'text' },
        { key: 'rank_math_description', label: 'RankMath Description', type: 'text' },
        { key: 'rank_math_focus_keyword', label: 'Focus Keyword', type: 'text' },
        { key: 'rank_math_additional_keywords', label: 'Additional Keywords', type: 'text' },
        { key: 'rank_math_canonical_url', label: 'Canonical URL', type: 'url' },
        { key: 'rank_math_robots', label: 'Robots', type: 'text' },
        { key: 'rank_math_schema_LocalBusiness', label: 'Local Business Schema', type: 'json' },
        { key: 'rank_math_schema_FAQPage', label: 'FAQ Schema', type: 'json' },
      ]

      return {
        fields,
        schemaTypes: ['LocalBusiness', 'FAQPage', 'Article', 'BreadcrumbList'],
      }
    } catch {
      return null
    }
  }

  private async detectYoast(): Promise<{ fields: Array<{ key: string; label: string; type: string }>; schemaTypes: string[] } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/pages?per_page=1`, {
        headers: { 'Authorization': this.auth },
      })

      if (!response.ok) return null

      const fields: Array<{ key: string; label: string; type: string }> = [
        { key: '_yoast_wpseo_title', label: 'Yoast SEO Title', type: 'text' },
        { key: '_yoast_wpseo_metadesc', label: 'Meta Description', type: 'text' },
        { key: '_yoast_wpseo_focuskw', label: 'Focus Keyword', type: 'text' },
        { key: '_yoast_wpseo_keywords', label: 'Keywords', type: 'text' },
        { key: '_yoast_wpseo_canonical', label: 'Canonical', type: 'url' },
        { key: '_yoast_wpseo_opengraph-title', label: 'OG Title', type: 'text' },
        { key: '_yoast_wpseo_opengraph-description', label: 'OG Description', type: 'text' },
      ]

      return {
        fields,
        schemaTypes: ['Article', 'WebPage'],
      }
    } catch {
      return null
    }
  }

  private async detectAllInOne(): Promise<{ fields: Array<{ key: string; label: string; type: string }>; schemaTypes: string[] } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/pages?per_page=1`, {
        headers: { 'Authorization': this.auth },
      })

      if (!response.ok) return null

      const fields: Array<{ key: string; label: string; type: string }> = [
        { key: '_aioseo_title', label: 'All in One SEO Title', type: 'text' },
        { key: '_aioseo_description', label: 'Meta Description', type: 'text' },
        { key: '_aioseo_keywords', label: 'Keywords', type: 'text' },
      ]

      return {
        fields,
        schemaTypes: ['Article'],
      }
    } catch {
      return null
    }
  }
}

// ─── WordPress Schema Extractor ───────────────────────────────────────────────

export class WordPressExtractor implements ISchemaExtractor {
  readonly sourceType = 'wordpress' as const

  constructor(
    private restExtractor: WordPressRestExtractor,
    private acfExtractor: AcfExtractor,
    private seoExtractor: SeoMetaExtractor
  ) {}

  canHandle(site: FederatedSite): boolean {
    return site.type === 'wordpress'
  }

  async extract(site: FederatedSite): Promise<ContentSchema> {
    const [postTypes, taxonomies, seoInfo] = await Promise.all([
      this.restExtractor.getPostTypes(),
      this.restExtractor.getTaxonomies(),
      this.seoExtractor.extract(),
    ])

    const contentTypes: ContentType[] = []

    for (const postType of postTypes) {
      const fields: ContentField[] = this.buildStandardFields(postType)
      const acfGroups = await this.acfExtractor.getAcfGroups(postType.slug)
      const acfFields = this.mapAcfGroupsToFields(acfGroups)

      contentTypes.push(
        makeType({
          key: postType.slug,
          label: postType.label,
          description: postType.description,
          fields: [...fields, ...acfFields],
          supports: postType.supports,
          taxonomies: taxonomies
            .filter(t => t.types.includes(postType.slug))
            .map(t => this.mapTaxonomy(t)),
        })
      )
    }

    return makeSchema({
      siteId: site.id,
      name: site.name,
      label: `WordPress - ${site.name}`,
      description: `Schema extrait de ${site.url}`,
      contentTypes,
      seoConfig: {
        hasSeoPlugin: !!seoInfo.plugin,
        seoFields: seoInfo.fields.map(f => f.key),
        schemaTypes: seoInfo.schemaTypes,
      },
      publishConfig: {
        requiresReview: false,
        defaultStatus: 'draft',
        supportedStatuses: ['draft', 'publish', 'pending'],
        autoPublish: false,
      },
      rawSource: { postTypes, taxonomies, seoPlugin: seoInfo.plugin },
    })
  }

  async extractContentType(site: FederatedSite, type: string): Promise<ContentType> {
    const schema = await this.extract(site)
    const contentType = schema.contentTypes.find(ct => ct.key === type)

    if (!contentType) {
      throw new Error(`Content type "${type}" not found in WordPress schema`)
    }

    return contentType
  }

  async validateConnection(site: FederatedSite): Promise<ConnectionResult> {
    try {
      const result = await this.restExtractor.testConnection()
      return {
        isConnected: result.success,
        siteName: result.siteName,
        capabilities: result.success ? ['rest_api', 'acf', 'seo'] : [],
      }
    } catch (error) {
      return {
        isConnected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }

  private buildStandardFields(postType: WpPostType): ContentField[] {
    const fields: ContentField[] = []

    if (postType.supports.includes('title')) {
      fields.push(makeField({
        key: 'title',
        label: 'Titre',
        type: 'text',
        required: true,
        config: { maxLength: 255 },
        sortOrder: 0,
      }))
    }

    if (postType.supports.includes('editor')) {
      fields.push(makeField({
        key: 'content',
        label: 'Contenu',
        type: 'html',
        required: true,
        sortOrder: 1,
      }))
    }

    if (postType.supports.includes('thumbnail') || postType.supports.includes('featured-image')) {
      fields.push(makeField({
        key: 'featured_image',
        label: 'Image mise en avant',
        type: 'image',
        sortOrder: 2,
      }))
    }

    if (postType.supports.includes('excerpt')) {
      fields.push(makeField({
        key: 'excerpt',
        label: 'Extrait',
        type: 'text',
        sortOrder: 3,
      }))
    }

    if (postType.supports.includes('author')) {
      fields.push(makeField({
        key: 'author',
        label: 'Auteur',
        type: 'reference',
        config: { to: ['user'] },
        sortOrder: 4,
      }))
    }

    fields.push(makeField({
      key: 'slug',
      label: 'Slug',
      type: 'slug',
      required: true,
      sortOrder: 5,
    }))

    fields.push(makeField({
      key: 'status',
      label: 'Statut de publication',
      type: 'select',
      config: { options: ['draft', 'publish', 'pending', 'private'] },
      sortOrder: 6,
    }))

    return fields
  }

  private mapAcfGroupsToFields(groups: WpAcfGroup[]): ContentField[] {
    return groups.flatMap((group, groupIndex) =>
      group.fields.map((field, fieldIndex) =>
        this.mapAcfField(field, group.key, groupIndex * 100 + fieldIndex)
      )
    )
  }

  private mapAcfField(acfField: WpAcfField, groupKey: string, sortOrder: number): ContentField {
    const fieldType = ACF_TYPE_MAPPING[acfField.type] ?? 'text'

    const field = makeField({
      key: `acf_${acfField.name}`,
      label: acfField.label,
      type: fieldType,
      required: !!acfField.required,
      description: acfField.description,
      config: {
        maxLength: acfField.max_length,
        min: acfField.min,
        max: acfField.max,
        step: acfField.step,
        options: acfField.choices ? Object.values(acfField.choices) : undefined,
      },
      acfConfig: {
        type: acfField.type,
        name: acfField.name,
        groupId: groupKey,
      },
      sortOrder,
    })

    if (acfField.sub_fields && acfField.type === 'group') {
      field.children = acfField.sub_fields.map((subField, index) =>
        this.mapAcfField(subField, groupKey, index)
      )
    }

    return field
  }

  private mapTaxonomy(wpTaxonomy: WpTaxonomy): Taxonomy {
    return {
      key: wpTaxonomy.slug,
      label: wpTaxonomy.label,
      hierarchical: wpTaxonomy.hierarchical,
      types: wpTaxonomy.types,
    }
  }
}

// ─── Error Class ───────────────────────────────────────────────────────────────

export class WordPressApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly endpoint: string,
    public readonly details: string
  ) {
    super(`WordPress API error ${statusCode} on ${endpoint}: ${details}`)
    this.name = 'WordPressApiError'
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createWordPressExtractor(site: FederatedSite): WordPressExtractor {
  const restExtractor = new WordPressRestExtractor(site)
  const acfExtractor = new AcfExtractor(site)
  const seoExtractor = new SeoMetaExtractor(site)

  return new WordPressExtractor(restExtractor, acfExtractor, seoExtractor)
}
