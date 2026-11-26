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
    const limiter = createRateLimiter(RULE, { now: time.now })

    expect([1, 2, 3].map(() => limiter.hit('a').allowed)).toEqual([true, true, true])
    time.advance(20_000)
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 40 })
  })

  it('rouvre la fenetre une fois le delai ecoule', () => {
    const time = clock()
    const limiter = createRateLimiter(RULE, { now: time.now })
    for (let i = 0; i < 4; i++) limiter.hit('a')

    time.advance(60_000)
    expect(limiter.hit('a').allowed).toBe(true)
  })

  it('compte chaque cle a part', () => {
    const limiter = createRateLimiter(RULE, { now: clock().now })
    for (let i = 0; i < 4; i++) limiter.hit('a')
    expect(limiter.hit('b').allowed).toBe(true)
  })

  it('borne la memoire : plein, il refuse une cle nouvelle mais sert les cles connues', () => {
    const time = clock()
    const limiter = createRateLimiter(RULE, { now: time.now, maxKeys: 2 })
    limiter.hit('a')
    limiter.hit('b')

    expect(limiter.hit('c').allowed).toBe(false)
    expect(limiter.hit('a').allowed).toBe(true)

    // Once the windows have expired, a sweep makes room again.
    time.advance(60_000)
    expect(limiter.hit('c').allowed).toBe(true)
  })
})

describe('hitAll', () => {
  it('s arrete a la premiere cle refusee : une IP au-dela de son budget n entame pas celui de l adresse', () => {
    const limiter = createRateLimiter(RULE, { now: clock().now })
    for (let i = 0; i < 3; i++) limiter.hit('ip:1')

    for (let i = 0; i < 10; i++) expect(hitAll(limiter, ['ip:1', 'email:x']).allowed).toBe(false)
    // email:x was never counted: three attempts still fit, from other IPs.
    expect(hitAll(limiter, ['ip:2', 'email:x']).allowed).toBe(true)
    expect(hitAll(limiter, ['ip:3', 'email:x']).allowed).toBe(true)
    expect(hitAll(limiter, ['ip:4', 'email:x']).allowed).toBe(true)
    expect(hitAll(limiter, ['ip:5', 'email:x']).allowed).toBe(false)
  })
})
