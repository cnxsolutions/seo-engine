// ─────────────────────────────────────────────────────────────────────────────
// Template API Routes
// SEO Engine - Universal Template System
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createTemplateEngine, type RenderContext } from '@/adapters/rag/TemplateEngine'
import {
  CONTENT_TYPE_TEMPLATES,
  getTemplate,
  listTemplates,
  createTemplateFromSchema,
  WORDPRESS_TEMPLATES,
  SANITY_TEMPLATES,
  NEXTJS_TEMPLATES,
} from '@/adapters/rag/TemplateLibrary'
import type { ContentTemplate } from '@/src/core/domain/entities/ContentTemplate'

const supabase = createServiceClient()
const templateEngine = createTemplateEngine()

// ─── GET /api/templates ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const platform = searchParams.get('platform')
  const contentType = searchParams.get('contentType')
  const list = searchParams.get('list')

  // Liste tous les templates
  if (list === 'all') {
    const templates = listTemplates()
    return NextResponse.json({
      count: templates.length,
      templates: templates.map(t => ({
        platform: t.platform,
        contentType: t.type,
        name: t.template.name,
        description: t.template.description,
        id: t.template.id,
        seoRequirements: {
          minWordCount: t.template.seoRequirements.minWordCount,
          targetWordCount: t.template.seoRequirements.targetWordCount,
        },
      })),
    })
  }

  // Template spécifique
  if (platform && contentType) {
    const template = getTemplate(platform, contentType)
    if (!template) {
      return NextResponse.json(
        { error: `Template not found for ${platform}:${contentType}` },
        { status: 404 }
      )
    }

    return NextResponse.json({ template })
  }

  // Par plateforme
  if (platform) {
    const templates = listTemplates().filter(t => t.platform === platform)
    return NextResponse.json({
      platform,
      count: templates.length,
      templates: templates.map(t => ({
        contentType: t.type,
        name: t.template.name,
        description: t.template.description,
      })),
    })
  }

  // Default: retourne tous les presets
  return NextResponse.json({
    wordpress: Object.keys(WORDPRESS_TEMPLATES),
    sanity: Object.keys(SANITY_TEMPLATES),
    nextjs: Object.keys(NEXTJS_TEMPLATES),
  })
}

