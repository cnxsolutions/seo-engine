// ─────────────────────────────────────────────────────────────────────────────
// « Accès client » — who may open this site's client space (ACC-1, ACC-4, ACC-7)
//
// Read on the server (lib/client-space/access.ts); the forms are in
// ClientAccessControls. A failed read says so in the section and leaves the
// rest of the settings tab alone.
// ─────────────────────────────────────────────────────────────────────────────

import { Notice } from '@/components/ui'
import { loadSiteAccess, type SiteAccess } from '@/lib/client-space/access'
import { ClientAccessControls } from './ClientAccessControls'

async function readAccess(siteId: string): Promise<SiteAccess | null | 'error'> {
  try {
    return await loadSiteAccess(siteId)
  } catch (error) {
    console.warn('[reglages] acces client illisible :', error instanceof Error ? error.message : error)
    return 'error'
  }
}

export async function ClientAccessSection({ siteId }: { siteId: string }) {
  const access = await readAccess(siteId)

  return (
    <section id="acces-client" className="settings-section" aria-labelledby="h-acces-client">
      <div className="settings-section__head">
        <h3 id="h-acces-client" className="settings-section__title">Accès client</h3>
      </div>
      <p className="meta settings-section__lead">
        Les personnes invitées se connectent à leur espace avec un code reçu par e-mail. Elles voient tous les sites de
        leur client, et rien d’autre.
      </p>
      {access === 'error' ? (
        <Notice tone="critical" title="Accès client illisible" body="La liste des accès n’a pas pu être lue. Rechargez la page." inline />
      ) : access === null ? null : (
        <ClientAccessControls access={access} />
      )}
    </section>
  )
}
