// ─────────────────────────────────────────────────────────────────────────────
// Site Inventory Tests
// SEO Engine - Domain
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux choses sont verrouillees ici, et ce sont les deux qui cassent en silence.
//
// 1. La normalisation de chemin doit coincider avec l'expression SQL que la
//    migration 018 a deja inscrite en base. Si elles divergent, l'amorcage
//    reste en base et devient INVISIBLE au code : aucune erreur, aucun test
//    rouge, juste un moteur qui regenere des pages qu'il a lui-meme publiees.
// 2. freshnessOf doit distinguer un site jamais analyse d'un site analyse sans
//    resultat. Les confondre ferait afficher « lancez une analyse » a un
//    operateur dont l'analyse a deja tourne et n'a rien trouve.

import { describe, it, expect } from 'vitest'
import {
  BLIND_AFTER_DAYS,
  STALE_AFTER_DAYS,
  blindInventory,
  freshnessOf,
  normalizeInventoryPath,
} from './inventory'

/**
 * Reproduction litterale de l'expression de la migration 018 :
 *   lower('/' || ltrim(g.slug, '/'))
 * ltrim(x, '/') retire TOUS les slashs de tete, pas un seul.
 */
function sqlBootstrapPath(slug: string): string {
  return `/${slug.replace(/^\/+/, '')}`.toLowerCase()
}

/** Les formes de slug que generations.slug porte reellement. */
const SLUGS_REELS = [
  'taxi-troyes',
  'Taxi-Troyes',
  '/taxi-troyes',
  '//taxi-troyes',
  'Services/Taxi-Conventionne',
  'transport-medical-assis-sainte-savine',
]

describe('normalizeInventoryPath', () => {
  it('coincide avec l amorcage SQL de la migration 018', () => {
    for (const slug of SLUGS_REELS) {
      expect(normalizeInventoryPath(slug)).toBe(sqlBootstrapPath(slug))
    }
  })

  it('est idempotente', () => {
    // La forme normalisee est comparee a d'autres formes normalisees et
    // realimente takenPaths. Un second passage qui la changerait ferait dire a
    // la meme URL qu'elle est libre une fois sur deux.
    for (const brut of [...SLUGS_REELS, '/Taxi/', '', '/', '/taxi?utm=ads#tarifs']) {
      const once = normalizeInventoryPath(brut)
      expect(normalizeInventoryPath(once)).toBe(once)
    }
  })

  it('garantit un slash de tete et un seul', () => {
    expect(normalizeInventoryPath('taxi-troyes')).toBe('/taxi-troyes')
    expect(normalizeInventoryPath('///taxi-troyes')).toBe('/taxi-troyes')
    expect(normalizeInventoryPath('/services//taxi')).toBe('/services/taxi')
  })

  it('retire le slash de queue, sauf sur la racine', () => {
    expect(normalizeInventoryPath('/taxi-troyes/')).toBe('/taxi-troyes')
    expect(normalizeInventoryPath('/')).toBe('/')
  })

  it('minuscule, comme le lower() de la migration', () => {
    expect(normalizeInventoryPath('/Taxi-Troyes')).toBe(normalizeInventoryPath('/taxi-troyes'))
  })

  it('ignore les parametres de requete et l ancre', () => {
    // idx_site_pages_url est unique sur le path BRUT : '/taxi?utm=ads' et
    // '/taxi' coexistent legalement en base et designent la meme page.
    expect(normalizeInventoryPath('/taxi-troyes?utm_source=ads')).toBe('/taxi-troyes')
    expect(normalizeInventoryPath('/taxi-troyes#tarifs')).toBe('/taxi-troyes')
    expect(normalizeInventoryPath('/taxi-troyes?utm=1#tarifs')).toBe('/taxi-troyes')
  })

  it('rend une chaine vide sur une entree vide, et surtout pas la racine', () => {
    // Rendre '/' ferait passer la page d'accueil pour occupee par une ligne
    // sans chemin, et la ferait compter dans counts.total.
    expect(normalizeInventoryPath('')).toBe('')
    expect(normalizeInventoryPath('   ')).toBe('')
    expect(normalizeInventoryPath(null)).toBe('')
    expect(normalizeInventoryPath(undefined)).toBe('')
  })

  it('ne jette pas sur une sequence d echappement invalide', () => {
    expect(() => normalizeInventoryPath('/taxi-%E0%A4%A')).not.toThrow()
    expect(normalizeInventoryPath('/taxi-%E0%A4%A')).toBe('/taxi-%e0%a4%a')
  })
})

const NOW = new Date('2026-08-21T12:00:00.000Z')

function ilYaJours(jours: number): string {
  return new Date(NOW.getTime() - jours * 24 * 60 * 60 * 1000).toISOString()
}

