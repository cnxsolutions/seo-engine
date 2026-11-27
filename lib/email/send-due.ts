// ─────────────────────────────────────────────────────────────────────────────
// The `emails` task of the scheduler: one pass over the outbox (KW-12, L7)
// ─────────────────────────────────────────────────────────────────────────────
//
// Read what is due, decide who gets what (src/core/domain/email/deliveries.ts),
// send, write the outcome. Every two minutes, in the Next process like every
// other task — single instance (CLAUDE.md), so no row is claimed twice.
//
// Without a usable configuration nothing leaves, but the pass still runs the
// rules: a row nobody will send is dropped once it is a day old, instead of
// waiting for the SMTP to come back and leaving a week late.
//
// At least once, not exactly once: an SMTP that accepted a message and a write
// that failed right after would send it again on the next pass. The other way
// round — marked sent, never sent — would be worse.

import { afterFailure, planDeliveries, type Delivery } from '@/src/core/domain/email/deliveries'
import { readEmailConfig, type EmailConfigResult } from './config'
import { createSmtpMailer, type Mailer } from './mailer'
import { createOutboxRepository, type OutboxRepository } from './outbox-repository'
import { renderDelivery } from './templates'

export interface SendDueDependencies {
  repository: OutboxRepository
  config: EmailConfigResult
  mailer: Mailer | null
  now: () => Date
}

export interface SendDueReport {
  sent: number
  skipped: number
  failed: number
  /** Why nothing could leave, when nothing could. */
  disabled: string | null
}

/** The reason last written to the log: a missing variable is said once, not every two minutes. */
let lastDisabledReason: string | null = null

function defaultDependencies(): SendDueDependencies {
  const config = readEmailConfig()
  return {
    repository: createOutboxRepository(),
    config,
    mailer: config.ok ? createSmtpMailer(config.config.smtp, config.config.from) : null,
    now: () => new Date(),
  }
}

export async function sendDueEmails(deps: SendDueDependencies = defaultDependencies()): Promise<SendDueReport> {
  const now = deps.now()
  const disabled = deps.config.ok && deps.mailer ? null : deps.config.ok ? 'aucun SMTP' : deps.config.reason
  if (disabled && disabled !== lastDisabledReason) console.warn(`[emails] aucun envoi : ${disabled}`)
  lastDisabledReason = disabled

  const entries = await deps.repository.readDue(now)
  if (entries.length === 0) return { sent: 0, skipped: 0, failed: 0, disabled }

  const plan = planDeliveries(entries, { now, operatorEmail: deps.config.ok ? deps.config.config.operatorEmail : null })
  await deps.repository.markSkipped(plan.skipped)

  if (disabled || !deps.config.ok || !deps.mailer) {
    // Left pending: they leave when the SMTP is back, or are dropped at a day old.
    return { sent: 0, skipped: plan.skipped.length, failed: 0, disabled }
  }

  const sentIds: string[] = []
  let failed = 0
  for (const delivery of plan.deliveries) {
    const ids = delivery.entries.map((entry) => entry.id)
    try {
      await deps.mailer.send(renderDelivery(delivery, deps.config.config.publicUrl))
      sentIds.push(...ids)
    } catch (error) {
      failed += ids.length
      const message = error instanceof Error ? error.message : String(error)
      const outcome = afterFailure(maxAttempts(delivery), now)
      // The address is the recipient's: the log keeps the kind and the count, not who.
      console.error(`[emails] envoi refusé (${delivery.kind}, ${ids.length} nouvelle(s)) : ${message}`)
      await deps.repository.markFailure(ids, { ...outcome, error: message })
    }
  }
  await deps.repository.markSent(sentIds, now)

  return { sent: sentIds.length, skipped: plan.skipped.length, failed, disabled: null }
}

/** A delivery groups rows tried a different number of times: the most tried one sets the pace. */
function maxAttempts(delivery: Delivery): number {
  return Math.max(...delivery.entries.map((entry) => entry.attempts))
}
