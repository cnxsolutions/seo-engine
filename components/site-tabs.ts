// ─────────────────────────────────────────────────────────────────────────────
// Les onglets d'un site — la seule liste, lue par la barre d'onglets ET le rail
//
// Tout ce qui concerne un site vit sous /sites/<id> : calendrier, publication,
// performances Google, réglages. Il n'y a plus d'écran « Calendrier » ou
// « Analytics » à côté qui montrerait tous les sites à la fois et ferait choisir
// le site une seconde fois. La barre d'onglets du site (components/SiteTabs.tsx)
// et la sous-liste du rail (components/Sidebar.tsx) lisent CE tableau : deux
// copies d'une même liste de sept liens divergent au premier onglet ajouté.
//
// Module pur, sans React : la résolution « quel onglet pour ce chemin » est la
// seule règle de navigation qui puisse se tromper en silence (un onglet éteint,
// un autre allumé à tort), elle se teste donc sans navigateur
// (./site-tabs.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_TABS = [
  { slug: '', label: 'Vue d’ensemble' },
  { slug: 'strategie', label: 'Stratégie' },
  { slug: 'calendrier', label: 'Calendrier' },
  { slug: 'publication', label: 'Publication' },
  { slug: 'performances', label: 'Performances' },
  { slug: 'pages', label: 'Pages' },
  { slug: 'reglages', label: 'Réglages' },
] as const

export type SiteTabSlug = (typeof SITE_TABS)[number]['slug']

/**
 * Les anciennes adresses d'un site, et l'onglet qui les a recueillies.
 *
 * Elles redirigent (sites/[id]/edit, /google, /existing) ; les garder ici sert
 * le cas où l'URL est encore affichée pendant la redirection, et la sous-page
 * `google/select` qui, elle, reste une vraie page — le choix de la propriété
 * Search Console appartient aux réglages.
 */
const SEGMENT_ALIASES: Record<string, SiteTabSlug> = {
  edit: 'reglages',
  google: 'reglages',
  existing: 'pages',
}

const TAB_SLUGS = new Set<string>(SITE_TABS.map((tab) => tab.slug))

/** Segments de /sites/<…> qui ne sont PAS un identifiant de site. */
const RESERVED_SITE_SEGMENTS = new Set(['new'])

export function siteTabHref(siteId: string, slug: SiteTabSlug): string {
  return slug ? `/sites/${siteId}/${slug}` : `/sites/${siteId}`
}

/**
 * Le site dont le chemin relève, ou `null`.
 *
 * `/sites` (la liste) et `/sites/new` (la création) ne relèvent d'aucun site :
 * les confondre avec un identifiant allumerait une sous-liste d'onglets pour un
 * site nommé « new ».
 */
export function siteIdFromPathname(pathname: string): string | null {
  const match = /^\/sites\/([^/?#]+)/.exec(pathname)
  if (!match) return null
  const segment = decodeURIComponent(match[1])
  return RESERVED_SITE_SEGMENTS.has(segment) ? null : segment
}

/**
 * L'onglet actif pour ce chemin, ou `null` quand le chemin n'est pas sous ce
 * site.
 *
 * Seul le PREMIER segment après l'identifiant compte : `/reglages/…` et
 * `/google/select` restent dans les réglages. Un segment inconnu ne rend pas
 * d'onglet plutôt que d'en allumer un au hasard — aucun lien ne prétend alors
 * être la page courante.
 */
export function activeSiteTab(pathname: string, siteId: string): SiteTabSlug | null {
  const base = `/sites/${siteId}`
  const path = pathname.replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (path === base) return ''
  if (!path.startsWith(`${base}/`)) return null

  const segment = path.slice(base.length + 1).split('/')[0]
  if (TAB_SLUGS.has(segment)) return segment as SiteTabSlug
  return SEGMENT_ALIASES[segment] ?? null
}

/**
 * `path` suivi de la requête reçue, telle quelle.
 *
 * Les anciennes adresses redirigent en GARDANT leur requête : /api/google/sync
 * renvoie encore vers /sites/<id>/google?gsc=success&rows=…, et c'est cette
 * requête que l'onglet Réglages lit pour dire si la synchronisation a abouti.
 * La perdre dans la redirection ferait taire le seul retour de l'action.
 */
export function appendSearch(path: string, params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item)
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
