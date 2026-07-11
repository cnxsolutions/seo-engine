export interface InternalLinkTarget {
  anchor: string
  href: string
}

export function injectInternalLinks(htmlContent: string, linkMap: InternalLinkTarget[]) {
  let nextHtml = htmlContent
  const injected: string[] = []

  for (const link of linkMap) {
    const escapedAnchor = escapeRegExp(link.anchor)
    const pattern = new RegExp(`(>[^<]*)(${escapedAnchor})([^<]*<)`, 'i')

    if (pattern.test(nextHtml)) {
      nextHtml = nextHtml.replace(pattern, (_match, before, anchor, after) => {
        injected.push(`<a href="${link.href}">${anchor}</a>`)
        return `${before}<a href="${link.href}">${anchor}</a>${after}`
      })
    }
  }

  return {
    htmlContent: nextHtml,
    injectedLinks: injected,
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
