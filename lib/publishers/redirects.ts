// ─────────────────────────────────────────────────────────────────────────────
// Paths the site redirects away from
// SEO Engine - Never publish a page at a URL that sends visitors elsewhere.
// ─────────────────────────────────────────────────────────────────────────────
//
// The file-existence guard was not enough, and the gap cost a real publication.
//
// A cleaned-up slug came out as `/taxi-troyes`. No file existed at
// `src/app/(seo)/taxi-troyes/page.tsx`, so the guard allowed it — but the site's
// middleware carries:
//
//   // Fix homepage ↔ /taxi-troyes cannibalization
//   '/taxi-troyes': '/',
//
// The owner had deliberately redirected that URL to the homepage to stop the two
// competing. Publishing there produced a page nobody can reach, and — worse —
// added the path to the site's route registry, where its own SEO check (rule
// IDX-003: a listed route must never be a redirect source) fails the build.
//
// So the engine reads the redirect map before it writes. A path the site sends
// away from is not a free slot; it is a decision someone made, and usually one
// made against the exact page we are about to publish.

/**
 * Redirect sources declared in a middleware or config file.
 *
 * Matches the shapes these files actually use — a map literal
 * (`'/from': '/to'`), and Next.js `redirects()` entries (`source: '/from'`).
 * Anything computed at runtime is invisible here, which is why this guard is a
 * floor and not a proof.
 */
export function readRedirectSources(source: string | null | undefined): string[] {
  if (!source) return []

  const paths = new Set<string>()

  // `'/taxi-troyes': '/',` — a lookup table, the most common shape.
  for (const match of source.matchAll(/['"](\/[^'"\s]*)['"]\s*:\s*['"]\/[^'"]*['"]/g)) {
    paths.add(normalisePath(match[1]))
  }

  // `{ source: '/old', destination: '/new' }` — the next.config.js shape.
  for (const match of source.matchAll(/source\s*:\s*['"](\/[^'"\s]*)['"]/g)) {
    paths.add(normalisePath(match[1]))
  }

  return [...paths]
}

/** `/Taxi-Troyes/` and `/taxi-troyes` are the same route. */
function normalisePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '').toLowerCase()
  return trimmed || '/'
}

/** Would publishing at this slug land on a path the site redirects away from? */
export function isRedirectSource(slug: string, redirects: string[] | undefined): boolean {
  if (!redirects?.length) return false
  return redirects.includes(normalisePath(`/${slug}`))
}
