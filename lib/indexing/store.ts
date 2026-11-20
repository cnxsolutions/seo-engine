// ─────────────────────────────────────────────────────────────────────────────
// page_indexing — what Search Console last said about each known page
// SEO Engine - Supabase adapter of the index check (migration 020).
// ─────────────────────────────────────────────────────────────────────────────
//
// supabase-js returns errors instead of throwing. Every read that a decision
// depends on throws here, so that « the table could not be read » never turns
// into « the site has no pages » — which, for the seeding step, would delete
// every row.

import { createServiceClient } from '@/lib/supabase'
import type { IndexState } from '@/src/core/domain/indexing/status'

/** Page reads are bounded: a site of this tool's size has a few hundred pages. */
const SOURCE_READ_LIMIT = 2000

/** Supabase rejects very large statements; writes go in chunks of this size. */
const WRITE_CHUNK = 500

export const INDEX_STATES: readonly IndexState[] = [
  'unchecked', 'indexed', 'not_discovered', 'crawled_not_indexed', 'blocked', 'fetch_error', 'canonical_elsewhere',
]

const ROW_COLUMNS = [
  'id', 'site_id', 'url', 'url_key', 'generation_id', 'priority', 'state', 'verdict', 'coverage_state',
  'indexing_state', 'robots_txt_state', 'page_fetch_state', 'google_canonical', 'user_canonical',
  'inspection_link', 'last_crawl_at', 'inspected_at', 'next_check_at', 'miss_streak', 'resubmit_count',
  'last_resubmitted_at', 'last_error',
].join(', ')

export interface PageIndexingRow {
  id: string
  site_id: string
  url: string
  url_key: string
  generation_id: string | null
  /** 0 for a page the engine published, 1 for a page found by the crawl. */
  priority: number
  state: IndexState
  verdict: string | null
  coverage_state: string | null
  indexing_state: string | null
  robots_txt_state: string | null
  page_fetch_state: string | null
  google_canonical: string | null
  user_canonical: string | null
  inspection_link: string | null
  last_crawl_at: string | null
  inspected_at: string | null
  next_check_at: string
  miss_streak: number
  resubmit_count: number
  last_resubmitted_at: string | null
  last_error: string | null
}

/** A new row: identity and first due date. Everything else takes the column default. */
export interface NewIndexingRow {
  site_id: string
  url: string
  url_key: string
  generation_id: string | null
  priority: number
  next_check_at: string
}

/**
 * What an inspection writes back — EVERY writable column, on every row. A bulk
 * upsert takes the union of the rows' keys and supabase-js fills a key a row
 * lacks with NULL: one failed call carrying no `state` beside a successful one
 * would write NULL into a NOT NULL column and lose the whole batch.
 */
export type IndexingResult = Omit<PageIndexingRow, 'id' | 'generation_id' | 'priority'>

export interface IndexingSources {
  engine: Array<{ generationId: string; url: string; publishedAt: string | null }>
  inventory: string[]
}

/** The port the index check depends on; the Supabase implementation is below. */
export interface IndexingStore {
  loadSources(siteId: string): Promise<IndexingSources>
  listKeys(siteId: string): Promise<Array<{ url_key: string; generation_id: string | null }>>
  insertRows(rows: readonly NewIndexingRow[]): Promise<void>
  linkRows(rows: ReadonlyArray<Pick<NewIndexingRow, 'site_id' | 'url' | 'url_key' | 'generation_id' | 'priority'>>): Promise<void>
  deleteRows(siteId: string, keys: readonly string[]): Promise<void>
  listDue(siteId: string, opts: { now: Date; limit: number; inspectedBefore?: Date }): Promise<PageIndexingRow[]>
  saveResults(rows: readonly IndexingResult[]): Promise<void>
}

