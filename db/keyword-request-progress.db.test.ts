// ─────────────────────────────────────────────────────────────────────────────
// L4b — the requests in the engine, against the LOCAL Supabase: the two
// functions of migration 025, a plan that starts (planned, covered, waited,
// set aside), slots replaced by a new cycle, and the production followed from
// the slot and its generation.
//
// Everything runs on a campaign created for the test, under Plomberie Martin:
// the demonstration campaign, its plan, its slots and its requests are read
// by `followProduction` (which sees every planned request) but never changed.
// Every row created here carries STAMP and is deleted in afterAll.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { connect } from '../scripts/db-connect.mjs'
import type { ClientSession } from '@/lib/client-space/session'
import { advanceRequests, listWaitingRequests } from '@/lib/keyword-requests/repository'
import { applyStartedPlan, followProduction, releaseReplacedSlots, WITHDRAWN_BEFORE_START } from '@/lib/keyword-requests/progress'
import { withdrawForMember } from '@/lib/keyword-requests/submit'
import { MAX_DEFERRED_CYCLES } from '@/src/core/domain/keyword-requests/consumption'

const STAMP = Date.now().toString(36)

function seedId(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const MARTIN = seedId('demo-site-martin')
const CLIENT_A = seedId('demo-client-a')
const CAMPAIGN = randomUUID()
const PLAN = randomUUID()

let db: Client
let marie: ClientSession

interface RequestState {
  status: string
  reason_code: string | null
  reasons: string[]
  cycle_plan_id: string | null
  plan_item_id: string | null
  scheduled_for: string | null
  published_url: string | null
  deferred_cycles: number
}

async function request(overrides: Partial<{ status: string; keyword: string; plan_item_id: string; scheduled_for: string; cycle_plan_id: string; deferred_cycles: number; created_at: string }> = {}): Promise<string> {
  const id = randomUUID()
  const keyword = `${overrides.keyword ?? 'demande'} ${STAMP} ${id.slice(0, 6)}`
  await db.query(
    `insert into public.keyword_requests
       (id, client_id, site_id, campaign_id, keyword, keyword_normalized, status, cycle_plan_id, plan_item_id, scheduled_for, deferred_cycles, created_at)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, coalesce($11::timestamptz, now()))`,
    [id, CLIENT_A, MARTIN, CAMPAIGN, keyword, overrides.status ?? 'deferred', overrides.cycle_plan_id ?? null,
      overrides.plan_item_id ?? null, overrides.scheduled_for ?? null, overrides.deferred_cycles ?? 0, overrides.created_at ?? null],
  )
  return id
}

async function slot(itemId: string, status = 'planned', extra: { generation_id?: string; error_message?: string; scheduled_date?: string } = {}): Promise<void> {
  await db.query(
    `insert into public.editorial_calendar (campaign_id, plan_item_id, scheduled_date, page_type, target_keyword, target_city, status, generation_id, error_message, artifact_kind)
     values ($1, $2, coalesce($3::date, current_date + 5), 'child', $4, 'Troyes', $5, $6, $7, 'page')`,
    [CAMPAIGN, itemId, extra.scheduled_date ?? null, `sujet ${STAMP}`, status, extra.generation_id ?? null, extra.error_message ?? null],
  )
}

async function state(id: string): Promise<RequestState> {
  const { rows } = await db.query<RequestState>(
    `select status, reason_code, reasons, cycle_plan_id, plan_item_id, scheduled_for::text, published_url, deferred_cycles
       from public.keyword_requests where id = $1`, [id],
  )
  return rows[0]
}

async function slotStatus(itemId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>('select status from public.editorial_calendar where plan_item_id = $1', [itemId])
  return rows[0]?.status
}

const item = (name: string) => `${name}-${STAMP}`

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
  const { rows } = await db.query<{ id: string; client_id: string; user_id: string }>(
    'select id, client_id, user_id from public.client_members where email = $1', ['marie@martin-batiment.test'],
  )
  if (!rows[0]) throw new Error('membre de demonstration absent — npm run db:local:reset ?')
  marie = { memberId: rows[0].id, clientId: rows[0].client_id, userId: rows[0].user_id, email: 'marie@martin-batiment.test' }

  await db.query(
    `insert into public.campaigns (id, site_id, name, business_type, business_name, keywords, department, communes, is_active, current_cycle_id)
     values ($1, $2, $3, 'plombier', 'Plomberie Martin', array['plombier'], 'Aube', array['Troyes'], false, null)`,
    [CAMPAIGN, MARTIN, `Campagne de test ${STAMP}`],
  )
  await db.query(
    `insert into public.cycle_plans (id, campaign_id, cycle_number, status, cycle_duration_days, plan_data, total_pages, total_estimated_words)
     values ($1, $2, 1, 'executing', 14, '[]'::jsonb, 0, 0)`,
    [PLAN, CAMPAIGN],
  )
})

