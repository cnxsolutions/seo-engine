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
import { createHash, randomUUID } from 'node:crypto'
import { connect } from '../scripts/db-connect.mjs'
import { getCampaignByIdSafe } from '@/lib/db'
import { loadPlanningKnowledge, normalizeBriefs } from '@/lib/planning/brief-plan'
import { placeInCurrentCycle, type PlacementDeps } from '@/lib/keyword-requests/placement'
import { swapPlanItem } from '@/lib/keyword-requests/repository'
import type { Campaign, PlanItemBrief } from '@/lib/types'

const STAMP = Date.now().toString(36)

function seedId(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const MARTIN = seedId('demo-site-martin')
const CLIENT_A = seedId('demo-client-a')

let db: Client
const campaigns: string[] = []

/** name → [days from today, page type, priority, keyword] */
const PAGES: Record<string, [number, string, string, string]> = {
  pilier: [3, 'pillar', 'high', 'plombier troyes guide complet'],
  bas: [4, 'child', 'low', 'entretien chaudiere troyes'],
  moyen: [5, 'child', 'medium', 'robinet qui fuit troyes'],
  haut: [6, 'child', 'high', 'plombier urgence nuit troyes'],
  proche: [1, 'child', 'low', 'wc bouche troyes'],
  tard: [8, 'child', 'medium', 'remplacement ballon eau chaude troyes'],
}

interface Scenario {
  campaign: string
  plan: string
  item(name: string): string
  day(name: string): string
}

async function scenario(endsInDays = 12): Promise<Scenario> {
  const campaign = randomUUID()
  const plan = randomUUID()
  campaigns.push(campaign)
  const { rows: [{ today }] } = await db.query<{ today: string }>("select to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as today")
  const day = (name: string) => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + PAGES[name][0])
    return date.toISOString().slice(0, 10)
  }
  const items = Object.entries(PAGES).map(([name, [, pageType, priority, keyword]]) => ({
    id: `${plan}-${name}`,
    scheduled_date: day(name),
    page_type: pageType,
    priority,
    target_city: 'Troyes',
    target_keyword: keyword,
    secondary_keywords: [],
    search_intent: 'transactionnelle',
    proposed_title: keyword,
    proposed_slug: `${keyword.replace(/ /g, '-')}-${STAMP}`,
    page_goal: 'Test.',
    outline: [],
    seo_rules: [],
    required_entities: [],
    internal_link_targets: [],
    competitor_insights: [],
    estimated_word_count: 900,
    rationale: 'Test.',
    action: { kind: 'create', slug: { status: 'free' } },
  }))

  await db.query(
    `insert into public.campaigns (id, site_id, name, business_type, business_name, keywords, department, communes, page_types, is_active)
     values ($1, $2, $3, 'plombier', 'Plomberie Martin', array['plombier'], 'Aube', array['Troyes'], array['pillar', 'child'], false)`,
    [campaign, MARTIN, `Placement ${STAMP}`],
  )
  await db.query(
    `insert into public.cycle_plans (id, campaign_id, cycle_number, status, cycle_duration_days, cycle_started_at, cycle_ends_at, plan_data, total_pages, total_estimated_words)
     values ($1, $2, 1, 'executing', 14, now() - interval '1 day', now() + make_interval(days => $3), $4::jsonb, 6, 5400)`,
    [plan, campaign, endsInDays, JSON.stringify(items)],
  )
  await db.query('update public.campaigns set current_cycle_id = $1 where id = $2', [plan, campaign])
  for (const item of items) {
    await db.query(
      `insert into public.editorial_calendar (campaign_id, plan_item_id, scheduled_date, page_type, target_keyword, target_city, status, artifact_kind)
       values ($1, $2, $3::date, $4, $5, 'Troyes', 'planned', 'page')`,
      [campaign, item.id, item.scheduled_date, item.page_type, item.target_keyword],
    )
  }
  return { campaign, plan, item: (name) => `${plan}-${name}`, day }
}

