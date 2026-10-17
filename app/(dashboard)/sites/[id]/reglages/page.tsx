// ─────────────────────────────────────────────────────────────────────────────
// L'onglet « Réglages » d'un site — tout ce qui se règle, sur une seule page
//
// Quatre écrans s'en partageaient le contenu : /sites/[id]/edit (identité et
// identifiants), /sites/[id]/google (connexion Google), /schema/[siteId]
// (schéma WordPress) et la zone de suppression en bas du premier. Tous
// redirigent ici. L'ordre suit ce qu'on vient y faire le plus souvent :
//
//   1. Connexion Google   — c'est là que reviennent /api/google/sync et
//                           /api/google/select, avec leur verdict en requête
//   2. Identité et accès  — nom, adresse, état actif, identifiants du connecteur
//   3. Schéma CMS         — WordPress seulement : un site Next.js se décrit par
//                           l'analyse de son dépôt, pas par un CMS
//   4. Zone dangereuse    — en dernier, toujours
//
// Lecture par `loadSite()` (../site-data) : `SITE_SAFE_COLUMNS`, aucun secret,
// et le formulaire client ne reçoit qu'une projection à la main de la ligne.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { DeleteSiteZone } from '../../SiteActions'
import { EditSiteForm, type EditableSite } from '../../EditSiteForm'
import { AnalyzeRepoButton } from '../../AnalyzeRepoButton'
import { loadSite } from '../site-data'
import { TabIntro } from '../TabIntro'
import { GoogleConnectionSection } from './GoogleConnection'
import { SchemaPanel } from './SchemaPanel'

export const dynamic = 'force-dynamic'

export default async function SiteSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams

  const site = await loadSite(id)
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
    <div className="settings">
      <TabIntro
        title="Réglages du site"
        subtitle="Connexion Google, identité et identifiants, structure du CMS. Les identifiants enregistrés ne sont jamais renvoyés par le serveur."
      />

      <GoogleConnectionSection siteId={site.id} query={query} />

      <section id="site" className="settings-section" aria-labelledby="h-site">
        <div className="settings-section__head">
          <h3 id="h-site" className="settings-section__title">Identité et accès</h3>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          Un champ secret laissé vide reste inchangé.
        </p>
        <EditSiteForm site={editable} />
      </section>

      {site.type === 'wordpress' ? (
        <SchemaPanel siteId={site.id} />
      ) : (
        <section id="depot" className="settings-section" aria-labelledby="h-depot">
          <div className="settings-section__head">
            <h3 id="h-depot" className="settings-section__title">Architecture du dépôt</h3>
            {site.github_repo && (
              <div className="settings-section__actions">
                <AnalyzeRepoButton siteId={site.id} hasProfile={Boolean(site.repo_profile)} />
              </div>
            )}
          </div>
          <p className="meta" style={{ margin: 0 }}>
            {!site.github_repo
              ? 'Aucun dépôt configuré : renseignez-le ci-dessus pour que le moteur puisse l’analyser.'
              : site.repo_profile
                ? `${site.github_repo} est analysé : les pages suivent l’architecture du dépôt.`
                : `${site.github_repo} n’a jamais été analysé : les pages seraient écrites au format générique.`}
          </p>
        </section>
      )}

      <DeleteSiteZone siteId={site.id} siteName={site.name} />
    </div>
  )
}
