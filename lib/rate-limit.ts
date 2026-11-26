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
//
// The limiter must not become the attack. The same event loop serves the
// operator console and runs the publishing scheduler, so the Map is BOUNDED
// (MAX_KEYS, then new keys are refused rather than stored) and expired windows
// are swept at most once per SWEEP_INTERVAL_MS, never on every hit.

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

export interface RateLimiterOptions {
  now?: () => number
  /** Live keys kept at most; past it, a NEW key is refused (fail closed). */
  maxKeys?: number
}

const MAX_KEYS = 20_000
const SWEEP_INTERVAL_MS = 10_000

export function createRateLimiter(rule: RateLimitRule, options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? MAX_KEYS
  const windows = new Map<string, Window>()
  let lastSweep = 0

  const sweep = (at: number) => {
    lastSweep = at
    for (const [key, window] of windows) {
      if (window.resetAt <= at) windows.delete(key)
    }
  }

  return {
    hit(key) {
      const at = now()
      const current = windows.get(key)

      if (!current || current.resetAt <= at) {
        if (!current && windows.size >= maxKeys) {
          if (at - lastSweep >= SWEEP_INTERVAL_MS) sweep(at)
          if (windows.size >= maxKeys) return { allowed: false, retryAfterSeconds: Math.ceil(SWEEP_INTERVAL_MS / 1000) }
        }
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
 * One attempt counted against several keys, IN ORDER, stopping at the first
 * refusal. Put the requester's own key (its IP) first: a requester already
 * over its budget then adds nothing to the keys after it — it can neither grow
 * the Map with invented addresses nor eat into a real member's budget.
 */
export function hitAll(limiter: RateLimiter, keys: string[]): RateLimitVerdict {
  for (const key of keys) {
    const verdict = limiter.hit(key)
    if (!verdict.allowed) return verdict
  }
  return { allowed: true, retryAfterSeconds: 0 }
}
