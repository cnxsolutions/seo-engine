import { NextRequest, NextResponse, after } from 'next/server'
import { publicUrl } from '@/lib/public-origin'
import { exchangeCode, getGoogleUserEmail } from '@/lib/google/auth'
import { upsertGoogleConnection } from '@/lib/google/client'
import { triggerGscSyncOnConnect } from '@/lib/google/sync'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const siteId = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(publicUrl(`/sites?error=${encodeURIComponent(error)}`, req))
  }

  if (!code || !siteId) {
    return NextResponse.redirect(publicUrl('/sites?error=missing_params', req))
  }

  try {
    const tokens = await exchangeCode(code)
    const email = await getGoogleUserEmail(tokens.access_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await upsertGoogleConnection(siteId, {
      google_email: email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt,
      scopes: tokens.scope.split(' '),
    })

    // A reconnection already knows which property to read, so the data can start
    // arriving before the operator has clicked anything. A first connection has
    // no property yet and the sync reports `skipped` — the selection step fires
    // it again.
    //
    // `after()` runs this once the redirect has been sent: the sync can neither
    // delay it nor break it, and — unlike a floating promise — it is awaited by
    // the runtime, so its logs are never truncated by the request ending.
    after(async () => {
      await triggerGscSyncOnConnect(siteId, 'oauth_callback')
    })

    return NextResponse.redirect(publicUrl(`/sites/${siteId}/google/select`, req))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur OAuth'
    return NextResponse.redirect(publicUrl(`/sites?error=${encodeURIComponent(message)}`, req))
  }
}
