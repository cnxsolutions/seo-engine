// ─────────────────────────────────────────────────────────────────────────────
// Generated route registry
// SEO Engine - Make a published page discoverable, not just present.
// ─────────────────────────────────────────────────────────────────────────────
//
// A page committed into `app/(seo)/<slug>/page.tsx` renders when someone asks
// for it and is otherwise invisible: nothing links to it and nothing lists it.
// On the connected site the sitemap derives from a hand-maintained registry, so
// every page the engine published so far is absent from it. Publishing an
// article that no crawler is told about is most of the work for none of the
// result.
//
// The engine therefore maintains ONE additional file, and only that one. It is
// a plain array the site spreads into its own registry, so the site keeps
// ownership of priorities, of the type, and of the decision to include it at
// all.
//
// The file is parsed and rewritten wholesale rather than patched by string
// insertion. The previous sitemap updater counted braces to find an insertion
// point, which works until a comment contains a brace.

/** One entry, matching the shape the connected site already declares. */
export interface GeneratedRoute {
  path: string
  lastModified: string
  priority: number
  changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
}

/**
 * Priority by layout family.
 *
 * A pillar page is the hub its children point at, so it outranks them. These
 * are the site's own conventions, read off its existing registry: 0.9 for the
 * page it wants ranked, 0.8 for the standard ones.
 */
const PRIORITY: Record<string, number> = {
  pilier: 0.9,
  local: 0.8,
  comparatif: 0.8,
}

export function routeForPublication(opts: {
  path: string
  variant: string
  today: string
}): GeneratedRoute {
  return {
    path: opts.path,
    lastModified: opts.today,
    priority: PRIORITY[opts.variant] ?? 0.8,
    // Monthly, not weekly. An SEO article is revised when the facts change, not
    // on a schedule, and a frequency the crawler can disprove is discarded.
    changeFrequency: 'monthly',
  }
}

/**
 * Read the entries out of a previously generated file.
 *
 * Returns an empty list for a file that does not exist or that we cannot read
 * with confidence — never a partial list. Half a registry silently replacing a
 * whole one would drop pages out of the sitemap, which is worse than the
 * problem this solves.
 */
export function parseGeneratedRoutes(source: string | null): GeneratedRoute[] {
  if (!source) return []

  // Anchored on the export statement, matched as a whole.
  //
  // Two narrower attempts both failed, and both failed the same way — returning
  // an empty list, which the caller reads as "no routes yet", so every
  // publication would have rewritten the registry with a single entry and
  // silently dropped every previously published page out of the sitemap:
  //
  //   - `indexOf('[')` matched the bracket in `readonly IndexableRoute[]`;
  //   - `indexOf('GENERATED_ROUTES')` matched the mention inside this file's own
  //     usage comment, several lines above the real export.
  //
  // The round-trip test is what caught both. Losing the sitemap is exactly the
  // kind of damage that shows up as a traffic curve six weeks later.
  const match = source.match(/export\s+const\s+GENERATED_ROUTES[^=]*=\s*\[/)
  if (!match || match.index === undefined) return []

  const open = match.index + match[0].length - 1
  const close = source.lastIndexOf(']')
  if (close <= open) return []

  try {
    const parsed = JSON.parse(source.slice(open, close + 1))
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is GeneratedRoute =>
        entry && typeof entry.path === 'string' && typeof entry.lastModified === 'string'
    )
  } catch {
    return []
  }
}

/** Add or refresh one entry, keeping the list ordered and free of duplicates. */
export function upsertRoute(routes: GeneratedRoute[], entry: GeneratedRoute): GeneratedRoute[] {
  const others = routes.filter((route) => route.path !== entry.path)
  return [...others, entry].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Render the file.
 *
 * The array is emitted as strict JSON so that reading it back is `JSON.parse`
 * rather than a parser of our own. The cost is quoted keys; the benefit is that
 * the round-trip cannot drift.
 */
export function renderGeneratedRoutes(routes: GeneratedRoute[], typeImport: string): string {
  return `import type { IndexableRoute } from '${typeImport}'

/**
 * Routes publiees par SEO Engine.
 *
 * Fichier genere : il est reecrit en entier a chaque publication, toute
 * modification manuelle est perdue. Pour qu'il serve a quelque chose, etale-le
 * dans ROUTES (src/lib/seo/routes.ts) :
 *
 *   import { GENERATED_ROUTES } from './routes.generated'
 *   export const ROUTES: readonly IndexableRoute[] = [
 *     …tes routes…,
 *     ...GENERATED_ROUTES,
 *   ]
 *
 * Sans cette ligne, les pages generees existent mais n'apparaissent ni dans le
 * sitemap ni dans IndexNow.
 */
export const GENERATED_ROUTES: readonly IndexableRoute[] = ${JSON.stringify(routes, null, 2)}
`
}
