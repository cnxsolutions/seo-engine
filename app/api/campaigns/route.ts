import { NextRequest, NextResponse } from 'next/server'
import { createCampaign, listCampaigns } from '@/lib/db'
import { normalizeCommunes } from '@/lib/geo/locations'

export async function GET() {
  try {
    const campaigns = await listCampaigns()
    return NextResponse.json({ campaigns })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const required = ['name', 'site_id', 'business_type', 'business_name']

    for (const field of required) {
      if (!payload[field]) {
        return NextResponse.json({ error: `Champ requis manquant: ${field}` }, { status: 400 })
      }
    }

    const communes = normalizeCommunes(payload.communes, payload.department)
    if (communes.length === 0) {
      return NextResponse.json({ error: 'Au moins une commune ou une zone valide est requise.' }, { status: 400 })
    }

    const campaign = await createCampaign({
      site_id: payload.site_id,
      name: payload.name,
      business_type: payload.business_type,
      business_name: payload.business_name,
      keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
      department: payload.department || 'Aube',
      communes,
      frequency_hours: Number(payload.frequency_hours) || 0,
      schedule_frequency: payload.schedule_frequency || 'daily',
      schedule_days: Array.isArray(payload.schedule_days) ? payload.schedule_days : [],
      schedule_time: payload.schedule_time || '09:00',
      ai_model: payload.ai_model || 'claude-haiku',
      page_types: Array.isArray(payload.page_types) ? payload.page_types : ['pillar', 'child'],
      publish_status: payload.publish_status || 'draft',
      auto_publish: Boolean(payload.auto_publish),
      target_length: Number(payload.target_length) || 800,
      enable_external_links: payload.enable_external_links ?? true,
      external_link_count: Number(payload.external_link_count) || 3,
      enable_images: payload.enable_images ?? true,
      image_per_page: Number(payload.image_per_page) || 2,
      system_prompt: payload.system_prompt || null,
      is_active: payload.is_active ?? true,
    })

    return NextResponse.json({ success: true, campaign }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
