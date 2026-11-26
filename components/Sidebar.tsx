'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Globe,
  LayoutDashboard,
  Menu,
  MessageSquarePlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { SHELL_TEXT } from '@/lib/console-labels'
import { QUEUE_TEXT } from '@/lib/keyword-requests/operator-labels'
import { BrandLockup } from './BrandMark'
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
  { href: '/demandes', icon: MessageSquarePlus, label: 'Demandes' },
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

/**
 * The requests waiting for CNX (KW-10), re-read like the sites: on every
 * navigation and on focus — an arbitration made on the queue lowers it at once.
 * A failed read keeps the last count rather than showing a zero.
 */
function useReviewCount(initial: number | null, pathname: string): number | null {
  const [count, setCount] = useState(initial)

  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      fetch('/api/demandes/compteur', { cache: 'no-store', signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && typeof data.review === 'number') setCount(data.review)
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      controller.abort()
      window.removeEventListener('focus', load)
    }
  }, [pathname])

  return count
}

/**
 * Under 1 024 px the rail is a drawer (UX-5): it used to keep its 248 px and
 * crush every screen to a column of single words.
 *
 * Open is remembered WITH the path it was opened on, so any navigation — a
 * link in the drawer, the back button — closes it without an effect having to
 * reset state. While open: the page does not scroll, Escape closes, Tab stays
 * in the drawer; focus goes into it, then back to the button that opened it.
 */
interface DrawerRefs {
  toggleRef: React.RefObject<HTMLButtonElement | null>
  closeRef: React.RefObject<HTMLButtonElement | null>
  drawerRef: React.RefObject<HTMLElement | null>
}

function useDrawer(pathname: string, { toggleRef, closeRef, drawerRef }: DrawerRefs) {
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === pathname
  const wasOpen = useRef(false)

  // Growing past the breakpoint turns the drawer back into the rail.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)')
    const onChange = () => {
      if (wide.matches) setOpenAt(null)
    }
    wide.addEventListener('change', onChange)
    return () => wide.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('rail-open', open)
    if (!open) {
      if (wasOpen.current) toggleRef.current?.focus()
      wasOpen.current = false
      return
    }

    wasOpen.current = true
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenAt(null)
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, toggleRef, closeRef, drawerRef])

  return {
    open,
    openDrawer: () => setOpenAt(pathname),
    closeDrawer: () => setOpenAt(null),
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Sidebar({ sites: initialSites, environment, reviewCount: initialReviewCount }: {
  sites: SidebarSite[]
  environment: SidebarEnvironment
  /** Requests waiting for CNX, read by the layout; null when the read failed. */
  reviewCount: number | null
}) {
  const pathname = usePathname()
  const sites = useSiteList(initialSites, pathname)
  const reviewCount = useReviewCount(initialReviewCount, pathname)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const { open: drawerOpen, openDrawer, closeDrawer } = useDrawer(pathname, { toggleRef, closeRef, drawerRef })

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
    <>
    {/* Below 1 024 px only (globals.css): the bar that opens the drawer. */}
    <div className="topbar">
      <button
        ref={toggleRef}
        type="button"
        className="topbar__menu"
        aria-label={SHELL_TEXT.openMenu}
        aria-expanded={drawerOpen}
        aria-controls="rail"
        onClick={openDrawer}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <Link href="/dashboard" className="topbar__brand" aria-label={SHELL_TEXT.home}>
        <BrandLockup />
      </Link>
      {reviewCount !== null && reviewCount > 0 && (
        <Link href="/demandes" className="topbar__count nav-count">
          {reviewCount}
          <span className="sr-only"> {QUEUE_TEXT.railCount(reviewCount)}</span>
        </Link>
      )}
    </div>

    <aside
      id="rail"
      ref={drawerRef}
      className={`sidebar${drawerOpen ? ' sidebar--open' : ''}`}
      {...(drawerOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': SHELL_TEXT.navigation } : {})}
    >
      <Link href="/dashboard" className="sidebar-logo" aria-label={SHELL_TEXT.home}>
        <BrandLockup />
      </Link>
      <button ref={closeRef} type="button" className="sidebar__close" aria-label={SHELL_TEXT.closeMenu} onClick={closeDrawer}>
        <X size={20} aria-hidden="true" />
      </button>

      <nav aria-label="Navigation principale" className="sidebar__nav">
        <div className="sidebar__spacer" />
        {OVERVIEW.map((item) => (
          <ToolLink key={item.href} {...item} active={isActive(item.href)} count={item.href === '/demandes' ? reviewCount : null} />
        ))}

        <div className="nav-section-label" id="nav-sites-label">Vos sites</div>
        {sites.length === 0 ? (
          <Link href="/sites/new" className="nav-item nav-item--site">
            <span className="nav-item__dot" aria-hidden="true" />
            <span className="meta nav-item__label">Aucun site actif — en ajouter un</span>
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
                    <span className="truncate nav-item__label nav-item__label--shrink">{site.name}</span>
                    {active && <ChevronRight size={14} className="nav-item__chevron nav-item__chevron--open" aria-hidden="true" />}
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
        <div className="sidebar-env__text">
          <div className="sidebar-env__label">{environment.label}</div>
          {environment.host && <div className="meta truncate" title={environment.host}>{environment.host}</div>}
        </div>
      </div>
    </aside>
    {/* The rest of the page, dimmed: a click on it closes the drawer (Escape and the close button do too). */}
    <div className={`rail-scrim${drawerOpen ? ' rail-scrim--open' : ''}`} aria-hidden="true" onClick={closeDrawer} />
    </>
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
  href, icon: Icon, label, active, count,
}: ToolLinkModel & { active: boolean; count: number | null }) {
  return (
    <Link href={href} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
      <span className="nav-item__label">{label}</span>
      {count !== null && count > 0 && (
        <span className="nav-count" title={QUEUE_TEXT.railCount(count)}>
          {count}
          <span className="sr-only"> {QUEUE_TEXT.railCount(count)}</span>
        </span>
      )}
      {active && <ChevronRight size={14} className="nav-item__chevron" />}
    </Link>
  )
}