export const supabaseIndexingStore: IndexingStore = {
  async loadSources(siteId) {
    const supabase = createServiceClient()
    const [engine, inventory] = await Promise.all([
      supabase
        .from('generations')
        .select('id, published_url, published_at')
        .eq('site_id', siteId)
        .eq('status', 'published')
        .not('published_url', 'is', null)
        // Same rule as listLiveEnginePages (lib/db.ts): a draft or an unpromoted
        // branch would read as a 404 « to fix ». Null predates the column: live.
        .or('publish_live.is.null,publish_live.eq.true')
        .limit(SOURCE_READ_LIMIT),
      supabase.from('site_pages').select('url').eq('site_id', siteId).limit(SOURCE_READ_LIMIT),
    ])
    if (engine.error) throw new Error(`generations illisible : ${engine.error.message}`)
    if (inventory.error) throw new Error(`site_pages illisible : ${inventory.error.message}`)

    return {
      engine: ((engine.data ?? []) as Array<{ id: string; published_url: string; published_at: string | null }>).map((row) => ({
        generationId: row.id,
        url: row.published_url,
        publishedAt: row.published_at,
      })),
      inventory: ((inventory.data ?? []) as Array<{ url: string }>).map((row) => row.url),
    }
  },

  async listKeys(siteId) {
    const { data, error } = await createServiceClient()
      .from('page_indexing')
      .select('url_key, generation_id')
      .eq('site_id', siteId)
      .limit(SOURCE_READ_LIMIT * 2)
    if (error) throw new Error(`page_indexing illisible : ${error.message}`)
    return (data ?? []) as Array<{ url_key: string; generation_id: string | null }>
  },

  async insertRows(rows) {
    // ignoreDuplicates: a row written meanwhile by another path keeps its state.
    await writeChunks(rows, (chunk) =>
      createServiceClient().from('page_indexing').upsert(chunk, { onConflict: 'site_id,url_key', ignoreDuplicates: true })
    )
  },

  async linkRows(rows) {
    await writeChunks(rows, (chunk) => createServiceClient().from('page_indexing').upsert(chunk, { onConflict: 'site_id,url_key' }))
  },

  async deleteRows(siteId, keys) {
    for (let i = 0; i < keys.length; i += WRITE_CHUNK) {
      const { error } = await createServiceClient()
        .from('page_indexing')
        .delete()
        .eq('site_id', siteId)
        .in('url_key', keys.slice(i, i + WRITE_CHUNK))
      if (error) throw new Error(`page_indexing : suppression refusée (${error.message})`)
    }
  },

  async listDue(siteId, { now, limit, inspectedBefore }) {
    let query = createServiceClient().from('page_indexing').select(ROW_COLUMNS).eq('site_id', siteId)

    query = inspectedBefore
      ? query
        .or(`inspected_at.is.null,inspected_at.lt."${inspectedBefore.toISOString()}"`)
        .order('priority', { ascending: true })
        .order('inspected_at', { ascending: true, nullsFirst: true })
      : query
        .lte('next_check_at', now.toISOString())
        .order('priority', { ascending: true })
        .order('next_check_at', { ascending: true })

    const { data, error } = await query.limit(limit)
    if (error) throw new Error(`page_indexing illisible : ${error.message}`)
    return (data ?? []) as unknown as PageIndexingRow[]
  },

  async saveResults(rows) {
    await writeChunks(rows, (chunk) => createServiceClient().from('page_indexing').upsert(chunk, { onConflict: 'site_id,url_key' }))
  },
}

// ─── Reads for the Indexation screen ─────────────────────────────────────────

/** One count per state, computed by the database. A fixed seven queries, never one per page. */
export async function countIndexStates(siteId: string): Promise<Record<IndexState, number>> {
  const supabase = createServiceClient()
  const counts = await Promise.all(
    INDEX_STATES.map(async (state) => {
      const { count, error } = await supabase
        .from('page_indexing')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .eq('state', state)
      if (error) throw new Error(`page_indexing illisible : ${error.message}`)
      return [state, count ?? 0] as const
    })
  )
  return Object.fromEntries(counts) as Record<IndexState, number>
}

export async function listIndexingPage(
  siteId: string,
  states: readonly IndexState[],
  page: { offset: number; limit: number }
): Promise<{ rows: PageIndexingRow[]; total: number }> {
  const { data, count, error } = await createServiceClient()
    .from('page_indexing')
    .select(ROW_COLUMNS, { count: 'exact' })
    .eq('site_id', siteId)
    .in('state', [...states])
    .order('priority', { ascending: true })
    .order('url', { ascending: true })
    .range(page.offset, page.offset + page.limit - 1)
  if (error) throw new Error(`page_indexing illisible : ${error.message}`)
  return { rows: (data ?? []) as unknown as PageIndexingRow[], total: count ?? 0 }
}

export async function lastInspectionAt(siteId: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from('page_indexing')
    .select('inspected_at')
    .eq('site_id', siteId)
    .not('inspected_at', 'is', null)
    .order('inspected_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`page_indexing illisible : ${error.message}`)
  return ((data ?? []) as Array<{ inspected_at: string }>)[0]?.inspected_at ?? null
}

async function writeChunks<T>(
  rows: readonly T[],
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await write(rows.slice(i, i + WRITE_CHUNK))
    if (error) throw new Error(`page_indexing : écriture refusée (${error.message})`)
  }
}
