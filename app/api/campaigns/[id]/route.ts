import { NextRequest, NextResponse } from 'next/server'
import { getCampaignByIdSafe } from '@/lib/db'

/**
 * The campaign is serialised as-is, so it is read WITHOUT the site credentials.
 * `getCampaignById()` — the credentialed read used by the run and publish paths
 * — would put `wp_app_password` and `github_token` straight into this body.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const campaign = await getCampaignByIdSafe(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }
    return NextResponse.json({ campaign })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
