// ─────────────────────────────────────────────────────────────────────────────
// Secret comparison
// SEO Engine - Web Crypto only, so the same helper serves proxy.ts and the
//              WordPress webhook without a runtime-specific branch. Node's own
//              `crypto.timingSafeEqual` would also work now that Next 16 runs
//              the proxy on Node.js, but it refuses buffers of unequal length —
//              which is exactly the equalisation the hash below performs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare a presented secret with the expected one without leaking it through
 * response time.
 *
 * `presented === expected` stops at the first differing byte. On a box reachable
 * from the internet that difference is measurable, and it turns a brute force
 * over the whole secret into a brute force over one byte at a time.
 *
 * Node's answer is `crypto.timingSafeEqual`, which refuses buffers of different
 * lengths — hence the usual "equalise the lengths first". Hashing both sides
 * does that equalisation for free: SHA-256 always yields 32 bytes, so neither
 * the length nor the content of the expected secret shows up in the timing. The
 * XOR accumulator then walks all 32 bytes whatever happens.
 *
 * Web Crypto is a global on every runtime this file reaches (Node 18+ exposes it
 * on `globalThis`), so nothing here is runtime-specific.
 */
export async function timingSafeEqual(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)])

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }

  return diff === 0
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}
