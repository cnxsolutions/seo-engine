// ─────────────────────────────────────────────────────────────────────────────
// L4c — a receivable request placed in the cycle in progress, against the LOCAL
// Supabase: swap_plan_item (026) and the placement service around it — which
// slot, the quota, the planner's guards, and the three writers that may cross
// it (the scheduler claiming a slot, the client withdrawing, the cycle ending).
//
// Each case builds its own campaign under Plomberie Martin, with a running plan
// of six pages and their slots; the demonstration rows are never touched. The
// brief is written by the real normalizeBriefs against the real knowledge of
// the site — only the model is stood in for. Everything carries STAMP and is
// deleted in afterAll.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { connect } from '../scripts/db-connect.mjs'
import { placeInCurrentCycle } from '@/lib/keyword-requests/placement'
import { swapPlanItem } from '@/lib/keyword-requests/repository'
import type { PlanItemBrief } from '@/lib/types'
import { MARTIN, PAGES, cleanUp, placementDeps as deps, request as insertRequest, scenario as buildScenario } from './request-fixtures.db'

const STAMP = Date.now().toString(36)

let db: Client
const campaigns: string[] = []

const scenario = (endsInDays?: number) => buildScenario(db, STAMP, campaigns, endsInDays)
const request = (campaign: string, keyword: string, desiredBy: string | null = null) => insertRequest(db, STAMP, campaign, keyword, { desiredBy })

async function requestRow(id: string) {
  const { rows } = await db.query('select status, reason_code, cycle_plan_id, plan_item_id, scheduled_for::text from public.keyword_requests where id = $1', [id])
  return rows[0]
}

async function planItems(plan: string): Promise<PlanItemBrief[]> {
  const { rows } = await db.query<{ plan_data: PlanItemBrief[] }>('select plan_data from public.cycle_plans where id = $1', [plan])
  return rows[0].plan_data
}

async function slotOf(campaign: string, scheduledDate: string) {
  const { rows } = await db.query('select plan_item_id, target_keyword, status from public.editorial_calendar where campaign_id = $1 and scheduled_date = $2::date', [campaign, scheduledDate])
  return rows[0]
}

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
})

afterAll(async () => {
  if (!db) return
  await cleanUp(db, STAMP, campaigns)
  await db.end()
})

describe('une demande integree au cycle en cours (KW-4)', () => {
  it('remplace la page prevue de plus basse priorite : plan, creneau et demande ensemble, volume inchange', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'detartrage chauffe-eau')
    const report = await placeInCurrentCycle([req], deps())

    expect(report).toMatchObject({ placed: 1, covered: 0, kept: 0 })
    const items = await planItems(s.plan)
    expect(items).toHaveLength(6)
    const placed = items.find((item) => item.client_request_id === req.id) as PlanItemBrief
    expect(placed).toMatchObject({ scheduled_date: s.day('bas'), page_type: 'child', target_keyword: req.keyword })
    expect(items.some((item) => item.id === s.item('bas'))).toBe(false)

    expect(await slotOf(s.campaign, s.day('bas'))).toMatchObject({ plan_item_id: placed.id, target_keyword: req.keyword, status: 'planned' })
    expect(await requestRow(req.id)).toMatchObject({
      status: 'scheduled', reason_code: 'PLACED_IN_CYCLE', cycle_plan_id: s.plan, plan_item_id: placed.id, scheduled_for: s.day('bas'),
    })
  })

  it('avec une date souhaitee : le dernier creneau remplacable avant elle, jamais le pilier ni un creneau trop proche', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'adoucisseur', s.day('moyen'))
    await placeInCurrentCycle([req], deps())
    expect(await requestRow(req.id)).toMatchObject({ status: 'scheduled', scheduled_for: s.day('moyen') })
    expect((await slotOf(s.campaign, s.day('pilier'))).plan_item_id).toBe(s.item('pilier'))
    expect((await slotOf(s.campaign, s.day('proche'))).plan_item_id).toBe(s.item('proche'))
  })

  it('un tiers du cycle au plus : la troisieme demande attend la periode suivante, sans brief paye', async () => {
    const s = await scenario()
    const first = await request(s.campaign, 'premiere')
    const second = await request(s.campaign, 'deuxieme')
    const third = await request(s.campaign, 'troisieme')
    const stub = deps()
    expect(await placeInCurrentCycle([first, second, third], stub)).toMatchObject({ placed: 2, covered: 0, kept: 1 })
    expect(stub.written).toBe(2)
    expect(await requestRow(third.id)).toMatchObject({ status: 'deferred', reason_code: 'NEXT_PERIOD', plan_item_id: null })
  })

  it('un brief qui reprend le mot-cle d une page du cycle tombe aux gardes : couverte, plan intact', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'robinet')
    const before = await planItems(s.plan)
    expect(await placeInCurrentCycle([req], deps({ target_keyword: PAGES.moyen[3] }))).toMatchObject({ placed: 0, covered: 1, kept: 0 })
    expect(await requestRow(req.id)).toMatchObject({ status: 'covered', reason_code: 'PLAN_GUARD' })
    expect(await planItems(s.plan)).toEqual(before)
  })

  it('un cycle qui finit dans moins de 3 jours ne prend plus de demande, et rien n est paye', async () => {
    const s = await scenario(2)
    const req = await request(s.campaign, 'fin de cycle')
    const stub = deps()
    expect(await placeInCurrentCycle([req], stub)).toMatchObject({ placed: 0, covered: 0, kept: 1 })
    expect(stub.written).toBe(0)
  })
})