afterAll(async () => {
  if (!db) return
  await db.query('delete from public.keyword_requests where campaign_id = $1 or keyword like $2', [CAMPAIGN, `%${STAMP}%`])
  await db.query('delete from public.editorial_calendar where campaign_id = $1', [CAMPAIGN])
  await db.query('delete from public.generations where campaign_id = $1', [CAMPAIGN])
  await db.query('delete from public.cycle_plans where id = $1', [PLAN])
  await db.query('delete from public.campaigns where id = $1', [CAMPAIGN])
  await db.end()
})

describe('advance_keyword_requests (025)', () => {
  it('n ecrit que les demandes encore dans le statut attendu', async () => {
    const waiting = await request()
    const withdrawn = await request({ status: 'withdrawn' })
    const written = await advanceRequests([
      { id: waiting, from: 'deferred', status: 'scheduled', plan_item_id: item('a'), scheduled_for: '2026-12-01', cycle_plan_id: PLAN },
      { id: withdrawn, from: 'deferred', status: 'scheduled', plan_item_id: item('b') },
    ])
    expect(written).toEqual([waiting])
    expect(await state(waiting)).toMatchObject({ status: 'scheduled', plan_item_id: item('a'), scheduled_for: '2026-12-01', cycle_plan_id: PLAN })
    expect((await state(withdrawn)).status).toBe('withdrawn')
  })

  it('une cle absente garde sa colonne, une cle a null la vide', async () => {
    const id = await request({ status: 'scheduled', plan_item_id: item('c'), scheduled_for: '2026-12-02', cycle_plan_id: PLAN })
    await advanceRequests([{ id, from: 'scheduled', status: 'in_production' }])
    expect(await state(id)).toMatchObject({ status: 'in_production', plan_item_id: item('c'), scheduled_for: '2026-12-02' })

    const back = await request({ status: 'scheduled', plan_item_id: item('d'), scheduled_for: '2026-12-03', cycle_plan_id: PLAN })
    await advanceRequests([{ id: back, from: 'scheduled', status: 'deferred', plan_item_id: null, scheduled_for: null, cycle_plan_id: null }])
    expect(await state(back)).toMatchObject({ status: 'deferred', plan_item_id: null, scheduled_for: null, cycle_plan_id: null })
  })

  it('un cycle attendu ne se compte qu une fois, meme si le lot est rejoue', async () => {
    const id = await request({ deferred_cycles: 1 })
    const change = { id, from: 'deferred' as const, from_deferred_cycles: 1, status: 'deferred' as const, deferred_cycles: 2 }
    expect(await advanceRequests([change])).toEqual([id])
    expect(await advanceRequests([change])).toEqual([])
    expect((await state(id)).deferred_cycles).toBe(2)
  })

  it('le moteur ne retire, ne refuse ni ne recoit rien seul', async () => {
    const id = await request()
    for (const status of ['withdrawn', 'declined', 'received']) {
      const { rows } = await db.query<{ ids: string[] }>(
        'select public.advance_keyword_requests($1::jsonb) as ids', [JSON.stringify([{ id, from: 'deferred', status }])],
      )
      expect(rows[0].ids).toEqual([])
    }
    expect((await state(id)).status).toBe('deferred')
  })
})

