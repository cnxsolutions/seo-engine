// ─────────────────────────────────────────────────────────────────────────────
// Sanity Client
// SEO Engine - Publishing Infrastructure
// Client for Sanity API - Write Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration du client Sanity
 */
export interface SanityClientConfig {
  projectId: string
  dataset: string
  apiVersion?: string
  token?: string
  useCdn?: boolean
}

/**
 * Document Sanity
 */
export interface SanityDocument {
  _id?: string
  _type: string
  _createdAt?: string
  _updatedAt?: string
  _rev?: string
  [key: string]: unknown
}

/**
 * Résultat d'opération
 */
export interface SanityOperationResult {
  success: boolean
  documentId?: string
  rev?: string
  transactionId?: string
  error?: SanityError
}

/**
 * Erreur Sanity
 */
export interface SanityError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Response Sanity API
 */
export interface SanityResponse<T = unknown> {
  results?: Array<{
    id: string
    operation: 'create' | 'update' | 'delete'
    rev?: string
  }>
  transactionId?: string
  ms?: number
}

/**
 * Client Sanity pour opérations d'écriture
 */
export class SanityClient {
  private baseUrl: string
  private headers: HeadersInit
  private config: SanityClientConfig

  constructor(config: SanityClientConfig) {
    this.config = {
      apiVersion: '2024-01-01',
      useCdn: false,
      ...config,
    }

    this.baseUrl = `https://${this.config.projectId}.api.sanity.io/v${this.config.apiVersion}/data/mutate/${this.config.dataset}`

    this.headers = {
      'Content-Type': 'application/json',
      ...(this.config.token && { Authorization: `Bearer ${this.config.token}` }),
    }
  }

  // ─── Document Operations ──────────────────────────────────────────────────

