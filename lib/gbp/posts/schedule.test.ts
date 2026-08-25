// ─────────────────────────────────────────────────────────────────────────────
// Le calendrier des posts de fiche — tests
// SEO Engine - Ce qui coute cher quand c'est faux, et rien d'autre
// ─────────────────────────────────────────────────────────────────────────────
//
// La rotation des angles est pure et deja verrouillee ailleurs
// (src/core/domain/gbp/rotation.test.ts). Ce fichier ne la reteste pas : il
// teste les quatre faits que la politique de rotation ne peut pas connaitre, et
// dont trois ont un cout direct chez un client.
//
//   1. L'OPT-IN. `gbp_posts_enabled` vaut false par defaut. Une campagne qui n'a
//      rien decide ne doit pas voir apparaitre de creneaux d'ecriture sur la
//      fiche de son client — et pas une requete ne doit partir pour elle.
//   2. LE PLAFOND HEBDOMADAIRE SUR UN CHANGEMENT D'ANNEE. Le 1er janvier 2027 est
//      un vendredi : il appartient a la semaine ISO 53 de 2026. Une clef de
//      semaine derivee de `getFullYear()` changerait au milieu de la semaine et
//      autoriserait quatre posts en sept jours, sur un quota que ce depot ne
//      connait pas.
//   3. LE REPORT QUI NE BRULE PAS DE TENTATIVE. Trois reports consecutifs
//      tueraient un creneau auquel il n'est rien arrive.
//   4. LE COOLDOWN DE LIEN APPLIQUE AVANT L'INSERTION. Un creneau qu'on sait
//      condamne a etre reporte n'est pas un creneau, c'est une ligne rouge de
//      plus dans le calendrier de l'operateur.
//
// LE DOUBLE SUPABASE NE FILTRE PAS. Il rend, pour chaque lecture, exactement les
// lignes que la requete REELLE aurait rendues — les fixtures sont donc ecrites
// deja filtrees. En contrepartie, les colonnes et les filtres demandes sont
// enregistres et deux tests les epinglent : c'est ce qui rattrape un `.eq()`
// oublie, que des fixtures pre-filtrees masqueraient sinon.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Campaign } from '@/lib/types'

// ─── Doubles ─────────────────────────────────────────────────────────────────

interface FilterCall {
  key: string
  method: string
  column: string
  value: unknown
}

interface InsertCall {
  table: string
  payload: Record<string, unknown>[]
}

type QueryResult = { data: unknown[]; error: { code?: string; message: string } | null }

/** Lignes rendues par lecture, indexees par la clef logique de la requete. */
let fixtures: Record<string, unknown[]> = {}
const filters: FilterCall[] = []
const inserts: InsertCall[] = []
const selects: Array<{ key: string; columns: string }> = []

/**
 * Deux lectures differentes visent `gbp_posts` avec des colonnes differentes :
 * la fenetre de rotation, le registre de la semaine et la reprise par creneau.
 * La clef distingue les trois, sinon une fixture repondrait aux trois a la fois.
 */
function keyFor(table: string, columns: string): string {
  if (table !== 'gbp_posts') return table
  if (columns.includes('summary')) return 'gbp_posts:recent'
  if (columns.includes('calendar_slot_id') && columns.includes('created_at')) return 'gbp_posts:writes'
  return 'gbp_posts:slots'
}

class Query {
  private key: string

  constructor(private readonly table: string) {
    this.key = table
  }

  select(columns: string): this {
    this.key = keyFor(this.table, columns)
    selects.push({ key: this.key, columns })
    return this
  }

  insert(payload: Record<string, unknown>[]): this {
    inserts.push({ table: this.table, payload })
    return this
  }

  eq(column: string, value: unknown): this {
    filters.push({ key: this.key, method: 'eq', column, value })
    return this
  }

  gte(column: string, value: unknown): this {
    filters.push({ key: this.key, method: 'gte', column, value })
    return this
  }

  in(column: string, value: unknown): this {
    filters.push({ key: this.key, method: 'in', column, value })
    return this
  }

  not(column: string, _operator: string, value: unknown): this {
    filters.push({ key: this.key, method: 'not', column, value })
    return this
  }

