// ─────────────────────────────────────────────────────────────────────────────
// Un site, une section — l'en-tête et les onglets communs à toutes ses pages
//
// Décision du propriétaire (17/10/2026) : « tout doit être fait lorsque je vais
// dans une page de site : calendrier, performances Google Search, publication…
// Pas de pages orphelines ailleurs. » Le calendrier, la file de publication,
// Search Console et les réglages vivaient sur des écrans transverses qui
// ouvraient sur TOUS les sites et faisaient rechoisir le site à chaque fois.
// Ils sont maintenant des onglets de /sites/<id>, et ce layout est ce qui les
// tient ensemble : le nom du site une fois, l'adresse, le connecteur, la barre
// d'onglets.
//
// Les anciennes adresses transverses (/calendar, /publish, /generate,
// /analytics, /schema, /strategy) deviennent des sélecteurs de site qui
// redirigent ici ; aucune ne garde de contenu à elle.
// ─────────────────────────────────────────────────────────────────────────────

import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { SiteHero } from '@/components/SiteHero'
import { SiteTabs } from '@/components/SiteTabs'
import { SITE_HEADER_TEXT } from '@/lib/console-labels'
import { readSitePeriod } from '@/lib/period'
import { connectorOf, loadSite } from './site-data'

export const dynamic = 'force-dynamic'

export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const site = await loadSite(id)
  if (!site) notFound()

  const connector = connectorOf(site.type)
  // The band's thread: the cycle in progress. A failed read draws no thread rather than a wrong one.
  const period = await readSitePeriod(site.id).catch(() => null)

  return (
    <div className="site-shell">
      <SiteHero
        icon={connector.icon}
        connectorLabel={connector.label}
        name={site.name}
        url={site.url}
        period={period}
        meta={
          <>
            {site.type === 'nextjs' && site.github_repo && (
              <span>{SITE_HEADER_TEXT.repository(site.github_repo, site.github_branch)}</span>
            )}
            {site.type === 'wordpress' && site.wp_username && <span>{SITE_HEADER_TEXT.wordpressUser(site.wp_username)}</span>}
          </>
        }
      >
        <SiteTabs siteId={site.id} />
      </SiteHero>

      {/* Sur chaque onglet, pas seulement la vue d'ensemble : c'est depuis le
          calendrier ou la publication qu'on se demande pourquoi rien ne part. */}
      {!site.is_active && (
        <p className="hub-warning" role="status">
          <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span>
            Site désactivé : le planificateur l’ignore, rien n’y sera généré ni publié.{' '}
            <Link href={`/sites/${site.id}/reglages`} className="btn-link">Le réactiver dans les réglages</Link>
          </span>
        </p>
      )}

      {children}
    </div>
  )
}
