// ─────────────────────────────────────────────────────────────────────────────
// L5a — CNX arbitrates the client requests, against the LOCAL Supabase: the
// queue the console reads, the four gestures written only from the status the
// console saw, the reason a declined request shows its client, and an
// « integrate » answered by the requests task — placed in the cycle, or kept
// with the reason why.
//
// Requests and campaigns are the test's own (request-fixtures.db.ts); the
// demonstration rows are never changed.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import { connect } from '../scripts/db-connect.mjs'
import { arbitrate } from '@/lib/keyword-requests/arbitrate'
import { readQueue } from '@/lib/keyword-requests/console'
import { placeRequestedByOperator } from '@/lib/keyword-requests/placement'
import { listRequestsToPlace } from '@/lib/keyword-requests/repository'
import { clientRequestView, type RequestRecord } from '@/src/core/domain/keyword-requests/client-view'
import { MARTIN, cleanUp, placementDeps, request as insertRequest, scenario as buildScenario } from './request-fixtures.db'

const STAMP = Date.now().toString(36)

let db: Client
const campaigns: string[] = []

const scenario = (endsInDays?: number) => buildScenario(db, STAMP, campaigns, endsInDays)
const toReview = (campaign: string, keyword: string) =>
  insertRequest(db, STAMP, campaign, keyword, { status: 'review', reasonCode: 'CITY_OUT_OF_AREA' })

/** As the client space reads it, dates as text — `pg` would hand back Date objects. */
async function row(id: string): Promise<RequestRecord & { decided_by: string | null }> {
  const { rows } = await db.query(
    `select id, keyword, city, note, desired_by::text, status, reason_code, reasons, evidence, scheduled_for::text,
            published_url, published_at::text, decided_at::text, created_at::text, updated_at::text, decided_by
       from public.keyword_requests where id = $1`,
    [id],
  )
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

describe('la file de la console (KW-10)', () => {
  it('a examiner : les seules demandes envoyees a CNX, la plus ancienne d abord, et leur compte', async () => {
    const s = await scenario()
    const first = await toReview(s.campaign, 'premiere a examiner')
    const second = await toReview(s.campaign, 'seconde a examiner')
    await insertRequest(db, STAMP, s.campaign, 'deja reportee')

    const queue = await readQueue({ view: 'review', siteId: MARTIN, page: 1 })
    const mine = queue.items.filter((item) => item.keyword.includes(STAMP)).map((item) => item.id)
    expect(mine).toEqual([first.id, second.id])
    expect(queue.items.every((item) => item.status === 'review')).toBe(true)
    expect(queue.reviewCount).toBeGreaterThanOrEqual(2)

    const all = await readQueue({ view: 'all', siteId: MARTIN, page: 1 })
    expect(all.items.some((item) => item.keyword.startsWith('deja reportee'))).toBe(true)
  })
})

describe('les gestes de CNX, ecrits seulement depuis le statut vu', () => {
  it('reporter : en tete du prochain plan, decide par CNX', async () => {
    const s = await scenario()
    const req = await toReview(s.campaign, 'a reporter')
    expect(await arbitrate({ requestId: req.id, action: 'defer' })).toMatchObject({ kind: 'done', status: 'deferred' })
    expect(await row(req.id)).toMatchObject({ status: 'deferred', reason_code: 'OPERATOR_DEFERRED', decided_by: 'operator' })
  })

  it('refuser : le client lit le motif tel quel, et CNX peut rouvrir', async () => {
    const s = await scenario()
    const req = await toReview(s.campaign, 'a refuser')
    const motif = 'La climatisation n’est pas encore un service de votre site : parlons-en au prochain point.'
    expect(await arbitrate({ requestId: req.id, action: 'decline', reason: motif })).toMatchObject({ kind: 'done', status: 'declined' })
    expect(clientRequestView(await row(req.id)).detail).toEqual({ kind: 'declined', reason: motif })

    expect(await arbitrate({ requestId: req.id, action: 'reopen' })).toMatchObject({ kind: 'done', status: 'review' })
    expect((await row(req.id)).status).toBe('review')
  })

  it('une demande retiree par le client ne se decide plus', async () => {
    const s = await scenario()
    const req = await insertRequest(db, STAMP, s.campaign, 'retiree', { status: 'withdrawn', reasonCode: 'NEXT_PERIOD' })
    expect(await arbitrate({ requestId: req.id, action: 'defer' })).toEqual({ kind: 'problem', problem: 'not_allowed' })
    expect((await row(req.id)).status).toBe('withdrawn')
  })
})

describe('integrer : la tache des demandes repond (KW-4, KW-10)', () => {
  it('une place dans le cycle : la demande y entre, planifiee', async () => {
    const s = await scenario()
    const req = await toReview(s.campaign, 'a integrer')
    expect(await arbitrate({ requestId: req.id, action: 'integrate' })).toMatchObject({ kind: 'done', status: 'deferred', reasonCode: 'OPERATOR_INTEGRATE' })
    expect((await listRequestsToPlace(50)).map((entry) => entry.id)).toContain(req.id)

    const report = await placeRequestedByOperator(placementDeps())
    expect(report.results.find((result) => result.id === req.id)).toMatchObject({ outcome: 'placed' })
    expect(await row(req.id)).toMatchObject({ status: 'scheduled', reason_code: 'PLACED_IN_CYCLE', scheduled_for: s.day('bas') })
  })

  it('pas de place : gardee pour le prochain plan, avec la raison, et plus retentee', async () => {
    const s = await scenario(2)
    const req = await toReview(s.campaign, 'pas de place')
    await arbitrate({ requestId: req.id, action: 'integrate' })

    const stub = placementDeps()
    await placeRequestedByOperator(stub)
    expect(stub.written).toBe(0)
    const stored = await row(req.id)
    expect(stored).toMatchObject({ status: 'deferred', reason_code: 'NO_SLOT_NOW' })
    expect(stored.reasons[0]).toContain('moins de 3 jours')
    expect((await listRequestsToPlace(50)).map((entry) => entry.id)).not.toContain(req.id)
  })
})
