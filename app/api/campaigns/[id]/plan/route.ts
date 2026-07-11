import { NextRequest, NextResponse } from 'next/server'
import { createCyclePlan, getActiveCyclePlan, getCampaignById, getCyclePlanById, getLatestCyclePlan, updateCyclePlan } from '@/lib/db'
import { startCycle } from '@/lib/scheduler/cycle-manager'
import { generatePlanPreview } from '@/lib/scheduler/plan-preview'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const plan = await getActiveCyclePlan(id)
    if (!plan) {
      const latest = await getLatestCyclePlan(id)
      return NextResponse.json({ plan: latest })
    }
    return NextResponse.json({ plan })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json().catch(() => ({}))
    const cycleDays = body.cycle_duration_days || 14

    const campaign = await getCampaignById(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const planItems = await generatePlanPreview({
      campaign,
      cycleDays,
    })

    if (planItems.length === 0) {
      return NextResponse.json({ error: 'Impossible de generer un plan (frequence manuelle?)' }, { status: 422 })
    }

    const totalWords = planItems.reduce((sum, item) => sum + item.estimated_word_count, 0)
    const latest = await getLatestCyclePlan(id)
    const cycleNumber = latest ? latest.cycle_number + 1 : 1

    const plan = await createCyclePlan({
      campaign_id: id,
      cycle_number: cycleNumber,
      status: 'draft',
      cycle_duration_days: cycleDays,
      plan_data: planItems,
      total_pages: planItems.length,
      total_estimated_words: totalWords,
    })

    return NextResponse.json({ plan })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()
    const { action, plan_id, plan_data } = body

    const campaign = await getCampaignById(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    const plan = plan_id
      ? await getCyclePlanById(plan_id)
      : await getActiveCyclePlan(id)

    if (!plan || plan.campaign_id !== id) {
      return NextResponse.json({ error: 'Aucun plan actif' }, { status: 404 })
    }

    if (action === 'confirm') {
      const items = plan_data || plan.plan_data
      await startCycle(campaign, plan.id, items)
      return NextResponse.json({ success: true, message: 'Cycle demarré' })
    }

    if (action === 'reject') {
      await updateCyclePlan(plan.id, { status: 'cancelled' })
      return NextResponse.json({ success: true, message: 'Plan annulé' })
    }

    if (action === 'update' && plan_data) {
      const totalWords = plan_data.reduce((sum: number, item: { estimated_word_count: number }) => sum + item.estimated_word_count, 0)
      await updateCyclePlan(plan.id, {
        plan_data,
        total_pages: plan_data.length,
        total_estimated_words: totalWords,
      })
      return NextResponse.json({ success: true, plan: { ...plan, plan_data } })
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}
