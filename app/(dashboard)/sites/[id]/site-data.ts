// ─────────────────────────────────────────────────────────────────────────────
// La lecture d'un site, partagée par l'en-tête et l'onglet du même rendu
//
// Le layout de /sites/[id] et la page de l'onglet lisent tous deux le site : le
// premier pour l'en-tête, la seconde pour son contenu. `cache()` (React) fait de
// ces deux appels une seule lecture par requête — sans lui, chaque onglet
// paierait deux fois les quatre requêtes de `listSites()`.
//
// `listSites()` et rien d'autre : elle sélectionne `SITE_SAFE_COLUMNS`, les deux
// secrets n'y sont pas, et ce qui part vers un composant client ne peut donc pas
// les porter, même par mégarde.
// ─────────────────────────────────────────────────────────────────────────────

import { Code2, Globe2, type LucideIcon } from 'lucide-react'
import { cache } from 'react'
import { listSites } from '@/lib/db'

/** `listSites()` attache ces trois drapeaux sans les déclarer dans son type. */
export type SiteRow = Awaited<ReturnType<typeof listSites>>[number] & {
  has_schema?: boolean
  has_credentials?: boolean
  google_connected?: boolean
}

export const loadSite = cache(async (id: string): Promise<SiteRow | null> => {
  const sites = (await listSites()) as SiteRow[]
  return sites.find((candidate) => candidate.id === id) ?? null
})

export interface ConnectorMeta {
  label: string
  icon: LucideIcon
  color: string
}

const CONNECTORS: Record<'wordpress' | 'nextjs', ConnectorMeta> = {
  wordpress: { label: 'WordPress', icon: Globe2, color: 'var(--series-1)' },
  nextjs: { label: 'Next.js', icon: Code2, color: 'var(--series-7)' },
}

export function connectorOf(type: string): ConnectorMeta {
  return type === 'nextjs' ? CONNECTORS.nextjs : CONNECTORS.wordpress
}
