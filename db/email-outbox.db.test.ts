// ─────────────────────────────────────────────────────────────────────────────
// L7 — the e-mails of the requests, against the LOCAL Supabase and its Mailpit:
// the trigger of migration 027 fills the outbox in the transaction of a status
// change, the repository reads it with its request, site and member, the pass
// sends through a real SMTP (Mailpit, 127.0.0.1:54325 — nothing leaves the
// machine), and the unsubscribe token opens one member's setting, no other.
//
// Every request created here carries STAMP and is deleted in afterAll (its
// outbox rows go with it, ON DELETE CASCADE); Marie's setting is put back.
// The pass is given only this file's rows: other pending rows of the local
// database are not touched.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Client } from 'pg'
import { connect } from '../scripts/db-connect.mjs'
import { applyEmailChoice, readEmailPreference } from '@/lib/client-space/email-preference'
import type { EmailConfig } from '@/lib/email/config'
import { createSmtpMailer } from '@/lib/email/mailer'
import { createOutboxRepository, type OutboxRepository } from '@/lib/email/outbox-repository'
import { sendDueEmails } from '@/lib/email/send-due'
import { MARTIN, CLIENT_A } from './request-fixtures.db'

const STAMP = Date.now().toString(36)

let db: Client
let marie: { id: string; email: string; token: string }
let luc: { id: string; token: string }
const created: string[] = []

async function newRequest(keyword: string, submittedBy: string | null): Promise<string> {
  const id = randomUUID()
  const text = `${keyword} ${STAMP}`
  await db.query(
    `insert into public.keyword_requests (id, client_id, site_id, submitted_by, keyword, keyword_normalized, city, status)
     values ($1, $2, $3, $4, $5, $5, 'Troyes', 'received')`,
    [id, CLIENT_A, MARTIN, submittedBy, text],
  )
  created.push(id)
  return id
}

async function outboxOf(requestId: string) {
  const { rows } = await db.query<{ kind: string; request_status: string; status: string; dedupe_key: string; last_error: string | null }>(
    'select kind, request_status, status, dedupe_key, last_error from public.email_outbox where keyword_request_id = $1 order by created_at',
    [requestId],
  )
  return rows
}

/** The repository, given only the rows of the requests named: no other test's, no other pending row of the base. */
function rowsOf(requestIds: readonly string[]): OutboxRepository {
  const repository = createOutboxRepository()
  return { ...repository, readDue: async (now) => (await repository.readDue(now)).filter((entry) => requestIds.includes(entry.request.id)) }
}

/**
 * The pass's clock, a few seconds ahead: the Docker Desktop VM runs some tenths
 * of a second ahead of Windows (CLAUDE.md), so a row inserted a moment ago has a
 * `next_attempt_at` still in Node's future. In production the next pass comes
 * two minutes later; here, the margin.
 */
const passNow = (): Date => new Date(Date.now() + 5_000)

const CONFIG: EmailConfig = {
  smtp: { host: '127.0.0.1', port: 54325, secure: false, auth: null },
  from: 'CNX Solutions <contact@cnx-solutions.fr>',
  operatorEmail: `cnx-${STAMP}@cnx-solutions.test`,
  publicUrl: 'http://localhost:3000',
}

async function mailpitMessages(to: string): Promise<Array<{ ID: string; Subject: string }>> {
  const mailpit = inject('mailpitUrl')
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const { messages } = (await search.json()) as { messages: Array<{ ID: string; Subject: string }> }
    if (messages.length > 0) return messages
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return []
}

beforeAll(async () => {
  db = await connect({ allow: ['local'], argv: [], quiet: true })
  const { rows } = await db.query<{ id: string; email: string; unsubscribe_token: string }>(
    'select id, email, unsubscribe_token from public.client_members where email = any($1) order by email',
    [['luc@electricite-durand.test', 'marie@martin-batiment.test']],
  )
  if (rows.length !== 2) throw new Error('membres de demonstration absents — npm run db:local:reset ?')
  luc = { id: rows[0].id, token: rows[0].unsubscribe_token }
  marie = { id: rows[1].id, email: rows[1].email, token: rows[1].unsubscribe_token }
  await db.query('update public.client_members set email_opt_out_at = null where id = $1', [marie.id])
})

afterAll(async () => {
  if (!db) return
  await db.query('delete from public.keyword_requests where id = any($1::uuid[])', [created])
  await db.query('update public.client_members set email_opt_out_at = null where id = any($1::uuid[])', [[marie.id, luc.id]])
  await db.end()
})