  order(): this {
    return this
  }

  limit(): this {
    return this
  }

  maybeSingle(): Promise<{ data: unknown | null; error: null }> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null })
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve<QueryResult>({ data: this.rows(), error: null }).then(onfulfilled, onrejected)
  }

  private rows(): unknown[] {
    return fixtures[this.key] ?? []
  }
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: (table: string) => new Query(table) }),
}))

let campaignFixture: Campaign | null = null

vi.mock('@/lib/db', () => ({
  getCampaignById: async () => campaignFixture,
  // Importe par lib/scheduler/editorial.ts, charge pour `formatLocalDate` :
  // un export absent d'un mock fait jeter vitest.
  SITE_SAFE_COLUMNS: 'id,name,type,url',
}))

let connectionFixture: {
  gbp_account_id: string | null
  gbp_location_id: string | null
  scopes: string[]
} | null = null

vi.mock('@/lib/google/client', () => ({
  getGoogleConnection: async () => connectionFixture,
}))

const {
  decideGbpSlotOutcome,
  describeGbpEligibility,
  GBP_WEEKLY_POST_CAP,
  isoWeekKey,
  planGbpPostSlots,
} = await import('./schedule')

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAMPAIGN_ID = 'campaign-1'
const SITE_ID = 'site-1'

function campagne(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: CAMPAIGN_ID,
    site_id: SITE_ID,
    name: 'Taxi Troyes',
    business_type: 'taxi',
    business_name: 'Taxi Troyes',
    keywords: ['taxi troyes'],
    communes: ['Troyes'],
    frequency_hours: 24,
    ai_model: 'gpt-5',
    publish_status: 'publish',
    auto_publish: false,
    target_length: 1200,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    gbp_posts_enabled: true,
    gbp_post_cadence_days: 3,
    ...overrides,
  }
}

/** Trois pages publiees : de quoi annoncer sans repeter. */
function pagesPubliees(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `gen-${index}`,
    title: `Page ${index}`,
    slug: `page-${index}`,
    published_url: `https://taxi-troyes.fr/page-${index}`,
  }))
}

function insertedDates(): string[] {
  return inserts.flatMap(call => call.payload.map(row => String(row.scheduled_date)))
}

beforeEach(() => {
  fixtures = {}
  filters.length = 0
  inserts.length = 0
  selects.length = 0
  campaignFixture = campagne()
  connectionFixture = {
    gbp_account_id: 'accounts/1',
    gbp_location_id: 'locations/2',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
  }
})

// ─── 1. L'opt-in ─────────────────────────────────────────────────────────────

describe('planGbpPostSlots — opt-in strict', () => {
  it('ne planifie RIEN et n interroge RIEN sans gbp_posts_enabled', async () => {
    campaignFixture = campagne({ gbp_posts_enabled: false })
    fixtures['generations'] = pagesPubliees(3)

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(report.created).toBe(0)
    expect(inserts).toHaveLength(0)
    // Pas une seule lecture : le controle est le PREMIER du fichier, pour qu'une
    // campagne qui n'a rien demande ne coute rien du tout.
    expect(selects).toHaveLength(0)
    expect(report.skipped.join(' ')).toContain('désactivés')
  })

  it('traite une colonne absente comme un refus, jamais comme un oui', async () => {
    // La colonne est optionnelle cote TypeScript : une ligne ecrite avant la
    // migration 019, ou une projection qui l'oublie, ne doit pas valoir
    // consentement.
    campaignFixture = campagne({ gbp_posts_enabled: undefined })

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(report.created).toBe(0)
    expect(inserts).toHaveLength(0)
  })

  it('ne planifie rien pour une campagne introuvable', async () => {
    campaignFixture = null

    const report = await planGbpPostSlots(CAMPAIGN_ID)

    expect(report).toEqual({ created: 0, skipped: [expect.stringContaining('introuvable')] })
  })
})

// ─── 2. La semaine ISO, et le changement d'annee ─────────────────────────────

