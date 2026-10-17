// ─────────────────────────────────────────────────────────────────────────────
// Le partage de la file de publication, et le compteur qui en découle
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE FICHIER EXISTE. Ces lignes vivaient dans le corps de l'écran de
// publication, un composant client que rien ne peut instancier sans un
// navigateur. La règle qu'elles portent — UNE LIGNE N'EST COMPTÉE QU'UNE FOIS —
// est pourtant la seule chose de cet écran qui puisse mentir en silence : une
// tuile qui annonce 5 là où il y a deux gestes à faire ne plante jamais, elle se
// contente de faire promettre cinq décisions au propriétaire.
//
// LES MISES À JOUR N'EXISTENT PLUS (décision du propriétaire, 17/10/2026 : « je
// ne veux pas de mise à jour »). Le moteur ne crée plus de ligne d'intention
// 'refresh'. Celles qui restent en base sont d'anciennes demandes : le
// planificateur ne les publie pas (`listPendingPublishGenerations` ne lit que
// les créations) et l'écran ne les propose plus à la publication. Elles sont
// mises à l'écart ici, et soustraites du compteur « À publier », qui sinon les
// compterait comme des pages en attente.
//
// Sorties ici, ces règles se testent sans rendu, sans DOM et sans réseau.
//
// CE QUI EST GARANTI, ET C'EST TOUT :
//
//   1. `legacyRefresh` et `queue` sont DISJOINTES — aucune ligne dans les deux.
//   2. « À publier » + anciennes demandes vaut exactement le total autoritaire
//      `counts.generated`, jamais davantage.
//   3. Une ligne déjà en vol (`publishing`) reste dans la file ordinaire quelle
//      que soit son intention : elle n'attend plus de décision humaine.

import type { FeedGeneration } from '@/app/api/generate/feed-types'

/** Le strict minimum dont le partage a besoin — le reste de la ligne ne l'intéresse pas. */
export type QueueLine = Pick<FeedGeneration, 'intent' | 'status'>

export interface PublishQueueSplit<T extends QueueLine> {
  /**
   * Les anciennes demandes de mise à jour encore en attente. Jamais rendues par
   * la file : son bouton « Publier maintenant » ne doit pas pouvoir remplacer
   * une page existante, ce que le produit ne fait plus.
   */
  legacyRefresh: T[]
  /** Ce que « Publier maintenant » a le droit d'expédier tel quel. */
  queue: T[]
}

/**
 * Sépare les pages neuves à publier des anciennes demandes de mise à jour.
 *
 * Les deux prédicats sont écrits pour être exhaustifs sur `status === 'generated'` :
 * une ligne 'generated' part dans `legacyRefresh` si — et seulement si — son
 * intention est 'refresh', et dans `queue` sinon. C'est ce qui rend impossible
 * qu'une ligne soit comptée deux fois, ou oubliée par les deux.
 */
export function splitPublishQueue<T extends QueueLine>(generations: readonly T[]): PublishQueueSplit<T> {
  const legacyRefresh = generations.filter((g) => g.status === 'generated' && g.intent === 'refresh')
  const queue = generations.filter(
    (g) => (g.status === 'generated' && g.intent !== 'refresh') || g.status === 'publishing'
  )
  return { legacyRefresh, queue }
}

/**
 * La tuile « À publier », par SOUSTRACTION du total autoritaire.
 *
 * `generatedCount` vient des comptages `head: true` de GET /api/generate,
 * filtrés par site : c'est le seul chiffre qui ne dépende pas du plafond de
 * lignes chargées. On lui retire les anciennes demandes de mise à jour, qui ne
 * partiront pas.
 *
 * `Math.max(..., 0)` n'est pas de la superstition : la liste chargée est
 * plafonnée alors que le comptage ne l'est pas, et une resynchronisation
 * partielle peut faire passer `legacyRefreshCount` au-dessus. Un compteur
 * négatif sur un écran de publication ne veut rien dire ; zéro, si.
 */
export function toPublishCount(generatedCount: number, legacyRefreshCount: number): number {
  return Math.max(generatedCount - legacyRefreshCount, 0)
}
