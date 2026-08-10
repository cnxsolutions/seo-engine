// ─────────────────────────────────────────────────────────────────────────────
// Vector Indexing Service
// SEO Engine - RAG Infrastructure
// Fills the vector store from what the product actually owns: the pages a crawl
// wrote into `site_pages`, and the pages the generator published into
// `generations`.
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything exported here is safe to call from a pipeline step:
//
//   • NOTHING THROWS. Indexing is an enrichment. A crawl that succeeded must not
//     be reported as failed because an embedding call timed out, and a published
//     page must not be un-published because its vector could not be written.
//     Failures come back inside the report, and are logged.
//
//   • NOTHING IS RE-EMBEDDED FOR FREE. Every document carries a stable key and a
//     content hash; a page whose text has not moved since the last run is
//     recognised and skipped before any billed call is made.
//
//   • EVERY RUN LEAVES A TRACE. One line per run on stdout, plus
//     `getSiteIndexStatus()` to read the state of the index from anywhere. An
//     index that stays empty in silence is the defect this module exists to fix.
//
// The previous version of this file targeted `federated_sites` /
// `content_schemas` / `content_types` — migration-001 tables that this product
// never writes to. It could not have indexed anything, and never did: nothing
// ever called it.

import { createServiceClient } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseVectorStore } from './providers'
import {
  EMBEDDING_BATCH_SIZE,
  type SupabaseVectorStore,
} from './providers/SupabaseVectorStore'
import type { IndexedDocument } from './VectorStore'

// ─── Public Types ────────────────────────────────────────────────────────────

/** What triggered an indexing run — carried into the logs. */
export type IndexingSource = 'crawl' | 'generation' | 'reindex' | 'manual'

/**
 * Content type keys written into the index.
 *
 * They are the filter the search side uses: `PAGE` is the site as it exists
 * (crawled), `POST` is what this engine published. Asking for examples of "our
 * own writing" means asking for POST; looking for internal-link targets means
 * asking for both.
 */
export const CONTENT_TYPE_CRAWLED_PAGE = 'page'
export const CONTENT_TYPE_GENERATED_POST = 'post'

/**
 * Documents embedded per provider request.
 *
 * Mirrors the store's batch size on purpose: the batch is the unit of failure
 * (one bad batch loses 32 documents, not the whole site) and the unit of cost.
 */
export const INDEXING_BATCH_SIZE = EMBEDDING_BATCH_SIZE

/**
 * Below this many characters a document carries no retrievable meaning — an
 * empty archive page, a redirect stub — and buying a vector for it only adds
 * noise to every future search.
 */
export const MIN_INDEXABLE_CHARS = 40

export interface IndexingOptions {
  /** Documents per embeddings request. Defaults to INDEXING_BATCH_SIZE. */
  batchSize?: number
  /** Recorded in the log line so a run can be traced back to its trigger. */
  source?: IndexingSource
  /** Safety valve on a very large site. Defaults to every page. */
  maxDocuments?: number
}

export interface IndexingReport {
  siteId: string
  source: IndexingSource
  /** Rows read from the database. */
  documentsFound: number
  /** Documents embedded and written — the only ones that cost money. */
  documentsIndexed: number
  /** Documents recognised as unchanged and left alone. */
  documentsSkipped: number
  /** Documents with too little text to be worth a vector. */
  documentsTooShort: number
  documentsFailed: number
  /** HTTP calls made to the embeddings provider. */
  embeddingRequests: number
  durationMs: number
  errors: string[]
}

