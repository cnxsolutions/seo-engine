import { refreshAccessToken } from './auth'
import { createServiceClient } from '@/lib/supabase'

export interface GoogleConnection {
  id: string
  site_id: string
  google_email: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  scopes: string[]
  gbp_account_id: string | null
  gbp_location_id: string | null
  gsc_site_url: string | null
  created_at: string
  updated_at: string
}

export async function getGoogleConnection(siteId: string): Promise<GoogleConnection | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('google_connections')
    .select('*')
    .eq('site_id', siteId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as GoogleConnection | null
}

export async function upsertGoogleConnection(siteId: string, values: Partial<GoogleConnection>) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('google_connections')
    .upsert({ site_id: siteId, ...values })

  if (error) throw new Error(error.message)
}

export async function deleteGoogleConnection(siteId: string) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('google_connections')
    .delete()
    .eq('site_id', siteId)

  if (error) throw new Error(error.message)
}

export type GoogleFetch = (url: string, options?: RequestInit) => Promise<Response>

export async function getAuthenticatedClient(siteId: string): Promise<{ fetch: GoogleFetch; connection: GoogleConnection }> {
  const connection = await getGoogleConnection(siteId)
  if (!connection) throw new Error('Aucune connexion Google pour ce site')

  let accessToken = connection.access_token
  const expiresAt = new Date(connection.token_expires_at)

  // Refresh if token expires within 5 minutes
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(connection.refresh_token)
    accessToken = refreshed.access_token

    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    await upsertGoogleConnection(siteId, {
      access_token: accessToken,
      token_expires_at: newExpiresAt,
    })
    connection.access_token = accessToken
    connection.token_expires_at = newExpiresAt
  }

  const googleFetch: GoogleFetch = (url, options = {}) => {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    }
    return fetch(url, { ...options, headers })
  }

  return { fetch: googleFetch, connection }
}

export async function listConnectedSiteIds(): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('google_connections')
    .select('site_id')

  if (error) return []
  return (data || []).map((row) => row.site_id)
}
