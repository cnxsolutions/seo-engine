'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChartLine, FileText, Home, type LucideIcon } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// The navigation of a site's space (docs/design.md § 9.1): a bottom bar on a
// phone, a slim rail from 1 024 px. Entries arrive with their screens —
// « Demandes » with the L3.
// ─────────────────────────────────────────────────────────────────────────────

interface NavEntry {
  /** Appended to /espace/<site>. */
  section: string
  label: string
  icon: LucideIcon
}

const ENTRIES: NavEntry[] = [
  { section: '', label: 'Accueil', icon: Home },
  { section: '/pages', label: 'Pages', icon: FileText },
  { section: '/resultats', label: 'Résultats', icon: ChartLine },
]

export function SpaceNav({ siteId }: { siteId: string }) {
  const pathname = usePathname()
  const base = `/espace/${siteId}`

  return (
    <nav className="espace-nav" aria-label="Sections de votre espace">
      <ul className="espace-nav__list">
        {ENTRIES.map(({ section, label, icon: Icon }) => {
          const href = `${base}${section}`
          const current = section === '' ? pathname === base : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={label}>
              <Link href={href} className="espace-nav__link" aria-current={current ? 'page' : undefined}>
                <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
