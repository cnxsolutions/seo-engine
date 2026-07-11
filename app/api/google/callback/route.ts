import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, getGoogleUserEmail } from '@/lib/google/auth'
import { upsertGoogleConnection } from '@/lib/google/client'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const siteId = req.nextUrl.searchParams.get('state')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/sites?error=${encodeURIComponent(error)}`, req.url))
  }

  if (!code || !siteId) {
    return NextResponse.redirect(new URL('/sites?error=missing_params', req.url))
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

    return NextResponse.redirect(new URL(`/sites/${siteId}/google/select`, req.url))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur OAuth'
    return NextResponse.redirect(new URL(`/sites?error=${encodeURIComponent(message)}`, req.url))
  }
}
