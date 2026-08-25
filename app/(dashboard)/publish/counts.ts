// ─────────────────────────────────────────────────────────────────────────────
// Le partage de la file de publication, et les deux compteurs qui en découlent
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE FICHIER EXISTE. Ces trois lignes vivaient dans le corps de
// `PublishPage`, un composant client que rien ne peut instancier sans un
// navigateur. La règle qu'elles portent — UNE LIGNE N'EST COMPTÉE QU'UNE FOIS —
// est pourtant la seule chose de cet écran qui puisse mentir en silence : deux
// tuiles qui annoncent 5 et 3 là où il y a cinq gestes à faire ne plantent
// jamais, elles se contentent de faire promettre huit décisions au propriétaire.
//
// Sorties ici, elles se testent sans rendu, sans DOM et sans réseau.
//
// CE QUI EST GARANTI, ET C'EST TOUT :
//
//   1. `refreshPending` et `queue` sont DISJOINTES — aucune ligne dans les deux.
//   2. « À publier » + « Mises à jour à valider » vaut exactement le total
//      autoritaire `counts.generated`, jamais davantage.
//   3. Une ligne déjà en vol (`publishing`) reste dans la file ordinaire quel
//      que soit son intention : elle n'attend plus de décision humaine.

import type { FeedGeneration } from '@/app/api/generate/feed-types'

/** Le strict minimum dont le partage a besoin — le reste de la ligne ne l'intéresse pas. */
export type QueueLine = Pick<FeedGeneration, 'intent' | 'status'>

export interface PublishQueueSplit<T extends QueueLine> {
  /**
   * Ce qui attend une LECTURE puis un clic dans une modale qui nomme la page
   * écrasée. Jamais rendu par la file ordinaire : son bouton « Publier
   * maintenant » n'envoie aucun `replaces` et n'ouvre aucune modale.
   */
  refreshPending: T[]
  /** Ce que « Publier maintenant » a le droit d'expédier tel quel. */
  queue: T[]
}

/**
 * Sépare les lignes qui attendent une validation humaine de celles qui
 * attendent une simple publication.
 *
 * Les deux prédicats sont écrits pour être exhaustifs sur `status === 'generated'` :
 * une ligne 'generated' part dans `refreshPending` si — et seulement si — son
 * intention est 'refresh', et dans `queue` sinon. C'est ce qui rend impossible
 * qu'une ligne soit comptée deux fois, ou oubliée par les deux.
 */
export function splitPublishQueue<T extends QueueLine>(generations: readonly T[]): PublishQueueSplit<T> {
  const refreshPending = generations.filter((g) => g.status === 'generated' && g.intent === 'refresh')
  const queue = generations.filter(
    (g) => (g.status === 'generated' && g.intent !== 'refresh') || g.status === 'publishing'
  )
  return { refreshPending, queue }
}

/**
 * La tuile « À publier », par SOUSTRACTION du total autoritaire.
 *
 * `generatedCount` vient des comptages `head: true` de GET /api/generate,
 * filtrés par site : c'est le seul chiffre qui ne dépende pas du plafond de
 * lignes chargées. On lui retire les mises à jour, qui ont leur propre tuile.
 *
 * `Math.max(..., 0)` n'est pas de la superstition : la liste chargée est
 * plafonnée alors que le comptage ne l'est pas, et une resynchronisation
 * partielle peut faire passer `refreshPendingCount` au-dessus. Un compteur
 * négatif sur un écran de publication ne veut rien dire ; zéro, si.
 */
export function toPublishCount(generatedCount: number, refreshPendingCount: number): number {
  return Math.max(generatedCount - refreshPendingCount, 0)
}