export interface SiteIndexStatus {
  siteId: string
  totalDocuments: number
  documentsByType: Record<string, number>
  lastIndexedAt: string | null
  /** False when the store is unreachable or unconfigured. */
  available: boolean
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Indexes the pages a crawl wrote into `site_pages`.
 *
 * Call it after a successful crawl, once `upsertSitePages` has returned. Safe to
 * call on every crawl: pages whose text has not changed cost nothing.
 */
export async function indexSitePages(
  siteId: string,
  options: IndexingOptions = {}
): Promise<IndexingReport> {
  const startedAt = Date.now()
  const source = options.source ?? 'crawl'
  const report = emptyReport(siteId, source)

  try {
    const supabase = createServiceClient()

    const query = supabase
      .from('site_pages')
      .select('url, path, title, meta_description, h1, h2s, keywords, word_count, focus_keyword, has_faq, has_schema, content_excerpt, crawled_at')
      .eq('site_id', siteId)
      .order('crawled_at', { ascending: false })

    const { data, error } = options.maxDocuments
      ? await query.limit(options.maxDocuments)
      : await query

    if (error) throw new Error(`site_pages read failed: ${error.message}`)

    const rows = (data || []) as SitePageRow[]
    report.documentsFound = rows.length

    if (rows.length === 0) {
      console.warn(
        `[vector-index] site=${siteId} source=${source} no crawled page to index — did the crawl fill site_pages?`
      )
    }

    const documents: IndexedDocument[] = []
    for (const row of rows) {
      const text = buildSitePageText(row)
      if (text.length < MIN_INDEXABLE_CHARS) {
        report.documentsTooShort++
        continue
      }
      documents.push(sitePageDocument(siteId, row, text))
    }

    await writeDocuments(documents, report, options)
    await touchLastIndexedAt(supabase, siteId, report)
  } catch (error) {
    report.errors.push(errorMessage(error))
    report.documentsFailed = Math.max(report.documentsFailed, 1)
  }

  report.durationMs = Date.now() - startedAt
  logReport(report)
  return report
}

/**
 * Indexes one page this engine has just published, read from `generations`.
 *
 * Call it right after publication succeeds. The generation must already be
 * persisted — the row is the source of truth, so the index cannot drift from
 * what was actually shipped.
 */
export async function indexGeneratedPage(
  generationId: string,
  options: IndexingOptions = {}
): Promise<IndexingReport> {
  const startedAt = Date.now()
  const source = options.source ?? 'generation'
  const report = emptyReport('', source)

  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('generations')
      .select('id, site_id, slug, title, meta_description, focus_keyword, content, page_type, published_url, city, created_at')
      .eq('id', generationId)
      .single()

    if (error) throw new Error(`generation read failed: ${error.message}`)

    const row = data as GenerationRow | null
    if (!row) throw new Error(`generation ${generationId} not found`)
    if (!row.site_id) throw new Error(`generation ${generationId} has no site_id`)

    report.siteId = row.site_id
    report.documentsFound = 1

    const text = buildGenerationText(row)

    if (text.length < MIN_INDEXABLE_CHARS) {
      report.documentsTooShort = 1
    } else {
      await writeDocuments([generationDocument(row, text)], report, options)
      await touchLastIndexedAt(supabase, row.site_id, report)
    }
  } catch (error) {
    report.errors.push(errorMessage(error))
    report.documentsFailed = 1
  }

  report.durationMs = Date.now() - startedAt
  logReport(report)
  return report
}

/**
 * Rebuilds a site's whole index from scratch.
 *
 * Drops every document of the site first, so this DOES pay for every embedding
 * again — the hash-skip has nothing left to compare against. Use it when the
 * document format changed, not as a routine refresh: `indexSitePages()` is the
 * routine refresh, and it is nearly free when nothing moved.
 */
