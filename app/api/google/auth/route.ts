import { NextRequest, NextResponse } from 'next/server'
import { generateAuthUrl } from '@/lib/google/auth'

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get('site_id')
  if (!siteId) {
    return NextResponse.json({ error: 'site_id requis' }, { status: 400 })
  }

  try {
    const authUrl = generateAuthUrl(siteId)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur configuration Google OAuth' },
      { status: 500 }
    )
  }
}
