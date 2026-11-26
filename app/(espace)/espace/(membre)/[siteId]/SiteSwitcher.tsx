'use client'

import { usePathname, useRouter } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// ESP-4 — moving from one site of the client to another, staying on the same
// section (« Pages » of one site → « Pages » of the other). A native <select>:
// on a phone it opens the system picker, which is the best one there is.
// ─────────────────────────────────────────────────────────────────────────────

interface SiteOption {
  id: string
  name: string
}

export function SiteSwitcher({ sites, currentId }: { sites: SiteOption[]; currentId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  // /espace/<site>/pages → /pages; /espace/<site> → ''.
  const section = pathname.replace(/^\/espace\/[^/]+/, '')

  return (
    <div className="espace-switcher">
      <label className="sr-only" htmlFor="espace-site">Site affiché</label>
      <select
        id="espace-site"
        className="input espace-switcher__select"
        value={currentId}
        onChange={(event) => router.push(`/espace/${event.target.value}${section}`)}
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>{site.name}</option>
        ))}
      </select>
    </div>
  )
}
