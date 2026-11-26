import { describe, expect, it } from 'vitest'
import { createRateLimiter, hitAll } from './rate-limit'

const RULE = { limit: 3, windowMs: 60_000 }

function clock(start = 0) {
  let at = start
  return { now: () => at, advance: (ms: number) => { at += ms } }
}

describe('createRateLimiter', () => {
  it('laisse passer jusqu a la limite, puis refuse avec le delai restant', () => {
    const time = clock()
    const limiter = createRateLimiter(RULE, time.now)

    expect([1, 2, 3].map(() => limiter.hit('a').allowed)).toEqual([true, true, true])
    time.advance(20_000)
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 40 })
  })

  it('rouvre la fenetre une fois le delai ecoule', () => {
    const time = clock()
    const limiter = createRateLimiter(RULE, time.now)
    for (let i = 0; i < 4; i++) limiter.hit('a')

    time.advance(60_000)
    expect(limiter.hit('a').allowed).toBe(true)
  })

  it('compte chaque cle a part', () => {
    const limiter = createRateLimiter(RULE, clock().now)
    for (let i = 0; i < 4; i++) limiter.hit('a')
    expect(limiter.hit('b').allowed).toBe(true)
  })
})

describe('hitAll', () => {
  it('refuse des qu une des cles est pleine, et compte toutes les cles', () => {
    const limiter = createRateLimiter(RULE, clock().now)
    for (let i = 0; i < 3; i++) limiter.hit('ip:1')

    expect(hitAll(limiter, ['email:x', 'ip:1']).allowed).toBe(false)
    // email:x was counted by the refused attempt: two more fit, not three.
    expect(hitAll(limiter, ['email:x', 'ip:2']).allowed).toBe(true)
    expect(hitAll(limiter, ['email:x', 'ip:3']).allowed).toBe(true)
    expect(hitAll(limiter, ['email:x', 'ip:4']).allowed).toBe(false)
  })
})