describe('isoWeekKey', () => {
  it('range le 1er janvier 2027 dans la semaine 53 de 2026', () => {
    // Le 1er janvier 2027 est un VENDREDI : sa semaine ISO commence le lundi
    // 28 decembre 2026 et porte donc l'annee 2026. C'est le cas exact ou une
    // clef derivee de getFullYear() remettrait le compteur a zero au milieu de
    // la semaine.
    expect(isoWeekKey(new Date(2026, 11, 28))).toBe('2026-W53')
    expect(isoWeekKey(new Date(2026, 11, 31))).toBe('2026-W53')
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53')
    expect(isoWeekKey(new Date(2027, 0, 3))).toBe('2026-W53')
    // Et le lundi suivant ouvre bien la premiere semaine de 2027.
    expect(isoWeekKey(new Date(2027, 0, 4))).toBe('2027-W01')
  })

  it('range le 31 decembre 2024 dans la premiere semaine de 2025', () => {
    // La symetrie de l'autre cote : un mardi de fin decembre appartient a
    // l'annee SUIVANTE. Les deux sens comptent, un plafond ne doit deborder ni
    // dans un sens ni dans l'autre.
    expect(isoWeekKey(new Date(2024, 11, 31))).toBe('2025-W01')
  })
})

describe('planGbpPostSlots — plafond hebdomadaire ISO', () => {
  it('tient sur un changement d annee : rien de plus dans la semaine 2026-W53', async () => {
    // Deux creneaux existent deja les 28 et 29 decembre 2026, tous deux dans la
    // semaine ISO 2026-W53, qui court jusqu'au dimanche 3 janvier 2027.
    fixtures['editorial_calendar'] = [
      { scheduled_date: '2026-12-28' },
      { scheduled_date: '2026-12-29' },
    ]
    fixtures['generations'] = pagesPubliees(3)

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 11, 30) })

    expect(report.created).toBeGreaterThan(0)
    const dates = insertedDates()

    // AUCUNE date dans la semaine deja pourvue, y compris apres le 1er janvier.
    expect(dates.filter(date => isoWeekKey(new Date(date)) === '2026-W53')).toEqual([])
    expect(dates.every(date => date >= '2027-01-04')).toBe(true)

    // Et le plafond tient aussi dans les semaines ouvertes.
    const perWeek = new Map<string, number>()
    for (const date of dates) {
      const week = isoWeekKey(new Date(date))
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1)
    }
    for (const count of perWeek.values()) {
      expect(count).toBeLessThanOrEqual(GBP_WEEKLY_POST_CAP)
    }

    expect(report.skipped.join(' ')).toContain('2026-W53')
  })

  it('compte les posts composés à la main dans le plafond de la semaine', async () => {
    // Deux posts ecrits depuis l'ecran cette semaine, sans creneau : ils ont
    // consomme la meme fiche et le meme quota inconnu. Les ignorer ferait du
    // plafond « deux CRENEAUX par semaine » au lieu de « deux POSTS ».
    const now = new Date(2026, 7, 19) // mercredi 19 aout 2026
    fixtures['gbp_posts:writes'] = [
      { created_at: new Date(2026, 7, 17, 9).toISOString(), calendar_slot_id: null, status: 'published' },
      { created_at: new Date(2026, 7, 18, 9).toISOString(), calendar_slot_id: null, status: 'published' },
    ]
    fixtures['generations'] = pagesPubliees(3)

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now })
    const week = isoWeekKey(now)

    expect(insertedDates().filter(date => isoWeekKey(new Date(date)) === week)).toEqual([])
    expect(report.skipped.join(' ')).toContain(week)
  })

  it('écrit page_type et target_keyword à NULL, et le genre du créneau', async () => {
    fixtures['generations'] = pagesPubliees(3)

    await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('editorial_calendar')
    for (const row of inserts[0].payload) {
      // `editorial_calendar_page_type_check` EXIGE page_type NULL sur un creneau
      // de post et l'interdit sur une page : ecrire les deux colonnes a null est
      // le contrat, pas une precaution.
      expect(row).toMatchObject({
        campaign_id: CAMPAIGN_ID,
        artifact_kind: 'gbp_post',
        page_type: null,
        target_keyword: null,
        status: 'planned',
      })
    }

    // Le creneau est cherche par campagne ET par genre : sans le second filtre,
    // les creneaux de PAGE compteraient dans le plafond des posts.
    expect(filters).toContainEqual({
      key: 'editorial_calendar',
      method: 'eq',
      column: 'artifact_kind',
      value: 'gbp_post',
    })
  })
})