describe('freshnessOf', () => {
  it('distingue un site jamais analyse d un site analyse sans resultat', () => {
    const jamais = freshnessOf(null, false, 0, NOW)
    const sansResultat = freshnessOf(null, true, 0, NOW)

    expect(jamais.state).toBe('blind')
    expect(jamais.blindReason).toBe('jamais-analyse')
    expect(sansResultat.state).toBe('blind')
    expect(sansResultat.blindReason).toBe('aucune-page-trouvee')
    // Deux faits differents, deux raisons differentes : c'est toute la valeur
    // de hasCompletedRun, qui n'existe que pour porter cette distinction.
    expect(jamais.blindReason).not.toBe(sansResultat.blindReason)
  })

  it('voit un crawl recent qui n a rapporte aucune page', () => {
    const verdict = freshnessOf(ilYaJours(2), true, 0, NOW)

    expect(verdict.state).toBe('blind')
    expect(verdict.blindReason).toBe('aucune-page-trouvee')
    // La date reste affichable : l'operateur doit savoir que l'analyse a bien
    // tourne il y a deux jours, sinon il la relance pour rien.
    expect(verdict.ageDays).toBe(2)
  })

  it('declare aveugle un crawl trop vieux', () => {
    const verdict = freshnessOf(ilYaJours(50), true, 12, NOW)

    expect(verdict.state).toBe('blind')
    expect(verdict.blindReason).toBe('crawl-trop-vieux')
    expect(verdict.ageDays).toBe(50)
  })

  it('declare obsolete puis frais selon l age', () => {
    expect(freshnessOf(ilYaJours(20), true, 12, NOW).state).toBe('stale')
    expect(freshnessOf(ilYaJours(2), true, 12, NOW).state).toBe('fresh')
  })

  it('place les seuils juste au-dessus des constantes', () => {
    expect(freshnessOf(ilYaJours(STALE_AFTER_DAYS), true, 12, NOW).state).toBe('fresh')
    expect(freshnessOf(ilYaJours(STALE_AFTER_DAYS + 1), true, 12, NOW).state).toBe('stale')
    expect(freshnessOf(ilYaJours(BLIND_AFTER_DAYS), true, 12, NOW).state).toBe('stale')
    expect(freshnessOf(ilYaJours(BLIND_AFTER_DAYS + 1), true, 12, NOW).blindReason).toBe(
      'crawl-trop-vieux',
    )
  })

  it('nomme toujours la degradation quand elle est aveugle', () => {
    // La degradation se nomme, elle ne bloque jamais : un ecran doit pouvoir
    // dire POURQUOI il ne voit rien, sans quoi l'operateur conclut a une panne.
    const aveugles = [
      freshnessOf(null, false, 0, NOW),
      freshnessOf(null, true, 0, NOW),
      freshnessOf(ilYaJours(3), true, 0, NOW),
      freshnessOf(ilYaJours(90), true, 40, NOW),
    ]

    for (const verdict of aveugles) {
      expect(verdict.state).toBe('blind')
      expect(verdict.blindReason).toBeDefined()
    }
  })

  it('traite une date illisible comme une date absente, sans jeter', () => {
    expect(() => freshnessOf('pas une date', true, 12, NOW)).not.toThrow()

    const verdict = freshnessOf('pas une date', true, 12, NOW)
    expect(verdict.blindReason).toBe('aucune-page-trouvee')
    // On n'echo PAS la chaine recue : affichee telle quelle, elle ferait croire
    // a une analyse dont on saurait quelque chose.
    expect(verdict.lastCrawledAt).toBeNull()
    expect(verdict.ageDays).toBeNull()
  })

  it('ne rend jamais un age negatif', () => {
    // Deux horloges qui derivent suffisent a produire un crawl date du futur.
    const verdict = freshnessOf(ilYaJours(-3), true, 12, NOW)

    expect(verdict.ageDays).toBe(0)
    expect(verdict.state).toBe('fresh')
  })
})

describe('blindInventory', () => {
  it('rend un inventaire vide qui nomme sa cecite', () => {
    const inventaire = blindInventory('site-1', 'jamais-analyse')

    expect(inventaire.siteId).toBe('site-1')
    expect(inventaire.entries).toEqual([])
    expect(inventaire.takenPaths.size).toBe(0)
    expect(inventaire.crawledCount).toBe(0)
    expect(inventaire.publishedCount).toBe(0)
    expect(inventaire.freshness).toEqual({
      state: 'blind',
      blindReason: 'jamais-analyse',
      lastCrawledAt: null,
      ageDays: null,
    })
  })

  it('ne declare pas de troncature : rien n a ete tronque, il n y a rien', () => {
    // truncated durcit les seuils en aval. Le mettre a vrai ici ferait durcir
    // pour la mauvaise raison ; la cecite est deja nommee par blindReason.
    expect(blindInventory('site-1', 'aucune-page-trouvee').truncated).toBe(false)
  })
})
