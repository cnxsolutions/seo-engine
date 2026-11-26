import { currentSite } from './current-site'
import { SiteSwitcher } from './SiteSwitcher'
import { SpaceNav } from './SpaceNav'

/**
 * The frame of one site's space: which site (and a switcher when the client
 * has several, ESP-4), the sections, the content. A site of another client is
 * a 404 here (current-site.ts), before any section reads a row.
 */
export default async function SiteSpaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { site, sites } = await currentSite(siteId)

  return (
    <div className="espace-site">
      <SpaceNav siteId={site.id} />
      <main id="contenu" className="espace-main">
        {sites.length > 1 ? (
          <SiteSwitcher sites={sites.map(({ id, name }) => ({ id, name }))} currentId={site.id} />
        ) : (
          <p className="espace-site__name">{site.name}</p>
        )}
        {children}
      </main>
    </div>
  )
}
