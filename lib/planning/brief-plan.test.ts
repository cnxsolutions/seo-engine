// ─────────────────────────────────────────────────────────────────────────────
// Brief plan — tests
// SEO Engine - Planning
// ─────────────────────────────────────────────────────────────────────────────
//
// DECISION DU PROPRIETAIRE, 2026-10-17 : « Je ne veux pas de mise a jour. Les
// pages deja redigees, on ne reprend pas leur slug. »
//
// Le planificateur produisait des items 'refresh' qui reprenaient l'adresse
// d'une page existante. Il n'en produit plus AUCUN : un sujet deja couvert
// devient une page neuve sur un angle distinct, a une adresse libre, ou il est
// ecarte avec son motif. Ces tests le verrouillent sans ouvrir le modele : ils
// passent par les fonctions pures du module (decision, prompt, normalisation).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GscPlanningSignals } from '@/lib/google/performance'
import type { InventoryEntry, SiteInventory } from '@/src/core/domain/existing/inventory'
import type { Campaign, PlanItemBrief } from '@/lib/types'
import { buildPrompt, decideForSlot, normalizeBriefs, type PlanSlot, type PlannedSubject } from './brief-plan'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const campaign = {
  id: 'campaign-1',
  site_id: 'site-1',
  name: 'Plomberie',
  business_type: 'plombier',
  business_name: 'Plomberie Dupont',
  keywords: ['plombier'],
  department: 'Aube',
  communes: ['Troyes', 'Sainte-Savine'],
  target_length: 900,
  site: { url: 'https://exemple.fr' },
} as unknown as Campaign

function slot(overrides: Partial<PlanSlot> = {}): PlanSlot {
  return {
    campaign_id: 'campaign-1',
    scheduled_date: '2026-10-18',
    page_type: 'child',
    target_keyword: 'plombier',
    target_city: 'Troyes',
    status: 'planned',
    ...overrides,
  } as PlanSlot
}

function entry(overrides: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    path: '/plombier-troyes',
    url: 'https://exemple.fr/plombier-troyes',
    title: 'Plombier a Troyes',
    metaDescription: 'Plombier a Troyes, intervention rapide 7j/7.',
    focusKeyword: 'plombier troyes',
    canonicalPath: null,
    noindex: false,
    body: 'Un corps de page deja en ligne.',
    bodyIsExcerpt: true,
    origin: 'crawl',
    coversTopic: true,
    observedAt: '2026-10-10T00:00:00.000Z',
    ...overrides,
  }
}

function inventory(entries: readonly InventoryEntry[]): SiteInventory {
  return {
    siteId: 'site-1',
    entries,
    takenPaths: new Set(entries.map(item => item.path)),
    freshness: { state: 'fresh', lastCrawledAt: '2026-10-10T00:00:00.000Z', ageDays: 7 },
    crawledCount: entries.length,
    publishedCount: 0,
    truncated: false,
  }
}

function gsc(overrides: Partial<GscPlanningSignals> = {}): GscPlanningSignals {
  return {
    available: true,
    windowStart: '2026-07-19',
    windowEnd: '2026-10-16',
    strikingDistance: [],
    lowCtrPages: [],
    deadPages: [],
    cannibalized: [],
    blockedQueries: [],
    ...overrides,
  }
}

const CITY_TOKENS = ['Troyes', 'Sainte-Savine', 'Aube']

function decide(target: PlanSlot, site: SiteInventory, signals: GscPlanningSignals | null = null): PlannedSubject {
  return decideForSlot(target, { campaign, inventory: site, signals, cityTokens: CITY_TOKENS })
}

