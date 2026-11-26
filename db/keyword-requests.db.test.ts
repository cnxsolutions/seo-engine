// ─────────────────────────────────────────────────────────────────────────────
// L3 — keyword requests, against the LOCAL Supabase and its demonstration
// data (db/seed-local.sql): submission (ceiling, duplicates), isolation of
// both /api/espace routes' use cases, withdrawal, the analysis end to end with
// a stand-in for the model, and the two functions of migration 024.
//
// Every request created here carries STAMP and is deleted in afterAll; the
// demonstration rows are read, never changed.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { createHash } from 'node:crypto'
import { connect } from '../scripts/db-connect.mjs'
import { findClientSite } from '@/lib/client-space/repository'
import { toClientSiteDto } from '@/lib/client-space/dto'
import { readSiteRequests } from '@/lib/client-space/requests'
import type { ClientSession } from '@/lib/client-space/session'
import { analyzeReceivedRequests, defaultAnalysisPorts } from '@/lib/keyword-requests/analyze'
import type { FitInput } from '@/lib/keyword-requests/fit'
import { applyVerdicts, listReceivedRequests, submitRequests } from '@/lib/keyword-requests/repository'
import { submitForMember, withdrawForMember } from '@/lib/keyword-requests/submit'
import { OPEN_STATUSES } from '@/src/core/domain/keyword-requests/lifecycle'
import { normalizedRequest } from '@/src/core/domain/keyword-requests/normalize'

const STAMP = Date.now().toString(36)

function seedId(seed: string): string {
  const hex = createHash('md5').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const MARTIN = seedId('demo-site-martin')
const DURAND = seedId('demo-site-durand')

let db: Client
let marie: ClientSession
let luc: ClientSession
const created = new Set<string>()

async function sessionOf(email: string): Promise<ClientSession> {
  const { rows } = await db.query<{ id: string; client_id: string; user_id: string }>(
    'select id, client_id, user_id from public.client_members where email = $1', [email],
  )
  if (!rows[0]) throw new Error(`membre de demonstration absent : ${email} — npm run db:local:reset ?`)
  return { memberId: rows[0].id, clientId: rows[0].client_id, userId: rows[0].user_id, email }
}

/** Submits as Marie on Plomberie Martin and records what it created, for afterAll. */
async function submit(keywords: string, extra: { city?: string; note?: string; desiredBy?: string } = {}) {
  const result = await submitForMember({ session: marie, siteId: MARTIN, body: { keywords, ...extra } })
  if (result.kind === 'done') for (const outcome of result.outcomes) if (outcome.outcome === 'created') created.add(outcome.id)
  return result
}

async function statusOf(id: string): Promise<{ status: string; reason_code: string | null; scheduled_for: string | null; evidence: unknown }> {
  const { rows } = await db.query('select status, reason_code, scheduled_for::text, evidence from public.keyword_requests where id = $1', [id])
  return rows[0]
}

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
  marie = await sessionOf('marie@martin-batiment.test')
  luc = await sessionOf('luc@electricite-durand.test')
})

afterAll(async () => {
  if (!db) return
  await db.query('delete from public.keyword_requests where id = any($1::uuid[]) or keyword like $2', [[...created], `%${STAMP}%`])
  await db.end()
})

describe('demandes — envoi (KW-1, KW-2)', () => {
  it('cree une demande par mot-cle, recue, rattachee au membre et au client', async () => {
    const result = await submit(`ramonage ${STAMP}\nentretien chaudière ${STAMP}`, { city: 'Troyes', note: 'Saison de chauffe.' })
    expect(result.kind).toBe('done')
    if (result.kind !== 'done') return
    expect(result.outcomes.map((outcome) => outcome.outcome)).toEqual(['created', 'created'])

    const { rows } = await db.query(
      'select status, client_id, submitted_by, city, note, keyword_normalized from public.keyword_requests where id = any($1::uuid[]) order by keyword',
      [result.outcomes.map((outcome) => (outcome.outcome === 'created' ? outcome.id : ''))],
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'received', client_id: marie.clientId, submitted_by: marie.memberId, city: 'Troyes', note: 'Saison de chauffe.' })
    }
    expect(rows.map((row) => row.keyword_normalized)).toContain(`ramonage ${STAMP} troyes`)
  })

  it('la meme recherche, encore ouverte, est rattachee a la premiere (regle 2)', async () => {
    const result = await submit(`Ramonage ${STAMP}`, { city: 'troyes' })
    expect(result).toMatchObject({ kind: 'done', outcomes: [{ outcome: 'duplicate', created_at: expect.any(String) }] })
  })

  it('un format invalide est refuse a la saisie, et rien n est stocke (regle 1)', async () => {
    const result = await submit(`https://concurrent-${STAMP}.test`)
    expect(result).toEqual({ kind: 'invalid', problems: [{ field: 'keywords', code: 'url', line: 1, text: `https://concurrent-${STAMP}.test` }] })
    const { rows } = await db.query('select count(*)::int as n from public.keyword_requests where keyword like $1', [`%concurrent-${STAMP}%`])
    expect(rows[0].n).toBe(0)
  })

  it('le plafond de demandes ouvertes du site est tenu en base', async () => {
    const { rows } = await db.query(`select count(*)::int as n from public.keyword_requests where site_id = $1 and status = any($2)`, [MARTIN, [...OPEN_STATUSES]])
    const outcomes = await submitRequests({
      clientId: marie.clientId, siteId: MARTIN, memberId: marie.memberId,
      items: [{ keyword: `plafond ${STAMP}`, normalized: `plafond ${STAMP}` }],
      city: null, note: null, desiredBy: null, openMax: rows[0].n,
    })
    expect(outcomes).toEqual([{ keyword: `plafond ${STAMP}`, outcome: 'full' }])
  })

  it('la fonction refuse un site qui n est pas celui du client', async () => {
    await expect(submitRequests({
      clientId: luc.clientId, siteId: MARTIN, memberId: luc.memberId,
      items: [{ keyword: `intrus ${STAMP}`, normalized: `intrus ${STAMP}` }],
      city: null, note: null, desiredBy: null, openMax: 30,
    })).rejects.toThrow(/hors du client/)
  })
})

