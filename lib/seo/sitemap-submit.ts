// ─────────────────────────────────────────────────────────────────────────────
// Sending a site's sitemaps to Search Console after a publication
// SEO Engine - The supported way to tell Google a page exists.
// ─────────────────────────────────────────────────────────────────────────────
//
// What Search Console's « Demander l'indexation » button does has no API: the
// URL Inspection API only reads, and the Indexing API is reserved to job
// postings and live streams — Google ignores it for anything else. Resubmitting
// the sitemaps that list the page is the supported signal, and it needs the
// `webmasters` write scope every connection already carries.
//
// Never throws: a page that is online stays published whatever Search Console
// answers. The outcome is a line for the publication's notes.

import { getAuthenticatedClient } from '@/lib/google/client'
import { listSitemaps, submitSitemap } from '@/lib/google/gsc'

export interface SitemapSubmission {
  submitted: string[]
  problems: string[]
}

/**
 * Submit the sitemaps the connector vouches for, plus every sitemap already
 * registered on the site's Search Console property — the owner's own choices,
 * which a new page may well belong to.
 */
export async function resubmitSitemaps(opts: { siteId: string; sitemaps: readonly string[] }): Promise<SitemapSubmission> {
  const problems: string[] = []

  let client: Awaited<ReturnType<typeof getAuthenticatedClient>>
  try {
    client = await getAuthenticatedClient(opts.siteId)
  } catch (error) {
    return { submitted: [], problems: [`pas de connexion Google utilisable (${error instanceof Error ? error.message : error})`] }
  }

  const property = client.connection.gsc_site_url
  if (!property) return { submitted: [], problems: ['aucune propriete Search Console choisie pour ce site'] }

  const registered = await listSitemaps(client.fetch, property).catch(() => [] as string[])
  const targets = [...new Set([...opts.sitemaps, ...registered].map((url) => url.trim()).filter(Boolean))]
  if (targets.length === 0) return { submitted: [], problems: ['aucun sitemap a soumettre'] }

  const submitted: string[] = []
  for (const sitemap of targets) {
    const result = await submitSitemap(client.fetch, property, sitemap).catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    if (result.success) submitted.push(sitemap)
    else problems.push(`${sitemap} : ${result.error ?? 'refuse'}`)
  }
  return { submitted, problems }
}
