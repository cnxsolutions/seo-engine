// ─────────────────────────────────────────────────────────────────────────────
// The Supabase Auth client of the client space
// docs/cadrage.md § 4.4 — a member's session lives in HttpOnly cookies.
// ─────────────────────────────────────────────────────────────────────────────
//
// The PUBLIC key, never the service key: this client carries a member's
// session, and before sign-in a service-key client would be a superuser one
// careless `.from()` away. It is used for Auth only — every read of data goes
// through lib/client-space/repository.ts and the service key, scoped by
// lib/client-space/scope.ts.
//
// The browser never receives a Supabase key: it talks to our routes, which
// talk to Supabase. Hence cookies the page's JavaScript cannot read — the
// default of @supabase/ssr is readable, because ITS browser client needs them.

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_SESSION_MAX_DAYS } from '@/src/core/domain/client-access/policy'

export interface ClientAuthEnv {
  url: string
  anonKey: string
}

/**
 * Read at request time, by name: a `process.env.NEXT_PUBLIC_…` written out
 * would be inlined at build time, and the Docker image is built without the
 * production values.
 */
export function readClientAuthEnv(): ClientAuthEnv | null {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  return url && anonKey ? { url, anonKey } : null
}

export interface SessionCookie {
  name: string
  value: string
  options: CookieOptions
}

/** Where a client reads and writes its cookies: the request in the proxy, `cookies()` elsewhere. */
export interface CookieJar {
  getAll(): Array<{ name: string; value: string }>
  setAll(cookies: SessionCookie[]): void
}

const SESSION_COOKIE_MAX_AGE = CLIENT_SESSION_MAX_DAYS * 24 * 60 * 60

/**
 * What every session cookie is, whatever the library asked for: unreadable by
 * scripts, sent on top-level navigations only (`Lax` — the e-mail link must
 * work), `Secure` in production, and no longer-lived than a session may be. A
 * removal (max-age 0) stays a removal.
 */
export function sessionCookieOptions(options: CookieOptions): CookieOptions {
  const removing = options.maxAge !== undefined && options.maxAge <= 0
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: removing ? options.maxAge : SESSION_COOKIE_MAX_AGE,
  }
}

export function createAuthClient(env: ClientAuthEnv, jar: CookieJar): SupabaseClient {
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => jar.setAll(list.map((cookie) => ({ ...cookie, options: sessionCookieOptions(cookie.options) }))),
    },
  })
}

/**
 * A session-less public client, for sending a code: nothing to remember, no
 * cookie to write. Still the public key — `signInWithOtp` needs nothing more.
 */
export function createCodeSender(env: ClientAuthEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}
