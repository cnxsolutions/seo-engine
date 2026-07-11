// ─────────────────────────────────────────────────────────────────────────────
// Sanity Publishing API Routes
// SEO Engine - Publishing Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import {
  createSanityPublisher,
  createSanityMonitoringService,
  type SanityPublishContent,
  type SanityPublishOptions,
} from '@/adapters/publishers/sanity'

const supabase = createServiceClient()

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSiteCredentials(siteId: string) {
  const { data, error } = await supabase
    .from('federated_sites')
    .select('id, name, url, type, credentials')
    .eq('id', siteId)
    .single()

  if (error || !data) {
    throw new Error(`Site not found: ${siteId}`)
  }

  if (data.type !== 'sanity') {
    throw new Error(`Site is not a Sanity site: ${data.type}`)
  }

  return data
}

// ─── POST /api/publish/sanity ────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, siteId, content, options } = body

    switch (action) {
      case 'publish': {
        if (!siteId || !content) {
          return NextResponse.json(
            { error: 'siteId and content are required' },
            { status: 400 }
          )
        }

        // Récupérer les credentials
        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        // Créer le publisher
        const publisher = createSanityPublisher(credentials, options)

        // Publier
        const result = await publisher.publish(content as SanityPublishContent)

        return NextResponse.json({
          action: 'publish',
          siteId,
          result,
        })
      }

      case 'update': {
        if (!siteId || !body.documentId || !content) {
          return NextResponse.json(
            { error: 'siteId, documentId, and content are required' },
            { status: 400 }
          )
        }

        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        const publisher = createSanityPublisher(credentials, options)
        const result = await publisher.update(body.documentId, content as Partial<SanityPublishContent>)

        return NextResponse.json({
          action: 'update',
          siteId,
          documentId: body.documentId,
          result,
        })
      }

      case 'delete': {
        if (!siteId || !body.documentId) {
          return NextResponse.json(
            { error: 'siteId and documentId are required' },
            { status: 400 }
          )
        }

        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        const publisher = createSanityPublisher(credentials)
        const result = await publisher.delete(body.documentId)

        return NextResponse.json({
          action: 'delete',
          siteId,
          documentId: body.documentId,
          result,
        })
      }

      case 'rollback': {
        if (!siteId || !body.documentId || !body.revisionId) {
          return NextResponse.json(
            { error: 'siteId, documentId, and revisionId are required' },
            { status: 400 }
          )
        }

        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        const publisher = createSanityPublisher(credentials)
        const result = await publisher.rollback(body.documentId, body.revisionId)

        return NextResponse.json({
          action: 'rollback',
          siteId,
          documentId: body.documentId,
          revisionId: body.revisionId,
          result,
        })
      }

      case 'validate': {
        if (!content) {
          return NextResponse.json(
            { error: 'content is required' },
            { status: 400 }
          )
        }

        // Validation sans credentials
        const mockCredentials = {
          sanityProjectId: 'mock',
          sanityDataset: 'mock',
          sanityToken: 'mock',
        }

        const publisher = createSanityPublisher(mockCredentials)
        const validation = publisher.validate(content as SanityPublishContent)

        return NextResponse.json({
          action: 'validate',
          validation,
        })
      }

      case 'status': {
        if (!siteId || !body.documentId) {
          return NextResponse.json(
            { error: 'siteId and documentId are required' },
            { status: 400 }
          )
        }

        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        const publisher = createSanityPublisher(credentials)
        const status = await publisher.getStatus(body.documentId)

        if (!status) {
          return NextResponse.json(
            { error: 'Document not found' },
            { status: 404 }
          )
        }

        return NextResponse.json({
          action: 'status',
          siteId,
          documentId: body.documentId,
          status,
        })
      }

      case 'bulk-publish': {
        if (!siteId || !body.contents || !Array.isArray(body.contents)) {
          return NextResponse.json(
            { error: 'siteId and contents (array) are required' },
            { status: 400 }
          )
        }

        const site = await getSiteCredentials(siteId)
        const credentials = site.credentials as {
          sanityProjectId: string
          sanityDataset: string
          sanityToken: string
        }

        const publisher = createSanityPublisher(credentials)
        const results = []
        const errors = []

        for (const item of body.contents) {
          try {
            const result = await publisher.publish(item as SanityPublishContent)
            results.push({
              contentIndex: body.contents.indexOf(item),
              ...result,
            })
          } catch (error) {
            errors.push({
              contentIndex: body.contents.indexOf(item),
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        }

        return NextResponse.json({
          action: 'bulk-publish',
          siteId,
          total: body.contents.length,
          successful: results.length,
          failed: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Sanity publishing error:', error)
    return NextResponse.json(
      {
        error: 'Operation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// ─── GET /api/publish/sanity ─────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('siteId')
  const documentId = searchParams.get('documentId')
  const healthCheck = searchParams.get('healthCheck')

  // Health check
  if (healthCheck === 'true') {
    if (!siteId) {
      return NextResponse.json(
        { error: 'siteId is required for health check' },
        { status: 400 }
      )
    }

    try {
      const site = await getSiteCredentials(siteId)
      const credentials = site.credentials as {
        sanityProjectId: string
        sanityDataset: string
        sanityToken: string
      }

      const { SanityClient } = await import('@/adapters/publishers/sanity')
      const client = new SanityClient({
        projectId: credentials.sanityProjectId,
        dataset: credentials.sanityDataset,
        token: credentials.sanityToken,
      })

      const monitoring = createSanityMonitoringService(client)
      const health = await monitoring.checkHealth()

      return NextResponse.json({
        action: 'health-check',
        siteId,
        siteName: site.name,
        health,
      })
    } catch (error) {
      return NextResponse.json(
        {
          action: 'health-check',
          siteId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    }
  }

  // Document status
  if (siteId && documentId) {
    try {
      const site = await getSiteCredentials(siteId)
      const credentials = site.credentials as {
        sanityProjectId: string
        sanityDataset: string
        sanityToken: string
      }

      const publisher = createSanityPublisher(credentials)
      const status = await publisher.getStatus(documentId)

      if (!status) {
        return NextResponse.json(
          { error: 'Document not found' },
          { status: 404 }
        )
      }

      return NextResponse.json({
        action: 'status',
        siteId,
        documentId,
        status,
      })
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    }
  }

  // Site list
  if (siteId) {
    try {
      const site = await getSiteCredentials(siteId)
      return NextResponse.json({
        action: 'site-info',
        site: {
          id: site.id,
          name: site.name,
          url: site.url,
          type: site.type,
        },
      })
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    error: 'siteId parameter is required',
  }, { status: 400 })
}
