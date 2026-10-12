// ─────────────────────────────────────────────────────────────────────────────
// One site, one address
// SEO Engine - `https://afs-maintenance.fr` and `https://afs-maintenance.fr/` are
// the same site, and the product must say so before creating a second one.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The address stripped of everything that does not identify the site: scheme,
 * case of the host, trailing slashes, `www.`. Two sites whose normalised
 * addresses match are the same site.
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    return `${host}${path}`
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '')
  }
}
