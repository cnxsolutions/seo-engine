// ─────────────────────────────────────────────────────────────────────────────
// Le résumé d'une campagne, en mots — vue d'ensemble ET onglet Stratégie
//
// Les deux écrans disent le rythme et le mode de publication d'une campagne.
// Écrites deux fois, ces phrases divergeraient au premier réglage ajouté : la
// vue d'ensemble dirait « en ligne directement » quand l'onglet dirait
// « brouillon ». Module pur, sans import serveur, pour que le composant client
// de l'onglet Stratégie puisse le lire aussi.
// ─────────────────────────────────────────────────────────────────────────────

import type { Campaign, ScheduleFrequency } from '@/lib/types'

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  manual: 'lancement manuel',
  daily: 'une page par jour',
  every_2_days: 'une page tous les 2 jours',
  every_3_days: 'une page tous les 3 jours',
  weekly: 'une page par semaine',
  biweekly: 'une page toutes les 2 semaines',
  monthly: 'une page par mois',
  custom: 'jours choisis',
}

/**
 * « une page par jour, à 09:00 ».
 *
 * `defaultTime` entre en paramètre plutôt qu'en import : sa source,
 * `DEFAULT_SCHEDULE_TIME`, vit dans lib/scheduler/editorial, qui ouvre un client
 * Supabase de service — rien qu'un composant client doive tirer dans son paquet.
 */
export function rhythmLabel(
  campaign: Pick<Campaign, 'schedule_frequency' | 'schedule_time'>,
  defaultTime: string,
): string {
  const frequency = campaign.schedule_frequency ?? 'daily'
  const label = FREQUENCY_LABELS[frequency] ?? frequency
  return frequency === 'manual' ? label : `${label}, à ${campaign.schedule_time || defaultTime}`
}

/** Comment une page acceptée part sur le site, selon le connecteur et la campagne. */
export function publicationModeOf(
  site: { type: string; auto_promote?: boolean | null },
  campaign: Pick<Campaign, 'auto_publish' | 'publish_status'>,
): string {
  if (!campaign.auto_publish) return 'manuelle, après relecture'
  if (site.type === 'nextjs') {
    return site.auto_promote ? 'automatique, fusionnée vers la branche par défaut' : 'automatique, sur la branche du moteur'
  }
  switch (campaign.publish_status) {
    case 'draft': return 'automatique, en brouillon WordPress'
    case 'pending': return 'automatique, en attente de relecture WordPress'
    default: return 'automatique, en ligne directement'
  }
}
