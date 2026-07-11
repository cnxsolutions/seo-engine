import type { Generation, PageType, ExternalLink } from '@/lib/types'
import { injectInternalLinks, type InternalLinkTarget } from './internal-linking'

export interface LinkGraph {
  pillarId: string
  pillarSlug: string
  pillarTitle: string
  children: Array<{ id: string; slug: string; title: string; pageType: PageType }>
}

export interface SmartLinkResult {
  htmlContent: string
  injectedInternalLinks: string[]
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
  maxInternalLinks?: number
  maxExternalLinks?: number
}): SmartLinkResult {
  const {
    htmlContent,
    currentPage,
    linkGraph,
    siteUrl,
    externalLinks = [],
    maxInternalLinks = 5,
    maxExternalLinks = 3,
  } = opts

  const internalTargets: InternalLinkTarget[] = []

  if (currentPage.pageType === 'pillar') {
    const graph = linkGraph.find((g) => g.pillarSlug === currentPage.slug)
    if (graph) {
      for (const child of graph.children.slice(0, maxInternalLinks)) {
        internalTargets.push({ anchor: child.title, href: `/${child.slug}` })
      }
    }
  } else {
    const parentGraph = linkGraph.find((g) =>
      g.children.some((c) => c.id === currentPage.id) || g.pillarId === currentPage.parentGenerationId
    )
    if (parentGraph) {
      internalTargets.push({ anchor: parentGraph.pillarTitle, href: `/${parentGraph.pillarSlug}` })
      const siblings = parentGraph.children.filter((c) => c.id !== currentPage.id)
      for (const sibling of siblings.slice(0, maxInternalLinks - 1)) {
        internalTargets.push({ anchor: sibling.title, href: `/${sibling.slug}` })
      }
    }
  }

  const { htmlContent: linkedHtml, injectedLinks: injectedInternalLinks } =
    injectInternalLinks(htmlContent, internalTargets)

  let finalHtml = linkedHtml
  const injectedExternalLinks: string[] = []

  if (externalLinks.length > 0) {
    const linksToAdd = externalLinks.slice(0, maxExternalLinks)
    finalHtml = injectExternalLinks(finalHtml, linksToAdd, injectedExternalLinks)
  }

  if (currentPage.pageType !== 'pillar' && internalTargets.length > 0) {
    const navBlock = buildChildNavigationBlock(internalTargets, siteUrl)
    finalHtml = insertBeforeCta(finalHtml, navBlock)
  }

  if (currentPage.pageType === 'pillar') {
    const graph = linkGraph.find((g) => g.pillarSlug === currentPage.slug)
    if (graph && graph.children.length > 0) {
      const hubBlock = buildPillarHubBlock(graph, siteUrl)
      finalHtml = insertBeforeCta(finalHtml, hubBlock)
    }
  }

  return {
    htmlContent: finalHtml,
    injectedInternalLinks,
    injectedExternalLinks,
    linkCount: {
      internal: injectedInternalLinks.length,
      external: injectedExternalLinks.length,
    },
  }
}

function injectExternalLinks(html: string, links: ExternalLink[], injected: string[]): string {
  let result = html
  for (const link of links) {
    const linkHtml = `<a href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.relevance}">${link.anchor}</a>`
    const anchorPattern = new RegExp(`(>[^<]*)(${escapeRegExp(link.anchor)})([^<]*<)`, 'i')

    if (anchorPattern.test(result)) {
      result = result.replace(anchorPattern, (_match, before, anchor, after) => {
        injected.push(linkHtml)
        return `${before}<a href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.relevance}">${anchor}</a>${after}`
      })
    } else {
      const lastP = result.lastIndexOf('</p>')
      if (lastP !== -1) {
        const externalRefHtml = `\n<p class="external-ref">Source : ${linkHtml}</p>`
        result = result.slice(0, lastP + 4) + externalRefHtml + result.slice(lastP + 4)
        injected.push(linkHtml)
      }
    }
  }
  return result
}

function buildChildNavigationBlock(links: InternalLinkTarget[], siteUrl: string): string {
  const baseUrl = siteUrl.replace(/\/$/, '')
  const listItems = links
    .map((l) => `<li><a href="${baseUrl}${l.href}">${l.anchor}</a></li>`)
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
      <a href="${baseUrl}/${child.slug}" class="hub-link">
        <span class="hub-type">${typeLabel}</span>
        <span class="hub-title">${child.title}</span>
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
