// ─────────────────────────────────────────────────────────────────────────────
// Sanity Publisher Adapter
// SEO Engine - Publishing Infrastructure
// Implements IPublisher interface for Sanity CMS
// ─────────────────────────────────────────────────────────────────────────────

import {
  SanityClient,
  createSanityClientFromCredentials,
  type SanityOperationResult,
  type SanityDocument,
} from './SanityClient'
import {
  SanityDocumentBuilder,
  createSanityDocumentBuilder,
  type SanityPublishContent,
  type SanityDocumentResult,
} from './SanityDocumentBuilder'

/**
 * Options de publication
 */
export interface SanityPublishOptions {
  // Comportement
  createIfNotExists?: boolean
  publishImmediately?: boolean
  useTransactions?: boolean

  // Rollback
  enableRollback?: boolean
  maxRevisions?: number

  // Validation
  skipValidation?: boolean

  // Réferences
  resolveReferences?: boolean
  referenceStrategy?: 'create' | 'reference' | 'skip'

  // Tags
  tags?: string[]
}

/**
 * Résultat de publication
 */
export interface SanityPublishResult {
  success: boolean
  documentId?: string
  publishedUrl?: string
  revisionId?: string
  validation?: SanityDocumentResult['validation']
  rollbackInfo?: RollbackInfo
  error?: PublishError
  metadata: PublishMetadata
}

/**
 * Information de rollback
 */
export interface RollbackInfo {
  revisionId: string
  timestamp: string
  canRollback: boolean
}

/**
 * Erreur de publication
 */
export interface PublishError {
  code: string
  message: string
  details?: Record<string, unknown>
  canRetry?: boolean
  originalError?: unknown
}

/**
 * Métadonnées de publication
 */
export interface PublishMetadata {
  publishedAt: string
  publishedBy: string
  documentType: string
  slug: string
  operationId: string
  durationMs: number
}

/**
 * Stats de publication
 */
export interface PublishStats {
  totalAttempts: number
  successful: number
  failed: number
  rollbacks: number
  averageDurationMs: number
}

/**
 * Publisher Adapter pour Sanity
 */
export class SanityPublisher {
  private client: SanityClient
  private documentBuilder: SanityDocumentBuilder
  private defaultOptions: SanityPublishOptions
  private stats: PublishStats = {
    totalAttempts: 0,
    successful: 0,
    failed: 0,
    rollbacks: 0,
    averageDurationMs: 0,
  }

