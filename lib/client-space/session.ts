// ─────────────────────────────────────────────────────────────────────────────
// Who is asking — a member, or nobody
// docs/cadrage.md ACC-3, ACC-4, § 4.4
// ─────────────────────────────────────────────────────────────────────────────
//
// A valid Supabase session is not enough to enter. It must have been opened by
// a code (`amr`: otp), less than CLIENT_SESSION_MAX_DAYS ago and after the
// member's last revocation or reopening; and the member behind it must exist
// and not be revoked. The proxy only checks that a session
// exists; the layout of the space and every route call this, every time — a
// revocation takes effect on the next request, not at the next token refresh.

import type { SupabaseClient } from '@supabase/supabase-js'
import { cache } from 'react'
import { judgeSession, type AuthMethodEntry } from '@/src/core/domain/client-access/policy'
import { createRequestAuthClient } from './request-auth'
import { findMemberByUserId } from './repository'

export interface ClientSession {
  userId: string
  memberId: string
  clientId: string
  email: string
}

export type ClientSessionResult =
  | { status: 'active'; session: ClientSession }
  /** No session, or one Supabase no longer honours. */
  | { status: 'none' }
  /** A session whose access was withdrawn by the operator. */
  | { status: 'revoked' }
  /** Older than CLIENT_SESSION_MAX_DAYS, or opened before a revocation or a reopening. */
  | { status: 'expired' }

export async function resolveClientSession(auth: SupabaseClient, now: Date = new Date()): Promise<ClientSessionResult> {
  const { data, error } = await auth.auth.getClaims()
  // Revocation bans the Auth user (lib/client-space/access.ts): Supabase then
  // refuses the session itself, and says why.
  if (error?.code === 'user_banned') return { status: 'revoked' }
  const claims = data?.claims
  const userId = claims?.sub
  if (error || !userId) return { status: 'none' }

  const member = await findMemberByUserId(userId)
  // An Auth user with no membership has no space to enter: same door as a revoked one.
  if (!member || member.revoked_at) return { status: 'revoked' }

  const verdict = judgeSession(claims.amr as AuthMethodEntry[] | undefined, member.sessions_valid_after, now)
  // `refused` (opened by a password set outside this space) ends the same way:
  // cookies cleared, a code asked for.
  if (verdict !== 'valid') return { status: 'expired' }

  return {
    status: 'active',
    session: { userId, memberId: member.id, clientId: member.client_id, email: member.email },
  }
}

/**
 * The session of the current request, for server components and route
 * handlers. Memoised per request (`cache`): the layout and the page of the
 * space both ask, and the second answer costs nothing.
 */
export const getClientSession = cache(async (): Promise<ClientSessionResult> => {
  const auth = await createRequestAuthClient()
  if (!auth) return { status: 'none' }
  return resolveClientSession(auth)
})
