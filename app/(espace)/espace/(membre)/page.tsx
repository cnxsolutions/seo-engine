import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { listMemberSites } from '@/lib/client-space/scope'
import { getClientSession } from '@/lib/client-space/session'

export const metadata: Metadata = { title: 'Votre espace' }

/**
 * /espace — the member's home. In L1, the sites the space covers; the period
 * in progress, the pages and the Google results come with the L2 (ESP-1 to
 * ESP-6), on this same page.
 */
export default async function ClientHomePage() {
  const result = await getClientSession()
  // The layout already refused anything else; this narrows the type.
  if (result.status !== 'active') redirect('/espace/connexion')

  const sites = await listMemberSites(result.session)

  return (
    <>
      <section className="espace-hero" aria-labelledby="espace-hero-title">
        <p className="espace-hero__eyebrow">Espace client</p>
        <h1 id="espace-hero-title" className="espace-hero__title">Bienvenue dans votre espace</h1>
        <p className="espace-hero__text">
          C’est ici que vous suivrez les pages que CNX Solutions écrit et publie pour vous, et ce qu’elles vous rapportent sur Google.
        </p>
      </section>

      <section aria-labelledby="espace-sites-title">
        <h2 id="espace-sites-title" className="espace-section__title">
          {sites.length > 1 ? 'Vos sites' : 'Votre site'}
        </h2>
        {sites.length === 0 ? (
          <p className="espace-site__url">
            Aucun site n’est encore rattaché à votre espace. CNX Solutions s’en occupe : écrivez à contact@cnx-solutions.fr si cela dure.
          </p>
        ) : (
          <ul className="espace-sites">
            {sites.map((site) => (
              <li key={site.id} className="espace-site">
                <p className="espace-site__name">{site.name}</p>
                <p className="espace-site__url">{site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
