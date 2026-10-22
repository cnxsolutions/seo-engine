// ─────────────────────────────────────────────────────────────────────────────
// Article typography
// SEO Engine - A generated page stays readable on a site that styles nothing.
// ─────────────────────────────────────────────────────────────────────────────
//
// Tailwind resets every margin, heading size and list bullet; a site gives them
// back with the Typography plugin (`prose`) or its own CSS. The engine's
// templates wrapped articles in `prose` on two sites that had no such plugin,
// and 42 paragraphs, 13 H2 and 6 lists read as one block of text
// (artisan-boisson-teddy.fr, flowyne.com, 2026-10-22).
//
// So a page on a site without the plugin carries a minimal typography of its
// own, and yields to anything the site does: every selector sits behind
// `:where()`, which weighs nothing, so a rule weighs what a bare element
// selector does. It beats Tailwind's reset (same weight, declared later) and
// loses to any class the site styles content with.
//
// Skipped where the plugin IS installed: on Tailwind 4 the site's rules live in
// cascade layers, and an unlayered block like this one would win over `prose`
// whatever its weight.

export const ARTICLE_CLASS = 'seo-article'

const scope = `:where(.${ARTICLE_CLASS})`

export const ARTICLE_CSS = [
  `${scope} :where(p, ul, ol, table, figure, blockquote){margin:0 0 1.1em}`,
  `${scope} :where(p, li){line-height:1.7}`,
  `${scope} h1{font-size:2em;font-weight:800;line-height:1.2;margin:0 0 .6em}`,
  `${scope} h2{font-size:1.5em;font-weight:700;line-height:1.3;margin:1.8em 0 .6em}`,
  `${scope} h3{font-size:1.2em;font-weight:600;line-height:1.35;margin:1.5em 0 .5em}`,
  `${scope} ul{list-style:disc;padding-left:1.4em}`,
  `${scope} ol{list-style:decimal;padding-left:1.4em}`,
  `${scope} li+li{margin-top:.4em}`,
  `${scope} a{text-decoration:underline;text-underline-offset:2px}`,
  `${scope} strong{font-weight:700}`,
  `${scope} table{width:100%;border-collapse:collapse}`,
  `${scope} :where(th, td){border:1px solid rgb(0 0 0 / .12);padding:.5em .75em;text-align:left;vertical-align:top}`,
  `${scope} img{max-width:100%;height:auto;border-radius:.5em}`,
].join('')

/** The article, wrapped in its own typography. */
export function withArticleStyles(html: string): string {
  return `<style>${ARTICLE_CSS}</style><div class="${ARTICLE_CLASS}">${html}</div>`
}

/**
 * Whether a site's package.json installs the Tailwind Typography plugin.
 *
 * Unreadable or absent counts as no: the cost of styles nobody needed is a few
 * hundred bytes, the cost of the opposite is a page that reads as one block.
 */
export function hasTypographyPlugin(packageJson: string | null): boolean {
  if (!packageJson) return false
  try {
    const manifest = JSON.parse(packageJson) as { dependencies?: object; devDependencies?: object }
    return '@tailwindcss/typography' in { ...manifest.dependencies, ...manifest.devDependencies }
  } catch {
    return false
  }
}