  constructor(
    client: SanityClient,
    options: Partial<SanityPublishOptions> = {}
  ) {
    this.client = client
    this.documentBuilder = createSanityDocumentBuilder(client)
    this.defaultOptions = {
      createIfNotExists: true,
      publishImmediately: true,
      useTransactions: true,
      enableRollback: true,
      maxRevisions: 10,
      skipValidation: false,
      resolveReferences: true,
      referenceStrategy: 'reference',
      ...options,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Publie du contenu sur Sanity
   */
  async publish(
    content: SanityPublishContent,
    options?: Partial<SanityPublishOptions>
  ): Promise<SanityPublishResult> {
    const startTime = Date.now()
    const opts = { ...this.defaultOptions, ...options }
    const operationId = crypto.randomUUID()

    this.stats.totalAttempts++

    // 1. Construire le document
    let documentResult: SanityDocumentResult
    if (opts.skipValidation) {
      documentResult = {
        document: this.documentBuilder.buildDocument(content).document,
        validation: { isValid: true, errors: [], warnings: [] },
      }
    } else {
      documentResult = this.documentBuilder.buildDocument(content)
    }

    // 2. Valider
    if (!documentResult.validation.isValid) {
      return this.createErrorResult(
        'VALIDATION_FAILED',
        'La validation du contenu a échoué',
        { validation: documentResult.validation },
        startTime,
        operationId
      )
    }

    // 3. Résoudre les références
    if (opts.resolveReferences) {
      await this.resolveReferences(documentResult.document)
    }

    // 4. Générer l'ID du document
    const documentId = this.documentBuilder.generateDocumentId(
      content.documentType,
      content.slug
    )

    // 5. Vérifier si le document existe
    const exists = await this.client.exists(documentId)

    let result: SanityOperationResult

    try {
      // 6. Publier selon la stratégie
      if (exists && opts.createIfNotExists) {
        // Mettre à jour
        result = await this.client.update(documentId, documentResult.document)

        // Publier si demandé
        if (opts.publishImmediately && result.success) {
          await this.client.publish(documentId)
        }
      } else if (!exists) {
        // Créer
        if (opts.useTransactions) {
          result = await this.client.transaction([
            {
              operation: 'create',
              document: { _id: documentId, ...documentResult.document },
            },
          ])
        } else {
          result = await this.client.create({
            ...documentResult.document,
            _type: content.documentType,
            _id: documentId,
          } as Parameters<typeof this.client.create>[0])
        }

        // Publier si demandé
        if (opts.publishImmediately && result.success) {
          await this.client.publish(documentId)
        }
      } else {
        return this.createErrorResult(
          'DOCUMENT_EXISTS',
          'Le document existe déjà et createIfNotExists est désactivé',
          {},
          startTime,
          operationId
        )
      }

      // 7. Vérifier le résultat
      if (!result.success) {
        return this.createErrorResult(
          result.error?.code || 'PUBLISH_FAILED',
          result.error?.message || 'La publication a échoué',
          { error: result.error },
          startTime,
          operationId
        )
      }

      // 8. Récupérer les infos de rollback
      let rollbackInfo: RollbackInfo | undefined
      if (opts.enableRollback) {
        const history = await this.client.getHistory(documentId, { limit: 1 })
        if (history.length > 0) {
          rollbackInfo = {
            revisionId: history[0]._rev,
            timestamp: history[0]._updatedAt,
            canRollback: true,
          }
          this.stats.rollbacks++
        }
      }

      // Succès
      this.stats.successful++

      return {
        success: true,
        documentId,
        publishedUrl: this.buildPublishedUrl(content.slug),
        revisionId: result.rev,
        validation: documentResult.validation,
        rollbackInfo,
        metadata: {
          publishedAt: new Date().toISOString(),
          publishedBy: 'seo-engine',
          documentType: content.documentType,
          slug: content.slug,
          operationId,
          durationMs: Date.now() - startTime,
        },
      }
    } catch (error) {
      this.stats.failed++

      return this.createErrorResult(
        'EXCEPTION',
        error instanceof Error ? error.message : 'Erreur inconnue',
        { error },
        startTime,
        operationId,
        error
      )
    }
  }

  /**
   * Met à jour un document existant
   */
  async update(
    documentId: string,
    content: Partial<SanityPublishContent>,
    options?: Partial<SanityPublishOptions>
  ): Promise<SanityPublishResult> {
    const startTime = Date.now()
    const opts = { ...this.defaultOptions, ...options }
    const operationId = crypto.randomUUID()

    this.stats.totalAttempts++

    // Récupérer le document actuel
    const existingDoc = await this.client.get<SanityDocument>(documentId)
    if (!existingDoc) {
      return this.createErrorResult(
        'NOT_FOUND',
        `Document non trouvé: ${documentId}`,
        {},
        startTime,
        operationId
      )
    }

    // Merger le contenu
    const mergedContent: SanityPublishContent = {
      documentType: content.documentType || (existingDoc._type as string),
      title: content.title || (existingDoc.title as string),
      slug: content.slug || ((existingDoc.slug as { current?: string })?.current as string) || documentId,
      body: content.body || (existingDoc.body as string),
      excerpt: content.excerpt || (existingDoc.excerpt as string),
      mainImage: content.mainImage || (existingDoc.mainImage as SanityPublishContent['mainImage']),
      seo: content.seo,
    }

    // Construire le document
    const documentResult = this.documentBuilder.buildDocument(mergedContent)

    // Patch le document
    try {
      const result = await this.client.patch(documentId, [
        { type: 'set', value: documentResult.document },
      ])

      if (!result.success) {
        this.stats.failed++
        return this.createErrorResult(
          result.error?.code || 'UPDATE_FAILED',
          result.error?.message || 'La mise à jour a échoué',
          { error: result.error },
          startTime,
          operationId
        )
      }

      // Publier si demandé
      if (opts.publishImmediately) {
        await this.client.publish(documentId)
      }

      this.stats.successful++

      return {
        success: true,
        documentId,
        publishedUrl: this.buildPublishedUrl(mergedContent.slug),
        revisionId: result.rev,
        metadata: {
          publishedAt: new Date().toISOString(),
          publishedBy: 'seo-engine',
          documentType: mergedContent.documentType,
          slug: mergedContent.slug,
          operationId,
          durationMs: Date.now() - startTime,
        },
      }
    } catch (error) {
      this.stats.failed++
      return this.createErrorResult(
        'EXCEPTION',
        error instanceof Error ? error.message : 'Erreur inconnue',
        { error },
        startTime,
        operationId,
        error
      )
    }
  }

  /**
   * Supprime un document
   */
  async delete(documentId: string): Promise<SanityPublishResult> {
    const startTime = Date.now()
    const operationId = crypto.randomUUID()

    try {
      const result = await this.client.delete(documentId)

      if (!result.success) {
        return this.createErrorResult(
          result.error?.code || 'DELETE_FAILED',
          result.error?.message || 'La suppression a échoué',
          { error: result.error },
          startTime,
          operationId
        )
      }

      return {
        success: true,
        documentId,
        metadata: {
          publishedAt: new Date().toISOString(),
          publishedBy: 'seo-engine',
          documentType: '',
          slug: '',
          operationId,
          durationMs: Date.now() - startTime,
        },
      }
    } catch (error) {
      return this.createErrorResult(
        'EXCEPTION',
        error instanceof Error ? error.message : 'Erreur inconnue',
        { error },
        startTime,
        operationId,
        error
      )
    }
  }

  /**
   * Rollback vers une version précédente
   */
  async rollback(
    documentId: string,
    revisionId: string
  ): Promise<SanityPublishResult> {
    const startTime = Date.now()
    const operationId = crypto.randomUUID()

    try {
      const result = await this.client.restore(documentId, revisionId)

      if (!result.success) {
        return this.createErrorResult(
          'ROLLBACK_FAILED',
          'Le rollback a échoué',
          { error: result.error },
          startTime,
          operationId
        )
      }

      return {
        success: true,
        documentId,
        revisionId,
        metadata: {
          publishedAt: new Date().toISOString(),
          publishedBy: 'seo-engine',
          documentType: '',
          slug: '',
          operationId,
          durationMs: Date.now() - startTime,
        },
      }
    } catch (error) {
      return this.createErrorResult(
        'EXCEPTION',
        error instanceof Error ? error.message : 'Erreur inconnue',
        { error },
        startTime,
        operationId,
        error
      )
    }
  }

  /**
   * Récupère le statut d'un document
   */
  async getStatus(documentId: string): Promise<DocumentStatus | null> {
    const doc = await this.client.get<SanityDocument>(documentId)
    if (!doc) return null

    const history = await this.client.getHistory(documentId, { limit: 1 })

    return {
      documentId,
      exists: true,
      type: doc._type as string,
      title: (doc.title as string) || documentId,
      slug: ((doc.slug as { current?: string })?.current as string) || documentId,
      lastModified: (doc._updatedAt as string) || new Date().toISOString(),
      currentRevision: history[0]?._rev || '',
      historyAvailable: history.length > 0,
    }
  }

  /**
   * Valide du contenu sans publier
   */
  validate(content: SanityPublishContent): SanityDocumentResult {
    return this.documentBuilder.buildDocument(content)
  }

  /**
   * Récupère les statistiques
   */
  getStats(): PublishStats {
    return { ...this.stats }
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private async resolveReferences(document: Record<string, unknown>): Promise<void> {
    // TODO: Implémenter la résolution des références
    // - Catégories
    // - Tags
    // - Auteurs
  }

  private buildPublishedUrl(slug: string): string {
    // Retourne l'URL de preview (dans une vraie implémentation,
    // cela来接取 depuis la config du projet Sanity)
    return `https://sanity.io/preview/${slug}`
  }

  private createErrorResult(
    code: string,
    message: string,
    details: Record<string, unknown>,
    startTime: number,
    operationId: string,
    originalError?: unknown
  ): SanityPublishResult {
    const canRetry = this.isRetryableError(code)

    return {
      success: false,
      error: {
        code,
        message,
        details,
        canRetry,
        originalError,
      },
      metadata: {
        publishedAt: new Date().toISOString(),
        publishedBy: 'seo-engine',
        documentType: '',
        slug: '',
        operationId,
        durationMs: Date.now() - startTime,
      },
    }
  }

  private isRetryableError(code: string): boolean {
    const retryableCodes = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'RATE_LIMITED',
      'SERVER_ERROR',
      'EXCEPTION',
    ]
    return retryableCodes.includes(code)
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DocumentStatus {
  documentId: string
  exists: boolean
  type: string
  title: string
  slug: string
  lastModified: string
  currentRevision: string
  historyAvailable: boolean
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Crée un publisher Sanity depuis des credentials
 */
export function createSanityPublisher(credentials: {
  sanityProjectId: string
  sanityDataset: string
  sanityToken: string
}, options?: Partial<SanityPublishOptions>): SanityPublisher {
  const client = createSanityClientFromCredentials(credentials)
  return new SanityPublisher(client, options)
}

/**
 * Crée un publisher Sanity depuis un client
 */
export function createSanityPublisherFromClient(
  client: SanityClient,
  options?: Partial<SanityPublishOptions>
): SanityPublisher {
  return new SanityPublisher(client, options)
}

// Ré-exports
export { SanityClient, createSanityClientFromCredentials } from './SanityClient'
export type { SanityClientConfig } from './SanityClient'
export { SanityDocumentBuilder, createSanityDocumentBuilder } from './SanityDocumentBuilder'
export type { SanityPublishContent } from './SanityDocumentBuilder'