/** Ce que normalizeBriefs recoit dans generateBriefPlanWithSignals, sans le modele. */
function normalize(
  subjects: PlannedSubject[],
  rawItems: Array<Partial<PlanItemBrief>>,
  site: SiteInventory,
  options: { existingKeywords?: string[]; signals?: GscPlanningSignals | null } = {}
): PlanItemBrief[] {
  return normalizeBriefs({
    subjects,
    rawItems,
    campaign,
    takenPaths: new Set(site.takenPaths),
    inventory: site,
    signals: options.signals ?? null,
    existingKeywords:
      options.existingKeywords ?? site.entries.map(item => (item.focusKeyword ?? '').toLowerCase()).filter(Boolean),
  })
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── La decision : plus aucun 'refresh' ─────────────────────────────────────

describe('decideForSlot — un sujet deja couvert reste une creation', () => {
  it("convertit le 'refresh' d'identite (meme adresse, meme mot-cle) en creation qui evite la page", () => {
    const subject = decide(slot(), inventory([entry()]))

    expect(subject.action).toEqual({ kind: 'create' })
    expect(subject.avoid).toMatchObject({
      path: '/plombier-troyes',
      url: 'https://exemple.fr/plombier-troyes',
      title: 'Plombier a Troyes',
      focusKeyword: 'plombier troyes',
      subject: 'plombier Troyes',
    })
    // Les faits restent, la consigne de mise a jour du domaine disparait : elle
    // contredirait la decision du proprietaire affichee a cote d'une page neuve.
    expect(subject.avoid?.reasons.length).toBeGreaterThan(0)
    expect(subject.avoid?.reasons.join(' ')).not.toMatch(/mettre a jour|reecri/i)
  })

  it("convertit le 'refresh' Search Console (requete en position 5-20) en creation qui evite la page qui ranke", () => {
    const subject = decide(
      slot({ target_keyword: 'plombier troyes' }),
      inventory([entry({ path: '/depannage', url: 'https://exemple.fr/depannage', focusKeyword: 'depannage' })]),
      gsc({
        strikingDistance: [
          {
            query: 'plombier troyes',
            pageUrl: 'https://exemple.fr/depannage',
            position: 7.4,
            impressions: 320,
            clicks: 6,
          },
        ],
      })
    )

    expect(subject.action.kind).toBe('create')
    expect(subject.avoid?.path).toBe('/depannage')
    expect(subject.avoid?.reasons[0]).toContain('position 7.4')
  })

  it('laisse un sujet libre en creation simple, sans page a eviter', () => {
    const subject = decide(slot({ target_keyword: 'adoucisseur eau' }), inventory([entry()]))

    expect(subject.action).toEqual({ kind: 'create' })
    expect(subject.avoid).toBeNull()
  })

  it("garde le 'skip' d'une requete bloquee par Search Console", () => {
    const subject = decide(
      slot({ target_keyword: 'adoucisseur eau' }),
      inventory([]),
      gsc({ blockedQueries: ['adoucisseur eau'] })
    )

    expect(subject.action.kind).toBe('skip')
    expect(subject.avoid).toBeNull()
  })
})

// ─── La normalisation : angle distinct, ou ecarte ───────────────────────────

describe('normalizeBriefs — aucun item ne reprend une page existante', () => {
  const site = inventory([entry()])

  it("cree la page sur l'angle distinct propose, a une adresse libre, en nommant la page voisine", () => {
    const subject = decide(slot(), site)
    const [brief] = normalize([subject], [
      {
        target_keyword: 'detartrage chauffe-eau troyes',
        proposed_slug: 'detartrage-chauffe-eau-troyes',
        rationale: 'Question frequente des clients.',
      },
    ], site)

    expect(brief.action).toEqual({ kind: 'create', slug: { status: 'free' } })
    expect(brief.proposed_slug).toBe('detartrage-chauffe-eau-troyes')
    expect(brief.target_keyword).toBe('detartrage chauffe-eau troyes')
    expect(brief.rationale).toContain(
      'Angle distinct de https://exemple.fr/plombier-troyes, qui couvre déjà « plombier troyes ».'
    )
    expect(brief.internal_link_targets).toContain('https://exemple.fr/plombier-troyes')
    expect(brief.seo_rules.join(' ')).toContain('Page complémentaire de https://exemple.fr/plombier-troyes')
    expect(brief.refresh_target_path).toBeUndefined()
  })

  it('ecarte le creneau quand le modele garde le mot-cle de la page a eviter', () => {
    const subject = decide(slot(), site)
    const [brief] = normalize([subject], [
      { target_keyword: 'plombiers à Troyes', proposed_slug: 'plombier-troyes' },
    ], site)

    expect(brief.action?.kind).toBe('skip')
    expect(brief.proposed_slug).toBe('')
    expect(brief.estimated_word_count).toBe(0)
    expect(brief.rationale.startsWith(
      "Aucun angle distinct de https://exemple.fr/plombier-troyes n'a été proposé : le créneau est écarté plutôt que de concurrencer la page existante."
    )).toBe(true)
  })

  it("ecarte le creneau quand le modele n'a rien rendu : le repli reprendrait le sujet couvert", () => {
    const subject = decide(slot(), site)
    const [brief] = normalize([subject], [], site)

    expect(brief.action?.kind).toBe('skip')
    expect(brief.rationale).toContain('Aucun angle distinct de https://exemple.fr/plombier-troyes')
  })

  it("ecarte toute page neuve qui reprend un mot-cle de l'existant, meme hors creneau deja couvert", () => {
    const subject = decide(slot({ target_keyword: 'adoucisseur eau' }), site)
    expect(subject.avoid).toBeNull()

    const [brief] = normalize([subject], [{ target_keyword: 'Plombier Troyes', proposed_slug: 'plombier-pas-cher' }], site)

    expect(brief.action?.kind).toBe('skip')
    expect(brief.rationale).toContain('déjà ciblé par une page du site')
  })

  it("ecarte une page neuve qui vise une requete deja portee par une page en Search Console", () => {
    const signals = gsc({
      strikingDistance: [
        { query: 'fuite eau troyes', pageUrl: 'https://exemple.fr/fuite', position: 9, impressions: 150, clicks: 1 },
      ],
    })
    const subject = decide(slot({ target_keyword: 'adoucisseur eau' }), inventory([]), signals)
    const [brief] = normalize([subject], [{ target_keyword: "fuites d'eau troyes" }], inventory([]), { signals })

    expect(brief.action?.kind).toBe('skip')
    expect(brief.rationale).toContain('Search Console')
  })

  it('ecarte le second creneau du cycle qui reprend le mot-cle du premier', () => {
    const empty = inventory([])
    const first = decide(slot({ target_keyword: 'adoucisseur eau' }), empty)
    const second = decide(slot({ target_keyword: 'filtre eau', scheduled_date: '2026-10-19' }), empty)

    const briefs = normalize([first, second], [
      { target_keyword: 'adoucisseur eau troyes', proposed_slug: 'adoucisseur-eau-troyes' },
      { target_keyword: 'adoucisseurs d eau troyes', proposed_slug: 'installer-adoucisseur-troyes' },
    ], empty)

    expect(briefs.map(brief => brief.action?.kind)).toEqual(['create', 'skip'])
    expect(briefs[1].rationale).toContain('déjà visé par un autre créneau de ce cycle')
  })

  it("laisse deux communes differentes du meme metier faire deux pages", () => {
    const empty = inventory([])
    const troyes = decide(slot({ target_keyword: 'plombier', target_city: 'Troyes' }), empty)
    const savine = decide(slot({ target_keyword: 'plombier', target_city: 'Sainte-Savine' }), empty)

    // Sans reponse du modele : les deux replis portent « plombier » nu, et
    // c'est leur commune qui les distingue.
    const briefs = normalize([troyes, savine], [], empty)

    expect(briefs.map(brief => brief.action?.kind)).toEqual(['create', 'create'])
    expect(briefs.map(brief => brief.proposed_slug)).toEqual(['plombier-troyes', 'plombier-sainte-savine'])
  })

  it("ne produit JAMAIS d'item 'refresh', quel que soit l'existant", () => {
    // Avant le 2026-10-17, ces creneaux sortaient en 'refresh' et reprenaient
    // l'adresse /plombier-troyes. Ils sortent desormais en page neuve ou en
    // sujet ecarte — jamais sur l'adresse d'une page existante.
    const subjects = [
      decide(slot(), site),
      decide(slot({ scheduled_date: '2026-10-19', target_keyword: 'plombier troyes' }), site),
    ]
    const briefs = normalize(subjects, [
      { target_keyword: 'plombier troyes' },
      { target_keyword: 'remplacement ballon eau chaude troyes' },
    ], site)

    for (const brief of briefs) {
      expect(brief.action?.kind).not.toBe('refresh')
      expect(brief.proposed_slug).not.toBe('plombier-troyes')
      expect(brief.refresh_target_path).toBeUndefined()
      expect(brief.refresh_scope).toBeUndefined()
    }
    expect(briefs.map(brief => brief.action?.kind)).toEqual(['skip', 'create'])
  })
})

// ─── Le prompt ──────────────────────────────────────────────────────────────

describe('buildPrompt — ce que le modele recoit', () => {
  function prompt(subjects: PlannedSubject[], signals: GscPlanningSignals | null = null): string {
    return buildPrompt({
      campaign,
      analysisRun: null,
      existingSlugs: ['plombier-troyes'],
      existingKeywords: ['plombier troyes'],
      subjects,
      signals,
      serpEvidence: [],
    })
  }

  it('demande un sujet different pour chaque creneau deja couvert, avec la page et son adresse', () => {
    const text = prompt([
      decide(slot({ target_keyword: 'adoucisseur eau' }), inventory([entry()])),
      decide(slot(), inventory([entry()])),
    ])

    expect(text).toContain(
      'Créneau 2 : le sujet « plombier Troyes » est déjà couvert par https://exemple.fr/plombier-troyes ' +
        '(« Plombier a Troyes », mot-clé « plombier troyes »). Propose un sujet DIFFÉRENT et complémentaire'
    )
    expect(text).toContain("N'utilise jamais l'adresse /plombier-troyes ni un mot-clé équivalent.")
    expect(text).not.toContain('Créneau 1 :')
    expect(text).toContain('"creneau": 2')
  })

  it("interdit de reutiliser ou de paraphraser les slugs et mots-cles de l'existant", () => {
    const text = prompt([decide(slot({ target_keyword: 'adoucisseur eau' }), inventory([]))])

    expect(text).toMatch(/ne les reutilise\s+JAMAIS comme target_keyword ni comme proposed_slug/)
    expect(text).toContain('ni tels quels ni paraphrases')
  })

  it("presente les requetes en position 5-20 comme portees par une page existante, a ne pas viser", () => {
    const signals = gsc({
      strikingDistance: [
        { query: 'fuite eau troyes', pageUrl: 'https://exemple.fr/fuite', position: 9, impressions: 150, clicks: 1 },
      ],
    })
    const text = prompt([decide(slot({ target_keyword: 'adoucisseur eau' }), inventory([]), signals)], signals)

    expect(text).toContain(
      'Requêtes déjà portées par une page existante — NE PAS les viser, ne pas écrire une page concurrente.'
    )
    // La donnee reste : le modele doit savoir QUELLES requetes eviter.
    expect(text).toContain('"fuite eau troyes" : position 9, 150 impressions, 1 clics -> https://exemple.fr/fuite')
    // Plus aucune requete n'est distribuee comme cible d'un creneau.
    expect(text).not.toContain('gsc_opportunity')
    expect(text).not.toContain('GISEMENT PRIORITAIRE')
  })
})

// ─── Campagne nationale ─────────────────────────────────────────────────────
//
// Flowyne telle qu'elle etait saisie : « tous » comme commune, departement par
// defaut. Le plan sortait /application-reservation-barber-tous et des local
// packs « … près de moi » pour une application sans etablissement.

describe('campagne nationale — aucune ville dans le plan', () => {
  const national = { ...campaign, business_type: 'application de reservation', communes: ['tous'], department: 'Aube' } as Campaign
  const site = inventory([])

  it('ne donne au sujet ni ville ni adresse suffixee', () => {
    const subject = decideForSlot(
      slot({ target_keyword: 'application de reservation pour barber', target_city: 'tous', page_type: 'pillar' }),
      { campaign: national, inventory: site, signals: null, cityTokens: [] },
    )
    expect(subject.city).toBe('')
    expect(subject.seedKeyword).toBe('application de reservation pour barber')
  })

  it('ignore la ville et le local pack que le modele renverrait quand meme', () => {
    const subject = decideForSlot(
      slot({ target_keyword: 'application de reservation pour barber', target_city: '', page_type: 'child' }),
      { campaign: national, inventory: site, signals: null, cityTokens: [] },
    )
    const [brief] = normalizeBriefs({
      subjects: [subject],
      rawItems: [{
        page_type: 'local_pack',
        target_city: 'tous',
        target_keyword: 'application de reservation pour barber',
        proposed_slug: 'application-reservation-barber',
      }],
      campaign: national,
      takenPaths: new Set(),
      inventory: site,
      signals: null,
      existingKeywords: [],
    })

    expect(brief.page_type).toBe('child')
    expect(brief.target_city).toBe('')
    expect(brief.proposed_slug).toBe('application-reservation-barber')
    expect(brief.required_entities).not.toContain('Aube')
  })

  it('dit au modele que la campagne est nationale, sans departement ni communes', () => {
    const text = buildPrompt({
      campaign: national,
      analysisRun: null,
      existingSlugs: [],
      existingKeywords: [],
      subjects: [],
      signals: null,
      serpEvidence: [],
    })
    expect(text).toContain('- Portee: NATIONALE')
    expect(text).toContain('aucun page_type local_pack')
    expect(text).not.toContain('- Departement: Aube')
    expect(text).not.toContain('- Communes: tous')
  })
})
