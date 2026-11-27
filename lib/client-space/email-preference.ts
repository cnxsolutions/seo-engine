// ─────────────────────────────────────────────────────────────────────────────
// The e-mails a member agrees to receive — the unsubscribe link of every
// client e-mail (KW-12, L7, migration 027)
// ─────────────────────────────────────────────────────────────────────────────
//
// Reached WITHOUT a session (lib/client-space/gate.ts): the link must work from
// any mailbox, on any device. What it carries is `client_members.unsubscribe_token`,
// a random uuid of the member, and it opens one setting and nothing else — no
// site, no request, no other member. An unknown token reads as « not found »,
// like everything of the space that is not yours.
//
// The address shown on the page is masked: a forwarded e-mail must not hand a
// stranger the member's full address.

import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

export interface EmailPreference {
  /** « ma…@martin-batiment.test » */
  maskedEmail: string
  optedOut: boolean
}

export type EmailChoice = 'unsubscribe' | 'resubscribe'

// `z.guid()`, as in schemas.ts: any 8-4-4-4-12 hex form, the database checks the rest.
const Token = z.guid()

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '…'
  const local = email.slice(0, at)
  return `${local.slice(0, Math.min(2, local.length))}…${email.slice(at)}`
}

function toPreference(row: { email: string; email_opt_out_at: string | null }): EmailPreference {
  return { maskedEmail: maskEmail(row.email), optedOut: row.email_opt_out_at !== null }
}

export async function readEmailPreference(token: string): Promise<EmailPreference | null> {
  if (!Token.safeParse(token).success) return null
  const { data, error } = await createServiceClient()
    .from('client_members')
    .select('email,email_opt_out_at')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (error) throw new Error(`préférence e-mail illisible : ${error.message}`)
  return data ? toPreference(data) : null
}

/**
 * Applies the choice; null when the token opens nothing. Unsubscribing twice
 * keeps the first date: it is when the member asked.
 */
export async function applyEmailChoice(token: string, choice: EmailChoice, now: Date = new Date()): Promise<EmailPreference | null> {
  if (!Token.safeParse(token).success) return null
  const supabase = createServiceClient()
  let query = supabase
    .from('client_members')
    .update({ email_opt_out_at: choice === 'unsubscribe' ? now.toISOString() : null })
    .eq('unsubscribe_token', token)
  if (choice === 'unsubscribe') query = query.is('email_opt_out_at', null)
  const { error } = await query
  if (error) throw new Error(`préférence e-mail non enregistrée : ${error.message}`)
  return readEmailPreference(token)
}
