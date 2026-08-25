// ─────────────────────────────────────────────────────────────────────────────
// Schema Extraction API
// GET  /api/schema/extract/[siteId] — schéma complet du site WordPress
// POST /api/schema/extract/[siteId] — test de connexion + résumé d'extraction
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getSiteById, updateSite } from '@/lib/db'
import type { Site } from '@/lib/types'
import { createWordPressExtractor, WordPressApiError } from '@/src/adapters/extractors/wordpress/WordPressExtractor'
import { createFederatedSite } from '@/src/core/domain/entities'
import type { ContentSchema, ContentType, FederatedSite } from '@/src/core/domain/entities'

// Le schéma n'est jamais persisté : il est relu depuis l'API REST WordPress à
// chaque appel. La seule table candidate, content_schemas, est déclarée avec une
// clé étrangère vers federated_sites — une table qui n'appartient pas au schéma
// réellement utilisé par l'application. Une copie périmée des CPT et des champs
// ACF serait de toute façon pire qu'une lecture directe pour un opérateur unique.

// ─── Response DTOs ────────────────────────────────────────────────────────────

interface FieldDto {
  key: string
  label: string
  type: string
  required: boolean
  description?: string
  options?: string[]
  isAcf: boolean
}

interface ContentTypeDto {
  key: string
  label: string
  fieldCount: number
  requiredCount: number
  fields: FieldDto[]
  taxonomies: Array<{ key: string; label: string; hierarchical: boolean }>
}

interface SchemaDto {
  name: string
  label: string
  extractedAt: string
  seoPlugin: string | null
  schemaTypes: string[]
  seoFields: string[]
  contentTypes: ContentTypeDto[]
}

// ─── GET /api/schema/extract/[siteId] ────────────────────────────────────────

export async function GET(_req: NextRequest, context: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await context.params
    const check = requireWordPressSite(await getSiteById(siteId))
    if (!check.ok) return check.response

    const dto = toSchemaDto(await extractSchema(check.site))
    await storeSchema(check.site.id, dto)

    return NextResponse.json({
      site: { id: check.site.id, name: check.site.name, url: check.site.url },
      schema: dto,
      readAt: new Date().toISOString(),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── POST /api/schema/extract/[siteId] ───────────────────────────────────────

export async function POST(_req: NextRequest, context: { params: Promise<{ siteId: string }> }) {
  try {
    const { siteId } = await context.params
    const check = requireWordPressSite(await getSiteById(siteId))
    if (!check.ok) return check.response

    const schema = toSchemaDto(await extractSchema(check.site))
    await storeSchema(check.site.id, schema)

    return NextResponse.json({
      success: true,
      message: `Schéma extrait depuis ${check.site.name}`,
      summary: {
        contentTypes: schema.contentTypes.length,
        fields: schema.contentTypes.reduce((sum, ct) => sum + ct.fieldCount, 0),
        taxonomies: schema.contentTypes.reduce((sum, ct) => sum + ct.taxonomies.length, 0),
        seoPlugin: schema.seoPlugin,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Keep what was just read.
 *
 * Reading a schema is several authenticated round-trips to the client's
 * production site. Nothing kept the result, so every visit to the screen hit
 * that site again for an identical answer — and `has_schema` could never be true
 * for anyone, which left the setup checklist permanently unsatisfiable.
 *
 * Never fatal: the caller already has the schema in hand, and failing to cache
 * it is not a reason to fail the read.
 */
async function storeSchema(siteId: string, schema: SchemaDto): Promise<void> {
  await updateSite(siteId, {
    cms_schema: schema,
    cms_schema_read_at: new Date().toISOString(),
  } as Parameters<typeof updateSite>[1]).catch((error) => {
    console.warn('[schema] lecture non conservee :', error instanceof Error ? error.message : error)
  })
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/** Erreur imputable au site distant, pas au moteur : remontée en 502. */
class RemoteSiteError extends Error {}

async function extractSchema(site: Site): Promise<ContentSchema> {
  const federated = toFederatedSite(site)
  const extractor = createWordPressExtractor(federated)

  const connection = await extractor.validateConnection(federated)
  if (!connection.isConnected) {
    throw new RemoteSiteError(connection.error ?? `Connexion impossible à ${site.url}`)
  }

  return extractor.extract(federated)
}

function toFederatedSite(site: Site): FederatedSite {
  return createFederatedSite({
    id: site.id,
    name: site.name,
    type: 'wordpress',
    url: site.url,
    credentials: {
      wpUsername: site.wp_username,
      wpAppPassword: site.wp_app_password,
    },
    isActive: site.is_active,
    createdAt: new Date(site.created_at),
    updatedAt: new Date(site.updated_at),
  })
}

// ─── Guards & Mapping ─────────────────────────────────────────────────────────

type SiteCheck = { ok: true; site: Site } | { ok: false; response: NextResponse }

function requireWordPressSite(site: Site | null): SiteCheck {
  if (!site) {
    return { ok: false, response: NextResponse.json({ error: 'Site introuvable' }, { status: 404 }) }
  }

  if (site.type !== 'wordpress') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "L'extraction de schéma n'est disponible que pour les sites WordPress" },
        { status: 400 }
      ),
    }
  }

  if (!site.wp_username || !site.wp_app_password) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Identifiants WordPress manquants sur ce site' },
        { status: 400 }
      ),
    }
  }

  return { ok: true, site }
}

function toSchemaDto(schema: ContentSchema): SchemaDto {
  return {
    name: schema.name,
    label: schema.label,
    extractedAt: schema.extractedAt.toISOString(),
    seoPlugin: readSeoPlugin(schema),
    schemaTypes: schema.seoConfig.schemaTypes,
    seoFields: schema.seoConfig.seoFields,
    contentTypes: schema.contentTypes.map(toContentTypeDto),
  }
}

function toContentTypeDto(contentType: ContentType): ContentTypeDto {
  const fields: FieldDto[] = contentType.fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    description: field.description,
    options: field.config?.options,
    isAcf: !!field.acfConfig,
  }))

  return {
    key: contentType.key,
    label: contentType.label,
    fieldCount: fields.length,
    requiredCount: fields.filter((field) => field.required).length,
    fields,
    taxonomies: (contentType.taxonomies ?? []).map((taxonomy) => ({
      key: taxonomy.key,
      label: taxonomy.label,
      hierarchical: taxonomy.hierarchical,
    })),
  }
}

/** Le nom du plugin SEO n'est pas dans seoConfig, seulement dans la source brute. */
function readSeoPlugin(schema: ContentSchema): string | null {
  const plugin = schema.rawSource?.seoPlugin
  return typeof plugin === 'string' ? plugin : null
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Erreur lors de l'extraction"
  const isRemote = error instanceof RemoteSiteError || error instanceof WordPressApiError
  const status = isRemote ? 502 : 500

  console.error('[api/schema/extract]', message)
  return NextResponse.json({ error: message }, { status })
}
