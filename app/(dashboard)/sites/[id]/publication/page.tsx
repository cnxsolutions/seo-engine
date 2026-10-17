// ─────────────────────────────────────────────────────────────────────────────
// L'onglet « Publication » d'un site — trois canaux, trois sous-onglets
//
//   Pages du site   ce qui attend une publication, ce qui est en ligne, refusé
//   Génération      ce que le moteur a produit, et le lancement manuel
//   Fiche Google    les posts de la fiche d'établissement
//
// Ils vivaient sur deux écrans transverses (/publish, /generate) qui ouvraient
// sur tous les sites. Ce sont maintenant des sous-onglets en LIENS (`?canal=`)
// plutôt qu'un état client : chaque canal a son adresse, la vue d'ensemble et
// le calendrier peuvent pointer droit sur « Fiche Google », et un rechargement
// ne ramène pas sur le premier onglet.
// ─────────────────────────────────────────────────────────────────────────────

import { TabNav } from '@/components/ui'
import { createServiceClient } from '@/lib/supabase'
import { TabIntro } from '../TabIntro'
import { GbpTab } from './GbpTab'
import { GenerationPanel } from './GenerationPanel'
import { PublishQueue } from './PublishQueue'

export const dynamic = 'force-dynamic'

const CHANNELS = [
  { id: 'pages', label: 'Pages du site' },
  { id: 'generation', label: 'Génération' },
  { id: 'fiche', label: 'Fiche Google' },
] as const

type Channel = (typeof CHANNELS)[number]['id']

function resolveChannel(raw: string | string[] | undefined): Channel {
  const value = Array.isArray(raw) ? raw[0] : raw
  return CHANNELS.some((channel) => channel.id === value) ? (value as Channel) : 'pages'
}

/**
 * Les pages neuves qui attendent, comptées `head: true` pour le sous-onglet.
 *
 * Les anciennes demandes de mise à jour en sont exclues : elles ne partiront
 * pas, et les compter ferait promettre des publications qui n'auront pas lieu.
 * `intent` est nul sur les lignes antérieures à la migration 018, d'où le `or`.
 * Un comptage en échec rend `undefined` — pas de pastille plutôt qu'un zéro
 * qui serait une mesure jamais faite.
 */
async function countAwaiting(siteId: string): Promise<number | undefined> {
  try {
    const { count, error } = await createServiceClient()
      .from('generations')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('status', 'generated')
      .or('intent.is.null,intent.neq.refresh')
    if (error) throw new Error(error.message)
    return count ?? 0
  } catch (error) {
    console.warn('[sites/publication] comptage indisponible :', error instanceof Error ? error.message : error)
    return undefined
  }
}

export default async function SitePublicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const channel = resolveChannel((await searchParams).canal)
  const awaiting = await countAwaiting(id)

  return (
    <>
      <TabIntro
        title="Publication"
        subtitle="Ce qui attend une publication, ce que le moteur a produit, et les posts de la fiche Google."
      />

      {/* L'onglet « Fiche Google » ne porte AUCUN compteur : cette coquille ne
          sait pas si une fiche est rattachée à ce site, et un « 0 » posé sur une
          fiche absente ferait passer une absence de connexion pour une absence
          de posts. Le compteur vit dans l'onglet, où le fait est connu. */}
      <TabNav
        ariaLabel="Canal de publication"
        active={channel}
        items={CHANNELS.map((item) => ({
          id: item.id,
          label: item.label,
          href: item.id === 'pages' ? `/sites/${id}/publication` : `/sites/${id}/publication?canal=${item.id}`,
          count: item.id === 'pages' ? awaiting : undefined,
        }))}
      />

      {channel === 'fiche' ? (
        <GbpTab siteId={id} />
      ) : channel === 'generation' ? (
        <GenerationPanel siteId={id} />
      ) : (
        <PublishQueue siteId={id} />
      )}
    </>
  )
}
