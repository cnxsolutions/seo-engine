// ─────────────────────────────────────────────────────────────────────────────
// Validation API Routes
// SEO Engine - Validation Pipeline
// POST /api/validation - Run validation pipeline
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { ValidationPipelineOrchestrator } from '@/adapters/rag/validation/ValidationPipelineOrchestrator'
import { SchemaValidator } from '@/adapters/rag/validation/SchemaValidator'
import { ContentQualityValidator } from '@/adapters/rag/validation/ContentQualityValidator'
import { SeoValidator } from '@/adapters/rag/validation/SeoValidator'
import { DuplicateDetector } from '@/adapters/rag/validation/DuplicateDetector'

// ─── Types ─────────────────────────────────────────────────────────────────

interface ValidationRequest {
  action: 'full' | 'schema' | 'quality' | 'seo' | 'duplicate' | 'quick'
  content: {
    fields?: Record<string, unknown>
    contentType?: string
    title?: string
    metaTitle?: string
    metaDescription?: string
    content: string
    url?: string
    focusKeyword?: string
    schemaMarkup?: string
  }
  options?: {
    siteId?: string
    stopOnFirstError?: boolean
    checkDuplicates?: boolean
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSiteSchema(siteId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('site_schemas')
    .select('schema')
    .eq('site_id', siteId)
    .single()

  if (error || !data) {
    return null
  }

  return data.schema
}

async function getExistingContents(siteId: string, excludeId?: string) {
  const supabase = createServiceClient()
  let query = supabase
    .from('content')
    .select('id, title, content, url')

  if (siteId) {
    query = query.eq('site_id', siteId)
  }

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query.limit(100)

  if (error) {
    return []
  }

  return data || []
}

// ─── POST /api/validation ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body: ValidationRequest = await request.json()
    const { action, content, options = {} } = body

    if (!content || !content.content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    const startTime = Date.now()

    // ─── Full Validation ──────────────────────────────────────────────
    if (action === 'full') {
      // Récupérer le schéma si non fourni
      let schema = null
      if (options.siteId && !content.fields) {
        schema = await getSiteSchema(options.siteId)
      }

      // Récupérer les contenus existants pour la détection de duplicats
      const existingContents = options.checkDuplicates
        ? await getExistingContents(options.siteId || '')
        : []

      // Créer le pipeline
      const pipeline = new ValidationPipelineOrchestrator({
        validators: {
          schema: !!schema,
          contentQuality: true,
          seo: !!content.focusKeyword,
          duplicate: options.checkDuplicates && existingContents.length > 0,
        },
        schema: schema ? { schema } : undefined,
        stopOnFirstError: options.stopOnFirstError,
      })

      const result = await pipeline.validate({
        content: {
          fields: content.fields || {},
          contentType: content.contentType || 'post',
          title: content.title,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          content: content.content,
          url: content.url,
          focusKeyword: content.focusKeyword || 'default',
          schemaMarkup: content.schemaMarkup,
        },
        existingContents,
      })

      return NextResponse.json({
        action: 'full',
        ...result,
        processingTimeMs: Date.now() - startTime,
      })
    }

    // ─── Individual Validators ────────────────────────────────────────
    switch (action) {
      case 'schema': {
        if (!content.fields || !content.contentType) {
          return NextResponse.json(
            { error: 'fields and contentType are required for schema validation' },
            { status: 400 }
          )
        }

        // Récupérer le schéma
        let schema = null
        if (options.siteId) {
          schema = await getSiteSchema(options.siteId)
        }

        if (!schema) {
          return NextResponse.json(
            { error: 'Schema not found. Provide siteId or schema in options.' },
            { status: 400 }
          )
        }

        const validator = new SchemaValidator(schema)
        const result = validator.validate({
          fields: content.fields,
          contentType: content.contentType,
        })

        return NextResponse.json({
          action: 'schema',
          ...result,
          processingTimeMs: Date.now() - startTime,
        })
      }

      case 'quality': {
        const validator = new ContentQualityValidator()
        const result = validator.validate({
          title: content.title || content.metaTitle,
          content: content.content,
        })

        return NextResponse.json({
          action: 'quality',
          ...result,
          processingTimeMs: Date.now() - startTime,
        })
      }

      case 'seo': {
        if (!content.focusKeyword) {
          return NextResponse.json(
            { error: 'focusKeyword is required for SEO validation' },
            { status: 400 }
          )
        }

        const validator = new SeoValidator()
        const result = validator.validate({
          title: content.title,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          content: content.content,
          url: content.url,
          focusKeyword: content.focusKeyword,
          schemaMarkup: content.schemaMarkup,
        })

        return NextResponse.json({
          action: 'seo',
          ...result,
          processingTimeMs: Date.now() - startTime,
        })
      }

      case 'duplicate': {
        const existingContents = await getExistingContents(options.siteId || '')

        if (existingContents.length === 0) {
          return NextResponse.json({
            action: 'duplicate',
            hasDuplicates: false,
            duplicates: [],
            stats: {
              totalChecked: 1,
              exactDuplicates: 0,
              nearDuplicates: 0,
              partialMatches: 0,
              processingTimeMs: 0,
            },
            processingTimeMs: Date.now() - startTime,
          })
        }

        const detector = new DuplicateDetector()
        const result = await detector.findDuplicates([
          {
            id: 'new',
            title: content.title || content.metaTitle || 'Untitled',
            content: content.content,
            url: content.url,
          },
          ...existingContents.map(c => ({
            id: c.id,
            title: c.title,
            content: c.content,
            url: c.url,
          })),
        ])

        return NextResponse.json({
          action: 'duplicate',
          ...result,
          processingTimeMs: Date.now() - startTime,
        })
      }

      case 'quick': {
        // Validation rapide: qualité + SEO basics
        const qualityValidator = new ContentQualityValidator()
        const seoValidator = new SeoValidator()

        const qualityResult = qualityValidator.validate({
          title: content.title || content.metaTitle,
          content: content.content,
        })

        const seoResult = content.focusKeyword
          ? seoValidator.validate({
              title: content.title,
              metaTitle: content.metaTitle,
              metaDescription: content.metaDescription,
              content: content.content,
              url: content.url,
              focusKeyword: content.focusKeyword,
            })
          : null

        const overallScore = seoResult
          ? Math.round((qualityResult.score.overall + seoResult.score) / 2)
          : qualityResult.score.overall

        const hasErrors = qualityResult.errors.length > 0 ||
          (seoResult && seoResult.errors.some(e => e.impact === 'high'))

        return NextResponse.json({
          action: 'quick',
          valid: !hasErrors,
          overallScore,
          quality: qualityResult,
          seo: seoResult,
          errors: [
            ...qualityResult.errors.map(e => ({ ...e, source: 'quality' })),
            ...(seoResult?.errors.filter(e => e.impact === 'high').map(e => ({ ...e, source: 'seo' })) || []),
          ],
          processingTimeMs: Date.now() - startTime,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Validation API error:', error)
    return NextResponse.json(
      { error: 'Validation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
