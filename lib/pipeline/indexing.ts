// ─────────────────────────────────────────────────────────────────────────────
// Post-publication Indexing Hook
// SEO Engine - Post-generation pipeline
// Feeds the vector store the pages this engine actually put online
// ─────────────────────────────────────────────────────────────────────────────
//
// `VectorIndexingService` had no caller anywhere in the repository, so the
// vector store was never written to and every semantic search ran against an
// empty index — the RAG context the generator builds on the scheduled path
// retrieved nothing. This hook closes the loop: what we publish, we index.
//
// Two rules govern everything below.
//
//  1. It NEVER fails a publication. The page is online by the time this runs;
//     an indexing error is a degraded search index, not a failed publication,
//     and rethrowing it here would send the caller back into a retry that
//     re-pushes an already published page.
//  2. It calls `indexGeneratedPage(generationId)` — the real entry point of the
//     rewritten indexing service — by name, not by runtime probe.
//
// INTEGRATION NOTE (wave 2). This hook used to duck-type the service, looking
// for `indexPublishedPage` and falling back to `onContentChange`. The rewritten
// `VectorIndexingService` exposes NEITHER: its surface is `indexSitePages`,
// `indexGeneratedPage`, `reindexSite` and `getSiteIndexStatus`. Because the
// probe went through an `as unknown as` cast, the mismatch type-checked, built
// and tested green while every call returned "no indexing entry point exposed"
// — the vector store stayed empty exactly as before. It is a direct call now,
// so a future rename breaks the build instead of the product.
//
// `indexGeneratedPage` re-reads the generation row itself, which is why it only
// needs the id: the row is the source of truth, so the index cannot drift from
// what was actually shipped. The rest of `PublishedPageIndexInput` is kept —
// callers already assemble it, and it documents what is being indexed.

import type { PageType } from '@/lib/types'

export interface PublishedPageIndexInput {
  siteId: string
  generationId: string
  pageType: PageType
  title: string
  html: string
  url: string
  focusKeyword?: string
  keywords?: string[]
  wordCount: number
  publishedAt: string
}

export interface IndexingHookResult {
  indexed: boolean
  /** Which entry point was used, or why none was. */
  via?: string
  reason?: string
  durationMs: number
}

function missingEnv(): string | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return 'NEXT_PUBLIC_SUPABASE_URL'
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY'
  // Embeddings are computed on write; without a key the store would only ever
  // record null vectors, which is worse than an empty index because a search
  // would then return matches ranked by nothing.
  if (!process.env.OPENAI_API_KEY) return 'OPENAI_API_KEY'
  return null
}

/**
 * Index one freshly published page. Resolves to a report; never rejects.
 */
export async function indexPublishedPage(input: PublishedPageIndexInput): Promise<IndexingHookResult> {
  const startedAt = Date.now()
  const done = (result: Omit<IndexingHookResult, 'durationMs'>): IndexingHookResult => ({
    ...result,
    durationMs: Date.now() - startedAt,
  })

  if (!input.siteId || !input.url) {
    return done({ indexed: false, reason: 'siteId ou url manquant' })
  }

  const missing = missingEnv()
  if (missing) {
    return done({ indexed: false, reason: `${missing} absent — indexation ignoree` })
  }

  if (!input.generationId) {
    return done({ indexed: false, reason: 'generationId manquant' })
  }

  try {
    // Imported lazily: this module is loaded by the scheduler at boot, and a
    // broken import in the RAG adapter must not stop the cron from starting.
    const { indexGeneratedPage } = await import('@/src/adapters/rag/VectorIndexingService')

    // Contract of the indexing service: never throws, reports failures in the
    // returned object. The `catch` below covers the import, not the call.
    const report = await indexGeneratedPage(input.generationId, { source: 'generation' })

    if (report.documentsIndexed > 0) {
      return done({ indexed: true, via: 'indexGeneratedPage' })
    }

    if (report.documentsSkipped > 0) {
      // Already in the index with the same content hash — nothing to pay for.
      return done({ indexed: true, via: 'indexGeneratedPage (inchange)' })
    }

    return done({
      indexed: false,
      reason: report.errors.length > 0
        ? report.errors.join(' | ')
        : report.documentsTooShort > 0
          ? 'contenu trop court pour etre indexe'
          : 'aucun document indexe',
    })
  } catch (error) {
    return done({
      indexed: false,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