export async function reindexSite(
  siteId: string,
  options: IndexingOptions = {}
): Promise<IndexingReport> {
  const startedAt = Date.now()
  const report = emptyReport(siteId, options.source ?? 'reindex')

  try {
    const store = getVectorStore()
    const deleted = await store.deleteBySite(siteId)
    console.info(`[vector-index] site=${siteId} cleared ${deleted} document(s) before reindex`)
  } catch (error) {
    report.errors.push(`clear failed: ${errorMessage(error)}`)
    report.documentsFailed = 1
    report.durationMs = Date.now() - startedAt
    logReport(report)
    return report
  }

  const pages = await indexSitePages(siteId, { ...options, source: 'reindex' })

  // Re-index the pages this engine published, which live in `generations` and
  // are not part of `site_pages` until the next crawl picks them up.
  const generations = await indexPublishedGenerations(siteId, options)

  const merged = mergeReports(siteId, options.source ?? 'reindex', [pages, generations])
  merged.durationMs = Date.now() - startedAt
  logReport(merged)
  return merged
}

/**
 * How full the index is for one site. Never throws: an unreachable store reports
 * `available: false` rather than breaking the caller.
 */
export async function getSiteIndexStatus(siteId: string): Promise<SiteIndexStatus> {
  const status: SiteIndexStatus = {
    siteId,
    totalDocuments: 0,
    documentsByType: {},
    lastIndexedAt: null,
    available: false,
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('get_site_index_status', { p_site_id: siteId })

    if (error) throw new Error(error.message)

    const row = (Array.isArray(data) ? data[0] : data) as
      | { total_documents?: number | string; documents_by_type?: Record<string, number>; last_indexed_at?: string }
      | null

    status.available = true
    status.totalDocuments = Number(row?.total_documents) || 0
    status.documentsByType = row?.documents_by_type || {}
    status.lastIndexedAt = row?.last_indexed_at || null
  } catch (error) {
    console.warn(`[vector-index] site=${siteId} index status unavailable: ${errorMessage(error)}`)
  }

  return status
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Indexes the site's published generations. Used by `reindexSite`; a single
 * publication goes through `indexGeneratedPage` instead.
 */
async function indexPublishedGenerations(
  siteId: string,
  options: IndexingOptions
): Promise<IndexingReport> {
  const report = emptyReport(siteId, 'reindex')

  try {
    const supabase = createServiceClient()

    const query = supabase
      .from('generations')
      .select('id, site_id, slug, title, meta_description, focus_keyword, content, page_type, published_url, city, created_at')
      .eq('site_id', siteId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    const { data, error } = options.maxDocuments
      ? await query.limit(options.maxDocuments)
      : await query

    if (error) throw new Error(`generations read failed: ${error.message}`)

    const rows = (data || []) as GenerationRow[]
    report.documentsFound = rows.length

    const documents: IndexedDocument[] = []
    for (const row of rows) {
      const text = buildGenerationText(row)
      if (text.length < MIN_INDEXABLE_CHARS) {
        report.documentsTooShort++
        continue
      }
      documents.push(generationDocument(row, text))
    }

    await writeDocuments(documents, report, options)
  } catch (error) {
    report.errors.push(errorMessage(error))
    report.documentsFailed = Math.max(report.documentsFailed, 1)
  }

  return report
}

/**
 * Hands documents to the store batch by batch and folds the outcome into the
 * report. Batching happens here rather than inside the store so a long run can
 * report progress while it is still running.
 */
async function writeDocuments(
  documents: IndexedDocument[],
  report: IndexingReport,
  options: IndexingOptions
): Promise<void> {
  if (documents.length === 0) return

  const store = getVectorStore()
  const batchSize = options.batchSize ?? INDEXING_BATCH_SIZE

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize)

    try {
      const outcome = await store.indexDocuments(batch)

      report.documentsIndexed += outcome.documentsProcessed
      report.documentsSkipped += outcome.documentsSkipped
      report.documentsFailed += outcome.documentsFailed
      report.embeddingRequests += outcome.embeddingRequests

      for (const err of outcome.errors) {
        report.errors.push(err.error)
      }
    } catch (error) {
      // A whole batch failed. Keep going: the remaining batches are independent,
      // and half an index beats none.
      report.documentsFailed += batch.length
      report.errors.push(errorMessage(error))
    }
  }
}

