// ─────────────────────────────────────────────────────────────────────────────
// API Route: Schema Extraction
// POST /api/schema/extract/[siteId]
// Extracts schema from a federated site
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createWordPressExtractor } from '../../../../adapters/extractors/wordpress/WordPressExtractor'
import { createSanityExtractor } from '../../../../adapters/extractors/sanity/SanityExtractor'
import type { FederatedSite } from '../../../../core/domain/entities'
import type { ISchemaExtractor } from '../../../../core/domain/repositories'

// Mock database - à remplacer par une vraie implémentation
const sites = new Map<string, FederatedSite>()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params

  try {
    const site = await getSite(siteId)
    if (!site) {
      return NextResponse.json({ error: 'Site non trouvé' }, { status: 404 })
    }

    // Récupérer le schéma si déjà extrait
    const schema = await getSchemaForSite(siteId)
    if (!schema) {
      return NextResponse.json({
        status: 'not_extracted',
        message: 'Aucun schéma extrait pour ce site. Lancez une extraction.',
      })
    }

    return NextResponse.json({
      status: 'extracted',
      schema: {
        id: schema.id,
        name: schema.name,
        label: schema.label,
        contentTypesCount: schema.contentTypes.length,
        fieldsCount: schema.contentTypes.reduce((sum, ct) => sum + ct.fields.length, 0),
        extractedAt: schema.extractedAt,
        seoConfig: schema.seoConfig,
        publishConfig: schema.publishConfig,
        contentTypes: schema.contentTypes.map(ct => ({
          key: ct.key,
          label: ct.label,
          fieldCount: ct.fields.length,
          requiredFields: ct.fields.filter(f => f.required).length,
          taxonomies: ct.taxonomies?.map(t => ({ key: t.key, label: t.label })) || [],
        })),
      },
    })
  } catch (error) {
    console.error('[GET /api/schema/extract]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params

  try {
    // 1. Récupérer le site
    const site = await getSite(siteId)
    if (!site) {
      return NextResponse.json({ error: 'Site non trouvé' }, { status: 404 })
    }

    // 2. Vérifier le type de site
    if (!['wordpress', 'sanity'].includes(site.type)) {
      return NextResponse.json(
        { error: `Type de site non supporté: ${site.type}` },
        { status: 400 }
      )
    }

    // 3. Créer l'extractor approprié
    const extractor = createExtractor(site)

    // 4. Valider la connexion
    const connectionResult = await extractor.validateConnection(site)
    if (!connectionResult.isConnected) {
      return NextResponse.json({
        error: 'Connexion au site impossible',
        details: connectionResult.error,
      }, { status: 400 })
    }

    // 5. Extraire le schéma
    const schema = await extractor.extract(site)

    // 6. Sauvegarder le schéma
    await saveSchema(siteId, schema)

    // 7. Logger la sync
    await logSync(siteId, 'completed', {
      contentTypes: schema.contentTypes.length,
      fields: schema.contentTypes.reduce((sum, ct) => sum + ct.fields.length, 0),
      taxonomies: schema.contentTypes.reduce((sum, ct) => sum + (ct.taxonomies?.length || 0), 0),
    })

    // 8. Retourner le résultat
    return NextResponse.json({
      success: true,
      message: `Schéma extrait avec succès depuis ${connectionResult.siteName || site.name}`,
      schema: {
        id: schema.id,
        name: schema.name,
        label: schema.label,
        contentTypesCount: schema.contentTypes.length,
        fieldsCount: schema.contentTypes.reduce((sum, ct) => sum + ct.fields.length, 0),
        extractedAt: schema.extractedAt,
        seoPlugin: schema.seoConfig.hasSeoPlugin,
        contentTypes: schema.contentTypes.map(ct => ({
          key: ct.key,
          label: ct.label,
          fieldCount: ct.fields.length,
          requiredFields: ct.fields.filter(f => f.required).length,
          fields: ct.fields.map(f => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
          })),
        })),
      },
    })
  } catch (error) {
    console.error('[POST /api/schema/extract]', error)

    await logSync(siteId, 'failed', { error: error instanceof Error ? error.message : 'Erreur' })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur lors de l\'extraction' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params

  try {
    await deleteSchema(siteId)

    return NextResponse.json({
      success: true,
      message: 'Schéma supprimé avec succès',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function createExtractor(site: FederatedSite): ISchemaExtractor {
  switch (site.type) {
    case 'wordpress':
      return createWordPressExtractor(site)
    case 'sanity':
      return createSanityExtractor(site)
    default:
      throw new Error(`Unsupported site type: ${site.type}`)
  }
}

// ─── Database Mock ────────────────────────────────────────────────────────────
// À remplacer par une vraie implémentation Supabase

async function getSite(siteId: string): Promise<FederatedSite | null> {
  // En production: SELECT * FROM federated_sites WHERE id = $1
  return sites.get(siteId) || null
}

async function saveSchema(siteId: string, schema: import('../../../core/domain/entities').ContentSchema): Promise<void> {
  // En production: INSERT INTO content_schemas VALUES (...)
  console.log('[Schema saved]', { siteId, schemaName: schema.name })
}

async function getSchemaForSite(siteId: string): Promise<import('../../../core/domain/entities').ContentSchema | null> {
  // En production: SELECT * FROM content_schemas WHERE federated_site_id = $1
  return null
}

async function deleteSchema(siteId: string): Promise<void> {
  // En production: DELETE FROM content_schemas WHERE federated_site_id = $1
  console.log('[Schema deleted]', { siteId })
}

async function logSync(
  siteId: string,
  status: 'pending' | 'running' | 'completed' | 'failed',
  stats: { contentTypes?: number; fields?: number; taxonomies?: number; error?: string }
): Promise<void> {
  // En production: INSERT INTO schema_sync_logs VALUES (...)
  console.log('[Sync log]', { siteId, status, stats })
}
