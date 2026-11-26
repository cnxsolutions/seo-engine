// ─────────────────────────────────────────────────────────────────────────────
// Supabase Auth, as the operator's side drives it
// ─────────────────────────────────────────────────────────────────────────────
//
// Why no `inviteUserByEmail` (the cadrage said it, § 4.4): an invited user stays
// UNCONFIRMED until they open the invitation link, and with public sign-up off
// Supabase refuses to send an unconfirmed user a code (« Signups not allowed for
// this instance » — checked against the local stack on 26/11/2026). A client
// who ignored the invitation, or opened it after a day, would be locked out.
//
// So an invitation is: a CONFIRMED account created by the admin API, then the
// same code e-mail as every later sign-in (supabase/templates/code-connexion.html).
// One path, one template.

import { createServiceClient } from '@/lib/supabase'
import { createCodeSender, readClientAuthEnv } from './auth-client'

export type SendCodeResult =
  | { ok: true }
  /** Supabase allows one e-mail per address per minute (hosted default). */
  | { ok: false; reason: 'too_soon' }
  | { ok: false; reason: 'failed'; detail: string }

/** Sends the sign-in code e-mail. Never creates an account (`shouldCreateUser: false`). */
export async function sendSignInCode(email: string): Promise<SendCodeResult> {
  const env = readClientAuthEnv()
  if (!env) return { ok: false, reason: 'failed', detail: 'NEXT_PUBLIC_SUPABASE_ANON_KEY absente' }

  const { error } = await createCodeSender(env).auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (!error) return { ok: true }
  if (error.code === 'over_email_send_rate_limit') return { ok: false, reason: 'too_soon' }
  return { ok: false, reason: 'failed', detail: `${error.status ?? ''} ${error.code ?? ''} ${error.message}`.trim() }
}

/** Auth users scanned, at most, to find an existing account by address. */
const USER_SCAN_PAGES = 10
const USER_SCAN_PER_PAGE = 1000

/**
 * The id of a CONFIRMED Auth user for this address, created if needed.
 *
 * An existing account is the rare path — an invitation that failed after the
 * account was made, a member deleted by hand — so it is found by scanning the
 * user list: the admin API of supabase-js has no lookup by address. Bounded:
 * ten thousand accounts is far beyond what this space will hold.
 */
export async function ensureConfirmedUser(email: string): Promise<string> {
  const admin = createServiceClient().auth.admin
  const created = await admin.createUser({ email, email_confirm: true })
  if (!created.error && created.data.user) return created.data.user.id
  if (created.error && created.error.code !== 'email_exists') {
    throw new Error(`[client-space] creation du compte : ${created.error.message}`)
  }

  for (let page = 1; page <= USER_SCAN_PAGES; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: USER_SCAN_PER_PAGE })
    if (error) throw new Error(`[client-space] liste des comptes : ${error.message}`)
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (user) {
      if (!user.email_confirmed_at) {
        const confirmed = await admin.updateUserById(user.id, { email_confirm: true })
        if (confirmed.error) throw new Error(`[client-space] confirmation du compte : ${confirmed.error.message}`)
      }
      return user.id
    }
    if (data.users.length < USER_SCAN_PER_PAGE) break
  }
  throw new Error('[client-space] compte annonce existant mais introuvable')
}

/** About a century: Supabase has no « forever ». `none` lifts it. */
const BAN_FOREVER = '876000h'

/**
 * A banned user's session dies at once — refresh refused, `getUser` refused —
 * and no new code is sent. The second half of a revocation, after
 * `client_members.revoked_at`, which our own checks read first.
 */
export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  const { error } = await createServiceClient().auth.admin.updateUserById(userId, {
    ban_duration: banned ? BAN_FOREVER : 'none',
  })
  if (error) throw new Error(`[client-space] ${banned ? 'blocage' : 'deblocage'} du compte : ${error.message}`)
}