describe('withdraw_keyword_request (025, KW-9)', () => {
  it('retire une demande prevue et ecarte son creneau dans la meme transaction', async () => {
    const itemId = item('retrait')
    await slot(itemId)
    const id = await request({ status: 'scheduled', plan_item_id: itemId, cycle_plan_id: PLAN })
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: id })).toBe('withdrawn')
    expect((await state(id)).status).toBe('withdrawn')
    expect(await slotStatus(itemId)).toBe('skipped')
  })

  it('un creneau deja reclame par le planificateur rend le retrait impossible, sans rien toucher', async () => {
    const itemId = item('reclame')
    await slot(itemId, 'generating')
    const id = await request({ status: 'scheduled', plan_item_id: itemId, cycle_plan_id: PLAN })
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: id })).toBe('locked')
    expect((await state(id)).status).toBe('scheduled')
    expect(await slotStatus(itemId)).toBe('generating')
  })

  it('une demande en attente se retire sans creneau a ecarter', async () => {
    const id = await request()
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: id })).toBe('withdrawn')
  })
})

describe('un plan qui demarre (§ 3.5, KW-11, KW-13)', () => {
  it('prevue, couverte, un cycle de plus ou a CNX — et le creneau d une demande retiree est ecarte', async () => {
    // Ecrit il y a quatre jours : une demande envoyee depuis n'a pas pu y entrer.
    const plannedAt = new Date(Date.now() - 4 * 86_400_000).toISOString()
    const before = new Date(Date.now() - 5 * 86_400_000).toISOString()

    const planned = await request({ created_at: before })
    const guarded = await request({ created_at: before })
    const patient = await request({ created_at: before })
    const tired = await request({ created_at: before, deferred_cycles: MAX_DEFERRED_CYCLES - 1 })
    const late = await request()
    const gone = await request({ status: 'withdrawn', created_at: before })

    await slot(item('prevue'))
    await slot(item('retiree'))

    const result = await applyStartedPlan({
      campaignId: CAMPAIGN,
      planId: PLAN,
      plannedAt,
      items: [
        { id: item('prevue'), scheduled_date: '2026-12-04', client_request_id: planned, action: { kind: 'create' } },
        { id: item('ecartee'), scheduled_date: '2026-12-06', client_request_id: guarded, action: { kind: 'skip', reasons: ['Mot-cle deja porte.'] } },
        { id: item('retiree'), scheduled_date: '2026-12-08', client_request_id: gone, action: { kind: 'create' } },
      ],
    })

    expect(await state(planned)).toMatchObject({ status: 'scheduled', plan_item_id: item('prevue'), scheduled_for: '2026-12-04', cycle_plan_id: PLAN })
    expect(await state(guarded)).toMatchObject({ status: 'covered', reason_code: 'PLAN_GUARD', reasons: ['Mot-cle deja porte.'] })
    expect(await state(patient)).toMatchObject({ status: 'deferred', deferred_cycles: 1 })
    expect(await state(tired)).toMatchObject({ status: 'review', reason_code: 'WAITED_TOO_LONG', deferred_cycles: MAX_DEFERRED_CYCLES })
    expect(await state(late)).toMatchObject({ status: 'deferred', deferred_cycles: 0 })

    // Retiree pendant que le plan etait un brouillon : sa page ne s'ecrit pas.
    expect(await slotStatus(item('retiree'))).toBe('skipped')
    const { rows } = await db.query<{ error_message: string }>('select error_message from public.editorial_calendar where plan_item_id = $1', [item('retiree')])
    expect(rows[0].error_message).toBe(WITHDRAWN_BEFORE_START)
    expect(result.setAside).toBe(1)
  })

  it('la file se lit dans l ordre de consommation : date souhaitee, puis anciennete', async () => {
    const queue = await listWaitingRequests(CAMPAIGN)
    const created = queue.map((entry) => entry.created_at)
    expect(created).toEqual([...created].sort())
  })

  it('un nouveau cycle rend a la file les demandes de creneaux jamais produits', async () => {
    const itemId = item('remplace')
    await slot(itemId)
    const id = await request({ status: 'scheduled', plan_item_id: itemId, scheduled_for: '2026-12-10', cycle_plan_id: PLAN })
    expect(await releaseReplacedSlots(CAMPAIGN)).toBeGreaterThanOrEqual(1)
    expect(await state(id)).toMatchObject({ status: 'deferred', reason_code: 'NEXT_PERIOD', plan_item_id: null, scheduled_for: null })
  })
})

