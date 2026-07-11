import { NextResponse } from 'next/server'
import {
  generateEditorialCalendar,
  saveEditorialSlots,
  listEditorialSlots,
  deleteEditorialSlots,
} from '@/lib/scheduler/editorial'
import { getCampaignById } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id') || undefined
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  try {
    const slots = await listEditorialSlots(campaignId, from, to)
    return NextResponse.json({ slots })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { campaign_id, slot_count = 30, start_date } = body

    if (!campaign_id) {
      return NextResponse.json({ error: 'campaign_id requis' }, { status: 400 })
    }

    const campaign = await getCampaignById(campaign_id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    await deleteEditorialSlots(campaign_id)

    const slots = generateEditorialCalendar({
      campaign,
      startDate: start_date ? new Date(start_date) : new Date(),
      slotCount: slot_count,
    })

    const saved = await saveEditorialSlots(slots)
    return NextResponse.json({ slots: saved, count: saved.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur serveur' },
      { status: 500 }
    )
  }
}