async function request(campaign: string, keyword: string, desiredBy: string | null = null): Promise<{ id: string; campaign_id: string; keyword: string; city: null; desired_by: string | null }> {
  const id = randomUUID()
  const text = `${keyword} ${STAMP}`
  await db.query(
    `insert into public.keyword_requests (id, client_id, site_id, campaign_id, keyword, keyword_normalized, status, reason_code, desired_by)
     values ($1, $2, $3, $4, $5, $5, 'deferred', 'NEXT_PERIOD', $6)`,
    [id, CLIENT_A, MARTIN, campaign, text, desiredBy],
  )
  return { id, campaign_id: campaign, keyword: text, city: null, desired_by: desiredBy }
}

/** The real planner guards, the model stood in for by `raw` (what it would have answered). */
function deps(raw: Partial<PlanItemBrief> = {}, during?: () => Promise<void>): PlacementDeps & { written: number } {
  const stub = {
    written: 0,
    loadCampaign: (id: string) => getCampaignByIdSafe(id) as Promise<Campaign | null>,
    loadKnowledge: (campaign: Campaign) => loadPlanningKnowledge({ campaign, gscSignals: null, serpEvidence: [], searchSuggestions: [], clientRequests: [] }),
    async writeBrief(knowledge: Parameters<PlacementDeps['writeBrief']>[0], subject: Parameters<PlacementDeps['writeBrief']>[1]) {
      stub.written++
      await during?.()
      return normalizeBriefs({
        subjects: [subject],
        rawItems: [raw],
        campaign: knowledge.campaign,
        takenPaths: knowledge.takenPaths,
        inventory: knowledge.inventory,
        signals: knowledge.signals,
        existingKeywords: knowledge.existingKeywords,
      })[0]
    },
    now: () => new Date(),
  }
  return stub
}

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
  await db.query('delete from public.keyword_requests where campaign_id = any($1::uuid[]) or keyword like $2', [campaigns, `%${STAMP}%`])
  await db.query('update public.campaigns set current_cycle_id = null where id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.editorial_calendar where campaign_id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.cycle_plans where campaign_id = any($1::uuid[])', [campaigns])
  await db.query('delete from public.campaigns where id = any($1::uuid[])', [campaigns])
  await db.end()
})

describe('une demande integree au cycle en cours (KW-4)', () => {
  it('remplace la page prevue de plus basse priorite : plan, creneau et demande ensemble, volume inchange', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'detartrage chauffe-eau')
    const report = await placeInCurrentCycle([req], deps())

    expect(report).toEqual({ placed: 1, covered: 0, kept: 0 })
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
    expect(await placeInCurrentCycle([first, second, third], stub)).toEqual({ placed: 2, covered: 0, kept: 1 })
    expect(stub.written).toBe(2)
    expect(await requestRow(third.id)).toMatchObject({ status: 'deferred', reason_code: 'NEXT_PERIOD', plan_item_id: null })
  })

  it('un brief qui reprend le mot-cle d une page du cycle tombe aux gardes : couverte, plan intact', async () => {
    const s = await scenario()
    const req = await request(s.campaign, 'robinet')
    const before = await planItems(s.plan)
    expect(await placeInCurrentCycle([req], deps({ target_keyword: PAGES.moyen[3] }))).toEqual({ placed: 0, covered: 1, kept: 0 })
    expect(await requestRow(req.id)).toMatchObject({ status: 'covered', reason_code: 'PLAN_GUARD' })
    expect(await planItems(s.plan)).toEqual(before)
  })

  it('un cycle qui finit dans moins de 3 jours ne prend plus de demande, et rien n est paye', async () => {
    const s = await scenario(2)
    const req = await request(s.campaign, 'fin de cycle')
    const stub = deps()
    expect(await placeInCurrentCycle([req], stub)).toEqual({ placed: 0, covered: 0, kept: 1 })
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
    expect(await placeInCurrentCycle([req], deps({}, claim))).toEqual({ placed: 1, covered: 0, kept: 0 })
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
    expect(await placeInCurrentCycle([req], deps({}, withdraw))).toEqual({ placed: 0, covered: 0, kept: 1 })
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
