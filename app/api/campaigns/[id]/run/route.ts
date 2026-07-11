import { NextRequest, NextResponse } from 'next/server'
import { getCampaignById } from '@/lib/db'
import { runCampaignNow } from '@/lib/scheduler/cron'

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const campaign = await getCampaignById(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const result = await runCampaignNow(campaign)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