describe('les ecrivains qui croisent l integration (026)', () => {
  it('le planificateur reclame le creneau pendant la redaction du brief : le suivant le prend', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'course au creneau')
    const claim = async () => {
      await db.query("update public.editorial_calendar set status = 'generating' where plan_item_id = $1", [s.item('bas')])
    }
    expect(await placeInCurrentCycle([req], deps({}, claim))).toMatchObject({ placed: 1, covered: 0, kept: 0 })
    // Le creneau reclame garde sa page ; la demande prend le suivant, par priorite puis par date.
    expect(await slotOf(s.campaign, s.day('bas'))).toMatchObject({ plan_item_id: s.item('bas'), status: 'generating' })
    expect(await requestRow(req.id)).toMatchObject({ status: 'scheduled', scheduled_for: s.day('moyen') })
  })

  it('le client retire sa demande pendant la redaction : aucun creneau n est pris', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'retiree en route')
    const before = await planItems(s.plan)
    const withdraw = async () => {
      await db.query("select public.withdraw_keyword_request($1, $2)", [MARTIN, req.id])
    }
    expect(await placeInCurrentCycle([req], deps({}, withdraw))).toMatchObject({ placed: 0, covered: 0, kept: 1 })
    expect((await requestRow(req.id)).status).toBe('withdrawn')
    expect(await planItems(s.plan)).toEqual(before)
  })

  it('la fonction elle-meme refuse le pilier, un item vise par une demande, un plan qui ne tourne plus', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'garde sql')
    const { rows: [pillarSlot] } = await db.query('select id from public.editorial_calendar where plan_item_id = $1', [s.item('pilier')])
    const brief = { id: randomUUID(), client_request_id: req.id, target_keyword: req.keyword, target_city: 'Troyes', page_type: 'child' } as PlanItemBrief
    const swap = (slotId: string, oldItemId: string) => swapPlanItem({ planId: s.plan, slotId, oldItemId, newItem: brief, requestId: req.id, reasons: [] })

    expect(await swap(pillarSlot.id, s.item('pilier'))).toBe('slot_taken')

    const { rows: [hautSlot] } = await db.query('select id from public.editorial_calendar where plan_item_id = $1', [s.item('haut')])
    const other = await request(s.campaign, 'deja prevue')
    await db.query("update public.keyword_requests set status = 'scheduled', plan_item_id = $1 where id = $2", [s.item('haut'), other.id])
    expect(await swap(hautSlot.id, s.item('haut'))).toBe('slot_taken')

    await db.query("update public.cycle_plans set status = 'completed' where id = $1", [s.plan])
    const { rows: [tardSlot] } = await db.query('select id from public.editorial_calendar where plan_item_id = $1', [s.item('tard')])
    expect(await swap(tardSlot.id, s.item('tard'))).toBe('plan_gone')
    expect((await requestRow(req.id)).status).toBe('deferred')
  })

  it('est refusee a la cle publique', async () => {
    const response = await fetch(`${inject('supabaseApiUrl')}/rest/v1/rpc/swap_plan_item`, {
      method: 'POST',
      headers: { apikey: inject('supabaseAnonKey'), Authorization: `Bearer ${inject('supabaseAnonKey')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_plan_id: randomUUID(), p_slot_id: randomUUID(), p_old_item_id: 'x', p_new_item: {}, p_request_id: randomUUID(), p_reasons: [] }),
    })
    expect(response.ok).toBe(false)
  })
})