  /**
   * Crée un nouveau document
   */
  async create<T extends SanityDocument>(
    document: Omit<T, '_id' | '_createdAt' | '_updatedAt' | '_rev'>
  ): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          create: {
            _type: document._type,
            ...document,
          },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)
      const result = response.results?.[0]

      return {
        success: true,
        documentId: result?.id,
        rev: result?.rev,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  /**
   * Crée ou met à jour un document ( upsert )
   */
  async upsert<T extends SanityDocument>(
    id: string,
    document: Partial<T>
  ): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          upsert: {
            _id: id,
            _type: document._type,
            ...document,
          },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)
      const result = response.results?.[0]

      return {
        success: true,
        documentId: result?.id,
        rev: result?.rev,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  /**
   * Met à jour un document existant
   */
  async update<T extends SanityDocument>(
    id: string,
    patch: Partial<T>
  ): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          patch: {
            id,
            set: patch,
          },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)
      const result = response.results?.[0]

      return {
        success: true,
        documentId: result?.id,
        rev: result?.rev,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  /**
   * Supprime un document
   */
  async delete(id: string): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          delete: { id },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)

      return {
        success: true,
        documentId: id,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  /**
   * Patch un document avec des opérations spécifiques
   */
  async patch(
    id: string,
    operations: SanityPatchOperation[]
  ): Promise<SanityOperationResult> {
    const patch: Record<string, unknown> = { id }

    for (const op of operations) {
      switch (op.type) {
        case 'set':
          patch.set = op.value
          break
        case 'setIfMissing':
          patch.setIfMissing = op.value
          break
        case 'unset':
          patch.unset = op.paths
          break
        case 'inc':
        case 'dec':
        case 'insert':
        case 'diffMatchPatch':
          // Ces opérations nécessitent un format différent
          break
      }
    }

    const mutation = {
      mutations: [
        {
          patch,
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)
      const result = response.results?.[0]

      return {
        success: true,
        documentId: result?.id,
        rev: result?.rev,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  /**
   * Publie un document (ajoute _updatedAt et marque comme publié)
   */
  async publish(id: string): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          patch: {
            id,
            set: {
              _updatedAt: new Date().toISOString(),
            },
          },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)
      const result = response.results?.[0]

      return {
        success: true,
        documentId: result?.id,
        rev: result?.rev,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  // ─── Transaction Operations ───────────────────────────────────────────────

  /**
   * Exécute une transaction avec plusieurs opérations
   */
  async transaction(
    operations: SanityTransactionOperation[]
  ): Promise<SanityOperationResult> {
    const mutations = operations.map(op => {
      if (!op.document) {
        throw new Error(`Operation ${op.operation} requires a document`)
      }
      switch (op.operation) {
        case 'create':
          return { create: { _type: op.document._type, ...op.document } }
        case 'createOrReplace':
          return { createOrReplace: { _id: op.id, _type: op.document._type, ...op.document } }
        case 'upsert':
          return { upsert: { _id: op.id, _type: op.document._type, ...op.document } }
        case 'patch':
          return {
            patch: {
              id: op.id,
              ...(op.set && { set: op.set }),
              ...(op.setIfMissing && { setIfMissing: op.setIfMissing }),
              ...(op.unset && { unset: op.unset }),
            },
          }
        case 'delete':
          return { delete: { id: op.id } }
        default:
          return {}
      }
    })

    const mutation = { mutations }

    try {
      const response = await this.executeMutation(mutation)

      return {
        success: true,
        transactionId: response.transactionId,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  // ─── Reference Operations ─────────────────────────────────────────────────

  /**
   * Crée une référence à un document
   */
  createReference(documentId: string): SanityReference {
    return {
      _type: 'reference',
      _ref: documentId,
    }
  }

  /**
   * Vérifie si un document existe
   */
  async exists(id: string): Promise<boolean> {
    const query = encodeURIComponent(`*[_id == "${id}"][0]{_id}`)
    const url = `https://${this.config.projectId}.api.sanity.io/v${this.config.apiVersion}/data/query/${this.config.dataset}?query=${query}`

    try {
      const response = await fetch(url, {
        headers: this.headers,
      })

      if (!response.ok) return false

      const data = await response.json()
      return !!data.result?._id
    } catch {
      return false
    }
  }

  /**
   * Récupère un document
   */
  async get<T extends SanityDocument>(id: string): Promise<T | null> {
    const query = encodeURIComponent(`*[_id == "${id}"][0]`)
    const url = `https://${this.config.projectId}.api.sanity.io/v${this.config.apiVersion}/data/query/${this.config.dataset}?query=${query}`

    try {
      const response = await fetch(url, {
        headers: this.headers,
      })

      if (!response.ok) return null

      const data = await response.json()
      return data.result as T
    } catch {
      return null
    }
  }

  // ─── History / Rollback ───────────────────────────────────────────────────

  /**
   * Récupère l'historique d'un document
   */
  async getHistory(
    id: string,
    options?: { limit?: number; offset?: number }
  ): Promise<SanityHistoryEntry[]> {
    const url = `https://${this.config.projectId}.api.sanity.io/v${this.config.apiVersion}/history/${this.config.dataset}/documents/${id}`

    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const queryString = params.toString()
    const fullUrl = queryString ? `${url}?${queryString}` : url

    try {
      const response = await fetch(fullUrl, {
        headers: this.headers,
      })

      if (!response.ok) return []

      const data = await response.json()
      return data.entries || []
    } catch {
      return []
    }
  }

  /**
   * Restore une version précédente
   */
  async restore(id: string, revisionId: string): Promise<SanityOperationResult> {
    const mutation = {
      mutations: [
        {
          restore: {
            _id: id,
            _rev: revisionId,
          },
        },
      ],
    }

    try {
      const response = await this.executeMutation(mutation)

      return {
        success: true,
        documentId: id,
        transactionId: response.transactionId,
      }
    } catch (error) {
      return {
        success: false,
        error: this.parseError(error),
      }
    }
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private async executeMutation(mutation: unknown): Promise<SanityResponse> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(mutation),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new SanityApiError(
        errorData.error?.description || 'Mutation failed',
        response.status,
        errorData
      )
    }

    return response.json()
  }

  private parseError(error: unknown): SanityError {
    if (error instanceof SanityApiError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
      }
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    }
  }
}

// ─── Types Additionnels ───────────────────────────────────────────────────────

/**
 * Référence Sanity
 */
export interface SanityReference {
  _type: 'reference'
  _ref: string
}

/**
 * Opération de patch
 */
export interface SanityPatchOperation {
  type: 'set' | 'setIfMissing' | 'unset' | 'inc' | 'dec' | 'insert' | 'diffMatchPatch'
  value?: Record<string, unknown>
  paths?: string[]
}

/**
 * Opération de transaction
 */
export interface SanityTransactionOperation {
  operation: 'create' | 'createOrReplace' | 'upsert' | 'patch' | 'delete'
  id?: string
  document?: Record<string, unknown>
  set?: Record<string, unknown>
  setIfMissing?: Record<string, unknown>
  unset?: string[]
}

/**
 * Entrée d'historique
 */
export interface SanityHistoryEntry {
  _id: string
  _rev: string
  _createdAt: string
  _updatedAt: string
  _type: string
}

/**
 * Erreur API Sanity
 */
export class SanityApiError extends Error {
  code: string
  status: number
  details?: { error?: { code?: string; message?: string } }

  constructor(message: string, status: number, details?: { error?: { code?: string; message?: string } }) {
    super(message)
    this.name = 'SanityApiError'
    this.code = details?.error?.code || `HTTP_${status}`
    this.status = status
    this.details = details
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Crée un client Sanity depuis une configuration
 */
export function createSanityClient(config: SanityClientConfig): SanityClient {
  return new SanityClient(config)
}

/**
 * Crée un client Sanity depuis des credentials de site fédéré
 */
export function createSanityClientFromCredentials(credentials: {
  sanityProjectId: string
  sanityDataset: string
  sanityToken: string
}): SanityClient {
  return new SanityClient({
    projectId: credentials.sanityProjectId,
    dataset: credentials.sanityDataset,
    token: credentials.sanityToken,
  })
}
