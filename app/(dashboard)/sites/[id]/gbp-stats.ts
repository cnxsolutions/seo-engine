// ─────────────────────────────────────────────────────────────────────────────
// La fiche Google d'un site, comptée — réglages ET performances
//
// Deux onglets lisent ces nombres : les réglages (état de la connexion
// Business Profile) et les performances (ce que la fiche montre et ce que le
// moteur y a publié). Écrits deux fois, les comptages divergeraient au premier
// statut ajouté à `gbp_posts`.
//
// OÙ CES LECTURES DEVRAIENT VIVRE : lib/gbp/posts, aux côtés de la politique.
// Elles sont ici parce que ce module n'expose aucun compteur et n'appartient
// pas à ce lot. Elles ne décident RIEN — des nombres, aucune règle — donc les
// faire remonter plus tard ne déplacera aucune politique.
// ─────────────────────────────────────────────────────────────────────────────

import { createServiceClient } from '@/lib/supabase'

/**
 * Ce que le moteur a écrit sur cette fiche, et ce qui attend.
 *
 * Chaque nombre vient d'un comptage `head: true` : PostgREST plafonne un select
 * ordinaire à mille lignes et ne dit rien du reste, alors qu'un comptage exact
 * ne transfère aucune ligne et ne peut pas se tromper.
 */
export interface GbpPostStats {
  /** Posts du MOTEUR réellement en ligne. Les posts 'remote' sont comptés à part. */
  published: number
  lastPublishedAt: string | null
  /** Écrits, pas encore partis. */
  pending: number
  /** Ni partis ni refusés : le doute d'écriture, le seul état qui demande un humain. */
  uncertain: number
  /** Posts que le propriétaire a tapés lui-même, connus du corpus anti-duplication. */
  remoteKnown: number
}

const PENDING_STATUSES = ['pending', 'generating', 'generated', 'publishing']

/**
 * Ne jette jamais, ne blanchit jamais la page.
 *
 * `null` veut dire « nous n'avons pas pu compter », et l'appelant l'écrit tel
 * quel. C'est le cas normal tant que la migration 019 n'est pas appliquée : la
 * table n'existe pas, et le reste de l'écran — Search Console, la connexion,
 * la fiche — n'en dépend en rien.
 */
export async function readGbpPostStats(siteId: string): Promise<GbpPostStats | null> {
  try {
    const supabase = createServiceClient()
    const base = () => supabase.from('gbp_posts').select('id', { count: 'exact', head: true }).eq('site_id', siteId)

    const [published, pending, uncertain, remote, last] = await Promise.all([
      base().eq('source', 'engine').eq('status', 'published'),
      base().eq('source', 'engine').in('status', PENDING_STATUSES),
      base().eq('status', 'incertain'),
      base().eq('source', 'remote'),
      supabase
        .from('gbp_posts')
        .select('published_at')
        .eq('site_id', siteId)
        .eq('source', 'engine')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // UN seul comptage en échec suffit à rendre `null` : une ligne où trois
    // nombres sur cinq sont justes et les deux autres à zéro se lit comme cinq
    // faits mesurés.
    for (const result of [published, pending, uncertain, remote]) {
      if (result.error) throw new Error(result.error.message)
    }

    return {
      published: published.count ?? 0,
      pending: pending.count ?? 0,
      uncertain: uncertain.count ?? 0,
      remoteKnown: remote.count ?? 0,
      // Une date manquante ne rend pas les quatre comptages faux : elle est
      // rendue nulle, et la ligne dit « date inconnue » sans effacer le nombre.
      lastPublishedAt: (last.data?.published_at as string | null | undefined) ?? null,
    }
  } catch (err) {
    console.error('[WARN] [gbp-stats] Comptage des posts de fiche impossible', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Les avis de la fiche, tels que la dernière synchronisation les a résumés.
 *
 * `summarizeReviews` (lib/google/gbp.ts) ne garde que les cinquante derniers
 * avis lus : la note est celle de cet échantillon, pas la note publique de la
 * fiche, et l'écran le dit. `null` couvre « jamais synchronisée » comme
 * « lecture impossible » : dans les deux cas il n'y a rien de mesuré à montrer.
 */
export interface GbpReviewSummary {
  businessName: string | null
  averageRating: number
  sampleSize: number
  syncedAt: string | null
}

export async function readGbpReviewSummary(siteId: string): Promise<GbpReviewSummary | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('gbp_profiles')
      .select('business_name, reviews_summary, last_synced_at')
      .eq('site_id', siteId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null

    const summary = (data.reviews_summary ?? {}) as { average_rating?: unknown; total_count?: unknown }
    return {
      businessName: typeof data.business_name === 'string' ? data.business_name : null,
      averageRating: typeof summary.average_rating === 'number' ? summary.average_rating : 0,
      sampleSize: typeof summary.total_count === 'number' ? summary.total_count : 0,
      syncedAt: typeof data.last_synced_at === 'string' ? data.last_synced_at : null,
    }
  } catch (err) {
    console.error('[WARN] [gbp-stats] Lecture de la fiche impossible', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
