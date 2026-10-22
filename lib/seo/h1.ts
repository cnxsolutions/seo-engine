// ─────────────────────────────────────────────────────────────────────────────
// One H1 per page
// SEO Engine - The destination keeps its H1, the article gives up its own.
// ─────────────────────────────────────────────────────────────────────────────
//
// The generator opens every article with an <h1> — the audit requires one, and
// it is the only H1 a page built from nothing else would have. But most pages
// it lands in already print one: a WordPress theme shows the post title as the
// H1, a Next.js template shows {{TITLE}} in its hero. Both live pages checked on
// 2026-10-22 carried two, the second right under the first.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name])
}

/**
 * The article's first H1, taken out: its text, and the article without it.
 *
 * Only the first one — the generator writes exactly one, at the top. An article
 * without any comes back untouched, with `h1: null`.
 */
export function takeLeadingH1(html: string): { h1: string | null; body: string } {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)
  if (!match) return { h1: null, body: html }

  const text = decode(match[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
  const body = `${html.slice(0, match.index)}${html.slice(match.index + match[0].length)}`.replace(/^\s+/, '')
  return { h1: text || null, body }
}
