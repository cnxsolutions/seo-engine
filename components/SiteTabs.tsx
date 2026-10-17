'use client'

// ─────────────────────────────────────────────────────────────────────────────
// La barre d'onglets d'un site
//
// Des liens, pas un `tablist` : chaque onglet est une vraie adresse, partageable
// et rendue côté serveur, et `TabNav` (components/ui.tsx) rend exactement cela,
// `aria-current="page"` compris. Ce composant n'ajoute qu'une chose : savoir
// quel onglet est le bon, ce que seul le client connaît — un layout serveur ne
// reçoit pas le chemin courant, et il ne se re-rend pas d'un onglet à l'autre.
//
// Sur un téléphone, `.tabs__list` défile horizontalement (overflow-x: auto) :
// sept onglets ne tiennent pas sur 360 px, et les replier en deux lignes ferait
// lire la seconde comme un autre groupe.
// ─────────────────────────────────────────────────────────────────────────────

import { usePathname } from 'next/navigation'
import { TabNav } from '@/components/ui'
import { SITE_TABS, activeSiteTab, siteTabHref } from './site-tabs'

export function SiteTabs({ siteId }: { siteId: string }) {
  const pathname = usePathname()
  const active = activeSiteTab(pathname, siteId)
  // La vue d'ensemble a un slug vide, qui ne peut pas servir d'identifiant :
  // elle devient « overview ». Un segment inconnu rend la chaîne vide, que
  // aucun onglet ne porte — rien n'est alors annoncé comme page courante.
  const activeId = active === null ? '' : active || 'overview'

  return (
    <TabNav
      ariaLabel="Sections du site"
      className="site-tabs"
      active={activeId}
      items={SITE_TABS.map((tab) => ({
        id: tab.slug || 'overview',
        label: tab.label,
        href: siteTabHref(siteId, tab.slug),
      }))}
    />
  )
}
