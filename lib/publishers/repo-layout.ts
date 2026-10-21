// ─────────────────────────────────────────────────────────────────────────────
// Repository layout
// SEO Engine - Where the Next.js application lives in the tree, and where its
// SEO pages live in the application.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Files whose presence marks the root of a Next.js application.
 *
 * `next.config.*` and not `package.json`: a monorepo carries one package.json
 * per workspace — the Flutter app of cnxsolutions/foodflow has its own — and
 * only the Next.js one has a config file named after the framework.
 */
const NEXT_CONFIG = /(^|\/)next\.config\.(ts|js|mjs|cjs)$/

/**
 * The folder holding the Next.js application, with a trailing slash, or `''`
 * when it is the repository root.
 *
 * The analysis used to assume the root. On a monorepo — a site and an app in
 * one repository, the web part under `nextjs/` — it then found no `src/`, took
 * the first `app/` it could see and reported pages "in app", a folder that does
 * not exist: nothing to compare, no shell, pages published bare.
 *
 * Several applications: the one with the most pages wins, which is the public
 * site far more often than a back-office. Ties go to the shallower one.
 */
export function detectAppRoot(files: string[]): string {
  const roots = files
    .filter((file) => !file.includes('node_modules/') && NEXT_CONFIG.test(file))
    .map((file) => file.replace(/next\.config\.[a-z]+$/, ''))

  if (roots.length === 0) return ''
  if (roots.includes('')) return ''
  if (roots.length === 1) return roots[0]

  const pageCount = (root: string) =>
    files.filter((file) => file.startsWith(root) && /\/page\.(tsx|jsx|ts|js)$/.test(file)).length

  return [...new Set(roots)].sort(
    (a, b) => pageCount(b) - pageCount(a) || a.split('/').length - b.split('/').length
  )[0]
}

/**
 * Route groups that hold the public, indexable site.
 *
 * Preferred outright: a group named for it is the operator telling us where
 * marketing pages go.
 */
const PUBLIC_GROUP = /seo|pages?|public|marketing|site|www|landing|vitrine|front/i

/**
 * Route groups behind a login.
 *
 * Never a destination. On foodflow, `(auth)` holds `reset-password`,
 * `verify-email`, `email-confirmed`… — more dashed slugs than the public group,
 * so counting alone would have published SEO pages next to the login screen,
 * under a layout that redirects anonymous visitors away.
 */
const PRIVATE_GROUP = /auth|admin|dashboard|account|vendor|private|protected|internal|login|user|member|espace|compte|portal|\bapp\b/i

/**
 * Where generated pages go: a route group under `appPath`, or `appPath` itself.
 *
 * `appPath` ends with a slash (`nextjs/src/app/`); the result does not, every
 * consumer appends `/<slug>`.
 *
 * Candidates are scored on the pages that look like SEO landings — static,
 * slug with a dash. A group named for the public site wins outright; a private
 * one never qualifies; otherwise the folder with the most such pages does.
 */
export function pickPageFolder(files: string[], appPath: string): string {
  const root = appPath.replace(/\/$/, '')

  const landings = files
    .filter((file) => file.startsWith(appPath) && file.endsWith('page.tsx'))
    .map((file) => file.slice(appPath.length).replace(/\/?page\.tsx$/, ''))
    .filter((route) => !route.includes('[') && !route.startsWith('api/') && route.includes('-'))

  const counts = new Map<string, number>()
  for (const route of landings) {
    const first = route.split('/')[0]
    const key = first.startsWith('(') ? first : ''
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const score = (key: string) => {
    if (key === '') return counts.get(key) ?? 0
    if (PRIVATE_GROUP.test(key)) return -1
    return (PUBLIC_GROUP.test(key) ? 1_000_000 : 0) + (counts.get(key) ?? 0)
  }

  const best = [...counts.keys()]
    .filter((key) => score(key) > 0)
    .sort((a, b) => score(b) - score(a))[0]

  return best ? `${appPath}${best}` : root
}

/**
 * Turn an `@/…` import into the repository paths it may resolve to.
 *
 * `@/` maps to `src/` on most applications and to the application root on
 * others; only the tree knows which. Both are relative to the APPLICATION, not
 * the repository — on a monorepo, `@/components/X` is `nextjs/src/components/X`.
 */
export function aliasCandidates(specifier: string, appRoot: string): string[] {
  if (!specifier.startsWith('@/')) return [specifier]
  const rest = specifier.slice(2)
  return [`${appRoot}src/${rest}`, `${appRoot}${rest}`]
}

/**
 * The reverse: a repository path back to the `@/…` import the site would write.
 *
 * Returns the path unchanged when it is outside the aliased folder — better an
 * import that fails loudly in review than one silently rewritten.
 */
export function toAliasImport(repoPath: string, srcPrefix: string): string {
  if (repoPath.startsWith('@/')) return repoPath
  if (srcPrefix && repoPath.startsWith(srcPrefix)) return `@/${repoPath.slice(srcPrefix.length)}`
  return repoPath
}