/** Best-effort freshness marker. Its failure must not fail the run. */
async function touchLastIndexedAt(
  supabase: SupabaseClient,
  siteId: string,
  report: IndexingReport
): Promise<void> {
  if (report.documentsIndexed === 0) return

  const { error } = await supabase
    .from('sites')
    .update({ last_indexed_at: new Date().toISOString() })
    .eq('id', siteId)

  if (error) {
    console.warn(`[vector-index] site=${siteId} could not stamp last_indexed_at: ${error.message}`)
  }
}

// ─── Document Building ───────────────────────────────────────────────────────

interface SitePageRow {
  url: string
  path: string
  title?: string | null
  meta_description?: string | null
  h1?: string | null
  h2s?: string[] | null
  keywords?: string[] | null
  word_count?: number | null
  focus_keyword?: string | null
  has_faq?: boolean | null
  has_schema?: boolean | null
  content_excerpt?: string | null
  crawled_at?: string | null
}

interface GenerationRow {
  id: string
  site_id: string
  slug?: string | null
  title?: string | null
  meta_description?: string | null
  focus_keyword?: string | null
  content?: string | null
  page_type?: string | null
  published_url?: string | null
  city?: string | null
  created_at?: string | null
}

/**
 * Text embedded for a crawled page.
 *
 * `content_excerpt` is the body; everything above it is the page's declared
 * subject. When the excerpt is missing — a row crawled before migration 009 —
 * the heading structure alone still describes the page well enough to make it
 * findable as an internal-link target.
 */
