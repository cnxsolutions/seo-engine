// ─────────────────────────────────────────────────────────────────────────────
// Sanity Document Builder
// SEO Engine - Publishing Infrastructure
// Converts content to Sanity document format with Portable Text
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SanityClient,
  SanityDocument,
  SanityReference,
} from './SanityClient'

/**
 * Contenu à publier sur Sanity
 */
export interface SanityPublishContent {
  // Type de document
  documentType: string

  // Identification
  title: string
  slug: string
  excerpt?: string

  // Contenu principal
  body: string | SanityBlock[]

  // Média
  mainImage?: SanityImageAsset

  // Taxonomie
  categories?: SanityTerm[]
  tags?: SanityTerm[]

  // Auteur
  author?: SanityAuthor

  // SEO
  seo?: SanitySeoFields

  // Métadonnées
  publishedAt?: string
  customFields?: Record<string, unknown>
}

/**
 * Block Portable Text
 */
export interface SanityBlock {
  _type: 'block'
  _key: string
  style?: string
  children: SanitySpan[]
  markDefs?: SanityMarkDef[]
}

/**
 * Span de texte
 */
export interface SanitySpan {
  _type: 'span'
  _key: string
  text: string
  marks?: string[]
}

/**
 * Mark definition (liens, etc.)
 */
export interface SanityMarkDef {
  _key: string
  _type: string
  href?: string
}

/**
 * Image Sanity
 */
export interface SanityImageAsset {
  _type: 'image'
  asset: {
    _type: 'reference'
    _ref: string
  }
  alt?: string
  caption?: string
}

/**
 * Terme (catégorie/tag)
 */
export interface SanityTerm {
  _type: string
  _ref: string
  title?: string
}

/**
 * Auteur
 */
export interface SanityAuthor {
  _type: 'reference'
  _ref: string
}

/**
 * Champs SEO Sanity
 */
export interface SanitySeoFields {
  metaTitle?: string
  metaDescription?: string
  focusKeyword?: string
  canonicalUrl?: string
  noIndex?: boolean
}

/**
 * Résultat de construction
 */
export interface SanityDocumentResult {
  document: SanityDocument
  validation: DocumentValidation
}

/**
 * Validation du document
 */
export interface DocumentValidation {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  field: string
  message: string
}

export interface ValidationWarning {
  field: string
  message: string
}

/**
 * Document Builder pour Sanity
 */
export class SanityDocumentBuilder {
  private client: SanityClient
  private knownTypes: Set<string> = new Set()

  constructor(client: SanityClient) {
    this.client = client
  }

  /**
   * Construit un document Sanity complet
   */
  buildDocument(content: SanityPublishContent): SanityDocumentResult {
    const validation = this.validateContent(content)

    const document: SanityDocument = {
      _type: content.documentType,
      title: content.title,
      slug: { _type: 'slug', current: this.slugify(content.slug) },
      excerpt: content.excerpt,
      body: this.buildBody(content.body),
      ...(content.mainImage && { mainImage: content.mainImage }),
      ...(content.categories && content.categories.length > 0 && { categories: content.categories }),
      ...(content.tags && content.tags.length > 0 && { tags: content.tags }),
      ...(content.author && { author: content.author }),
      ...(content.publishedAt && { publishedAt: content.publishedAt }),
      ...(content.seo && this.buildSeoFields(content.seo)),
      ...(content.customFields && content.customFields),
    }

    return {
      document,
      validation,
    }
  }

  /**
   * Construit le body Portable Text
   */
  buildBody(content: string | SanityBlock[]): SanityBlock[] {
    if (Array.isArray(content)) {
      return content
    }

    return this.htmlToPortableText(content)
  }

  /**
   * Convertit HTML en Portable Text
   */
  htmlToPortableText(html: string): SanityBlock[] {
    const blocks: SanityBlock[] = []
    let keyIndex = 0

    // Diviser par paragraphes et titres
    const parts = html.split(/(?:<\/p>|<\/h[1-6]>|<\/li>|<\/blockquote>)/gi)

    for (const part of parts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      // Détecter les titres
      const hMatch = trimmed.match(/^<(h[1-6])[^>]*>([\s\S]*)$/i)
      if (hMatch) {
        blocks.push(this.createBlock(hMatch[2].trim(), hMatch[1].toLowerCase(), `block_${keyIndex++}`))
        continue
      }

      // Détecter les listes
      if (trimmed.includes('<ul') || trimmed.includes('<ol')) {
        const listBlocks = this.parseList(trimmed, keyIndex)
        blocks.push(...listBlocks)
        keyIndex += listBlocks.length
        continue
      }

      // Détecter blockquote
      if (trimmed.includes('<blockquote')) {
        const text = trimmed.replace(/<[^>]*>/g, '').trim()
        if (text) {
          blocks.push(this.createBlock(text, 'blockquote', `block_${keyIndex++}`))
        }
        continue
      }

      // Paragraphe normal
      const text = trimmed
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .trim()

      if (text && text.length > 0) {
        blocks.push(this.createBlock(text, 'normal', `block_${keyIndex++}`))
      }
    }

    return blocks
  }