// ─── 3. Les cooldowns, avant l'insertion ─────────────────────────────────────

describe('planGbpPostSlots — cooldowns appliqués avant insertion', () => {
  it('ne pose aucun créneau quand la seule page publiée vient d être annoncée', async () => {
    fixtures['generations'] = pagesPubliees(1)
    fixtures['gbp_posts:recent'] = [
      {
        angle: 'service',
        summary: 'Nous vous emmenons à la gare de Troyes tous les jours.',
        linked_generation_id: 'gen-0',
        published_at: '2026-08-20T09:00:00.000Z',
        source: 'engine',
      },
    ]

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(report.created).toBe(0)
    expect(inserts).toHaveLength(0)
    expect(report.skipped.join(' ')).toContain('annoncées')
  })

  it('ne pose pas plus de créneaux que la fiche n a de pages à annoncer', async () => {
    // Deux pages libres : un troisieme creneau ne pourrait qu'etre reporte, et
    // un creneau condamne d'avance n'est qu'une ligne rouge de plus dans le
    // calendrier.
    fixtures['generations'] = pagesPubliees(2)

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(report.created).toBe(2)
    expect(report.skipped.join(' ')).toContain('page(s) à annoncer')
  })

  it('ne pose aucun créneau quand le site n a aucune page en ligne', async () => {
    fixtures['generations'] = []

    const report = await planGbpPostSlots(CAMPAIGN_ID, { now: new Date(2026, 7, 22) })

    expect(report.created).toBe(0)
    expect(inserts).toHaveLength(0)
    expect(report.skipped.join(' ')).toContain('Aucune page publiée')
  })
})

// ─── 4. Ce qu'un run fait au creneau ─────────────────────────────────────────

describe('decideGbpSlotOutcome', () => {
  const slot = { attempt_count: 2, scheduled_date: '2026-08-22' }

  it('REND la tentative sur un report, et repousse le créneau au lendemain', () => {
    const patch = decideGbpSlotOutcome(
      slot,
      { published: false, reported: 'Aucun angle disponible.', problems: [] },
      { now: new Date(2026, 7, 22, 14) },
    )

    expect(patch.status).toBe('planned')
    // LE FAIT QUI COMPTE : le compteur revient a sa valeur d'avant la
    // reclamation. Sans cela, trois reports consecutifs epuisent le budget et le
    // creneau meurt alors que rien n'a echoue.
    expect(patch.attempt_count).toBe(2)
    expect(patch.scheduled_date).toBe('2026-08-23')
    expect(patch.error_message).toBe('Aucun angle disponible.')
    expect(patch.gbp_post_id).toBeUndefined()
  })

  it('rend la tentative même quand le créneau n en avait aucune', () => {
    const patch = decideGbpSlotOutcome(
      { scheduled_date: '2026-08-22' },
      { published: false, reported: 'Doute non levé.', problems: [] },
      { now: new Date(2026, 7, 22) },
    )

    // Zero, et surtout pas `undefined` : un `attempt_count` omis laisserait en
    // base la valeur posee par la reclamation, c'est-a-dire la tentative qu'on
    // pretend rendre.
    expect(patch.attempt_count).toBe(0)
  })

  it('ne touche NI la date NI le compteur quand un post est en ligne', () => {
    const patch = decideGbpSlotOutcome(slot, { postId: 'post-1', published: true, problems: [] })

    expect(patch).toEqual({ status: 'published', gbp_post_id: 'post-1' })
  })

  it('rend le créneau terminal quand une ligne existe sans être en ligne', () => {
    const patch = decideGbpSlotOutcome(slot, {
      postId: 'post-1',
      published: false,
      refusalKind: 'duplicat',
      problems: ['GBP_SUMMARY_OFF_TARGET: résumé court'],
    })

    // Terminal : le chemin de composition insere toujours une ligne NEUVE, donc
    // rejouer paierait une seconde redaction et risquerait un second post sur la
    // fiche d'un client.
    expect(patch.status).toBe('failed')
    expect(patch.gbp_post_id).toBe('post-1')
    expect(patch.attempt_count).toBeUndefined()
    expect(patch.scheduled_date).toBeUndefined()
    expect(patch.error_message).toContain('duplicat')
    expect(patch.error_message).toContain('GBP_SUMMARY_OFF_TARGET')
  })
})