function buildSitePageText(row: SitePageRow): string {
  return [
    row.title,
    row.h1 && row.h1 !== row.title ? row.h1 : null,
    row.meta_description,
    row.h2s?.length ? `Sections : ${row.h2s.slice(0, 20).join(' · ')}` : null,
    row.keywords?.length ? `Mots-clés : ${row.keywords.slice(0, 15).join(', ')}` : null,
    row.content_excerpt,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n')
    .trim()
}

function sitePageDocument(siteId: string, row: SitePageRow, text: string): IndexedDocument {
  // Keyed on the path, which is also what `site_pages` is unique on: re-crawling
  // replaces the page's document instead of stacking a new one beside it.
  const documentId = `page:${row.path || row.url}`
  const now = new Date().toISOString()

  return {
    id: documentId,
    content: text,
    metadata: {
      documentId,
      documentType: 'content',
      siteId,
      contentTypeKey: CONTENT_TYPE_CRAWLED_PAGE,
      title: row.title || row.h1 || row.path,
      excerpt: row.meta_description || undefined,
      url: row.url,
      focusKeyword: row.focus_keyword || undefined,
      taxonomyTerms: row.keywords?.slice(0, 15) || undefined,
      metaDescription: row.meta_description || undefined,
      wordCount: row.word_count ?? undefined,
      hasFaq: row.has_faq ?? undefined,
      createdAt: row.crawled_at || now,
      indexedAt: now,
    },
  }
}

/**
 * Text embedded for a generated page.
 *
 * The stored content is HTML; tags are stripped because they inflate the token
 * bill and drag every document's vector towards the same markup soup.
 */
function buildGenerationText(row: GenerationRow): string {
  return [
    row.title,
    row.meta_description,
    row.city ? `Ville : ${row.city}` : null,
    htmlToText(row.content || ''),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n')
    .trim()
}

function generationDocument(row: GenerationRow, text: string): IndexedDocument {
  const documentId = `generation:${row.id}`
  const now = new Date().toISOString()

  return {
    id: documentId,
    content: text,
    metadata: {
      documentId,
      documentType: 'content',
      siteId: row.site_id,
      contentTypeKey: CONTENT_TYPE_GENERATED_POST,
      title: row.title || row.slug || documentId,
      excerpt: row.meta_description || undefined,
      url: row.published_url || undefined,
      focusKeyword: row.focus_keyword || undefined,
      metaDescription: row.meta_description || undefined,
      wordCount: countWords(text),
      createdAt: row.created_at || now,
      indexedAt: now,
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let cachedStore: SupabaseVectorStore | null = null

/**
 * The store is built lazily and reused.
 *
 * Lazily because building it reads environment variables that are absent in
 * unit tests and at build time, and a module-level throw there would take down
 * everything importing this file.
 */
function getVectorStore(): SupabaseVectorStore {
  if (cachedStore) return cachedStore

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to index')
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to compute embeddings')
  }

  cachedStore = createSupabaseVectorStore(url, key)
  return cachedStore
}

function emptyReport(siteId: string, source: IndexingSource): IndexingReport {
  return {
    siteId,
    source,
    documentsFound: 0,
    documentsIndexed: 0,
    documentsSkipped: 0,
    documentsTooShort: 0,
    documentsFailed: 0,
    embeddingRequests: 0,
    durationMs: 0,
    errors: [],
  }
}

function mergeReports(
  siteId: string,
  source: IndexingSource,
  reports: IndexingReport[]
): IndexingReport {
  const merged = emptyReport(siteId, source)

  for (const report of reports) {
    merged.documentsFound += report.documentsFound
    merged.documentsIndexed += report.documentsIndexed
    merged.documentsSkipped += report.documentsSkipped
    merged.documentsTooShort += report.documentsTooShort
    merged.documentsFailed += report.documentsFailed
    merged.embeddingRequests += report.embeddingRequests
    merged.errors.push(...report.errors)
  }

  return merged
}

/**
 * One line per run, on stdout, always.
 *
 * The founder must be able to see the index fill up — and, just as importantly,
 * see it NOT fill up. `indexed` is what was paid for, `skipped` is what the
 * content hash saved.
 */
function logReport(report: IndexingReport): void {
  const line =
    `[vector-index] site=${report.siteId || '?'} source=${report.source} ` +
    `found=${report.documentsFound} indexed=${report.documentsIndexed} ` +
    `skipped=${report.documentsSkipped} short=${report.documentsTooShort} ` +
    `failed=${report.documentsFailed} embedCalls=${report.embeddingRequests} ` +
    `${report.durationMs}ms`

  if (report.documentsFailed > 0) {
    console.error(line, report.errors.slice(0, 3))
    return
  }

  console.info(line)

  if (report.documentsFound > 0 && report.documentsIndexed === 0 && report.documentsSkipped === 0) {
    console.warn(
      `[vector-index] site=${report.siteId} read ${report.documentsFound} row(s) but indexed none — the index is not filling`
    )
  }
}

/** Rough plain text out of stored HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Class facade ────────────────────────────────────────────────────────────

/**
 * Object wrapper over the functions above.
 *
 * Kept because `RagGeneratorWithTemplates` instantiates it with an explicit
 * store; new code should prefer the free functions, which manage their own.
 */
export class VectorIndexingService {
  constructor(vectorStore?: SupabaseVectorStore) {
    if (vectorStore) cachedStore = vectorStore
  }

  indexSitePages(siteId: string, options?: IndexingOptions): Promise<IndexingReport> {
    return indexSitePages(siteId, options)
  }

  indexGeneratedPage(generationId: string, options?: IndexingOptions): Promise<IndexingReport> {
    return indexGeneratedPage(generationId, options)
  }

  reindexSite(siteId: string, options?: IndexingOptions): Promise<IndexingReport> {
    return reindexSite(siteId, options)
  }

  getSiteIndexStatus(siteId: string): Promise<SiteIndexStatus> {
    return getSiteIndexStatus(siteId)
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let indexingService: VectorIndexingService | null = null

export function getIndexingService(vectorStore?: SupabaseVectorStore): VectorIndexingService {
  if (!indexingService) {
    indexingService = new VectorIndexingService(vectorStore)
  }
  return indexingService
}