  /**
   * Parse une liste HTML
   */
  private parseList(html: string, startKey: number): SanityBlock[] {
    const blocks: SanityBlock[] = []
    let keyIndex = startKey

    // Extraire les items de liste
    const listMatch = html.match(/<ul[^>]*>([\s\S]*?)<\/ul>|<ol[^>]*>([\s\S]*?)<\/ol>/i)
    if (!listMatch) return blocks

    const listContent = listMatch[1] || listMatch[2]
    const listType = html.includes('<ul') ? 'bullet' : 'number'
    const items = listContent.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || []

    for (const item of items) {
      const text = item.replace(/<\/?li[^>]*>/gi, '').replace(/<[^>]*>/g, '').trim()
      if (text) {
        blocks.push({
          _type: 'block',
          _key: `block_${keyIndex++}`,
          style: listType,
          children: [{
            _type: 'span',
            _key: `span_${keyIndex}`,
            text,
            marks: [],
          }],
          markDefs: [],
        })
      }
    }

    return blocks
  }

  /**
   * Crée un block Portable Text
   */
  private createBlock(text: string, style: string, key: string): SanityBlock {
    // Parser les marks (bold, italic, liens)
    const { cleanText, marks, markDefs } = this.parseMarks(text, key)

    return {
      _type: 'block',
      _key: key,
      style,
      children: [{
        _type: 'span',
        _key: `span_${key}`,
        text: cleanText,
        marks: marks,
      }],
      markDefs,
    }
  }

