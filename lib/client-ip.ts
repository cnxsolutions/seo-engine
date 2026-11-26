// ─────────────────────────────────────────────────────────────────────────────
// The address a request came from, behind nginx — as a rate-limit key
// ─────────────────────────────────────────────────────────────────────────────
//
// nginx sets `X-Real-IP $remote_addr` (deploy/bootstrap.sh): the peer it saw,
// which a client cannot choose. `X-Forwarded-For` comes second because nginx
// APPENDS to it — its first entry is whatever the client chose to send — so
// only its LAST entry, the one nginx added, is read. With no proxy at all
// (`next dev`), there is no header and every request counts as one address.
//
// An IPv6 address is reduced to its /64: one subscriber line holds 2^64 of
// them, and a limit per full address would be a limit per nothing.

export function clientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim()
  const forwarded = headers.get('x-forwarded-for')?.split(',').map((part) => part.trim()).filter(Boolean).at(-1)
  const ip = realIp || forwarded
  return ip ? rateLimitKey(ip) : 'unknown'
}

/** IPv4 as is; IPv4-mapped IPv6 as its IPv4; any other IPv6 as its /64 prefix. */
export function rateLimitKey(ip: string): string {
  const address = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  if (!address.includes(':')) return address

  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return mapped[1]

  const [head, tail = ''] = address.split('::')
  const left = head ? head.split(':') : []
  const right = address.includes('::') && tail ? tail.split(':') : []
  const groups = address.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`
}
