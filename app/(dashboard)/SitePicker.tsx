// ─────────────────────────────────────────────────────────────────────────────
// Les anciens écrans transverses — un sélecteur de site, et rien d'autre
//
// /calendar, /publish, /generate, /analytics, /schema et /strategy ouvraient
// sur tous les sites à la fois et faisaient rechoisir le site dans un menu.
// Décision du propriétaire (17/10/2026) : tout se fait dans la page du site,
// « pas de pages orphelines ailleurs ». Ces adresses restent valides — favoris,
// liens partagés, anciens courriels — mais ne gardent AUCUN contenu propre :
//
//   · `?site=<id>` d'un site connu  → redirection vers son onglet ;
//   · un seul site actif             → redirection vers son onglet ;
//   · sinon                          → « Choisissez un site », une ligne par site.
//
// Un `?site=` inconnu ne mène jamais à un 404 : il retombe sur la liste.
// ─────────────────────────────────────────────────────────────────────────────

import { ChevronRight, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listDashboardSites, type DashboardSite } from '@/app/api/dashboard/metrics'
import { EmptyState, PageHeader } from '@/components/ui'
import { siteTabHref, type SiteTabSlug } from '@/components/site-tabs'

type SearchParams = Record<string, string | string[] | undefined>

export interface SitePickerProps {
  searchParams: SearchParams
  /** L'onglet du site qui a recueilli le contenu de cet écran. */
  tab: SiteTabSlug
  /** Une requête à ajouter à l'onglet — `canal=generation` pour /generate. */
  tabQuery?: Record<string, string>
  title: string
  icon: LucideIcon
  /** Ce que l'onglet contient, dit sous le titre. */
  description: string
  /** Restreint aux sites concernés : le schéma CMS n'existe que pour WordPress. */
  only?: (site: DashboardSite) => boolean
  /** Ce que dit la liste vide quand `only` écarte tous les sites. */
  emptyWhenFiltered?: string
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export async function SitePicker({
  searchParams, tab, tabQuery, title, icon, description, only, emptyWhenFiltered,
}: SitePickerProps) {
  const hrefFor = (siteId: string) => {
    const query = tabQuery ? new URLSearchParams(tabQuery).toString() : ''
    return query ? `${siteTabHref(siteId, tab)}?${query}` : siteTabHref(siteId, tab)
  }

  // Une lecture en échec rend la liste vide plutôt qu'une erreur : la page
  // propose alors d'aller à la liste des sites, qui saura dire ce qui cloche.
  const all = await listDashboardSites().catch((error) => {
    console.warn('[site-picker] liste des sites indisponible :', error instanceof Error ? error.message : error)
    return [] as DashboardSite[]
  })
  const sites = only ? all.filter(only) : all

  // `redirect()` lève une exception que Next intercepte : elle doit rester hors
  // de tout try/catch, sinon la redirection serait avalée comme une erreur.
  // Un site DEMANDÉ est cherché parmi tous, filtre ou non : l'onglet d'arrivée
  // sait parler d'un site que cet écran-ci ne concernait pas (les réglages d'un
  // site Next.js montrent son dépôt à la place du schéma WordPress).
  const requested = single(searchParams.site)
  if (requested && all.some((site) => site.id === requested)) redirect(hrefFor(requested))

  const active = sites.filter((site) => site.isActive)
  if (active.length === 1) redirect(hrefFor(active[0].id))

  // Les sites actifs d'abord : un site désactivé reste atteignable — on peut
  // vouloir relire son calendrier — mais il n'est pas ce qu'on vient chercher.
  const ordered = [...active, ...sites.filter((site) => !site.isActive)]

  return (
    <div style={{ maxWidth: 720 }}>
      <PageHeader icon={icon} badge={title} title="Choisissez un site" subtitle={description} />

      {ordered.length === 0 ? (
        <EmptyState
          variant="not-connected"
          title={all.length === 0 ? 'Aucun site' : 'Aucun site concerné'}
          description={
            all.length === 0
              ? 'Ajoutez d’abord un site : tout ce que le moteur fait se règle dans la page du site.'
              : emptyWhenFiltered ?? 'Aucun de vos sites n’est concerné par cet écran.'
          }
          action={all.length === 0 ? { label: 'Ajouter un site', href: '/sites/new' } : { label: 'Voir les sites', href: '/sites' }}
        />
      ) : (
        <nav aria-label={`Sites — ${title}`}>
          <ul className="site-picker">
            {ordered.map((site) => (
              <li key={site.id}>
                <Link href={hrefFor(site.id)} className="site-picker__row">
                  <span className="site-picker__body">
                    <span className="site-picker__name">{site.name}</span>
                    <span className="meta truncate">{site.url}</span>
                  </span>
                  <span className="chip">{site.type === 'nextjs' ? 'Next.js' : 'WordPress'}</span>
                  {!site.isActive && <span className="badge badge-muted">Désactivé</span>}
                  <ChevronRight size={15} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--ink-faint)' }} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
