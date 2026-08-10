// ─────────────────────────────────────────────────────────────────────────────
// Smart Linking
// SEO Engine - Builds the internal mesh of a generated page from the pages that
//              already exist on the site
// ─────────────────────────────────────────────────────────────────────────────

import type { Generation, PageType, ExternalLink } from '@/lib/types'
import {
  escapeAttribute,
  injectAnchors,
  injectInternalLinks,
  type InternalLinkTarget,
} from './internal-linking'

export interface LinkGraph {
  pillarId: string
  pillarSlug: string
  pillarTitle: string
  children: Array<{ id: string; slug: string; title: string; pageType: PageType }>
}

export interface SmartLinkResult {
  htmlContent: string
  /** Anchors woven into the copy. */
  injectedInternalLinks: string[]
  /** Anchors listed in the "see also" / hub block. */
  navigationLinks: string[]
  injectedExternalLinks: string[]
  linkCount: { internal: number; external: number }
}

export function buildLinkGraph(generations: Generation[]): LinkGraph[] {
  const pillars = generations.filter((g) => g.page_type === 'pillar' && g.slug)
  return pillars.map((pillar) => {
    const children = generations.filter(
      (g) => g.parent_generation_id === pillar.id && g.slug && g.id !== pillar.id
    )
    return {
      pillarId: pillar.id,
      pillarSlug: pillar.slug!,
      pillarTitle: pillar.title || pillar.focus_keyword || '',
      children: children.map((c) => ({
        id: c.id,
        slug: c.slug!,
        title: c.title || c.focus_keyword || '',
        pageType: c.page_type || 'child' as PageType,
      })),
    }
  })
}

export function applySmartLinking(opts: {
  htmlContent: string
  currentPage: { id: string; slug: string; pageType: PageType; parentGenerationId?: string }
  linkGraph: LinkGraph[]
  siteUrl: string
  externalLinks?: ExternalLink[]
  /**
   * Destinations that exist on the site but are not in the pillar/child graph.
   *
   * Without these the linker is empty-handed on almost every page: the graph is
   * built from `parent_generation_id`, which the scheduler never sets, so a
   * freshly generated child page finds no parent and no siblings. The caller
   * supplies real published pages instead, and they are used after the graph.
   */
  extraTargets?: InternalLinkTarget[]
  maxInternalLinks?: number
  maxExternalLinks?: number
}): SmartLinkResult {
  const {
    htmlContent,
    currentPage,
    linkGraph,
    siteUrl,
    externalLinks = [],
    extraTargets = [],
    maxInternalLinks = 5,
    maxExternalLinks = 3,
  } = opts

  const graphTargets: InternalLinkTarget[] = []

  if (currentPage.pageType === 'pillar') {
    const graph = linkGraph.find((g) => g.pillarSlug === currentPage.slug)
    if (graph) {
      for (const child of graph.children) {
        graphTargets.push({ anchor: child.title, href: `/${child.slug}` })
      }
    }
  } else {
    const parentGraph = linkGraph.find((g) =>
      g.children.some((c) => c.id === currentPage.id) || g.pillarId === currentPage.parentGenerationId
    )
    if (parentGraph) {
      graphTargets.push({ anchor: parentGraph.pillarTitle, href: `/${parentGraph.pillarSlug}` })
      for (const sibling of parentGraph.children.filter((c) => c.id !== currentPage.id)) {
        graphTargets.push({ anchor: sibling.title, href: `/${sibling.slug}` })
      }
    }
  }

  const internalTargets = dedupeTargets([...graphTargets, ...extraTargets], currentPage.slug)
    .slice(0, maxInternalLinks)

  const { htmlContent: linkedHtml, injectedLinks: injectedInternalLinks } =
    injectInternalLinks(htmlContent, internalTargets)

  let finalHtml = linkedHtml
  const injectedExternalLinks: string[] = []

  if (externalLinks.length > 0) {
    finalHtml = injectExternalLinks(finalHtml, externalLinks.slice(0, maxExternalLinks), injectedExternalLinks)
  }

  // Anything already woven into a sentence is left out of the block below: two
  // links to the same page on one page is one link and one distraction.
  const injectedHrefs = new Set(
    internalTargets
      .filter((target) => injectedInternalLinks.some((html) => html.includes(`href="${escapeAttribute(target.href)}"`)))
      .map((target) => target.href)
  )
  const navigationTargets = internalTargets.filter((target) => !injectedHrefs.has(target.href))

  if (currentPage.pageType === 'pillar') {
    const graph = linkGraph.find((g) => g.pillarSlug === currentPage.slug)
    if (graph && graph.children.length > 0) {
      finalHtml = insertBeforeCta(finalHtml, buildPillarHubBlock(graph, siteUrl))
    } else if (navigationTargets.length > 0) {
      finalHtml = insertBeforeCta(finalHtml, buildChildNavigationBlock(navigationTargets, siteUrl))
    }
  } else if (navigationTargets.length > 0) {
    finalHtml = insertBeforeCta(finalHtml, buildChildNavigationBlock(navigationTargets, siteUrl))
  }

  const navigationLinks = navigationTargets.map((target) => target.href)

  return {
    htmlContent: finalHtml,
    injectedInternalLinks,
    navigationLinks,
    injectedExternalLinks,
    linkCount: {
      internal: injectedInternalLinks.length + navigationLinks.length,
      external: injectedExternalLinks.length,
    },
  }
}

