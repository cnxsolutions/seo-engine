// ─────────────────────────────────────────────────────────────────────────────
// Vector Store API Routes
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createSupabaseVectorStore } from '@/adapters/rag/providers'
import { VectorIndexingService } from '@/adapters/rag/VectorIndexingService'
import { SemanticSearchService } from '@/adapters/rag/SemanticSearchService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVectorStore() {
  const supabase = createServiceClient()
  return createSupabaseVectorStore(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getIndexingService(vectorStore: ReturnType<typeof createSupabaseVectorStore>) {
  return new VectorIndexingService(vectorStore)
}

function getSearchService(vectorStore: ReturnType<typeof createSupabaseVectorStore>) {
  return new SemanticSearchService(vectorStore)
}

// ─── GET /api/vector/search ──────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const query = searchParams.get('q')
  const siteId = searchParams.get('siteId')
  const contentType = searchParams.get('contentType')
  const limit = parseInt(searchParams.get('limit') || '10')
  const minScore = parseFloat(searchParams.get('minScore') || '0.7')

  if (!query) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required' },
      { status: 400 }
    )
  }

  try {
    const vectorStore = getVectorStore()
    const searchService = getSearchService(vectorStore)

    const results = await searchService.semanticSearch(query, {
      siteId: siteId || undefined,
      contentTypeKey: contentType || undefined,
      limit,
      minScore,
    })

    return NextResponse.json({
      query,
      count: results.length,
      results,
    })
  } catch (error) {
    console.error('Vector search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// ─── POST /api/vector/search ─────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const {
      action,
      siteId,
      contentTypeKeys,
      query,
      options,
    } = body

    const vectorStore = getVectorStore()

    switch (action) {
      case 'search': {
        const searchService = getSearchService(vectorStore)
        const results = await searchService.semanticSearch(query, {
          siteId: options?.siteId,
          contentTypeKey: options?.contentTypeKey,
          documentTypes: options?.documentTypes,
          taxonomyTerms: options?.taxonomyTerms,
          limit: options?.limit || 10,
          minScore: options?.minScore || 0.7,
        })

        return NextResponse.json({
          query,
          count: results.length,
          results,
        })
      }

      case 'index-schema': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        const indexingService = getIndexingService(vectorStore)
        const status = await indexingService.indexSiteSchemas(siteId)

        return NextResponse.json({
          action: 'index-schema',
          siteId,
          status,
        })
      }

      case 'index-content': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        const indexingService = getIndexingService(vectorStore)
        const status = await indexingService.indexSiteContent(siteId, {
          contentTypeKeys,
        })

        return NextResponse.json({
          action: 'index-content',
          siteId,
          status,
        })
      }

      case 'reindex-site': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        const indexingService = getIndexingService(vectorStore)
        const status = await indexingService.reindexSite(siteId)

        return NextResponse.json({
          action: 'reindex-site',
          siteId,
          status,
        })
      }

      case 'build-context': {
        if (!siteId || !contentTypeKeys?.[0]) {
          return NextResponse.json(
            { error: 'siteId and contentTypeKeys are required' },
            { status: 400 }
          )
        }

        const searchService = getSearchService(vectorStore)
        const context = await searchService.buildRagContext({
          siteId,
          contentTypeKey: contentTypeKeys[0],
          topic: query,
          keywords: options?.keywords,
          location: options?.location,
          limit: options?.limit || 5,
        })

        return NextResponse.json({
          action: 'build-context',
          siteId,
          contentType: contentTypeKeys[0],
          context,
        })
      }

      case 'find-similar': {
        if (!query) {
          return NextResponse.json(
            { error: 'query is required for find-similar' },
            { status: 400 }
          )
        }

        const searchService = getSearchService(vectorStore)
        const results = await searchService.findSimilarExamples(
          contentTypeKeys?.[0] || 'post',
          query,
          {
            siteId: options?.siteId,
            limit: options?.limit || 5,
            excludeIds: options?.excludeIds,
          }
        )

        return NextResponse.json({
          action: 'find-similar',
          query,
          contentType: contentTypeKeys?.[0],
          count: results.length,
          results,
        })
      }

      case 'find-internal-links': {
        if (!query || !siteId) {
          return NextResponse.json(
            { error: 'query and siteId are required for find-internal-links' },
            { status: 400 }
          )
        }

        const searchService = getSearchService(vectorStore)
        const targets = await searchService.findInternalLinkTargets(query, siteId, {
          limit: options?.limit || 5,
          existingLinks: options?.existingLinks,
        })

        return NextResponse.json({
          action: 'find-internal-links',
          query,
          siteId,
          count: targets.length,
          targets,
        })
      }

      case 'content-gaps': {
        if (!siteId || !options?.keywords) {
          return NextResponse.json(
            { error: 'siteId and keywords are required for content-gaps' },
            { status: 400 }
          )
        }

        const searchService = getSearchService(vectorStore)
        const gaps = await searchService.findContentGaps(siteId, options.keywords)

        return NextResponse.json({
          action: 'content-gaps',
          siteId,
          keywords: options.keywords,
          gaps,
        })
      }

      case 'site-stats': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required for site-stats' },
            { status: 400 }
          )
        }

        const searchService = getSearchService(vectorStore)
        const stats = await searchService.getSiteContentStats(siteId)

        return NextResponse.json({
          action: 'site-stats',
          siteId,
          stats,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Vector API error:', error)
    return NextResponse.json(
      { error: 'Operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
