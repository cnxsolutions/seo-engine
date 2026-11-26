// ─────────────────────────────────────────────────────────────────────────────
// The words of the operator console for client requests — docs/design.md § 10
// ─────────────────────────────────────────────────────────────────────────────
//
// The console says what the engine concluded, in CNX's words; the client's
// words for the same statuses live in lib/client-space/labels.ts. Never a
// status name, a reason code or a table name on screen.

import type { DecisionProblem, OperatorAction } from '@/src/core/domain/keyword-requests/arbitration'
import type { RequestStatus } from '@/src/core/domain/keyword-requests/lifecycle'

export type QueueTone = 'neutral' | 'info' | 'good' | 'warning'

export const OPERATOR_STATUS_LABELS: Readonly<Record<RequestStatus, { label: string; tone: QueueTone }>> = {
  received: { label: 'Reçue — analyse en cours', tone: 'neutral' },
  review: { label: 'À examiner', tone: 'warning' },
  deferred: { label: 'Reportée au cycle suivant', tone: 'info' },
  scheduled: { label: 'Planifiée', tone: 'good' },
  in_production: { label: 'En rédaction', tone: 'good' },
  published: { label: 'Publiée', tone: 'good' },
  covered: { label: 'Couverte', tone: 'neutral' },
  declined: { label: 'Refusée', tone: 'neutral' },
  withdrawn: { label: 'Retirée par le client', tone: 'neutral' },
}

/** What decided the current status, in a few words. Every code the engine and the console write. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  ALREADY_PLANNED: 'Déjà prévue dans le cycle',
  ALREADY_WON: 'Déjà gagnée sur Google',
  ALREADY_COVERED: 'Déjà couverte par une page',
  NO_CAMPAIGN: 'Site sans campagne',
  CITY_OUT_OF_AREA: 'Ville hors zone',
  CITY_ON_NATIONAL: 'Ville sur une campagne nationale',
  OUT_OF_TRADE: 'Hors métier, selon le modèle',
  UNSURE_TRADE: 'Métier incertain, selon le modèle',
  OPINION_UNAVAILABLE: 'Avis du modèle indisponible',
  NEXT_PERIOD: 'Recevable, pour le cycle suivant',
  PLANNED: 'Prévue au plan du cycle',
  PLACED_IN_CYCLE: 'Intégrée au cycle en cours',
  PLAN_GUARD: 'Écartée par les gardes du plan',
  WAITED_TOO_LONG: 'Attend depuis 3 cycles',
  PRODUCTION_STOPPED: 'Production arrêtée',
  OPERATOR_INTEGRATE: 'Intégration demandée par CNX',
  OPERATOR_DEFERRED: 'Reportée par CNX',
  OPERATOR_DECLINED: 'Refusée par CNX',
  OPERATOR_REOPENED: 'Rouverte par CNX',
  NO_SLOT_NOW: 'Pas de place dans le cycle en cours',
}

export const QUEUE_TEXT = {
  eyebrow: 'Demandes clients',
  title: 'Demandes',
  subtitle: 'Les mots-clés proposés par vos clients depuis leur espace, et ce que le moteur en a conclu. Ce qu’il envoie à CNX attend ici votre décision.',
  siteTitle: 'Demandes du client',
  siteSubtitle: 'Les mots-clés proposés pour ce site, et ce que le moteur en a conclu.',
  views: { review: 'À examiner', all: 'Toutes' },
  viewsLabel: 'Afficher',
  siteFilter: 'Site',
  allSites: 'Tous les sites',
  filter: 'Filtrer',
  emptyReview: 'Rien à examiner : le moteur a tranché toutes les demandes.',
  emptyAll: 'Aucune demande pour l’instant. Les clients proposent leurs mots-clés depuis leur espace.',
  received: (day: string) => `Reçue le ${day}`,
  wished: (day: string) => `souhaitée pour le ${day}`,
  plannedFor: (day: string) => `Prévue le ${day}`,
  waited: (cycles: number) => `${cycles} cycle${cycles > 1 ? 's' : ''} d’attente`,
  noteLabel: 'Note du client',
  viewPage: 'Voir la page',
  pager: 'Demandes, suite',
  previous: 'Précédentes',
  next: 'Suivantes',
  actionsLabel: (keyword: string) => `Décider pour « ${keyword} »`,
  actions: { integrate: 'Intégrer', defer: 'Reporter', decline: 'Refuser…', reopen: 'Rouvrir' } satisfies Record<OperatorAction, string>,
  actionHints: {
    integrate: 'Dans le cycle en cours si une page prévue peut lui céder la place, sinon en tête du prochain plan.',
    defer: 'En tête du prochain plan.',
    decline: 'Avec un motif que le client lira.',
    reopen: 'De nouveau à examiner.',
  } satisfies Record<OperatorAction, string>,
  integrating: 'Le moteur cherche une place dans le cycle en cours : 2 minutes au plus.',
  done: {
    integrate: 'Intégration demandée.',
    defer: 'Reportée au cycle suivant.',
    decline: 'Refusée : le client lit votre motif.',
    reopen: 'De nouveau à examiner.',
  } satisfies Record<OperatorAction, string>,
  declineTitle: 'Refuser cette demande ?',
  declineBody: 'Le client lira ce motif tel quel, dans son espace. Écrivez-le pour lui : ce qui ne convient pas, et ce que vous lui proposez.',
  declineLabel: 'Motif pour le client',
  declineConfirm: 'Refuser la demande',
  declineCount: (count: number, max: number) => `${count} / ${max}`,
  problems: {
    not_allowed: 'Cette demande a changé : la file est rechargée.',
    reason_required: 'Écrivez un motif d’au moins 10 caractères : le client le lira.',
    reason_too_long: '500 caractères au plus.',
    no_campaign: 'Ce site n’a pas de campagne : créez-la avant d’intégrer ou de reporter une demande.',
  } satisfies Record<DecisionProblem | 'no_campaign', string>,
  changed: 'Cette demande a changé entre-temps : la file est rechargée.',
  failed: 'L’action n’a pas abouti. Réessayez dans un instant.',
  railCount: (count: number) => `${count} à examiner`,
} as const
