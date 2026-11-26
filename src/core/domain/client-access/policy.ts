// ─────────────────────────────────────────────────────────────────────────────
// Client access — the rules, without a database
// docs/cadrage.md ACC-1 to ACC-4, § 3.8
// ─────────────────────────────────────────────────────────────────────────────
//
// Who may enter a client space, for how long, and what an invitation does to an
// existing membership. Pure functions: lib/client-space applies them to rows it
// read, and the tests below pin them without Supabase.

/**
 * A session lives this long after the code or link that opened it, whatever
 * the refresh tokens say. Supabase rotates refresh tokens indefinitely; a phone
 * left signed in for a year is a door left open for a year.
 *
 * Measured on the SESSION, not the member: from the `amr` claim of its token,
 * which records when its code was typed and survives every refresh (checked
 * against the local stack, 26/11/2026). A member signing in elsewhere every
 * month does not keep a lost phone alive.
 */
export const CLIENT_SESSION_MAX_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** The code Supabase sends: `otp_length = 6` in supabase/config.toml and in the hosted project. */
export const SIGN_IN_CODE_PATTERN = /^\d{6}$/

export interface RateLimitRule {
  limit: number
  windowMs: number
}

/** § 3.8 — codes requested, per address and per IP: brute force and the e-mail quota. */
export const SIGN_IN_CODE_REQUESTS: RateLimitRule = { limit: 5, windowMs: 15 * 60 * 1000 }

/**
 * Codes typed, per address and per IP. A six-digit code is a million guesses;
 * ten tries per quarter-hour leave room for typos and none for guessing.
 * Supabase adds its own ceiling (30 verifications per 5 minutes per IP).
 */
export const SIGN_IN_CODE_VERIFICATIONS: RateLimitRule = { limit: 10, windowMs: 15 * 60 * 1000 }

/** One spelling per address: what the unique index `lower(email)` compares. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Codes are typed on phones: spaces and dashes pasted from the e-mail are not the user's fault. */
export function normalizeSignInCode(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export interface MembershipFacts {
  revoked_at: string | null
  last_login_at: string | null
}

export type MemberState = 'active' | 'pending' | 'revoked'

/** What the operator reads next to each address (ACC-7). */
export function memberState(member: MembershipFacts): MemberState {
  if (member.revoked_at) return 'revoked'
  return member.last_login_at ? 'active' : 'pending'
}

/** One entry of the `amr` claim: how the session was authenticated, and when (Unix seconds). */
export interface AuthMethodEntry {
  method: string
  timestamp: number
}

/**
 * When the session's code was typed — the latest `otp` entry, in ms — or null
 * when no code opened it. Sign-in codes and the e-mail link both record `otp`;
 * a password (an account someone set up outside this space) does not.
 */
export function codeSignInTime(amr: AuthMethodEntry[] | undefined): number | null {
  const times = (amr ?? []).filter((entry) => entry.method === 'otp').map((entry) => entry.timestamp * 1000)
  return times.length > 0 ? Math.max(...times) : null
}

/**
 * - `refused` — not opened by a code: no door of ours;
 * - `expired` — older than CLIENT_SESSION_MAX_DAYS, or opened before
 *   `sessionsValidAfter` (a revocation or a reopening since);
 * - `valid`.
 */
export type SessionVerdict = 'valid' | 'expired' | 'refused'

export function judgeSession(
  amr: AuthMethodEntry[] | undefined,
  sessionsValidAfter: string | null,
  now: Date,
): SessionVerdict {
  const signedInAt = codeSignInTime(amr)
  if (signedInAt === null) return 'refused'
  if (now.getTime() - signedInAt > CLIENT_SESSION_MAX_DAYS * DAY_MS) return 'expired'
  if (sessionsValidAfter) {
    // The token counts in whole seconds: so does the cutoff. A code typed in
    // the very second of a reopening belongs to the reopened access.
    const cutoff = Math.floor(Date.parse(sessionsValidAfter) / 1000) * 1000
    if (Number.isNaN(cutoff) || signedInAt < cutoff) return 'expired'
  }
  return 'valid'
}

export interface ExistingMembership {
  client_id: string
  revoked_at: string | null
}

/**
 * What inviting an address to a client does, given what already exists:
 *
 * - `create`       — nobody has this address: a new member;
 * - `reopen`       — a revoked member of THIS client: the same row, reopened;
 * - `resend`       — already an active member here: a fresh code, nothing else;
 * - `other_client` — the address belongs to another client: refused, one
 *                    address opens one space in V1.
 */
export type InvitationPlan = 'create' | 'reopen' | 'resend' | 'other_client'

export function planInvitation(existing: ExistingMembership | null, clientId: string): InvitationPlan {
  if (!existing) return 'create'
  if (existing.client_id !== clientId) return 'other_client'
  return existing.revoked_at ? 'reopen' : 'resend'
}

const SAFE_BASE = 'http://espace.invalid'

/**
 * Where to send a member after signing in. Only a path inside the client space
 * is honoured: anything else — another origin, `//evil.test`, an operator page,
 * `/espace/../sites` — falls back to the home, so the parameter can never
 * become an open redirect nor a detour to the operator's Basic prompt.
 *
 * Judged AFTER the URL parser has resolved it, as the browser will: dot
 * segments, encoded or not, and backslashes are resolved first.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/espace'
  let url: URL
  try {
    url = new URL(raw, SAFE_BASE)
  } catch {
    return '/espace'
  }
  if (url.origin !== SAFE_BASE || !/^\/espace(?:\/|$)/.test(url.pathname)) return '/espace'
  return `${url.pathname}${url.search}${url.hash}`
}
