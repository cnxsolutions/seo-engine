'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ChevronRight,
  Globe,
  LayoutDashboard,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { SITE_TABS, activeSiteTab, siteIdFromPathname, siteTabHref } from './site-tabs'

// ─── Navigation model ────────────────────────────────────────────────────────
//
// The rail used to carry a GLOBAL five-step path, then a group of cross-site
// « Outils » (Calendrier, Générer, Publier, Analytics) that opened on every site
// at once. The owner's rule (17/10/2026): everything about a site is done from
// the site's own page — « pas de pages orphelines ailleurs ». So the rail now
// says only WHERE to go:
//
//   · the cross-site overview and the list of sites;
//   · « Vos sites », one entry per active site;
//   · under the site being viewed, its tabs, indented — the same list as the
//     tab bar of the site layout (components/site-tabs.ts), so the two cannot
//     drift apart.
//
// The old tool URLs still resolve: each is a site picker that redirects into a
// site's tab (app/(dashboard)/SitePicker.tsx).
//
// This component never reads the database: the layout (a server component)
// hands it the site list and the environment, and it re-reads the public
// `/api/sites` route on navigation because App Router keeps a layout mounted
// across client navigations — the list computed when the tab opened would
// still miss the site the operator just created.

export interface SidebarSite {
  id: string
  name: string
}

export interface SidebarEnvironment {
  /** « Production » or « Développement » — decided server-side from NODE_ENV. */
  label: string
  /** The host the request came in on, read from the request headers. */
  host: string | null
}

interface ToolLinkModel {
  href: string
  icon: LucideIcon
  label: string
}

const OVERVIEW: ToolLinkModel[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Tableau de bord' },
  { href: '/sites', icon: Globe, label: 'Sites' },
]

// ─── Site list ───────────────────────────────────────────────────────────────

/**
 * Starts from what the server rendered, then re-reads on every navigation and
 * on window focus — the moment the list goes stale is right after saving a
 * site, and a failed read keeps the last good list rather than blanking it.
 */
function useSiteList(initial: SidebarSite[], pathname: string): SidebarSite[] {
  const [sites, setSites] = useState(initial)

  useEffect(() => {
    const controller = new AbortController()

    const load = () => {
      fetch('/api/sites', { cache: 'no-store', signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data || !Array.isArray(data.sites)) return
          setSites(
            (data.sites as Array<{ id: string; name: string; is_active: boolean }>)
              .filter((site) => site.is_active)
              .map((site) => ({ id: site.id, name: site.name }))
              .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
          )
        })
        .catch(() => undefined)
    }

    load()
    window.addEventListener('focus', load)
    return () => {
      controller.abort()
      window.removeEventListener('focus', load)
    }
    // `pathname` is a trigger, not an input: the effect reads none of it, it
    // just has to run again once the operator has moved.
  }, [pathname])

  return sites
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Sidebar({ sites: initialSites, environment }: { sites: SidebarSite[]; environment: SidebarEnvironment }) {
  const pathname = usePathname()
  const sites = useSiteList(initialSites, pathname)

  /**
   * One row lights up at a time. « Sites » owns the list and the creation form;
   * a site's own pages light up its entry and, below it, the tab being viewed.
   */
  const isActive = (href: string): boolean => {
    if (href === '/sites') return pathname === '/sites' || pathname === '/sites/new'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const currentSiteId = siteIdFromPathname(pathname)
  const activeSiteId = sites.find((site) => site.id === currentSiteId)?.id

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{
          width: 36, height: 36,
          background: 'var(--accent)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Zap size={18} color="var(--accent-on)" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', lineHeight: 1.2, color: 'var(--ink-primary)' }}>SEO Engine</div>
          <div className="meta">AI Content Platform</div>
        </div>
      </div>

      <nav aria-label="Navigation principale" style={{ flex: 1, padding: '0.5rem 0', overflowY: 'auto' }}>
        <div style={{ height: 8 }} />
        {OVERVIEW.map((item) => (
          <ToolLink key={item.href} {...item} active={isActive(item.href)} />
        ))}

        <div className="nav-section-label" id="nav-sites-label">Vos sites</div>
        {sites.length === 0 ? (
          <Link href="/sites/new" className="nav-item nav-item--site">
            <span className="nav-item__dot" aria-hidden="true" />
            <span style={{ flex: 1 }} className="meta">Aucun site actif — en ajouter un</span>
          </Link>
        ) : (
          <ul className="nav-sites" aria-labelledby="nav-sites-label">
            {sites.map((site) => {
              const active = site.id === activeSiteId
              return (
                <li key={site.id}>
                  <Link
                    href={`/sites/${site.id}`}
                    className={`nav-item nav-item--site ${active ? 'active' : ''}`}
                    title={site.name}
                  >
                    <span className="nav-item__dot" aria-hidden="true" />
                    <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{site.name}</span>
                    {active && <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0, transform: 'rotate(90deg)' }} aria-hidden="true" />}
                  </Link>
                  {active && <SiteSubTabs siteId={site.id} siteName={site.name} pathname={pathname} />}
                </li>
              )
            })}
          </ul>
        )}
      </nav>

      {/* Which deployment this tab is talking to. It replaces a hard-coded
          « Admin / Mode local » that read the same in production, where
          publishing is for real. */}
      <div className="sidebar-env">
        <span className={`sidebar-env__dot ${environment.label === 'Production' ? 'sidebar-env__dot--prod' : ''}`} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div className="sidebar-env__label">{environment.label}</div>
          {environment.host && <div className="meta truncate" title={environment.host}>{environment.host}</div>}
        </div>
      </div>
    </aside>
  )
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/**
 * The tabs of the site being viewed, indented under its entry. `aria-current`
 * sits on the TAB, not on the site entry: both would otherwise announce the
 * same page twice on the overview, and only the tab says which section it is.
 */
function SiteSubTabs({ siteId, siteName, pathname }: { siteId: string; siteName: string; pathname: string }) {
  const active = activeSiteTab(pathname, siteId)

  return (
    <ul className="nav-subtabs" aria-label={`Sections de ${siteName}`}>
      {SITE_TABS.map((tab) => {
        const current = tab.slug === active
        return (
          <li key={tab.slug || 'overview'}>
            <Link
              href={siteTabHref(siteId, tab.slug)}
              className={`nav-subtab ${current ? 'nav-subtab--active' : ''}`}
              aria-current={current ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function ToolLink({
  href, icon: Icon, label, active,
}: ToolLinkModel & { active: boolean }) {
  return (
    <Link href={href} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
    </Link>
  )
}
