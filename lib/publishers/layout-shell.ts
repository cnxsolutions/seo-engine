// ─────────────────────────────────────────────────────────────────────────────
// What the site's layout already provides
// SEO Engine - Do not emit a shell the layout has already built.
// ─────────────────────────────────────────────────────────────────────────────
//
// Two connected sites do the opposite thing, and neither is wrong:
//
//   taxidriver10   layout.tsx renders `{children}` and nothing else; every page
//                  opens its own `<main className="bg-dark-premium">` and mounts
//                  its own navigation and footer.
//   renovation-bt  layout.tsx renders `<Header /><main className="flex-1">
//                  {children}</main><Footer />`; a page is content only.
//
// Emitting the same page for both breaks one of them. On the second site the
// scaffold would produce `<main>` inside the layout's `<main>` — two main
// landmarks in one document, which is invalid HTML and makes assistive
// technology announce the page twice.
//
// It also explains a report that read as a failure and was not: the chrome
// extraction finds nothing shared between that site's pages, because there IS
// nothing shared to find. Its pages are already wrapped. "No chrome" and "chrome
// comes from the layout" look identical from the pages alone, and only one of
// them is a problem.

export interface LayoutShell {
  /** The layout opens a `<main>`, so the page must not open another. */
  hasMain: boolean
  /** Components the layout mounts around `{children}` — the page need not. */
  components: string[]
  /** True when the layout wraps the page in anything at all. */
  wraps: boolean
}

export const NO_LAYOUT_SHELL: LayoutShell = { hasMain: false, components: [], wraps: false }

const DEFAULT_IMPORT = /^import\s+(?:\{\s*([A-Z][A-Za-z0-9_]*)\s*\}|([A-Z][A-Za-z0-9_]*))\s+from\s+['"][^'"]+['"]/

/**
 * Read the shell out of a layout file.
 *
 * Only components imported by the layout AND mounted in it count. A named
 * import is as valid as a default one here — `import { Header } from …` is what
 * the second site uses, and a default-only reader would have seen an empty
 * layout and drawn the wrong conclusion.
 */
export function readLayoutShell(source: string | null | undefined): LayoutShell {
  if (!source) return NO_LAYOUT_SHELL

  const imported = new Set<string>()
  for (const line of source.split(/\r?\n/)) {
    // A single line can carry several named imports.
    const named = line.match(/^import\s+\{([^}]+)\}\s+from/)
    if (named) {
      for (const part of named[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Z]/.test(name)) imported.add(name)
      }
      continue
    }
    const match = line.trim().match(DEFAULT_IMPORT)
    const name = match?.[1] ?? match?.[2]
    if (name) imported.add(name)
  }

  const components: string[] = []
  for (const match of source.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) {
    const name = match[1]
    if (imported.has(name) && !components.includes(name)) components.push(name)
  }

  // `<main` in the layout, not anywhere in the file: a comment mentioning it
  // does not wrap anything.
  const hasMain = /<main[\s>]/.test(source)

  return { hasMain, components, wraps: hasMain || components.length > 0 }
}
