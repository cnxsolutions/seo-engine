// ─────────────────────────────────────────────────────────────────────────────
// Le compteur de l'onglet Publication — tests
// SEO Engine - « Une ligne, un geste. » Jamais deux.
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE CE FICHIER PROTÈGE. Un compteur faux ne lève aucune exception et ne
// casse aucun rendu : il se contente d'annoncer cinq pages à publier là où il y
// en a deux, tous les jours, sans que rien ne le signale.
//
// LE CAS DE RECETTE : trois anciennes demandes de mise à jour et deux pages
// neuves, toutes 'generated', doivent rendre 2 à publier — jamais 5 — et les
// trois anciennes demandes ne doivent jamais atteindre la file.

import { describe, expect, it } from 'vitest'
import { splitPublishQueue, toPublishCount, type QueueLine } from './counts'

/** Une ligne réduite à ce que le partage regarde, plus un nom pour la suivre. */
type Line = QueueLine & { id: string }

const line = (id: string, intent: 'create' | 'refresh', status: Line['status']): Line =>
  ({ id, intent, status })

// 3 anciennes demandes de mise à jour + 2 pages neuves, toutes finies.
const THREE_LEGACY_TWO_CREATE: Line[] = [
  line('r1', 'refresh', 'generated'),
  line('c1', 'create', 'generated'),
  line('r2', 'refresh', 'generated'),
  line('c2', 'create', 'generated'),
  line('r3', 'refresh', 'generated'),
]

/** Le total autoritaire tel que GET /api/generate le compte : cinq lignes 'generated'. */
const GENERATED_COUNT = 5

describe('la tuile « À publier »', () => {
  it('rend 2 sur 3 anciennes demandes + 2 pages neuves, jamais 5', () => {
    const { legacyRefresh } = splitPublishQueue(THREE_LEGACY_TWO_CREATE)
    const toPublish = toPublishCount(GENERATED_COUNT, legacyRefresh.length)

    expect(legacyRefresh).toHaveLength(3)
    expect(toPublish).toBe(2)

    // La formulation négative de la recette, écrite telle quelle : le jour où
    // « À publier » repasse sur le total brut, cette ligne le dit.
    expect(toPublish).not.toBe(GENERATED_COUNT)
  })

  it('se partage exactement le total avec les anciennes demandes, sans jamais le dépasser', () => {
    const { legacyRefresh } = splitPublishQueue(THREE_LEGACY_TWO_CREATE)

    expect(toPublishCount(GENERATED_COUNT, legacyRefresh.length) + legacyRefresh.length)
      .toBe(GENERATED_COUNT)
  })

  it('ne range jamais la MÊME ligne des deux côtés', () => {
    const { legacyRefresh, queue } = splitPublishQueue(THREE_LEGACY_TWO_CREATE)

    // La propriété de fond, vérifiée sur les identités et pas sur les longueurs :
    // deux listes de bonne taille peuvent parfaitement se recouvrir.
    const inBoth = legacyRefresh.filter((r) => queue.some((q) => q.id === r.id))
    expect(inBoth).toEqual([])
    expect([...legacyRefresh, ...queue].map((g) => g.id).sort())
      .toEqual(THREE_LEGACY_TWO_CREATE.map((g) => g.id).sort())
  })

  it('tient les anciennes demandes hors de la file, quelle que soit leur place', () => {
    const { queue } = splitPublishQueue(THREE_LEGACY_TWO_CREATE)

    // « Publier maintenant » remplacerait la page existante : le produit ne met
    // plus à jour, une ancienne demande ne doit donc jamais atteindre ce bouton.
    expect(queue.map((g) => g.id)).toEqual(['c1', 'c2'])
  })
})

describe('les lignes qui n attendent plus de décision', () => {
  it('garde une ancienne demande DÉJÀ EN VOL dans la file ordinaire, et hors des anciennes demandes', () => {
    const flying = line('r-flying', 'refresh', 'publishing')
    const { legacyRefresh, queue } = splitPublishQueue([...THREE_LEGACY_TWO_CREATE, flying])

    // 'publishing' a sa propre tuile (« En cours ») : la ligne est partie, il
    // n'y a plus rien à décider à son sujet.
    expect(legacyRefresh.map((g) => g.id)).not.toContain('r-flying')
    expect(queue.map((g) => g.id)).toContain('r-flying')
    expect(toPublishCount(GENERATED_COUNT, legacyRefresh.length)).toBe(2)
  })

  it('ignore les statuts qui ne sont ni finis ni en vol', () => {
    const others: Line[] = [
      line('p', 'create', 'published'),
      line('x', 'refresh', 'rejected'),
      line('f', 'refresh', 'failed'),
      line('w', 'create', 'pending'),
    ]
    const { legacyRefresh, queue } = splitPublishQueue([...THREE_LEGACY_TWO_CREATE, ...others])

    expect(legacyRefresh).toHaveLength(3)
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

  it('rend le total inchangé quand aucune ancienne demande n attend', () => {
    expect(toPublishCount(5, 0)).toBe(5)
  })
})