describe('la production suivie (KW-8, § 3.6)', () => {
  it('en redaction, en ligne avec son adresse, ou a CNX — et les demandes de la demonstration ne bougent pas', async () => {
    const generationId = randomUUID()
    await db.query(
      `insert into public.generations (id, campaign_id, site_id, city, slug, title, status, published_url, published_at)
       values ($1, $2, $3, 'Troyes', $4, 'Page de test', 'published', $5, now())`,
      [generationId, CAMPAIGN, MARTIN, `page-${STAMP}`, `https://plomberie-martin.test/page-${STAMP}`],
    )
    await slot(item('ecrit'), 'generating')
    await slot(item('publie'), 'published', { generation_id: generationId })
    await slot(item('rejete'), 'failed', { error_message: 'Rejete par le pipeline : doublon.' })
    await slot(item('deplace'), 'planned', { scheduled_date: '2026-12-20' })

    const writing = await request({ status: 'scheduled', plan_item_id: item('ecrit'), cycle_plan_id: PLAN })
    const online = await request({ status: 'in_production', plan_item_id: item('publie'), cycle_plan_id: PLAN })
    const stopped = await request({ status: 'in_production', plan_item_id: item('rejete'), cycle_plan_id: PLAN })
    const moved = await request({ status: 'scheduled', plan_item_id: item('deplace'), scheduled_for: '2026-12-12', cycle_plan_id: PLAN })

    const demo = await db.query('select id, status, scheduled_for::text from public.keyword_requests where site_id = $1 and keyword not like $2 order by id', [MARTIN, `%${STAMP}%`])

    await followProduction()

    expect((await state(writing)).status).toBe('in_production')
    expect(await state(online)).toMatchObject({ status: 'published', published_url: `https://plomberie-martin.test/page-${STAMP}` })
    expect(await state(stopped)).toMatchObject({ status: 'review', reason_code: 'PRODUCTION_STOPPED', reasons: ['Rejete par le pipeline : doublon.'] })
    expect(await state(moved)).toMatchObject({ status: 'scheduled', scheduled_for: '2026-12-20' })

    const after = await db.query('select id, status, scheduled_for::text from public.keyword_requests where site_id = $1 and keyword not like $2 order by id', [MARTIN, `%${STAMP}%`])
    expect(after.rows).toEqual(demo.rows)
  })
})

describe('la base (migration 025)', () => {
  it('les deux fonctions sont refusees a la cle publique', async () => {
    const calls: Array<[string, unknown]> = [
      ['advance_keyword_requests', { p_changes: [] }],
      ['withdraw_keyword_request', { p_site_id: MARTIN, p_request_id: randomUUID() }],
    ]
    for (const [fn, body] of calls) {
      const response = await fetch(`${inject('supabaseApiUrl')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: inject('supabaseAnonKey'), Authorization: `Bearer ${inject('supabaseAnonKey')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.ok).toBe(false)
    }
  })
})