describe('demandes — cloisonnement (QA-2)', () => {
  it('un membre ne propose rien sur le site d un autre client : introuvable', async () => {
    expect(await submitForMember({ session: luc, siteId: MARTIN, body: { keywords: `intrus ${STAMP}` } })).toEqual({ kind: 'not_found' })
  })

  it('un membre ne retire pas la demande d un autre client, ni par son site ni par le sien', async () => {
    const victim = seedId('demo-request-deferred')
    expect(await withdrawForMember({ session: luc, siteId: MARTIN, requestId: victim })).toBe('not_found')
    expect(await withdrawForMember({ session: luc, siteId: DURAND, requestId: victim })).toBe('not_found')
    expect((await statusOf(victim)).status).toBe('deferred')
  })

  it('ce que lit le client ne porte ni les motifs de CNX ni les preuves brutes', async () => {
    const site = toClientSiteDto((await findClientSite(marie.clientId, MARTIN))!)
    const { requests, total } = await readSiteRequests(site, { offset: 0, limit: 50 })
    expect(total).toBeGreaterThanOrEqual(9)
    const serialized = JSON.stringify(requests)
    expect(serialized).not.toContain('Deja visee par un brief')
    expect(serialized).not.toContain('Search Console')
    for (const request of requests) {
      expect(Object.keys(request).sort()).toEqual(['canWithdraw', 'city', 'desiredBy', 'detail', 'id', 'keyword', 'note', 'state', 'timeline'])
    }
    // Neuf statuts dans la demonstration, chacun lu dans les mots du client.
    expect(new Set(requests.map((request) => request.state))).toEqual(
      new Set(['analysing', 'review', 'deferred', 'scheduled', 'in_production', 'published', 'covered', 'declined', 'withdrawn']),
    )
  })
})

describe('demandes — retrait (KW-9)', () => {
  it('le client retire sa demande tant qu elle n est pas en redaction', async () => {
    const result = await submit(`vidange ${STAMP}`)
    if (result.kind !== 'done' || result.outcomes[0].outcome !== 'created') throw new Error('envoi attendu')
    const id = result.outcomes[0].id
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: id })).toBe('withdrawn')
    expect((await statusOf(id)).status).toBe('withdrawn')
    // Retiree, elle libere sa recherche : la proposer de nouveau cree une demande.
    expect(await submit(`vidange ${STAMP}`)).toMatchObject({ kind: 'done', outcomes: [{ outcome: 'created' }] })
  })

  it('une demande en redaction ne se retire plus', async () => {
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: seedId('demo-request-in-production') })).toBe('locked')
  })

  it('un identifiant invente est introuvable, pas une erreur', async () => {
    expect(await withdrawForMember({ session: marie, siteId: MARTIN, requestId: 'pas-un-id' })).toBe('not_found')
  })
})

