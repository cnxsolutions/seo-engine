// ─────────────────────────────────────────────────────────────────────────────
// Edit a site — the screen that did not exist
//
// A site could be created and never touched again: a wrong URL, a rotated
// application password or a renamed branch meant deleting the row by hand in
// Supabase and creating the site twice — which is exactly how the duplicate
// sites of PR #12 came to be. This page is the missing step between « create »
// and « delete ».
//
// It reads through `listSites()` and nothing else: that function selects
// `SITE_SAFE_COLUMNS`, the two secrets are not in it, so the HTML this page
// renders cannot carry them. The form starts every secret field empty and the
// API treats an empty secret as « unchanged ».
// ─────────────────────────────────────────────────────────────────────────────

import { Pencil } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import { listSites } from '@/lib/db'
import { EditSiteForm, type EditableSite } from '../../EditSiteForm'

export const dynamic = 'force-dynamic'

const CONNECTOR_LABEL = { wordpress: 'WordPress', nextjs: 'Next.js' } as const

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // One list read rather than a bespoke `select('*')`: the list is the only
  // reader that is guaranteed secret-free, and a site count stays small enough
  // that filtering it here costs nothing worth a second query shape.
  const site = (await listSites()).find((candidate) => candidate.id === id)
  if (!site) notFound()

  // Narrowed by hand: `listSites()` also carries `repo_profile` and
  // `cms_schema`, two JSON blobs the form does not read. Passing the whole row
  // across the client boundary would ship them in the page payload for nothing.
  const editable: EditableSite = {
    id: site.id,
    name: site.name,
    type: site.type,
    url: site.url,
    is_active: site.is_active,
    wp_username: site.wp_username ?? '',
    wp_page_template: site.wp_page_template ?? '',
    github_repo: site.github_repo ?? '',
    github_branch: site.github_branch ?? '',
    // Default mirrors the creation form: on, unless the row says otherwise.
    auto_promote: site.auto_promote ?? true,
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader
        icon={Pencil}
        badge={CONNECTOR_LABEL[site.type] ?? 'Site'}
        title={site.name}
        subtitle="Les identifiants enregistrés ne sont jamais renvoyés par le serveur : un champ secret laissé vide reste inchangé."
        backHref="/sites"
        meta={<span>{site.url}</span>}
      />

      <EditSiteForm site={editable} />
    </div>
  )
}
