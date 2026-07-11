import { NextRequest, NextResponse } from 'next/server'
import { createCampaign, createCyclePlan, getAnalysisRunById, getCampaignById, getLatestCyclePlan } from '@/lib/db'
import { normalizeCommunes } from '@/lib/geo/locations'
import { generateBriefPlan } from '@/lib/planning/brief-plan'

const FREQUENCY_TO_HOURS: Record<string, number> = {
  manual: 0,
  daily: 24,
  every_2_days: 48,
  every_3_days: 72,
  weekly: 168,
  biweekly: 336,
  monthly: 720,
  custom: 0,
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const analysisRun = await getAnalysisRunById(id)

    if (!analysisRun) {
      return NextResponse.json({ error: 'Analyse introuvable' }, { status: 404 })
    }

    const campaign = body.campaign_id
      ? await getCampaignById(body.campaign_id)
      : await createCampaignFromAnalysis(body, analysisRun)

    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const cycleDays = Number(body.cycle_duration_days) || 14
    const planItems = await generateBriefPlan({
      campaign,
      cycleDays,
      analysisRun,
    })

    if (planItems.length === 0) {
      return NextResponse.json({ error: 'Impossible de generer un plan avec cette frequence.' }, { status: 422 })
    }

    const latest = await getLatestCyclePlan(campaign.id)
    const totalWords = planItems.reduce((sum, item) => sum + item.estimated_word_count, 0)
    const plan = await createCyclePlan({
      campaign_id: campaign.id,
      cycle_number: latest ? latest.cycle_number + 1 : 1,
      status: 'draft',
      cycle_duration_days: cycleDays,
      plan_data: planItems,
      total_pages: planItems.length,
      total_estimated_words: totalWords,
      crawl_completed_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true, campaign, plan })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur generation plan' },
      { status: 500 }
    )
  }
}

async function createCampaignFromAnalysis(body: Record<string, unknown>, analysisRun: Awaited<ReturnType<typeof getAnalysisRunById>>) {
  if (!analysisRun) return null
  const siteId = String(body.site_id || analysisRun.site_id || '')
  if (!siteId) throw new Error('site_id requis pour creer la campagne')

  const department = String(body.department || 'Aube')
  const communes = normalizeCommunes(splitList(body.communes).length ? splitList(body.communes) : analysisRun.input.targetCities, department)
  if (communes.length === 0) throw new Error('Au moins une commune ou zone valide est requise.')

  const scheduleFrequency = String(body.schedule_frequency || 'every_2_days')
  const keywords = splitList(body.keywords).length
    ? splitList(body.keywords)
    : analysisRun.analysis_data.gapAnalysis.missingKeywords.slice(0, 5)

  return createCampaign({
    site_id: siteId,
    name: String(body.name || `SEO ${body.business_type || analysisRun.input.businessType || 'Campagne'}`),
    business_type: String(body.business_type || analysisRun.input.businessType || 'service'),
    business_name: String(body.business_name || analysisRun.input.businessName || 'Business'),
    keywords,
    department,
    communes,
    frequency_hours: Number(body.frequency_hours) || FREQUENCY_TO_HOURS[scheduleFrequency] || 0,
    schedule_frequency: scheduleFrequency as 'manual' | 'daily' | 'every_2_days' | 'every_3_days' | 'weekly' | 'biweekly' | 'monthly' | 'custom',
    schedule_days: Array.isArray(body.schedule_days) ? body.schedule_days as number[] : [],
    schedule_time: String(body.schedule_time || '09:00'),
    ai_model: String(body.ai_model || 'gpt-4o-mini'),
    page_types: Array.isArray(body.page_types) ? body.page_types as ['pillar', 'child'] : ['pillar', 'child', 'local_pack'],
    publish_status: (body.publish_status as 'publish' | 'draft' | 'pending') || 'draft',
    auto_publish: Boolean(body.auto_publish),
    target_length: Number(body.target_length) || 800,
    enable_external_links: body.enable_external_links !== false,
    external_link_count: Number(body.external_link_count) || 3,
    enable_images: body.enable_images !== false,
    image_per_page: Number(body.image_per_page) || 2,
    system_prompt: undefined,
    is_active: true,
    cycle_duration_days: Number(body.cycle_duration_days) || 14,
    current_cycle_id: undefined,
    cycle_auto_renew: true,
    last_crawl_at: new Date().toISOString(),
  })
}

function splitList(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean)
  return String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}
