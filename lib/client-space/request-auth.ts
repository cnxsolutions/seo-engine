// ─────────────────────────────────────────────────────────────────────────────
// The session client of a route handler or a server component
// ─────────────────────────────────────────────────────────────────────────────
//
// Apart from auth-client.ts so that the proxy, which builds its own client on
// the request, never imports `next/headers`.
//
// A server component cannot write cookies: the write is dropped there, which
// is safe because the proxy (gate.ts) refreshed the session on the way in. A
// route handler can, and its writes reach the response.

import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createAuthClient, readClientAuthEnv } from './auth-client'

export async function createRequestAuthClient(): Promise<SupabaseClient | null> {
  const env = readClientAuthEnv()
  if (!env) return null
  const store = await cookies()
  return createAuthClient(env, {
    getAll: () => store.getAll(),
    setAll: (list) => {
      try {
        for (const { name, value, options } of list) store.set(name, value, options)
      } catch {
        // Server component: read-only cookies, see above.
      }
    },
  })
}
