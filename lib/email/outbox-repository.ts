// ─────────────────────────────────────────────────────────────────────────────
// The outbox in the database (migration 027): read what is due, write what
// became of it. Service key only — RLS is on with no policy.
//
// ONE read per pass, the request, its site and its member embedded: no query
// per row. The writes are grouped too: every sent row in one update, every
// dropped row in one update per reason; only a refused delivery is written on
// its own, and refusals are the exception.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'
import type { OutboxEntry, OutboxKind, SkipReason } from '@/src/core/domain/email/deliveries'
import type { RequestRecord } from '@/src/core/domain/keyword-requests/client-view'

/** Rows read per pass: far above what a two-minute window produces. */
export const OUTBOX_BATCH = 200

const COLUMNS = [
  'id,kind,request_status,attempts,created_at',
  'request:keyword_requests(id,keyword,city,note,desired_by,status,reason_code,reasons,evidence,scheduled_for,published_url,published_at,decided_at,created_at,updated_at,site_id',
  'site:sites(name)',
  'member:client_members!keyword_requests_submitted_by_fkey(id,email,revoked_at,email_opt_out_at,unsubscribe_token))',
].join(',')

/** What the outbox records for a row that did not leave, in words. */
export const SKIP_REASON_TEXT: Readonly<Record<SkipReason, string>> = {
  too_old: 'Écartée : plus d’un jour d’attente, la nouvelle n’en est plus une.',
  superseded: 'Écartée : la demande a changé de statut depuis.',
  no_member: 'Écartée : le membre qui a envoyé la demande n’existe plus.',
  member_revoked: 'Écartée : le membre n’a plus accès à l’espace.',
  opted_out: 'Écartée : le membre s’est désinscrit des e-mails.',
  no_operator_address: 'Écartée : aucune adresse CNX réglée (OPERATOR_EMAIL).',
}

export interface OutboxRepository {
  readDue(now: Date): Promise<OutboxEntry[]>
  markSent(ids: readonly string[], now: Date): Promise<void>
  markSkipped(skipped: ReadonlyArray<{ id: string; reason: SkipReason }>): Promise<void>
  markFailure(ids: readonly string[], outcome: { attempts: number; giveUp: boolean; nextAttemptAt: string; error: string }): Promise<void>
}

interface Row {
  id: string
  kind: OutboxKind
  request_status: string
  attempts: number
  created_at: string
  request: (Omit<RequestRecord, 'reasons'> & {
    reasons: string[] | null
    site_id: string
    site: { name: string } | null
    member: { id: string; email: string; revoked_at: string | null; email_opt_out_at: string | null; unsubscribe_token: string } | null
  }) | null
}

function toEntry(row: Row): OutboxEntry | null {
  // The request is deleted with its rows (ON DELETE CASCADE): a row without one
  // is a read caught mid-deletion, left for the next pass to find gone.
  if (!row.request) return null
  const { site, member, site_id: siteId, ...request } = row.request
  return {
    id: row.id,
    kind: row.kind,
    requestStatus: row.request_status,
    attempts: row.attempts,
    createdAt: row.created_at,
    request: { ...request, reasons: request.reasons ?? [], siteId, siteName: site?.name ?? '' },
    member: member
      ? {
          id: member.id,
          email: member.email,
          revokedAt: member.revoked_at,
          optedOutAt: member.email_opt_out_at,
          unsubscribeToken: member.unsubscribe_token,
        }
      : null,
  }
}

export function createOutboxRepository(): OutboxRepository {
  const supabase = createServiceClient()
  const outbox = () => supabase.from('email_outbox')

  return {
    async readDue(now) {
      const { data, error } = await outbox()
        .select(COLUMNS)
        .eq('status', 'pending')
        .lte('next_attempt_at', now.toISOString())
        .order('created_at', { ascending: true })
        .limit(OUTBOX_BATCH)
      if (error) throw new Error(`lecture de la file d’envoi impossible : ${error.message}`)
      return ((data ?? []) as unknown as Row[]).flatMap((row) => toEntry(row) ?? [])
    },

    async markSent(ids, now) {
      if (ids.length === 0) return
      const { error } = await outbox()
        .update({ status: 'sent', sent_at: now.toISOString(), last_error: null })
        .in('id', [...ids])
      if (error) throw new Error(`file d’envoi : ${error.message}`)
    },

    async markSkipped(skipped) {
      const byReason = new Map<SkipReason, string[]>()
      for (const { id, reason } of skipped) byReason.set(reason, [...(byReason.get(reason) ?? []), id])
      for (const [reason, ids] of byReason) {
        const { error } = await outbox().update({ status: 'skipped', last_error: SKIP_REASON_TEXT[reason] }).in('id', ids)
        if (error) throw new Error(`file d’envoi : ${error.message}`)
      }
    },

    async markFailure(ids, outcome) {
      const { error } = await outbox()
        .update({
          status: outcome.giveUp ? 'failed' : 'pending',
          attempts: outcome.attempts,
          next_attempt_at: outcome.nextAttemptAt,
          last_error: outcome.error.slice(0, 500),
        })
        .in('id', [...ids])
      if (error) throw new Error(`file d’envoi : ${error.message}`)
    },
  }
}
