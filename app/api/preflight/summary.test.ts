// ─────────────────────────────────────────────────────────────────────────────
// Tests du pre-vol operationnel
// SEO Engine - Verdict, croisement Claude, et les TROIS depensiers du tick
// ─────────────────────────────────────────────────────────────────────────────
//
// Le rapport de configuration est fabrique ici a la main plutot que pris de
// configReport() : ces tests portent sur la LECTURE d'un rapport, pas sur son
// contenu, et lib/config/preflight.test.ts couvre deja l'autre moitie. Les
// prendre de la vraie fonction rendrait ces cas dependants de l'environnement de
// la machine qui les execute — un test vert chez qui a un .env, rouge en CI.

import { describe, it, expect } from 'vitest'
import type { ConfigCheck } from '@/lib/config/preflight'
import {
  summarisePreflight,
  type PreflightCampaignRef,
  type PreflightCycleRef,
  type PreflightFacts,
} from './summary'

/** Un rapport sain : tous les bloquants passent, ANTHROPIC_API_KEY absente. */
function healthyConfig(overrides: Partial<Record<string, boolean>> = {}): ConfigCheck[] {
  const blocking = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'APP_ACCESS_SECRET']

  return [
    ...blocking.map<ConfigCheck>((name) => ({
      name,
      level: 'bloquant',
      ok: overrides[name] ?? true,
      why: `pourquoi ${name}`,
    })),
    {
      name: 'ANTHROPIC_API_KEY',
      level: 'recommande',
      ok: overrides.ANTHROPIC_API_KEY ?? false,
      why: 'pourquoi ANTHROPIC_API_KEY',
    },
  ]
}

function makeFacts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
  return {
    dueSlots: 0,
    dueCampaigns: 0,
    pendingDeferredPublications: 0,
    autoPublishCampaigns: [],
    renewingCycles: [],
    claudeCampaigns: [],
    config: healthyConfig(),
    schedulerEnabled: false,
    ...overrides,
  }
}

const couvreur: PreflightCampaignRef = { id: 'camp-1', name: 'SEO Couvreur chalons en champagne' }
const expiringCycle: PreflightCycleRef = { id: 'cycle-1', campaignName: 'SEO Couvreur chalons en champagne' }

function checkNamed(summary: ReturnType<typeof summarisePreflight>, name: string) {
  return summary.configuration.find((check) => check.name === name)
}

describe('summarisePreflight — verdict', () => {
  it('dit « prêt à ouvrir » quand rien ne part et que tout est posé', () => {
    const summary = summarisePreflight(makeFacts())

    expect(summary.verdict).toBe('pret-a-ouvrir')
    expect(summary.configurationOk).toBe(true)
    expect(summary.nextTick.spends).toBe(false)
    expect(summary.nextTick.publishesAlone).toBe(false)
    expect(summary.warnings).toEqual([])
    expect(summary.phrase).toContain('Prêt à ouvrir')
  })

  it('fait passer une configuration incomplète devant tout le reste', () => {
    const summary = summarisePreflight(
      makeFacts({
        config: healthyConfig({ OPENAI_API_KEY: false }),
        dueSlots: 8,
        schedulerEnabled: true,
      })
    )

    expect(summary.verdict).toBe('configuration-incomplete')
    expect(summary.configurationOk).toBe(false)
    expect(summary.phrase).toContain('OPENAI_API_KEY')
  })

  it('explique qu’un drapeau posé ne démarrera rien tant qu’un bloquant échoue', () => {
    const eteint = summarisePreflight(makeFacts({ config: healthyConfig({ APP_ACCESS_SECRET: false }) }))
    expect(eteint.phrase).toContain('Ne rien ouvrir')
    expect(eteint.phrase).not.toContain('ENABLE_SCHEDULER')

    const allume = summarisePreflight(
      makeFacts({ config: healthyConfig({ APP_ACCESS_SECRET: false }), schedulerEnabled: true })
    )
    expect(allume.phrase).toContain('ENABLE_SCHEDULER')
  })

  it('accorde la phrase au nombre de contrôles en échec', () => {
    const un = summarisePreflight(makeFacts({ config: healthyConfig({ OPENAI_API_KEY: false }) }))
    expect(un.phrase).toContain('manque ou est invalide')

    const deux = summarisePreflight(
      makeFacts({ config: healthyConfig({ OPENAI_API_KEY: false, APP_ACCESS_SECRET: false }) })
    )
    expect(deux.phrase).toContain('manquent ou sont invalides')
    expect(deux.phrase).toContain('OPENAI_API_KEY et APP_ACCESS_SECRET')
  })

  it('ne dit jamais « prêt à ouvrir » quand le planificateur tourne déjà', () => {
    const summary = summarisePreflight(makeFacts({ schedulerEnabled: true }))

    expect(summary.verdict).toBe('planificateur-allume')
    expect(summary.phrase).toContain('ALLUMÉ')
    expect(summary.phrase).toContain('15 minutes')
  })

  it('décrit ce que l’allumage déclencherait, planificateur éteint', () => {
    const summary = summarisePreflight(makeFacts({ dueSlots: 8 }))

    expect(summary.verdict).toBe('planificateur-eteint')
    expect(summary.phrase).toContain('Configuration complète, planificateur éteint')
    expect(summary.phrase).toContain('8 générations de créneaux échus')
  })

  it('ne rend « rien » que lorsque les trois travaux sont vides', () => {
    const rien = summarisePreflight(makeFacts({ schedulerEnabled: true }))
    expect(rien.phrase).toContain('déclenche rien')

    for (const facts of [
      makeFacts({ schedulerEnabled: true, dueSlots: 1 }),
      makeFacts({ schedulerEnabled: true, dueCampaigns: 1 }),
      makeFacts({ schedulerEnabled: true, renewingCycles: [expiringCycle] }),
      makeFacts({ schedulerEnabled: true, pendingDeferredPublications: 1 }),
    ]) {
      expect(summarisePreflight(facts).phrase).not.toContain('déclenche rien')
    }
  })

  it('renvoie aux avertissements même quand le prochain tick est calme', () => {
    // Campagne armée mais pas échue : le tick suivant ne publie rien, et la
    // vanne reste ouverte pour celui d'après. Un verdict rassurant qui tairait
    // ce fait est exactement le mensonge que ce module existe pour empêcher.
    const summary = summarisePreflight(makeFacts({ autoPublishCampaigns: [couvreur] }))

    expect(summary.verdict).toBe('pret-a-ouvrir')
    expect(summary.warnings).toHaveLength(1)
    expect(summary.phrase).toContain('Lire les avertissements')
  })
})

