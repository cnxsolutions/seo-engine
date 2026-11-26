// ─────────────────────────────────────────────────────────────────────────────
// The address a request came from, behind nginx
// ─────────────────────────────────────────────────────────────────────────────
//
// nginx sets `X-Real-IP $remote_addr` (deploy/bootstrap.sh): the peer it saw,
// which a client cannot choose. `X-Forwarded-For` comes second because nginx
// APPENDS to it — its first entry is whatever the client chose to send — so
// only its LAST entry, the one nginx added, is read. With no proxy at all
// (`next dev`), there is no header and every request counts as one address.

export function clientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = headers.get('x-forwarded-for')
  const last = forwarded?.split(',').map((part) => part.trim()).filter(Boolean).at(-1)
  return last || 'unknown'
}
