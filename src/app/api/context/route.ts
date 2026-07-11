// ─────────────────────────────────────────────────────────────────────────────
// Context API Routes
// SEO Engine - Context Enrichment
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  createTaxonomyContextBuilder,
  type TaxonomyContextConfig,
} from '@/src/adapters/rag/context/TaxonomyContextBuilder'
import {
  createCompetitorContextBuilder,
  type CompetitorContextConfig,
} from '@/src/adapters/rag/context/CompetitorContextBuilder'
import {
  createGoogleContextBuilder,
  type GoogleContextConfig,
} from '@/src/adapters/rag/context/GoogleContextBuilder'
import {
  createUnifiedContextAggregator,
  type UnifiedContextConfig,
  type ContextSourcesConfig,
} from '@/src/adapters/rag/context/UnifiedContextAggregator'

const supabase = createServiceClient()

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSite(siteId: string) {
  const { data, error } = await supabase
    .from('federated_sites')
    .select('*')
    .eq('id', siteId)
    .single()

  if (error || !data) {
    throw new Error(`Site not found: ${siteId}`)
  }

  return data
}

// ─── GET /api/context ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId')
  const source = searchParams.get('source') // taxonomy | competitor | google | unified

  if (!siteId) {
    return NextResponse.json(
      { error: 'siteId parameter is required' },
      { status: 400 }
    )
  }

  try {
    await getSite(siteId)

    switch (source) {
      case 'taxonomy': {
        const builder = createTaxonomyContextBuilder({ siteId })
        const context = await builder.buildContext()
        return NextResponse.json({ source: 'taxonomy', siteId, context })
      }

      case 'competitor': {
        const keywords = searchParams.get('keywords')?.split(',') || []
        if (keywords.length === 0) {
          return NextResponse.json(
            { error: 'keywords parameter required for competitor source' },
            { status: 400 }
          )
        }
        const builder = createCompetitorContextBuilder({
          siteId,
          targetKeywords: keywords,
        })
        const context = await builder.buildContext()
        return NextResponse.json({ source: 'competitor', siteId, keywords, context })
      }

      case 'google': {
        const builder = createGoogleContextBuilder({ siteId })
        const context = await builder.buildContext()
        return NextResponse.json({ source: 'google', siteId, context })
      }

      case 'unified':
      default: {
        const keywords = searchParams.get('keywords')?.split(',') || []

        const aggregator = createUnifiedContextAggregator(
          { siteId },
          {
            competitor: keywords.length > 0 ? { siteId, targetKeywords: keywords } : undefined,
          }
        )
        const context = await aggregator.buildContext()
        return NextResponse.json({ source: 'unified', siteId, context })
      }
    }
  } catch (error) {
    console.error('Context API error:', error)
    return NextResponse.json(
      {
        error: 'Failed to build context',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// ─── POST /api/context ────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, siteId, ...params } = body

    switch (action) {
      case 'build-context': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const aggregator = createUnifiedContextAggregator(
          { siteId },
          params.sources as ContextSourcesConfig
        )
        const context = await aggregator.buildContext()

        return NextResponse.json({
          action: 'build-context',
          siteId,
          context,
        })
      }

      case 'build-for-generation': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const aggregator = createUnifiedContextAggregator(
          { siteId },
          params.sources as ContextSourcesConfig
        )
        const context = await aggregator.buildContextForGeneration(params)

        return NextResponse.json({
          action: 'build-for-generation',
          siteId,
          context,
        })
      }

      case 'taxonomy-suggest': {
        if (!siteId || !params.topic) {
          return NextResponse.json(
            { error: 'siteId and topic are required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const builder = createTaxonomyContextBuilder({ siteId })
        const suggestions = await builder.suggestTermsForTopic(
          params.topic,
          params.limit || 5
        )

        return NextResponse.json({
          action: 'taxonomy-suggest',
          siteId,
          topic: params.topic,
          suggestions,
        })
      }

      case 'competitor-keyword-context': {
        if (!siteId || !params.keyword) {
          return NextResponse.json(
            { error: 'siteId and keyword are required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const builder = createCompetitorContextBuilder({
          siteId,
          targetKeywords: [params.keyword],
        })
        const context = await builder.getContextForKeyword(params.keyword)

        return NextResponse.json({
          action: 'competitor-keyword-context',
          siteId,
          keyword: params.keyword,
          context,
        })
      }

      case 'google-keyword-context': {
        if (!siteId || !params.keyword) {
          return NextResponse.json(
            { error: 'siteId and keyword are required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const builder = createGoogleContextBuilder({ siteId })
        const context = await builder.getContextForKeyword(params.keyword)

        return NextResponse.json({
          action: 'google-keyword-context',
          siteId,
          keyword: params.keyword,
          context,
        })
      }

      case 'local-content-context': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        await getSite(siteId)

        const builder = createGoogleContextBuilder({ siteId })
        const context = await builder.getLocalContentContext()

        return NextResponse.json({
          action: 'local-content-context',
          siteId,
          context,
        })
      }

      case 'invalidate-cache': {
        if (!siteId) {
          return NextResponse.json(
            { error: 'siteId is required' },
            { status: 400 }
          )
        }

        const aggregator = createUnifiedContextAggregator({ siteId })
        aggregator.invalidateCache()

        return NextResponse.json({
          action: 'invalidate-cache',
          siteId,
          success: true,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Context API error:', error)
    return NextResponse.json(
      {
        error: 'Operation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
