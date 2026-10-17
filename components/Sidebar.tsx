'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BarChart3,
  Calendar,
  ChevronRight,
  Globe,
  LayoutDashboard,
  Send,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// ─── Navigation model ────────────────────────────────────────────────────────
//
// The rail used to carry a GLOBAL five-step path, computed across every site by
// /api/workflow. « Connecter Google » there was true of one site and false of
// the next, and the same actions sat on three screens. The path now lives on
// each site's own page (/sites/[id]); the rail only says WHERE to go: the two
// overview screens, the sites themselves, and the cross-site tools.
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

/**
 * The cross-site screens. Each one is also reachable from the site page, from
 * the section it belongs to, with the site pre-selected; here they are the
 * un-scoped entrances, kept so nothing becomes unreachable.
 *
 * « Analytics » points straight at the performance tab of the dashboard, not at
 * `/analytics`: that route is a 307 to the very same tab, and a link through it
 * would never light up, the pathname ending up as `/dashboard`.
 *
 * `/schema` and `/strategy` are deliberately absent: both are reached from the
 * site page (Connexion and Stratégie sections) with the right site in hand,
 * and listing them here would restore the duplicated entrances this rail just
 * lost.
 */
const TOOLS: ToolLinkModel[] = [
  { href: '/calendar', icon: Calendar, label: 'Calendrier' },
  { href: '/generate', icon: Wand2, label: 'Générer' },
  { href: '/publish', icon: Send, label: 'Publier' },
  { href: '/dashboard?tab=performance', icon: BarChart3, label: 'Analytics' },
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
  const searchParams = useSearchParams()
  const sites = useSiteList(initialSites, pathname)

  const performanceTab = pathname === '/dashboard' && searchParams.get('tab') === 'performance'

  /**
   * One row lights up at a time. « Sites » owns the list and the creation form;
   * a site's own pages (hub, edit, Google, inventory) light up its own entry.
   */
  const isActive = (href: string): boolean => {
    if (href === '/dashboard') return pathname === '/dashboard' && !performanceTab
    if (href === '/dashboard?tab=performance') return performanceTab
    if (href === '/sites') return pathname === '/sites' || pathname === '/sites/new'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const activeSiteId = sites.find((site) => pathname === `/sites/${site.id}` || pathname.startsWith(`/sites/${site.id}/`))?.id

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

        <div className="nav-section-label">Vos sites</div>
        {sites.length === 0 ? (
          <Link href="/sites/new" className="nav-item nav-item--site">
            <span className="nav-item__dot" aria-hidden="true" />
            <span style={{ flex: 1 }} className="meta">Aucun site actif — en ajouter un</span>
          </Link>
        ) : (
          <ul className="nav-sites">
            {sites.map((site) => {
              const active = site.id === activeSiteId
              return (
                <li key={site.id}>
                  <Link
                    href={`/sites/${site.id}`}
                    className={`nav-item nav-item--site ${active ? 'active' : ''}`}
                    aria-current={pathname === `/sites/${site.id}` ? 'page' : undefined}
                    title={site.name}
                  >
                    <span className="nav-item__dot" aria-hidden="true" />
                    <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{site.name}</span>
                    {active && <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        <div className="nav-section-label">Outils</div>
        {TOOLS.map((item) => (
          <ToolLink key={item.href} {...item} active={isActive(item.href)} />
        ))}
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
