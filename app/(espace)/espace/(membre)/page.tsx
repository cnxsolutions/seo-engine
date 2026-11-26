import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CLIENT_SPACE_TEXT } from '@/lib/client-space/labels'
import { listMemberSites } from '@/lib/client-space/scope'
import { getClientSession } from '@/lib/client-space/session'

export const metadata: Metadata = { title: 'Votre espace' }

/**
 * /espace — straight to the first site (alphabetical). Every screen of the
 * space is about one site, and the switcher at the top of each one moves to
 * another. Only a client with no site yet stays here.
 */
export default async function ClientHomePage() {
  const result = await getClientSession()
  // The layout already refused anything else; this narrows the type.
  if (result.status !== 'active') redirect('/espace/connexion')

  const [first] = await listMemberSites(result.session)
  if (first) redirect(`/espace/${first.id}`)

  return (
    <main id="contenu" className="espace-main">
      <section className="espace-hero" aria-labelledby="espace-hero-title">
        <p className="espace-hero__eyebrow">Espace client</p>
        <h1 id="espace-hero-title" className="espace-hero__title">{CLIENT_SPACE_TEXT.noSiteTitle}</h1>
        <p className="espace-hero__text">{CLIENT_SPACE_TEXT.noSiteBody}</p>
      </section>
    </main>
  )
}