describe('file d’envoi — le déclencheur (migration 027)', () => {
  it('une demande qui change de statut met une ligne dans la file, une seule par statut', async () => {
    const id = await newRequest('ramonage', marie.id)
    await db.query(`update public.keyword_requests set status = 'scheduled', scheduled_for = current_date + 10 where id = $1`, [id])
    await db.query(`update public.keyword_requests set reasons = reasons where id = $1`, [id])
    await db.query(`update public.keyword_requests set status = 'review' where id = $1`, [id])
    await db.query(`update public.keyword_requests set status = 'scheduled' where id = $1`, [id])

    expect(await outboxOf(id)).toEqual([
      { kind: 'client_request', request_status: 'scheduled', status: 'pending', dedupe_key: `client:${id}:scheduled`, last_error: null },
      { kind: 'operator_review', request_status: 'review', status: 'pending', dedupe_key: `operator:${id}:review`, last_error: null },
    ])
  })

  it('n’annonce rien d’un changement annulé', async () => {
    const id = await newRequest('détartrage', marie.id)
    await db.query('begin')
    await db.query(`update public.keyword_requests set status = 'covered' where id = $1`, [id])
    await db.query('rollback')
    expect(await outboxOf(id)).toEqual([])
  })

  it('n’annonce ni la réception, ni la rédaction, ni le retrait', async () => {
    const id = await newRequest('adoucisseur', marie.id)
    await db.query(`update public.keyword_requests set status = 'withdrawn' where id = $1`, [id])
    expect(await outboxOf(id)).toEqual([])
  })
})

describe('file d’envoi — le passage, jusqu’au SMTP local', () => {
  it('lit la demande, son site et son membre, envoie à Marie et à CNX, puis marque les lignes parties', async () => {
    const id = await newRequest('fuite sous évier', marie.id)
    await db.query(`update public.keyword_requests set status = 'published', published_url = 'https://plomberie-martin.test/fuite', published_at = now() where id = $1`, [id])
    const reviewed = await newRequest('piscine', marie.id)
    await db.query(`update public.keyword_requests set status = 'review', reasons = array['Hors du métier déclaré du site.'] where id = $1`, [reviewed])

    const entries = await rowsOf([id, reviewed]).readDue(passNow())
    const published = entries.find((entry) => entry.request.id === id)
    expect(published?.request).toMatchObject({ siteId: MARTIN, siteName: 'Plomberie Martin', status: 'published' })
    expect(published?.member).toMatchObject({ id: marie.id, email: marie.email, unsubscribeToken: marie.token, optedOutAt: null })

    const report = await sendDueEmails({
      repository: rowsOf([id, reviewed]),
      config: { ok: true, config: CONFIG },
      mailer: createSmtpMailer(CONFIG.smtp, CONFIG.from),
      now: passNow,
    })
    expect(report.failed).toBe(0)
    expect((await outboxOf(id)).map((row) => row.status)).toEqual(['sent'])
    expect((await outboxOf(reviewed)).map((row) => row.status)).toEqual(['sent'])

    const toCnx = await mailpitMessages(CONFIG.operatorEmail as string)
    expect(toCnx.map((message) => message.Subject)).toContain(`Demande client à examiner : « piscine ${STAMP} » (Plomberie Martin)`)
    const toMarie = await mailpitMessages(marie.email)
    expect(toMarie.map((message) => message.Subject)).toContain(`Votre demande « fuite sous évier ${STAMP} » : en ligne`)
  })
})

describe('désinscription — le jeton n’ouvre qu’un réglage, celui de son membre', () => {
  it('désinscrit Marie, et la nouvelle suivante est écartée', async () => {
    expect(await readEmailPreference(marie.token)).toEqual({ maskedEmail: 'ma…@martin-batiment.test', optedOut: false })
    expect(await applyEmailChoice(marie.token, 'unsubscribe')).toEqual({ maskedEmail: 'ma…@martin-batiment.test', optedOut: true })
    expect(await readEmailPreference(luc.token)).toMatchObject({ optedOut: false })

    const id = await newRequest('robinet', marie.id)
    await db.query(`update public.keyword_requests set status = 'covered' where id = $1`, [id])
    await sendDueEmails({ repository: rowsOf([id]), config: { ok: true, config: CONFIG }, mailer: createSmtpMailer(CONFIG.smtp, CONFIG.from), now: passNow })
    expect(await outboxOf(id)).toEqual([
      expect.objectContaining({ status: 'skipped', last_error: 'Écartée : le membre s’est désinscrit des e-mails.' }),
    ])
  })

  it('garde la date de la première désinscription, et réabonne', async () => {
    const first = await db.query<{ at: string }>('select email_opt_out_at::text as at from public.client_members where id = $1', [marie.id])
    await applyEmailChoice(marie.token, 'unsubscribe', new Date(Date.now() + 60_000))
    const second = await db.query<{ at: string }>('select email_opt_out_at::text as at from public.client_members where id = $1', [marie.id])
    expect(second.rows[0].at).toBe(first.rows[0].at)

    expect(await applyEmailChoice(marie.token, 'resubscribe')).toMatchObject({ optedOut: false })
  })

  it('un jeton inconnu ou mal formé n’ouvre rien', async () => {
    expect(await readEmailPreference(randomUUID())).toBeNull()
    expect(await applyEmailChoice(randomUUID(), 'unsubscribe')).toBeNull()
    expect(await readEmailPreference('pas-un-jeton')).toBeNull()
    expect(await readEmailPreference(luc.id)).toBeNull()
  })
})