describe('summarisePreflight — le TROISIÈME dépensier', () => {
  it('quitte « prêt à ouvrir » sur un cycle à renouveler, sans aucun créneau ni campagne échus', () => {
    const summary = summarisePreflight(makeFacts({ renewingCycles: [expiringCycle] }))

    expect(summary.nextTick.dueSlots).toBe(0)
    expect(summary.nextTick.dueCampaigns).toBe(0)
    expect(summary.verdict).toBe('planificateur-eteint')
    expect(summary.nextTick.spends).toBe(true)
  })

  it('nomme les campagnes dont le cycle serait renouvelé et ce que cela coûte', () => {
    const summary = summarisePreflight(makeFacts({ renewingCycles: [expiringCycle] }))
    const [warning] = summary.warnings

    expect(warning).toContain('SEO Couvreur chalons en champagne')
    expect(warning).toContain('300 pages')
    expect(warning).toContain('SANS plafond')
  })

  it('accorde le pluriel sur plusieurs cycles', () => {
    const summary = summarisePreflight(
      makeFacts({
        renewingCycles: [expiringCycle, { id: 'cycle-2', campaignName: 'BoxnFit' }],
      })
    )

    expect(summary.warnings[0]).toContain('2 cycles expirés sont renouvelés')
    expect(summary.warnings[0]).toContain('« SEO Couvreur chalons en champagne » et « BoxnFit »')
  })
})

describe('summarisePreflight — publication autonome', () => {
  it('compte la file différée comme une publication qui part seule', () => {
    const summary = summarisePreflight(makeFacts({ pendingDeferredPublications: 1 }))

    expect(summary.nextTick.publishesAlone).toBe(true)
    expect(summary.nextTick.spends).toBe(false)
    expect(summary.verdict).toBe('planificateur-eteint')
  })

  it('suppose le pire quand une campagne auto_publish croise du travail échu', () => {
    // On ne sait pas ici à quelle campagne appartient chaque créneau échu :
    // supposer que ce n'est pas la campagne armée serait supposer la version
    // rassurante d'un fait qu'on n'a pas établi.
    const summary = summarisePreflight(makeFacts({ dueSlots: 8, autoPublishCampaigns: [couvreur] }))

    expect(summary.nextTick.publishesAlone).toBe(true)
  })

  it('dit que la vanne auto_publish ne se ferme pas depuis un écran', () => {
    const summary = summarisePreflight(makeFacts({ autoPublishCampaigns: [couvreur] }))

    expect(summary.warnings[0]).toContain('auto_publish = true')
    expect(summary.warnings[0]).toContain('SEO Couvreur chalons en champagne')
    expect(summary.warnings[0]).toContain('UPDATE SQL')
  })

  it('ne porte jamais autre chose que l’identité des campagnes', () => {
    const summary = summarisePreflight(makeFacts({ autoPublishCampaigns: [couvreur] }))

    expect(summary.nextTick.autoPublishCampaigns).toEqual([{ id: 'camp-1', name: couvreur.name }])
  })
})