/**
 * One entry per destination, self-links dropped.
 *
 * A page linking to itself is not a mesh, and the generator proposes it often —
 * its own slug is the one it has just been told about.
 */
function dedupeTargets(targets: InternalLinkTarget[], currentSlug: string): InternalLinkTarget[] {
  const self = normalizeSlug(currentSlug)
  const seen = new Set<string>()
  const result: InternalLinkTarget[] = []

  for (const target of targets) {
    const anchor = (target.anchor || '').trim()
    const href = (target.href || '').trim()
    if (!anchor || !href) continue

    const key = normalizeSlug(href)
    if (!key || key === self || seen.has(key)) continue

    seen.add(key)
    result.push({ anchor, href })
  }

  return result
}

function normalizeSlug(value: string): string {
  return (value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()
}

function injectExternalLinks(html: string, links: ExternalLink[], injected: string[]): string {
  const render = (link: ExternalLink) => (text: string) =>
    `<a href="${escapeAttribute(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttribute(link.relevance)}">${text}</a>`

  const { htmlContent, injectedLinks } = injectAnchors(
    html,
    links.map((link) => ({ anchor: link.anchor, key: link.url, render: render(link) }))
  )
  injected.push(...injectedLinks)

  // Sources whose anchor phrase is nowhere in the copy still have to be cited:
  // the generator was asked for them, and a source that is not linked is not a
  // source. They go at the end rather than being forced into a sentence.
  let result = htmlContent
  for (const link of links) {
    if (injectedLinks.some((anchorHtml) => anchorHtml.includes(`href="${escapeAttribute(link.url)}"`))) continue

    const anchorHtml = render(link)(escapeAttribute(link.anchor))
    const lastP = result.lastIndexOf('</p>')
    if (lastP === -1) continue

    result = `${result.slice(0, lastP + 4)}\n<p class="external-ref">Source : ${anchorHtml}</p>${result.slice(lastP + 4)}`
    injected.push(anchorHtml)
  }

  return result
}

function buildChildNavigationBlock(links: InternalLinkTarget[], siteUrl: string): string {
  const baseUrl = siteUrl.replace(/\/$/, '')
  const listItems = links
    .map((l) => `<li><a href="${escapeAttribute(baseUrl + l.href)}">${escapeAttribute(l.anchor)}</a></li>`)
    .join('\n    ')
  return `
<nav class="related-pages" aria-label="Pages associées">
  <h3>À lire également</h3>
  <ul>
    ${listItems}
  </ul>
</nav>`
}

function buildPillarHubBlock(graph: LinkGraph, siteUrl: string): string {
  const baseUrl = siteUrl.replace(/\/$/, '')
  const cards = graph.children
    .map((child) => {
      const typeLabel = PAGE_TYPE_LABELS[child.pageType] || child.pageType
      return `<li>
      <a href="${escapeAttribute(`${baseUrl}/${child.slug}`)}" class="hub-link">
        <span class="hub-type">${escapeAttribute(typeLabel)}</span>
        <span class="hub-title">${escapeAttribute(child.title)}</span>
      </a>
    </li>`
    })
    .join('\n    ')

  return `
<section class="pillar-hub" aria-label="Sommaire du cluster">
  <h2>Explorez nos guides détaillés</h2>
  <ul class="hub-grid">
    ${cards}
  </ul>
</section>`
}

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  pillar: 'Guide complet',
  child: 'Détail',
  alternative: 'Alternatives',
  comparative: 'Comparatif',
  local_pack: 'Local',
}

function insertBeforeCta(html: string, block: string): string {
  const ctaPatterns = [
    /<section[^>]*class="[^"]*cta[^"]*"[^>]*>/i,
    /<div[^>]*class="[^"]*cta[^"]*"[^>]*>/i,
    /<h2[^>]*>.*(?:contact|rdv|rendez-vous|devis).*<\/h2>/i,
  ]
  for (const pattern of ctaPatterns) {
    const match = html.match(pattern)
    if (match && match.index !== undefined) {
      return html.slice(0, match.index) + block + '\n' + html.slice(match.index)
    }
  }
  const lastSection = html.lastIndexOf('</section>')
  if (lastSection !== -1) {
    return html.slice(0, lastSection) + block + '\n' + html.slice(lastSection)
  }
  return html + block
}
