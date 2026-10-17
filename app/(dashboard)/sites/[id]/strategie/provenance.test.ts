// ─────────────────────────────────────────────────────────────────────────────
// « N briefs sur N citent une mesure Search Console » — tests du comptage
// ─────────────────────────────────────────────────────────────────────────────
//
// LE CAS DE RECETTE : un plan construit à l'aveugle, dont chaque brief porte
// « Décidé sans Search Console : aucune mesure d'audience n'était disponible »,
// annonçait « 3 briefs sur 3 citent une mesure Search Console ». Il doit
// annoncer zéro.

import { describe, expect, it } from 'vitest'
import type { PlanPreviewItem } from '@/lib/types'
import { citesMeasurement, countMeasuredBriefs, sentenceCitesMeasurement } from './provenance'

/** Un brief réduit à ce que le comptage lit : sa justification, ses règles, son verdict. */
function brief(rationale: string, seoRules: string[] = [], action?: PlanPreviewItem['action']): PlanPreviewItem {
  return {
    id: rationale.slice(0, 12),
    scheduled_date: '2026-10-20',
    page_type: 'child',
    priority: 'low',
    target_city: 'Troyes',
    target_keyword: 'taxi troyes',
    secondary_keywords: [],
    search_intent: 'locale',
    proposed_title: 'Taxi à Troyes',
    proposed_slug: 'taxi-troyes',
    page_goal: '',
    outline: [],
    seo_rules: seoRules,
    required_entities: [],
    internal_link_targets: [],
    competitor_insights: [],
    estimated_word_count: 900,
    rationale,
    action,
  }
}

/** La phrase exacte que lib/planning/brief-plan.ts écrit sur un brief aveugle (sans accents). */
const BLIND_AS_STORED =
  "Page child planifiee pour renforcer la couverture longue traine. Decide sans Search Console : aucune mesure d'audience n'etait disponible, l'absence de donnee ne vaut pas absence de concurrence."

/** La même, telle que le propriétaire l'a lue à l'écran. */
const BLIND_AS_READ = 'Décidé sans Search Console : aucune mesure d’audience n’était disponible.'

describe('les briefs construits sans Search Console', () => {
  it('ne comptent pas : le plan aveugle annonce zéro, jamais « 3 sur 3 »', () => {
    const items = [brief(BLIND_AS_STORED), brief(BLIND_AS_STORED), brief(BLIND_AS_READ)]
    expect(countMeasuredBriefs(items)).toBe(0)
  })

  it('ne comptent pas quand le domaine dit l’absence en parlant de cannibalisation', () => {
    const domain =
      "Decide sans Search Console : aucune mesure d'audience n'etait disponible, la decision repose sur la seule identite editoriale. L'absence de donnee ne vaut pas absence de cannibalisation."
    expect(citesMeasurement(brief('Page planifiee.', [domain]))).toBe(false)
  })

  it('ne comptent pas une règle de rédaction qui vise une position sans la mesurer', () => {
    expect(citesMeasurement(brief('Page planifiee.', ['Viser la position 1 sur la requete principale.']))).toBe(false)
  })

  it('écartent une phrase qui dit l’absence même si elle porte un chiffre', () => {
    expect(sentenceCitesMeasurement('Search Console non connectee : 0 impressions lues.')).toBe(false)
  })
})

describe('les briefs construits sur une mesure', () => {
  it('comptent la justification chiffrée du planificateur', () => {
    const measured =
      'Requete mesuree a 120 impressions et position 7.3 en Search Console : gain de places atteignable en renforcant https://exemple.fr/taxi.'
    expect(citesMeasurement(brief(measured))).toBe(true)
  })

  it('comptent une règle qui cite la position mesurée d’une page', () => {
    const rule = 'Requete "taxi troyes" en position 8.4 sur https://exemple.fr/taxi : traiter une sous-intention et lier vers cette URL, ne pas la concurrencer.'
    expect(citesMeasurement(brief('Page planifiee.', [rule]))).toBe(true)
  })

  it('comptent la preuve chiffrée d’un verdict, cannibalisation comprise', () => {
    const skip = brief('Page planifiee.', [], {
      kind: 'skip',
      reasons: ['Search Console : 2 pages du site se disputent deja « taxi troyes » (40 impression(s), 1 clic(s)).'],
    })
    expect(citesMeasurement(skip)).toBe(true)
  })

  it('comptent un CTR chiffré', () => {
    expect(sentenceCitesMeasurement('Page vue 300 fois pour 2 clic(s) (CTR 0,67 %, position 6.1).')).toBe(true)
  })

  it('ne comptent que les briefs mesurés dans un plan mêlé', () => {
    const items = [
      brief('Requete mesuree a 45 impressions et position 12 en Search Console : gain atteignable.'),
      brief(BLIND_AS_STORED),
      brief(`Page pillar planifiee pour renforcer la couverture longue traine. ${BLIND_AS_READ}`),
    ]
    expect(countMeasuredBriefs(items)).toBe(1)
  })
})
