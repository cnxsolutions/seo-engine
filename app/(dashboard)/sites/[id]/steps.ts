// ─────────────────────────────────────────────────────────────────────────────
// Le parcours d'UN site — cinq étapes, chacune lue sur des faits réels
// SEO Engine - règles pures, sans base de données
// ─────────────────────────────────────────────────────────────────────────────
//
// La barre latérale portait un parcours GLOBAL (app/api/workflow/state.ts),
// calculé sur tous les sites à la fois. « Connecter Google » y était vrai d'un
// site et faux du suivant, et l'opérateur ne savait jamais DUQUEL on parlait.
// Ces règles répondent à la même question, mais pour un seul site, et vivent à
// part de la page pour être testées sans Supabase.
//
// Un invariant : chaque étape porte toujours une phrase (`detail`). Une pastille
// grise sans explication est exactement l'impasse que ce fichier remplace.

import type { CyclePlanStatus } from '@/lib/types'

export type HubStepId = 'connexion' | 'strategie' | 'calendrier' | 'publication' | 'resultats'

/**
 * `done` et `attention` sont des conclusions tirées des faits ; `current` est
 * la première étape qui n'est pas finie ; `pending` est le reste.
 *
 * `attention` prime sur `done` : une étape qui a publié le mois dernier mais
 * dont sept pages attendent une relecture aujourd'hui n'est pas « faite ».
 */
export type HubStepTone = 'done' | 'current' | 'attention' | 'pending'

export interface HubStep {
  id: HubStepId
  /** Rang 1 à 5, affiché dans la pastille. Dérivé ici pour ne jamais dériver. */
  order: number
  label: string
  tone: HubStepTone
  /** Une ligne de contexte — ce qui manque, ou ce qui a été produit. */
  detail: string
  /**
   * Ce que la pastille affiche à la place du rang : le nombre de choses qui
   * attendent, quand l'étape réclame une décision. Absent sinon.
   */
  count?: number
}

export interface HubFacts {
  /** `wordpress` | `nextjs` — gardé lâche, il ne choisit qu'une formulation. */
  siteType: string
  /** WordPress : identifiants sur fichier. Next.js : dépôt analysé (`repo_profile`). */
  described: boolean
  google: {
    connected: boolean
    /** Une propriété Search Console a été CHOISIE. Connecté ≠ mesurable. */
    hasProperty: boolean
  }
  campaigns: number
  /** Le plan de cycle actif de la campagne la plus avancée, s'il y en a un. */
  cycle: { number: number; status: CyclePlanStatus } | null
  /** Date `YYYY-MM-DD` du prochain créneau encore planifié, ou null. */
  nextSlotDate: string | null
  /** Pages en `generated` : elles attendent une relecture ou une publication. */
  awaitingReview: number
  publishedThisMonth: number
  failedLast7Days: number
  gsc: {
    /** Lignes `gsc_performance` conservées. `null` quand la table est illisible. */
    rows: number | null
    lastSyncAt: string | null
  }
}

