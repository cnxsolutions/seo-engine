// ─────────────────────────────────────────────────────────────────────────────
// Les compteurs de l'écran de publication — tests
// SEO Engine - « Une ligne, un geste. » Jamais deux.
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE CE FICHIER PROTÈGE. Un compteur faux ne lève aucune exception et ne
// casse aucun rendu : il se contente d'annoncer huit décisions à prendre là où
// il y en a cinq, tous les jours, sans que rien ne le signale. C'est exactement
// le genre de mensonge tranquille que ce lot existe pour empêcher, et c'est la
// seule règle de cet écran qu'un test peut tenir.
//
// LE CAS DE RECETTE, MOT POUR MOT : trois lignes 'refresh' et deux lignes
// 'create', toutes 'generated', doivent rendre 2 et 3 — jamais 5 et 3.

import { describe, expect, it } from 'vitest'
import { splitPublishQueue, toPublishCount, type QueueLine } from './counts'

/** Une ligne réduite à ce que le partage regarde, plus un nom pour la suivre. */
type Line = QueueLine & { id: string }

const line = (id: string, intent: 'create' | 'refresh', status: Line['status']): Line =>
  ({ id, intent, status })

// Le jeu de la consigne : 3 mises à jour + 2 pages neuves, toutes finies.
const THREE_REFRESH_TWO_CREATE: Line[] = [
  line('r1', 'refresh', 'generated'),
  line('c1', 'create', 'generated'),
  line('r2', 'refresh', 'generated'),
  line('c2', 'create', 'generated'),
  line('r3', 'refresh', 'generated'),
]

/** Le total autoritaire tel que GET /api/generate le compte : cinq lignes 'generated'. */
const GENERATED_COUNT = 5

describe('les deux tuiles de « generated »', () => {
  it('rendent 2 et 3 sur 3 refresh + 2 create, jamais 5 et 3', () => {
    const { refreshPending } = splitPublishQueue(THREE_REFRESH_TWO_CREATE)
    const toPublish = toPublishCount(GENERATED_COUNT, refreshPending.length)

    expect(refreshPending).toHaveLength(3)
    expect(toPublish).toBe(2)

    // La formulation négative de la recette, écrite telle quelle : le jour où
    // « À publier » repasse sur le total brut, cette ligne le dit.
    expect(toPublish).not.toBe(GENERATED_COUNT)
  })

  it('se partagent exactement le total, sans jamais le dépasser', () => {
    const { refreshPending } = splitPublishQueue(THREE_REFRESH_TWO_CREATE)

    expect(toPublishCount(GENERATED_COUNT, refreshPending.length) + refreshPending.length)
      .toBe(GENERATED_COUNT)
  })

  it('ne comptent jamais la MÊME ligne des deux côtés', () => {
    const { refreshPending, queue } = splitPublishQueue(THREE_REFRESH_TWO_CREATE)

    // La propriété de fond, vérifiée sur les identités et pas sur les longueurs :
    // deux listes de bonne taille peuvent parfaitement se recouvrir.
    const inBoth = refreshPending.filter((r) => queue.some((q) => q.id === r.id))
    expect(inBoth).toEqual([])
    expect([...refreshPending, ...queue].map((g) => g.id).sort())
      .toEqual(THREE_REFRESH_TWO_CREATE.map((g) => g.id).sort())
  })

  it('laisse la file ordinaire refuser les mises à jour, quelle que soit leur place', () => {
    const { queue } = splitPublishQueue(THREE_REFRESH_TWO_CREATE)

    // « Publier maintenant » n'envoie ni `replaces` ni modale : une ligne
    // 'refresh' atteignable par ce bouton serait un remplacement expédié sans
    // qu'un humain ait lu la page écrasée.
    expect(queue.map((g) => g.id)).toEqual(['c1', 'c2'])
  })
})

describe('les lignes qui n attendent plus de décision', () => {
  it('garde une mise à jour DÉJÀ EN VOL dans la file ordinaire, et hors des deux tuiles', () => {
    const flying = line('r-flying', 'refresh', 'publishing')
    const { refreshPending, queue } = splitPublishQueue([...THREE_REFRESH_TWO_CREATE, flying])

    // 'publishing' a sa propre tuile (« En cours ») : la compter aussi dans
    // « Mises à jour à valider » ferait réclamer un clic sur une ligne partie.
    expect(refreshPending.map((g) => g.id)).not.toContain('r-flying')
    expect(queue.map((g) => g.id)).toContain('r-flying')
    expect(toPublishCount(GENERATED_COUNT, refreshPending.length)).toBe(2)
  })

  it('ignore les statuts qui ne sont ni finis ni en vol', () => {
    const others: Line[] = [
      line('p', 'create', 'published'),
      line('x', 'refresh', 'rejected'),
      line('f', 'refresh', 'failed'),
      line('w', 'create', 'pending'),
    ]
    const { refreshPending, queue } = splitPublishQueue([...THREE_REFRESH_TWO_CREATE, ...others])

    expect(refreshPending).toHaveLength(3)
    expect(queue.map((g) => g.id)).toEqual(['c1', 'c2'])
  })
})

describe('toPublishCount', () => {
  it('ne descend pas sous zéro quand la liste chargée dépasse le comptage', () => {
    // La liste est plafonnée à 150 lignes alors que le comptage ne l'est pas :
    // une resynchronisation partielle peut inverser les deux. Un « -1 à
    // publier » ne veut rien dire sur cet écran.
    expect(toPublishCount(2, 5)).toBe(0)
  })

  it('rend le total inchangé quand aucune mise à jour n attend', () => {
    expect(toPublishCount(5, 0)).toBe(5)
  })
})
