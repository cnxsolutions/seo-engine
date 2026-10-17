// ─────────────────────────────────────────────────────────────────────────────
// La fiche Google d'un site, en chiffres — ce qui est mesuré, et rien d'autre
//
// Search Console mesure le site ; la fiche d'établissement a sa propre vie :
// des avis, et les posts que le moteur y publie. Ce panneau montre ce que le
// produit SAIT de la fiche, et dit en clair ce qu'il ne sait pas :
//
//   · Google ne rend plus aucune statistique par post (`localPosts.reportInsights`
//     est supprimé depuis février 2023) ;
//   · les indicateurs de la fiche (vues, appels, itinéraires) ne sont pas
//     importés par le moteur.
//
// Plutôt qu'une tuile « 0 vue » qui se lirait comme une mesure, ces deux
// absences sont écrites. Le composant est serveur : il lit la base avec la clé
// de service et ne fait traverser aucun jeton vers le client.
// ─────────────────────────────────────────────────────────────────────────────

import { CircleQuestionMark, Clock, MessageSquareText, Send, Star, Store } from 'lucide-react'
import Link from 'next/link'
import { EmptyState, StatTile, UnknownValue, formatDayLong, formatMetric } from '@/components/ui'
import { getGoogleSyncState } from '@/lib/google/sync'
import { readGbpPostStats, readGbpReviewSummary } from '../gbp-stats'

export async function GbpSummary({ siteId }: { siteId: string }) {
  const [state, posts, reviews] = await Promise.all([
    getGoogleSyncState(siteId),
    readGbpPostStats(siteId),
    readGbpReviewSummary(siteId),
  ])

  if (!state.connected) {
    return (
      <EmptyState
        variant="not-connected"
        icon={Store}
        title="Google n’est pas connecté"
        description="Sans connexion Google, ni la fiche d’établissement ni ses avis ne sont lus, et aucun post ne peut y être publié. Ce n’est pas une fiche sans activité : c’est une absence de mesure."
        action={{ label: 'Connecter Google', href: `/api/google/auth?site_id=${siteId}` }}
      />
    )
  }

  if (!state.gbpLocationId) {
    return (
      <EmptyState
        variant="not-connected"
        icon={Store}
        title="Aucune fiche d’établissement rattachée"
        description="Le compte Google est relié, mais aucune fiche n’est choisie pour ce site : rien n’est lu, rien n’est publié. Les pages du site, elles, n’en dépendent pas."
        action={{ label: 'Choisir la fiche', href: `/sites/${siteId}/google/select` }}
      />
    )
  }

  const waiting = posts ? posts.pending + posts.uncertain : 0

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <p className="meta" style={{ margin: 0 }}>
        {reviews?.businessName ? `Fiche « ${reviews.businessName} »` : 'Fiche d’établissement'}
        {reviews?.syncedAt ? ` · lue le ${formatDayLong(reviews.syncedAt)}` : ' · jamais lue en entier'}
      </p>

      <div className="kpi-row">
        <StatTile
          label="Note des avis lus"
          icon={Star}
          value={
            reviews && reviews.sampleSize > 0
              ? `${formatMetric(reviews.averageRating, 'decimal', { decimals: 1 })} / 5`
              : <UnknownValue why="Aucun avis n’a été lu sur cette fiche." />
          }
          // La synchronisation garde les cinquante derniers avis : la moyenne
          // est celle de cet échantillon, pas la note publique de la fiche.
          hint={reviews && reviews.sampleSize > 0 ? `sur les ${reviews.sampleSize} derniers avis lus` : 'Aucun avis lu'}
        />
        <StatTile
          label="Avis lus"
          icon={MessageSquareText}
          value={reviews ? reviews.sampleSize : <UnknownValue why="La fiche n’a pas encore été synchronisée." />}
          hint="Échantillon de la dernière synchronisation"
        />
        <StatTile
          label="Posts publiés par le moteur"
          icon={Send}
          value={posts ? posts.published : <UnknownValue why="Le comptage des posts n’a pas pu être établi — la migration 019 n’est peut-être pas appliquée." />}
          hint={posts?.lastPublishedAt ? `dernier le ${formatDayLong(posts.lastPublishedAt)}` : 'Aucun post publié'}
        />
        <StatTile
          label="Posts en attente"
          icon={waiting > 0 && posts && posts.uncertain > 0 ? CircleQuestionMark : Clock}
          value={posts ? waiting : <UnknownValue why="Le comptage des posts n’a pas pu être établi." />}
          emphasis={Boolean(posts && posts.uncertain > 0)}
          hint={posts && posts.uncertain > 0 ? `dont ${posts.uncertain} écriture${posts.uncertain > 1 ? 's' : ''} incertaine${posts.uncertain > 1 ? 's' : ''}` : 'Écrits, pas encore partis'}
        />
      </div>

      <div className="inset" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-normal)' }}>
        Ce qui n’est pas affiché, et pourquoi : Google ne fournit plus aucune statistique par post (vues, clics)
        depuis 2023, et le moteur n’importe pas les indicateurs de la fiche (vues, appels, demandes d’itinéraire).
        Aucun chiffre n’est donc montré pour eux plutôt qu’un zéro qui passerait pour une mesure.
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Link href={`/sites/${siteId}/publication?canal=fiche`} className="btn-secondary btn-sm">Piloter les posts</Link>
        <Link href={`/sites/${siteId}/reglages#google`} className="btn-ghost btn-sm">État de la synchronisation</Link>
      </div>
    </div>
  )
}
