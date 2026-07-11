export interface BreadcrumbItem {
  name: string
  url: string
}

export function buildBreadcrumb(items: BreadcrumbItem[]) {
  const htmlItems = items
    .map((item, index) => {
      const isLast = index === items.length - 1
      if (isLast) return `<li aria-current="page">${escapeHtml(item.name)}</li>`
      return `<li><a href="${escapeAttribute(item.url)}">${escapeHtml(item.name)}</a></li>`
    })
    .join('')

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return {
    html: `<nav aria-label="breadcrumb" class="seo-breadcrumb"><ol>${htmlItems}</ol></nav>`,
    schema: JSON.stringify(schema),
  }
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', '&quot;')
}