describe('summarisePreflight — croisement ANTHROPIC_API_KEY', () => {
  it('laisse le constat « recommandé » quand aucune campagne n’écrit en Claude', () => {
    const summary = summarisePreflight(makeFacts())

    expect(checkNamed(summary, 'ANTHROPIC_API_KEY')).toMatchObject({ level: 'recommande', ok: false })
    expect(summary.configurationOk).toBe(true)
    expect(summary.verdict).toBe('pret-a-ouvrir')
  })

  it('promeut le constat en bloquant dès qu’une campagne Claude existe sans la clé', () => {
    const summary = summarisePreflight(makeFacts({ claudeCampaigns: [couvreur] }))
    const check = checkNamed(summary, 'ANTHROPIC_API_KEY')

    expect(check).toMatchObject({ level: 'bloquant', ok: false })
    expect(check?.why).toContain('SEO Couvreur chalons en champagne')
    expect(summary.configurationOk).toBe(false)
    expect(summary.verdict).toBe('configuration-incomplete')
  })

  it('reste bloquant mais satisfait quand la clé est posée', () => {
    const summary = summarisePreflight(
      makeFacts({ claudeCampaigns: [couvreur], config: healthyConfig({ ANTHROPIC_API_KEY: true }) })
    )

    expect(checkNamed(summary, 'ANTHROPIC_API_KEY')).toMatchObject({ level: 'bloquant', ok: true })
    expect(summary.configurationOk).toBe(true)
    expect(summary.verdict).toBe('pret-a-ouvrir')
  })

  it('n’ajoute jamais deux constats pour la même variable', () => {
    const summary = summarisePreflight(makeFacts({ claudeCampaigns: [couvreur] }))

    expect(summary.configuration.filter((check) => check.name === 'ANTHROPIC_API_KEY')).toHaveLength(1)
  })

  it('traite la clé comme absente si le rapport ne porte pas ce constat', () => {
    // Direction sûre : le pire que cela coûte est une vérification de plus. Le
    // défaut inverse laisserait ouvrir sur une clé jamais vérifiée, et brûlerait
    // trois tentatives par créneau.
    const summary = summarisePreflight(
      makeFacts({
        claudeCampaigns: [couvreur],
        config: healthyConfig().filter((check) => check.name !== 'ANTHROPIC_API_KEY'),
      })
    )

    expect(checkNamed(summary, 'ANTHROPIC_API_KEY')).toMatchObject({ level: 'bloquant', ok: false })
    expect(summary.verdict).toBe('configuration-incomplete')
  })

  it('ne modifie pas le rapport reçu', () => {
    const config = healthyConfig()
    summarisePreflight(makeFacts({ claudeCampaigns: [couvreur], config }))

    expect(config.find((check) => check.name === 'ANTHROPIC_API_KEY')?.level).toBe('recommande')
  })
})

describe('summarisePreflight — la mesure de production, telle quelle', () => {
  // 8 créneaux échus, une campagne auto_publish, une génération en attente que
  // le filtre de la file différée écarte : l'état réel de la base au moment où
  // ce chantier a été ouvert.
  const production = makeFacts({
    dueSlots: 8,
    dueCampaigns: 0,
    pendingDeferredPublications: 0,
    autoPublishCampaigns: [couvreur],
    renewingCycles: [expiringCycle],
  })

  it('nomme les trois dangers dans une seule réponse', () => {
    const summary = summarisePreflight(production)

    expect(summary.verdict).toBe('planificateur-eteint')
    expect(summary.nextTick.spends).toBe(true)
    expect(summary.nextTick.publishesAlone).toBe(true)
    expect(summary.warnings).toHaveLength(3)
    expect(summary.phrase).toContain('8 générations de créneaux échus')
    expect(summary.phrase).toContain('renouvellement de cycle')
  })

  it('énumère les travaux du tick dans un ordre lisible', () => {
    const summary = summarisePreflight({ ...production, pendingDeferredPublications: 3 })

    expect(summary.phrase).toContain(
      '8 générations de créneaux échus, 1 renouvellement de cycle (crawl du site client, indexation, modèle) et 3 publications autonomes'
    )
  })
})