describe('demandes — analyse (KW-3, KW-5 a KW-7)', () => {
  it('rend chaque verdict contre la vraie base : prevue, gagnee, couverte, hors zone, a CNX, gardee', async () => {
    const result = await submit(
      [`plombier`, `plombier troyes`, `plomberie martin`, `adoucisseur ${STAMP}`, `coiffure ${STAMP}`].join('\n'),
      { city: '' },
    )
    const zone = await submit('plombier', { city: 'Romilly-sur-Seine' })
    const planned = await submit('plombier', { city: 'Saint-André-les-Vergers' })
    if (result.kind !== 'done' || zone.kind !== 'done' || planned.kind !== 'done') throw new Error('envois attendus')

    const ids = new Map<string, string>()
    for (const [label, outcome] of [
      ...result.outcomes.map((o) => [o.keyword, o] as const),
      ['zone', zone.outcomes[0]] as const,
      ['prevue', planned.outcomes[0]] as const,
    ]) {
      if (outcome.outcome === 'created') ids.set(label, outcome.id)
    }

    const asked: FitInput[] = []
    const mine = new Set(ids.values())
    const run = await analyzeReceivedRequests({
      ...defaultAnalysisPorts,
      listReceived: async () => (await listReceivedRequests(50)).filter((request) => mine.has(request.id)).slice(0, 5),
      judgeFit: async (input) => {
        asked.push(input)
        return input.search.startsWith('coiffure')
          ? { fit: 'out', service: null, city: null, intent: null, reason: 'Un autre métier.' }
          : { fit: 'in', service: 'traitement de l’eau', city: null, intent: 'transactionnelle', reason: 'Service du métier.' }
      },
    })
    // Deux lots de cinq au plus : on relance pour les suivantes.
    const rerun = await analyzeReceivedRequests({
      ...defaultAnalysisPorts,
      listReceived: async () => (await listReceivedRequests(50)).filter((request) => mine.has(request.id)).slice(0, 5),
      judgeFit: async () => ({ fit: 'in', service: null, city: null, intent: null, reason: 'Service du métier.' }),
    })
    expect(run.written + rerun.written).toBe(mine.size)

    expect(await statusOf(ids.get('prevue')!)).toMatchObject({ status: 'scheduled', reason_code: 'ALREADY_PLANNED', scheduled_for: expect.any(String) })
    expect(await statusOf(ids.get('plomberie martin')!)).toMatchObject({
      status: 'covered', reason_code: 'ALREADY_WON',
      evidence: [{ kind: 'position', position: 1 }, { kind: 'page', url: 'https://plomberie-martin.test/' }],
    })
    expect(await statusOf(ids.get('plombier troyes')!)).toMatchObject({
      status: 'covered', reason_code: 'ALREADY_COVERED', evidence: [{ kind: 'page', url: 'https://plomberie-martin.test/plombier-troyes' }],
    })
    expect((await statusOf(ids.get('zone')!)).reason_code).toBe('CITY_OUT_OF_AREA')
    expect(await statusOf(ids.get(`coiffure ${STAMP}`)!)).toMatchObject({ status: 'review', reason_code: 'OUT_OF_TRADE' })
    expect(await statusOf(ids.get(`adoucisseur ${STAMP}`)!)).toMatchObject({ status: 'deferred', reason_code: 'NEXT_PERIOD' })
    // « plombier » sans ville, sur une campagne locale : recevable, gardee.
    expect((await statusOf(ids.get('plombier')!)).status).toBe('deferred')

    // Le modele n'a ete consulte que pour ce que les mesures ne reglaient pas, et jamais avec la note.
    expect(asked.every((input) => !('note' in input))).toBe(true)
    expect(asked.map((input) => input.search)).not.toContain('plomberie martin')
  })

  it('un retrait arrive pendant l analyse n est jamais ecrase', async () => {
    const result = await submit(`detartrage ${STAMP}`)
    if (result.kind !== 'done' || result.outcomes[0].outcome !== 'created') throw new Error('envoi attendu')
    const id = result.outcomes[0].id
    await withdrawForMember({ session: marie, siteId: MARTIN, requestId: id })
    const written = await applyVerdicts([{ id, status: 'deferred', reason_code: 'NEXT_PERIOD', reasons: [], evidence: [], campaign_id: null, cycle_plan_id: null, plan_item_id: null, scheduled_for: null }])
    expect(written).toEqual([])
    expect((await statusOf(id)).status).toBe('withdrawn')
  })
})

describe('demandes — la base (migration 024)', () => {
  it('deux demandes ouvertes du meme site ne portent jamais la meme recherche ; une demande close, si', async () => {
    const insert = (status: string) => db.query(
      `insert into public.keyword_requests (client_id, site_id, keyword, keyword_normalized, status)
       values ($1, $2, $3, $3, $4) returning id`,
      [marie.clientId, MARTIN, `unique ${STAMP}`, status],
    )
    await insert('covered')
    await insert('deferred')
    await expect(insert('review')).rejects.toThrow(/keyword_requests_open_keyword_key/)
  })

  it('les recherches de la demonstration sont celles que rend le domaine', async () => {
    const { rows } = await db.query<{ keyword: string; city: string | null; keyword_normalized: string }>(
      `select keyword, city, keyword_normalized from public.keyword_requests where id = any($1::uuid[])`,
      [['received', 'review', 'deferred', 'scheduled', 'in-production', 'published', 'covered', 'declined', 'withdrawn', 'durand'].map((s) => seedId(`demo-request-${s}`))],
    )
    expect(rows).toHaveLength(10)
    for (const row of rows) expect(row.keyword_normalized).toBe(normalizedRequest(row.keyword, row.city))
  })

  it('les deux fonctions sont refusees a la cle publique', async () => {
    for (const fn of ['submit_keyword_requests', 'apply_keyword_verdicts']) {
      const response = await fetch(`${inject('supabaseApiUrl')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: inject('supabaseAnonKey'), Authorization: `Bearer ${inject('supabaseAnonKey')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_verdicts: [] }),
      })
      expect(response.ok).toBe(false)
    }
  })
})