const LABELS: Record<HubStepId, string> = {
  connexion: 'Connexion',
  strategie: 'Stratégie',
  calendrier: 'Calendrier',
  publication: 'Publication',
  resultats: 'Résultats',
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`
}

/** « 21 oct. » depuis une date ISO, à midi UTC pour ne pas glisser d'un jour. */
function shortDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
    .format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
}

export function deriveHubSteps(facts: HubFacts): HubStep[] {
  const steps: HubStep[] = [
    connexionStep(facts),
    strategieStep(facts),
    calendrierStep(facts),
    publicationStep(facts),
    resultatsStep(facts),
  ]

  // L'étape mise en avant est la PREMIÈRE qui reste à faire. Une étape en
  // `attention` garde sa teinte : elle réclame déjà une décision, et la marquer
  // courante en plus ne dirait rien de plus.
  const current = steps.find((step) => step.tone === 'pending')
  if (current) current.tone = 'current'

  return steps
}

// ─── Étapes ──────────────────────────────────────────────────────────────────

function connexionStep(facts: HubFacts): HubStep {
  const base = { id: 'connexion' as const, order: 1, label: LABELS.connexion }

  if (!facts.described) {
    return {
      ...base,
      tone: 'pending',
      detail: facts.siteType === 'nextjs' ? 'Dépôt jamais analysé' : 'Identifiants WordPress manquants',
    }
  }
  if (!facts.google.connected) return { ...base, tone: 'pending', detail: 'Google non connecté' }
  if (!facts.google.hasProperty) return { ...base, tone: 'pending', detail: 'Propriété Search Console à choisir' }

  return { ...base, tone: 'done', detail: 'CMS et Google reliés' }
}

function strategieStep(facts: HubFacts): HubStep {
  const base = { id: 'strategie' as const, order: 2, label: LABELS.strategie }

  if (facts.campaigns === 0) return { ...base, tone: 'pending', detail: 'Aucune campagne' }
  if (!facts.cycle) return { ...base, tone: 'pending', detail: 'Aucun cycle en cours' }

  switch (facts.cycle.status) {
    case 'draft':
      return { ...base, tone: 'pending', detail: `Plan du cycle ${facts.cycle.number} à confirmer` }
    case 'confirmed':
      return { ...base, tone: 'done', detail: `Cycle ${facts.cycle.number} confirmé` }
    case 'executing':
      return { ...base, tone: 'done', detail: `Cycle ${facts.cycle.number} en cours` }
    default:
      // `completed` et `cancelled` ne sont pas des cycles en cours ; les lire
      // comme tels ferait dire « en cours » d'un cycle qui s'est arrêté.
      return { ...base, tone: 'pending', detail: `Cycle ${facts.cycle.number} terminé, aucun cycle en cours` }
  }
}

function calendrierStep(facts: HubFacts): HubStep {
  const base = { id: 'calendrier' as const, order: 3, label: LABELS.calendrier }

  if (!facts.nextSlotDate) return { ...base, tone: 'pending', detail: 'Aucun créneau planifié' }
  return { ...base, tone: 'done', detail: `Prochaine page le ${shortDay(facts.nextSlotDate)}` }
}

function publicationStep(facts: HubFacts): HubStep {
  const base = { id: 'publication' as const, order: 4, label: LABELS.publication }

  if (facts.awaitingReview > 0) {
    return {
      ...base,
      tone: 'attention',
      count: facts.awaitingReview,
      detail: facts.awaitingReview > 1
        ? `${facts.awaitingReview} pages attendent votre avis`
        : '1 page attend votre avis',
    }
  }
  if (facts.failedLast7Days > 0) {
    return {
      ...base,
      tone: 'attention',
      count: facts.failedLast7Days,
      detail: `${plural(facts.failedLast7Days, 'échec', 'échecs')} sur 7 jours`,
    }
  }
  if (facts.publishedThisMonth > 0) {
    return { ...base, tone: 'done', detail: `${facts.publishedThisMonth} en ligne ce mois-ci` }
  }
  return { ...base, tone: 'pending', detail: 'Rien publié ce mois-ci' }
}

function resultatsStep(facts: HubFacts): HubStep {
  const base = { id: 'resultats' as const, order: 5, label: LABELS.resultats }

  if (!facts.google.connected || !facts.google.hasProperty) {
    return { ...base, tone: 'pending', detail: 'Search Console non reliée' }
  }
  if (facts.gsc.rows === null) return { ...base, tone: 'pending', detail: 'Données illisibles' }
  if (facts.gsc.rows > 0) return { ...base, tone: 'done', detail: 'Données Search Console disponibles' }
  if (!facts.gsc.lastSyncAt) return { ...base, tone: 'pending', detail: 'Première synchronisation en attente' }

  // Google publie avec deux à trois jours de retard : une synchronisation qui
  // a tourné sans rien ramener est normale sur un site relié cette semaine.
  return { ...base, tone: 'pending', detail: 'Données Google en attente (2 à 3 jours)' }
}
