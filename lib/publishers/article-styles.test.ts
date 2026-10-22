// ─────────────────────────────────────────────────────────────────────────────
// Article typography — tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { ARTICLE_CSS, hasTypographyPlugin, withArticleStyles } from './article-styles'

describe('withArticleStyles', () => {
  it('wraps the article and gives it paragraph spacing, heading sizes and list bullets', () => {
    const out = withArticleStyles('<h2>Titre</h2><p>Texte</p>')
    expect(out).toMatch(/^<style>.+<\/style><div class="seo-article"><h2>Titre<\/h2><p>Texte<\/p><\/div>$/)
    expect(ARTICLE_CSS).toContain('list-style:disc')
    expect(ARTICLE_CSS).toContain('h2{font-size:1.5em')
  })

  it('weighs nothing more than a bare element: every rule sits behind :where()', () => {
    for (const rule of ARTICLE_CSS.split('}').filter(Boolean)) {
      expect(rule.startsWith(':where(.seo-article)')).toBe(true)
    }
  })
})

describe('hasTypographyPlugin', () => {
  it('reads the plugin in dependencies or devDependencies', () => {
    expect(hasTypographyPlugin('{"devDependencies":{"@tailwindcss/typography":"^0.5.20"}}')).toBe(true)
    expect(hasTypographyPlugin('{"dependencies":{"@tailwindcss/typography":"^0.5.20"}}')).toBe(true)
  })

  it('says no when absent, unreadable or missing', () => {
    expect(hasTypographyPlugin('{"devDependencies":{"tailwindcss":"^4"}}')).toBe(false)
    expect(hasTypographyPlugin('{oops')).toBe(false)
    expect(hasTypographyPlugin(null)).toBe(false)
  })
})