  /**
   * Parse les marks (formatage inline)
   */
  private parseMarks(text: string, blockKey: string): {
    cleanText: string
    marks: string[]
    markDefs: SanityMarkDef[]
  } {
    let cleanText = text
    const marks: string[] = []
    const markDefs: SanityMarkDef[] = []
    let markKey = 0

    // Bold
    if (cleanText.includes('<strong>') || cleanText.includes('<b>')) {
      cleanText = cleanText.replace(/<\/?(strong|b)>/gi, '')
      marks.push('strong')
    }

    // Italic
    if (cleanText.includes('<em>') || cleanText.includes('<i>')) {
      cleanText = cleanText.replace(/<\/?(em|i)>/gi, '')
      marks.push('em')
    }

    // Links
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = linkRegex.exec(cleanText)) !== null) {
      const linkKey = `link_${blockKey}_${markKey++}`
      markDefs.push({
        _key: linkKey,
        _type: 'link',
        href: match[1],
      })
      cleanText = cleanText.replace(match[0], match[2])
      marks.push(linkKey)
    }

    // Code
    if (cleanText.includes('<code>') || cleanText.includes('<pre>')) {
      cleanText = cleanText.replace(/<\/?(code|pre)>/gi, '')
      marks.push('code')
    }

    return { cleanText, marks, markDefs }
  }

  /**
   * Construit les champs SEO
   */
  private buildSeoFields(seo: SanitySeoFields): Record<string, unknown> {
    const fields: Record<string, unknown> = {}

    if (seo.metaTitle) {
      fields.seoTitle = seo.metaTitle
    }

    if (seo.metaDescription) {
      fields.seoDescription = seo.metaDescription
    }

    if (seo.focusKeyword) {
      fields.focusKeyword = seo.focusKeyword
    }

    if (seo.canonicalUrl) {
      fields.canonicalUrl = seo.canonicalUrl
    }

    if (seo.noIndex !== undefined) {
      fields.noIndex = seo.noIndex
    }

    return fields
  }

  /**
   * Valide le contenu avant publication
   */
  validateContent(content: SanityPublishContent): DocumentValidation {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    // Champs requis
    if (!content.title || content.title.trim().length === 0) {
      errors.push({
        field: 'title',
        message: 'Le titre est requis',
      })
    }

    if (!content.slug || content.slug.trim().length === 0) {
      errors.push({
        field: 'slug',
        message: 'Le slug est requis',
      })
    }

    if (!content.documentType || content.documentType.trim().length === 0) {
      errors.push({
        field: 'documentType',
        message: 'Le type de document est requis',
      })
    }

    // Validation du body
    if (!content.body || (typeof content.body === 'string' && content.body.trim().length === 0)) {
      errors.push({
        field: 'body',
        message: 'Le contenu est requis',
      })
    }

    // Warnings
    if (content.title && content.title.length > 80) {
      warnings.push({
        field: 'title',
        message: `Le titre est long (${content.title.length} caractères). Envisagez de le raccourcir.`,
      })
    }

    if (content.seo?.metaTitle && content.seo.metaTitle.length > 60) {
      warnings.push({
        field: 'seo.metaTitle',
        message: `Le meta title (${content.seo.metaTitle.length} chars) dépasse 60 caractères.`,
      })
    }

    if (content.seo?.metaDescription && content.seo.metaDescription.length > 160) {
      warnings.push({
        field: 'seo.metaDescription',
        message: `La meta description (${content.seo.metaDescription.length} chars) dépasse 160 caractères.`,
      })
    }

    // Word count
    const bodyText = typeof content.body === 'string'
      ? content.body.replace(/<[^>]*>/g, '')
      : JSON.stringify(content.body)
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length

    if (wordCount < 100) {
      warnings.push({
        field: 'body',
        message: `Le contenu est très court (${wordCount} mots). Envisagez d'ajouter plus de détails.`,
      })
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Crée une référence
   */
  createReference(documentId: string): SanityReference {
    return this.client.createReference(documentId)
  }

  /**
   * Génère un ID de document basé sur le slug
   */
  generateDocumentId(documentType: string, slug: string): string {
    return `${documentType}-${this.slugify(slug)}`
  }

  /**
   * Slugify pour Sanity
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }
}

// ─── Image Uploader ─────────────────────────────────────────────────────────

/**
 * Upload une image vers Sanity
 */
export class SanityImageUploader {
  private client: SanityClient
  private config: SanityClientConfig

  constructor(client: SanityClient, config: SanityClientConfig) {
    this.client = client
    this.config = config
  }

  /**
   * Upload une image depuis une URL
   */
  async uploadFromUrl(imageUrl: string): Promise<SanityImageAsset | null> {
    try {
      // Télécharger l'image
      const response = await fetch(imageUrl)
      if (!response.ok) return null

      const buffer = await response.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const contentType = response.headers.get('content-type') || 'image/jpeg'

      // Upload vers Sanity
      const mutation = {
        mutations: [
          {
            _type: 'upload',
            _id: `image-${Date.now()}`,
            url: imageUrl,
          },
        ],
      }

      // Note: En production, utiliser le endpoint /assets/upload
      const uploadUrl = `https://${this.config.projectId}.api.sanity.io/v${this.config.apiVersion}/assets/documents/${this.config.dataset}`

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Authorization: `Bearer ${this.config.token}`,
        },
        body: buffer,
      })

      if (!uploadResponse.ok) return null

      const result = await uploadResponse.json()

      return {
        _type: 'image',
        asset: {
          _type: 'reference',
          _ref: result._id,
        },
      }
    } catch (error) {
      console.error('Failed to upload image:', error)
      return null
    }
  }

  /**
   * Upload une image depuis un fichier (base64)
   */
  async uploadFromBase64(
    base64Data: string,
    filename: string,
    contentType: string = 'image/jpeg'
  ): Promise<SanityImageAsset | null> {
    try {
      // Extraire les données base64
      const base64Match = base64Data.match(/^data:([^;]+);base64,(.+)$/)
      if (base64Match) {
        const data = Buffer.from(base64Match[2], 'base64')
        const type = base64Match[1]

        const mutation = {
          mutations: [
            {
              _type: 'image',
              _id: `image-${Date.now()}`,
            },
          ],
        }

        return {
          _type: 'image',
          asset: {
            _type: 'reference',
            _ref: `image-${Date.now()}`,
          },
        }
      }

      return null
    } catch (error) {
      console.error('Failed to upload image from base64:', error)
      return null
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

import type { SanityClientConfig } from './SanityClient'

export function createSanityDocumentBuilder(client: SanityClient): SanityDocumentBuilder {
  return new SanityDocumentBuilder(client)
}

export function createSanityImageUploader(
  client: SanityClient,
  config: SanityClientConfig
): SanityImageUploader {
  return new SanityImageUploader(client, config)
}
