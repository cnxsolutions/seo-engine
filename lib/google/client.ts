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

/**
 * One connection per site, keyed on site_id.
 *
 * Without `onConflict`, PostgREST infers the conflict target from the PRIMARY
 * KEY. Every caller here writes a partial row without `id` — a token refresh
 * carries only `access_token` and `token_expires_at` — so the statement was an
 * INSERT of a brand new row: a second connection for the same site if nothing
 * constrained site_id, an outright error if something did. Either way the site
 * lost its Google access on the first token refresh, which is at most one hour
 * after connecting.
 *
 * Requires the unique index created by migration 010.
 */
/**
 * Create or replace a site's Google connection.
 *
 * For the OAuth callback, which holds a COMPLETE connection. Do not use it to
 * write a subset of the columns: PostgREST's upsert is `INSERT … ON CONFLICT DO
 * UPDATE`, and PostgreSQL validates the insert tuple BEFORE it detects the
 * conflict — so a partial payload fails on `google_email NOT NULL` even when the
 * row already exists and would only have been updated. Use
 * `updateGoogleConnection` for that.
 */
export async function upsertGoogleConnection(siteId: string, values: Partial<GoogleConnection>) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('google_connections')
    .upsert({ site_id: siteId, ...values }, { onConflict: 'site_id' })

  if (error) throw new Error(error.message)
}

/** Patch an EXISTING connection — the token refresh path. Never inserts. */
export async function updateGoogleConnection(siteId: string, values: Partial<GoogleConnection>) {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('google_connections')
    .update(values)
    .eq('site_id', siteId)

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

/**
 * How much life a token must have left before a READ is issued.
 *
 * The value this file has always used, kept to the millisecond: no existing
 * caller — GSC sync, GBP sync, the RAG context builders, the dashboard pages —
 * changes behaviour because the margin became a parameter.
 *
 * Five minutes is enough for a read because a read that dies on an expired token
 * is a read that gets repeated. Nothing was created, nothing is in doubt.
 */
export const TOKEN_MARGIN_READ_MS = 5 * 60 * 1000

/**
 * How much life a token must have left before a NON-IDEMPOTENT WRITE is issued.
 *
 * Double the read margin, and the reason is not caution for its own sake. The
 * token is captured in the `googleFetch` closure below and never re-evaluated:
 * once the client is handed out, an expiry that falls mid-operation cannot be
 * noticed, let alone repaired. On `POST .../localPosts` that produces the single
 * worst outcome available — the request left, the answer is 401, and nothing
 * says whether the post was created before the token died. The row is then
 * `incertain` forever, and a human has to open the listing and look.
 *
 * Refreshing EARLY removes that case rather than handling it. The cost of being
 * early is one extra refresh call against a quota that does not meter them; the
 * cost of being late is a duplicate post on a client's public listing.
 *
 * Ten minutes, not thirty: the margin has to stay well under the token's own
 * hour of life, or every single call would refresh and the stored token would
 * never be used at all.
 */
export const TOKEN_MARGIN_WRITE_MS = 10 * 60 * 1000

/**
 * A fetch already carrying this site's Google credentials.
 *
 * @param opts.minRemainingMs how much validity the access token must still have
 *   for it to be reused. Defaults to `TOKEN_MARGIN_READ_MS`, which is what every
 *   caller written before the GBP connector gets, unchanged. A writer passes
 *   `TOKEN_MARGIN_WRITE_MS`. Made a parameter rather than raised for everyone:
 *   the margin that a non-idempotent write needs is not the margin a read needs,
 *   and one number for both would either refresh far too often or protect the
 *   write far too little.
 */
export async function getAuthenticatedClient(
  siteId: string,
  opts?: { minRemainingMs?: number }
): Promise<{ fetch: GoogleFetch; connection: GoogleConnection }> {
  const connection = await getGoogleConnection(siteId)
  if (!connection) throw new Error('Aucune connexion Google pour ce site')

  let accessToken = connection.access_token
  const expiresAt = new Date(connection.token_expires_at).getTime()

  // An unreadable expiry counts as expired. `new Date('…').getTime()` is NaN, and
  // every comparison against NaN is false — so the stored date going bad used to
  // mean "never refresh" and handed out a token nobody could vouch for. On a
  // write path that is the doubtful 401 this margin exists to prevent.
  // Negative infinity rather than 0, so that even a caller asking for a margin of
  // 0 refreshes: "use it until it dies" needs a death date to be honoured.
  const remainingMs = Number.isNaN(expiresAt) ? Number.NEGATIVE_INFINITY : expiresAt - Date.now()

  // Refresh when less than the requested margin is left. `??` and not `||`: a
  // caller asking for 0 is asking for "use the token until it dies", and `||`
  // would silently hand it the five-minute default instead.
  const minRemainingMs = opts?.minRemainingMs ?? TOKEN_MARGIN_READ_MS
  if (remainingMs < minRemainingMs) {
    const refreshed = await refreshAccessToken(connection.refresh_token)
    accessToken = refreshed.access_token

    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    // UPDATE, not upsert: the connection was loaded above, so it exists, and an
    // upsert of these two columns alone violates google_email NOT NULL.
    await updateGoogleConnection(siteId, {
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
