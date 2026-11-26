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

/**
 * Whether the session opened at `lastLoginAt` has outlived
 * CLIENT_SESSION_MAX_DAYS. No recorded login means no session was ever opened
 * through our routes: expired, not trusted.
 */
export function isSessionExpired(lastLoginAt: string | null, now: Date): boolean {
  if (!lastLoginAt) return true
  const openedAt = Date.parse(lastLoginAt)
  if (Number.isNaN(openedAt)) return true
  return now.getTime() - openedAt > CLIENT_SESSION_MAX_DAYS * DAY_MS
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

/**
 * Where to send a member after signing in. Only a path inside the client space
 * is honoured: anything else — another origin, `//evil.test`, an operator page
 * — falls back to the home, so the parameter can never become an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/espace'
  if (!/^\/espace(?:[/?#]|$)/.test(raw)) return '/espace'
  if (raw.includes('//') || raw.includes('\\')) return '/espace'
  return raw
}