// ─── 5. Ce que l'ecran a le droit d'afficher ─────────────────────────────────

describe('describeGbpEligibility', () => {
  it('nomme l opt-in absent avant tout le reste', async () => {
    fixtures['campaigns'] = [campagne({ gbp_posts_enabled: false })]
    fixtures['generations'] = pagesPubliees(1)

    const eligibility = await describeGbpEligibility(SITE_ID, { now: new Date(2026, 7, 22) })

    expect(eligibility.enabled).toBe(false)
    expect(eligibility.blockedReason).toContain('désactivés')
    expect(eligibility.weeklyCap).toBe(GBP_WEEKLY_POST_CAP)
  })

  it('nomme le scope manquant plutôt qu une connexion absente', async () => {
    fixtures['campaigns'] = [campagne()]
    fixtures['generations'] = pagesPubliees(1)
    connectionFixture = {
      gbp_account_id: 'accounts/1',
      gbp_location_id: 'locations/2',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    }

    const eligibility = await describeGbpEligibility(SITE_ID, { now: new Date(2026, 7, 22) })

    // Une connexion consentie avant que le scope d'ecriture ne soit demande se
    // lit « connectée » a l'oeil nu et ne permet pourtant pas un seul post.
    expect(eligibility.credentialsReady).toBe(false)
    expect(eligibility.blockedReason).toContain('business.manage')
  })

  it('donne un motif français à CHAQUE angle fermé', async () => {
    fixtures['campaigns'] = [campagne()]
    fixtures['generations'] = pagesPubliees(1)
    fixtures['gbp_posts:recent'] = [
      {
        angle: 'service',
        summary: 'Un premier post.',
        linked_generation_id: null,
        published_at: null,
        source: 'engine',
      },
    ]

    const eligibility = await describeGbpEligibility(SITE_ID, { now: new Date(2026, 7, 22) })

    expect(eligibility.anglesBlocked.length).toBeGreaterThan(0)
    for (const blocked of eligibility.anglesBlocked) {
      // Une option grisee sans motif est un cul-de-sac : l'operateur ne sait ni
      // quoi corriger ni s'il doit attendre. Une PHRASE porte des espaces ; les
      // valeurs du domaine ('angle-en-cooldown', 'aucun-avis-reel') n'en ont
      // aucun — c'est ce qui distingue un motif affichable d'un code laisse nu.
      expect(blocked.reason).toContain(' ')
    }
    expect(eligibility.anglesBlocked.map(blocked => blocked.angle)).toContain('service')
    expect(eligibility.anglesAvailable).not.toContain('service')
    expect(eligibility.nextLinkTarget?.id).toBe('gen-0')
  })

  it('compte les posts de la semaine ISO sans compter les refus', async () => {
    const now = new Date(2026, 7, 19)
    fixtures['campaigns'] = [campagne()]
    fixtures['generations'] = pagesPubliees(2)
    fixtures['gbp_posts:writes'] = [
      { created_at: new Date(2026, 7, 17, 9).toISOString(), calendar_slot_id: 'slot-1', status: 'published' },
      // Un refus n'a JAMAIS atteint Google : le gate l'a arrete avant le
      // connecteur. Le compter volerait au client une publication de sa semaine.
      { created_at: new Date(2026, 7, 18, 9).toISOString(), calendar_slot_id: 'slot-2', status: 'rejected' },
      // Un echec, lui, compte : l'evidence d'ecriture est precisement ce que ce
      // produit ne peut pas toujours obtenir, et le doute pese du cote prudent.
      { created_at: new Date(2026, 7, 18, 10).toISOString(), calendar_slot_id: 'slot-3', status: 'incertain' },
    ]

    const eligibility = await describeGbpEligibility(SITE_ID, { now })

    expect(eligibility.postsThisIsoWeek).toBe(2)
    expect(eligibility.blockedReason).toContain('Plafond atteint')
  })
})
