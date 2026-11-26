// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting, in memory
// SEO Engine - Counts attempts per key in fixed windows, inside the process.
// ─────────────────────────────────────────────────────────────────────────────
//
// In memory, deliberately: the application runs as ONE instance (CLAUDE.md, the
// in-process scheduler), so a Map is the whole truth. The day the scheduler
// leaves the process and a second instance appears, this moves to the database
// with it — a per-process counter would then let through N times the limit.
//
// A restart forgets every counter. That is acceptable for what this guards
// (codes requested and typed, § 3.8): Supabase keeps its own ceilings behind.

import type { RateLimitRule } from '@/src/core/domain/client-access/policy'

export interface RateLimitVerdict {
  allowed: boolean
  /** Seconds until the window of the key reopens; 0 when allowed. */
  retryAfterSeconds: number
}

export interface RateLimiter {
  /** Counts one attempt for `key` and says whether it fits in the rule. */
  hit(key: string): RateLimitVerdict
}

interface Window {
  count: number
  resetAt: number
}

/** Past this many live keys, expired windows are swept on the next hit. */
const SWEEP_THRESHOLD = 5_000

export function createRateLimiter(rule: RateLimitRule, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>()

  const sweep = (at: number) => {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key)
    }
  }

  return {
    hit(key) {
      const at = now()
      if (windows.size > SWEEP_THRESHOLD) sweep(at)

      const current = windows.get(key)
      if (!current || current.resetAt <= at) {
        windows.set(key, { count: 1, resetAt: at + rule.windowMs })
        return { allowed: true, retryAfterSeconds: 0 }
      }

      current.count += 1
      if (current.count <= rule.limit) return { allowed: true, retryAfterSeconds: 0 }
      return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - at) / 1000) }
    },
  }
}

/**
 * One attempt counted against several keys at once (the address AND the IP):
 * refused as soon as one of them is over. Every key is counted, even after a
 * refusal, so hammering one address from many IPs still fills its window.
 */
export function hitAll(limiter: RateLimiter, keys: string[]): RateLimitVerdict {
  let verdict: RateLimitVerdict = { allowed: true, retryAfterSeconds: 0 }
  for (const key of keys) {
    const result = limiter.hit(key)
    if (!result.allowed && result.retryAfterSeconds >= verdict.retryAfterSeconds) verdict = result
  }
  return verdict
}