// ─── POST /api/templates ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, template, context, siteId, contentTypeKey } = body

    switch (action) {
      case 'render': {
        if (!template || !context) {
          return NextResponse.json(
            { error: 'template and context are required' },
            { status: 400 }
          )
        }

        const result = await templateEngine.render(template as ContentTemplate, context as RenderContext)

        return NextResponse.json({
          action: 'render',
          result,
        })
      }

      case 'validate': {
        if (!template || !context) {
          return NextResponse.json(
            { error: 'template and context are required' },
            { status: 400 }
          )
        }

        const renderResult = await templateEngine.render(template as ContentTemplate, context as RenderContext)
        const validation = templateEngine.validate(renderResult, (template as ContentTemplate).seoRequirements)

        return NextResponse.json({
          action: 'validate',
          render: renderResult,
          validation,
        })
      }

      case 'create-from-schema': {
        if (!siteId || !contentTypeKey) {
          return NextResponse.json(
            { error: 'siteId and contentTypeKey are required' },
            { status: 400 }
          )
        }

        // Récupérer le schéma depuis la DB
        const { data: schema, error } = await supabase
          .from('content_schemas')
          .select(`
            *,
            content_types (
              key,
              label,
              description,
              content_fields (key, label, field_type, is_required)
            )
          `)
          .eq('federated_site_id', siteId)
          .single()

        if (error || !schema) {
          return NextResponse.json(
            { error: 'Schema not found for site' },
            { status: 404 }
          )
        }

        // Trouver le content type
        const contentType = schema.content_types?.find(
          (ct: { key: string }) => ct.key === contentTypeKey
        )

        if (!contentType) {
          return NextResponse.json(
            { error: `Content type ${contentTypeKey} not found in schema` },
            { status: 404 }
          )
        }

        // Créer le template depuis le schéma
        const newTemplate = createTemplateFromSchema(
          schema.type === 'wordpress' ? 'wordpress' : 'sanity',
          contentTypeKey,
          {
            label: contentType.label,
            description: contentType.description,
            fields: contentType.content_fields?.map((f: { key: string; label: string; field_type: string; is_required: boolean }) => ({
              key: f.key,
              label: f.label,
              type: f.field_type,
              required: f.is_required,
            })) || [],
          }
        )

        // Sauvegarder en DB
        const { data: saved, error: saveError } = await supabase
          .from('content_templates')
          .insert({
            id: newTemplate.id,
            name: newTemplate.name,
            platform: newTemplate.platform,
            content_type_key: newTemplate.contentTypeKey,
            structure: newTemplate.structure,
            seo_requirements: newTemplate.seoRequirements,
            config: newTemplate.config,
            version: newTemplate.version,
          })
          .select()
          .single()

        if (saveError) {
          console.error('Failed to save template:', saveError)
          return NextResponse.json(
            { error: 'Failed to save template', details: saveError.message },
            { status: 500 }
          )
        }

        return NextResponse.json({
          action: 'create-from-schema',
          template: saved,
        })
      }

      case 'list-presets': {
        return NextResponse.json({
          action: 'list-presets',
          presets: {
            wordpress: WORDPRESS_TEMPLATES,
            sanity: SANITY_TEMPLATES,
            nextjs: NEXTJS_TEMPLATES,
          },
        })
      }

      case 'duplicate': {
        if (!template?.id) {
          return NextResponse.json(
            { error: 'template.id is required' },
            { status: 400 }
          )
        }

        // Récupérer le template original
        const original = getTemplate(template.platform, template.contentTypeKey)
        if (!original) {
          return NextResponse.json(
            { error: 'Original template not found' },
            { status: 404 }
          )
        }

        // Créer une copie
        const duplicated: ContentTemplate = {
          ...JSON.parse(JSON.stringify(original)),
          id: crypto.randomUUID(),
          name: `${original.name} (Copy)`,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        return NextResponse.json({
          action: 'duplicate',
          template: duplicated,
        })
      }

      case 'customize': {
        if (!template?.id || !body.customizations) {
          return NextResponse.json(
            { error: 'template and customizations are required' },
            { status: 400 }
          )
        }

        // Appliquer les customizations
        const customized = applyCustomizations(
          template as ContentTemplate,
          body.customizations
        )

        return NextResponse.json({
          action: 'customize',
          template: customized,
        })
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Template API error:', error)
    return NextResponse.json(
      { error: 'Operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyCustomizations(
  template: ContentTemplate,
  customizations: {
    name?: string
    description?: string
    seoOverrides?: Partial<ContentTemplate['seoRequirements']>
    addSections?: ContentTemplate['structure']['sections']
    removeSections?: string[]
    modifySections?: Record<string, Partial<ContentTemplate['structure']['sections'][0]>>
  }
): ContentTemplate {
  const customized = JSON.parse(JSON.stringify(template)) as ContentTemplate

  if (customizations.name) {
    customized.name = customizations.name
  }

  if (customizations.description) {
    customized.description = customizations.description
  }

  if (customizations.seoOverrides) {
    customized.seoRequirements = {
      ...customized.seoRequirements,
      ...customizations.seoOverrides,
    }
  }

  if (customizations.addSections) {
    customized.structure.sections.push(...customizations.addSections)
  }

  if (customizations.removeSections) {
    customized.structure.sections = customized.structure.sections.filter(
      s => !customizations.removeSections!.includes(s.id)
    )
  }

  if (customizations.modifySections) {
    for (const [sectionId, mods] of Object.entries(customizations.modifySections)) {
      const section = customized.structure.sections.find(s => s.id === sectionId)
      if (section) {
        Object.assign(section, mods)
      }
    }
  }

  customized.updatedAt = new Date()
  customized.version++

  return customized
}
