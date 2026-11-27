import { describe, expect, it, vi } from 'vitest'
import type { OutboxEntry, SkipReason } from '@/src/core/domain/email/deliveries'
import type { EmailConfig } from './config'
import type { Mailer } from './mailer'
import type { OutboxRepository } from './outbox-repository'
import { sendDueEmails } from './send-due'
import type { OutgoingEmail } from './templates'

const NOW = new Date('2026-11-28T10:00:00Z')

const CONFIG: EmailConfig = {
  smtp: { host: '127.0.0.1', port: 54325, secure: false, auth: null },
  from: 'CNX Solutions <contact@cnx-solutions.fr>',
  operatorEmail: 'contact@cnx-solutions.fr',
  publicUrl: 'https://seo.cnx-solutions.fr',
}

function entry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id,
    kind: 'client_request',
    requestStatus: 'published',
    attempts: 0,
    createdAt: '2026-11-28T09:58:00Z',
    member: { id: 'm1', email: 'marie@martin-batiment.test', revokedAt: null, optedOutAt: null, unsubscribeToken: 'tok' },
    request: {
      id: `r-${id}`, keyword: 'chauffe-eau', city: 'Troyes', note: null, desired_by: null, status: 'published',
      reason_code: null, reasons: [], evidence: [], scheduled_for: null,
      published_url: 'https://plomberie-martin.test/chauffe-eau', published_at: '2026-11-28T09:57:00Z',
      decided_at: null, created_at: '2026-11-20T09:00:00Z', updated_at: '2026-11-28T09:58:00Z',
      siteId: 's1', siteName: 'Plomberie Martin',
    },
    ...overrides,
  }
}

function fakeRepository(entries: OutboxEntry[]) {
  const calls = {
    sent: [] as string[],
    skipped: [] as Array<{ id: string; reason: SkipReason }>,
    failures: [] as Array<{ ids: readonly string[]; attempts: number; giveUp: boolean; error: string }>,
  }
  const repository: OutboxRepository = {
    readDue: async () => entries,
    markSent: async (ids) => { calls.sent.push(...ids) },
    markSkipped: async (skipped) => { calls.skipped.push(...skipped) },
    markFailure: async (ids, outcome) => { calls.failures.push({ ids, attempts: outcome.attempts, giveUp: outcome.giveUp, error: outcome.error }) },
  }
  return { repository, calls }
}

function fakeMailer(fail = false) {
  const sent: OutgoingEmail[] = []
  const mailer: Mailer = {
    send: async (email) => {
      if (fail) throw new Error('421 service indisponible')
      sent.push(email)
    },
  }
  return { mailer, sent }
}

describe('sendDueEmails', () => {
  it('envoie un seul e-mail pour deux nouvelles du même membre, et les marque parties', async () => {
    const { repository, calls } = fakeRepository([entry('a'), entry('b')])
    const { mailer, sent } = fakeMailer()
    const report = await sendDueEmails({ repository, mailer, config: { ok: true, config: CONFIG }, now: () => NOW })

    expect(report).toEqual({ sent: 2, skipped: 0, failed: 0, disabled: null })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('marie@martin-batiment.test')
    expect(sent[0].subject).toBe('Du nouveau sur 2 de vos demandes')
    expect(calls.sent).toEqual(['a', 'b'])
  })

  it('écarte et note ce qui ne doit pas partir', async () => {
    const optedOut = entry('c', { member: { ...entry('c').member!, optedOutAt: '2026-11-27T00:00:00Z' } })
    const { repository, calls } = fakeRepository([optedOut])
    const { mailer, sent } = fakeMailer()
    await sendDueEmails({ repository, mailer, config: { ok: true, config: CONFIG }, now: () => NOW })

    expect(sent).toEqual([])
    expect(calls.skipped).toEqual([{ id: 'c', reason: 'opted_out' }])
  })

  it('remet à plus tard un envoi refusé par le SMTP, sans l’adresse dans le journal', async () => {
    const { repository, calls } = fakeRepository([entry('a', { attempts: 1 })])
    const { mailer } = fakeMailer(true)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = await sendDueEmails({ repository, mailer, config: { ok: true, config: CONFIG }, now: () => NOW })

    expect(report.failed).toBe(1)
    expect(calls.sent).toEqual([])
    expect(calls.failures).toEqual([{ ids: ['a'], attempts: 2, giveUp: false, error: '421 service indisponible' }])
    expect(log.mock.calls.flat().join(' ')).not.toContain('marie@')
    log.mockRestore()
  })

  it('sans configuration, n’envoie rien mais écarte quand même les nouvelles trop vieilles', async () => {
    const old = entry('o', { createdAt: '2026-11-26T09:00:00Z' })
    const { repository, calls } = fakeRepository([old, entry('a')])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const report = await sendDueEmails({ repository, mailer: null, config: { ok: false, reason: 'SMTP_HOST absente : aucun e-mail ne part.' }, now: () => NOW })

    expect(report).toEqual({ sent: 0, skipped: 1, failed: 0, disabled: 'SMTP_HOST absente : aucun e-mail ne part.' })
    expect(calls.skipped).toEqual([{ id: 'o', reason: 'too_old' }])
    expect(calls.sent).toEqual([])
    warn.mockRestore()
  })
})
