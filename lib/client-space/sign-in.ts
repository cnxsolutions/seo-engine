// ─────────────────────────────────────────────────────────────────────────────
// Signing in to the client space — code by e-mail
// docs/cadrage.md ACC-2, § 3.8 (limits), décision 3
// ─────────────────────────────────────────────────────────────────────────────
//
// Two rules shape everything here:
//
// 1. NOTHING SAYS WHETHER AN ADDRESS HAS ACCESS. Asking for a code answers the
//    same sentence, in the same time, for a member, a revoked member and a
//    stranger: the e-mail is sent AFTER the response (`defer`), so the
//    response time cannot tell them apart either.
// 2. A CODE IS NOT A MEMBERSHIP. Supabase verifies the code; we then check that
//    the account behind it is a member not revoked, and record the sign-in —
//    the start of the CLIENT_SESSION_MAX_DAYS that session.ts enforces.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SIGN_IN_CODE_REQUESTS,
  SIGN_IN_CODE_VERIFICATIONS,
} from '@/src/core/domain/client-access/policy'
import { createRateLimiter, hitAll, type RateLimiter } from '@/lib/rate-limit'
import { sendSignInCode } from './auth-admin'
import { findMemberByEmail, findMemberByUserId, updateMember } from './repository'

/** Runs work after the response is sent — `after()` of next/server in a route. */
export type Defer = (task: () => Promise<void>) => void

export type CodeRequestResult =
  | { status: 'accepted' }
  | { status: 'limited'; retryAfterSeconds: number }

export type VerificationResult =
  | { status: 'signed_in' }
  | { status: 'invalid' }
  | { status: 'limited'; retryAfterSeconds: number }

// One process, one instance: these counters are the whole truth (lib/rate-limit.ts).
const codeRequests: RateLimiter = createRateLimiter(SIGN_IN_CODE_REQUESTS)
const codeVerifications: RateLimiter = createRateLimiter(SIGN_IN_CODE_VERIFICATIONS)

/** `email` normalised by the caller (normalizeEmail). */
export async function requestSignInCode(input: { email: string; ip: string; defer: Defer }): Promise<CodeRequestResult> {
  const verdict = hitAll(codeRequests, [`email:${input.email}`, `ip:${input.ip}`])
  if (!verdict.allowed) return { status: 'limited', retryAfterSeconds: verdict.retryAfterSeconds }

  const member = await findMemberByEmail(input.email)
  if (member && !member.revoked_at) {
    input.defer(async () => {
      const sent = await sendSignInCode(input.email)
      // Logged without the address: the journal is no place for personal data.
      if (!sent.ok && sent.reason === 'failed') console.warn(`[espace] code non envoye au membre ${member.id} : ${sent.detail}`)
    })
  }
  return { status: 'accepted' }
}

/** The six digits typed on the sign-in page. `auth` writes the session cookies. */
export async function verifySignInCode(input: {
  email: string
  code: string
  ip: string
  auth: SupabaseClient
  now?: Date
}): Promise<VerificationResult> {
  const verdict = hitAll(codeVerifications, [`email:${input.email}`, `ip:${input.ip}`])
  if (!verdict.allowed) return { status: 'limited', retryAfterSeconds: verdict.retryAfterSeconds }

  const { data, error } = await input.auth.auth.verifyOtp({ email: input.email, token: input.code, type: 'email' })
  if (error || !data.user) return { status: 'invalid' }
  return completeSignIn(input.auth, data.user.id, input.now ?? new Date())
}

/** The fallback link of the e-mail (`/auth/callback?token_hash=…&type=email`). */
export async function verifySignInLink(input: {
  tokenHash: string
  ip: string
  auth: SupabaseClient
  now?: Date
}): Promise<VerificationResult> {
  const verdict = codeVerifications.hit(`ip:${input.ip}`)
  if (!verdict.allowed) return { status: 'limited', retryAfterSeconds: verdict.retryAfterSeconds }

  const { data, error } = await input.auth.auth.verifyOtp({ token_hash: input.tokenHash, type: 'email' })
  if (error || !data.user) return { status: 'invalid' }
  return completeSignIn(input.auth, data.user.id, input.now ?? new Date())
}

/**
 * Supabase said yes; the membership decides. An account that is no member, or
 * a revoked one, leaves with its fresh session closed — the cookies just
 * written are cleared before the response goes.
 */
async function completeSignIn(auth: SupabaseClient, userId: string, now: Date): Promise<VerificationResult> {
  const member = await findMemberByUserId(userId)
  if (!member || member.revoked_at) {
    await auth.auth.signOut({ scope: 'local' })
    return { status: 'invalid' }
  }
  await updateMember(member.id, { last_login_at: now.toISOString() })
  return { status: 'signed_in' }
}
