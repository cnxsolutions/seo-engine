import { NextRequest, NextResponse } from 'next/server'
import { getGoogleConnection, deleteGoogleConnection, upsertGoogleConnection } from '@/lib/google/client'
import { listAccounts, listLocations } from '@/lib/google/gbp'
import { listProperties } from '@/lib/google/gsc'
import { syncGbpData, syncGscData } from '@/lib/google/sync'
import { getAuthenticatedClient } from '@/lib/google/client'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const connection = await getGoogleConnection(id)

  if (!connection) {
    return NextResponse.json({ connected: false })
  }

  return NextResponse.json({
    connected: true,
    email: connection.google_email,
    gbp_account_id: connection.gbp_account_id,
    gbp_location_id: connection.gbp_location_id,
    gsc_site_url: connection.gsc_site_url,
  })
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await req.json()
  const { action } = body

  try {
    if (action === 'sync') {
      const [gbp, gsc] = await Promise.all([
        syncGbpData(id),
        syncGscData(id),
      ])
      return NextResponse.json({ success: true, gbp, gsc })
    }

    if (action === 'disconnect') {
      await deleteGoogleConnection(id)
      return NextResponse.json({ success: true })
    }

    if (action === 'list_accounts') {
      const { fetch: googleFetch } = await getAuthenticatedClient(id)
      const accounts = await listAccounts(googleFetch)
      return NextResponse.json({ accounts })
    }

    if (action === 'list_locations') {
      const { fetch: googleFetch } = await getAuthenticatedClient(id)
      const locations = await listLocations(googleFetch, body.account_id)
      return NextResponse.json({ locations })
    }

    if (action === 'list_properties') {
      const { fetch: googleFetch } = await getAuthenticatedClient(id)
      const properties = await listProperties(googleFetch)
      return NextResponse.json({ properties })
    }

    if (action === 'configure') {
      await upsertGoogleConnection(id, {
        gbp_account_id: body.gbp_account_id || null,
        gbp_location_id: body.gbp_location_id || null,
        gsc_site_url: body.gsc_site_url || null,
      })
      // Initial sync after configuration
      await Promise.all([
        body.gbp_account_id ? syncGbpData(id) : null,
        body.gsc_site_url ? syncGscData(id) : null,
      ])
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur Google API' },
      { status: 500 }
    )
  }
}
