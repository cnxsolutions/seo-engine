// ─────────────────────────────────────────────────────────────────────────────
// Acces de donnees partage — tests
// SEO Engine - La ligne qui rend vraie la phrase « un rafraichissement n'est
// jamais automatique ».
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE CE FICHIER TESTE, ET POURQUOI IL NE TESTE QUE CA
//
// `listPendingPublishGenerations` est la requete que le job de publication
// differee execute a chaque tick. Elle ne rend pas un resultat qu'un operateur
// relit : elle rend une liste de pages qui vont partir toutes seules chez le
// client. Ce qui compte n'est donc pas ce que la base repond — le double ci-
// dessous ne repond rien — mais les CONDITIONS que la fonction pose avant de
// demander. Les assertions portent sur les appels, pas sur les lignes.
//
// Trois conditions, et la troisieme est le point de surete du lot :
//
//   1. `status = 'generated'`      — la page est finie et payee.
//   2. `campaign.auto_publish`     — le client a demande la publication auto.
//   3. `intent = 'create'`         — c'est une page NEUVE.
//
// Sans la troisieme, une ligne `intent = 'refresh'` — qui attend un clic humain
// dans le statut 'generated', par construction — serait ramassee au tick
// suivant et poussee SANS `replaces`. Sur le site du proprietaire, cela veut
// dire au mieux un refus 'occupe', au pire l'ecrasement d'une page qui ranke,
// sans que personne ait vu ce qui allait etre remplace.
//
// POURQUOI CE FICHIER EXISTE PLUTOT QU'UN BLOC DANS UN AUTRE. Le premier double
// Supabase du depot ne pouvait pas aller dans lib/pipeline/integration.test.ts,
// dont l'en-tete promet par ecrit de ne toucher ni base ni reseau : y loger un
// mock de client de base de donnees est la facon la plus efficace de perdre
// cette promesse.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Double Supabase ─────────────────────────────────────────────────────────

interface RecordedCall {
  method: string
  args: readonly unknown[]
}

/** Toutes les tables interrogees, dans l'ordre. */
const tables: string[] = []
/** Tous les appels chaines de la requete en cours, dans l'ordre. */
const calls: RecordedCall[] = []
/** Ce que la prochaine requete rend. Vide par defaut : c'est la question qui est sous test. */
let nextRows: unknown[] = []

/**
 * Un constructeur de requete qui n'execute rien et retient tout.
 *
 * Les methodes sont enumerees a la main plutot que produites par un Proxy : une
 * methode oubliee doit lever un TypeError bruyant au premier appel, la ou un
 * Proxy avalerait silencieusement un `.eq()` devenu `.filter()` et laisserait
 * passer une requete qui ne filtre plus rien.
 *
 * `then` fait de l'objet un thenable : `await supabase.from(...)…limit(10)` se
 * resout donc sur une reponse vide, ce qui suffit — c'est la question posee qui
 * est sous test, pas la reponse.
 */
function queryDouble(): Record<string, unknown> {
  const builder: Record<string, unknown> = {}

  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args })
    return builder
  }

  for (const method of ['select', 'update', 'delete', 'eq', 'neq', 'not', 'in', 'is', 'lte', 'order', 'limit']) {
    builder[method] = record(method)
  }

  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: nextRows, error: null })

  // `.maybeSingle()` termine la chaine : il rend la premiere ligne ou null, pas
  // le constructeur — comme chez Supabase, ou plus rien ne s'enchaine apres.
  builder.maybeSingle = () => {
    calls.push({ method: 'maybeSingle', args: [] })
    return Promise.resolve({ data: nextRows[0] ?? null, error: null })
  }

  return builder
}

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      tables.push(table)
      return queryDouble()
    },
  }),
}))

const {
  countInFlightGenerations,
  deleteCampaign,
  deleteSite,
  getSiteByIdSafe,
  listDueCampaigns,
  listPendingPublishGenerations,
  updateSiteSafe,
} = await import('./db')

// ─── Lecture des appels ──────────────────────────────────────────────────────

/** Les couples (colonne, valeur) passes a `.eq()`, dans l'ordre. */
function equalities(): Array<[unknown, unknown]> {
  return calls.filter(call => call.method === 'eq').map(call => [call.args[0], call.args[1]])
}

beforeEach(() => {
  tables.length = 0
  calls.length = 0
  nextRows = []
})

// ─── Le filtre d'intention ───────────────────────────────────────────────────

describe('listPendingPublishGenerations', () => {
  it('exclut les rafraichissements de la publication automatique', async () => {
    await listPendingPublishGenerations()

    // LA ligne. Une generation 'refresh' reste en 'generated' jusqu'a ce qu'un
    // humain la valide ; sans ce filtre, le job differe la publierait a sa place.
    expect(equalities()).toContainEqual(['intent', 'create'])
  })

  it('garde les deux conditions qui protegeaient deja le client', async () => {
    await listPendingPublishGenerations()

    // `status` seul rendrait aussi les pages garees d'une campagne dont
    // l'auto-publication est coupee ; `auto_publish` seul rendrait des pages
    // inachevees. Les trois filtres tiennent ensemble.
    expect(equalities()).toContainEqual(['status', 'generated'])
    expect(equalities()).toContainEqual(['campaign.auto_publish', true])
  })

  it('interroge generations en joignant la campagne en jointure interne', async () => {
    await listPendingPublishGenerations()

    expect(tables).toEqual(['generations'])

    // La jointure INTERNE est porteuse : elle exclut les generations sans
    // campagne, qui doivent rester manuelles par construction. Une jointure
    // externe les ferait toutes remonter avec `campaign` a null.
    const projection = calls.find(call => call.method === 'select')?.args[0]
    expect(projection).toContain('campaigns!inner')
  })

  it('ne rend que des pages ecrites et rattachees a un site, dix au plus', async () => {
    await listPendingPublishGenerations()

    const nots = calls.filter(call => call.method === 'not').map(call => call.args)
    expect(nots).toContainEqual(['content', 'is', null])
    expect(nots).toContainEqual(['site_id', 'is', null])

    // Un tick ne doit pas pouvoir declencher une centaine de publications.
    expect(calls.find(call => call.method === 'limit')?.args[0]).toBe(10)
  })
})

// ─── Le job de campagne sans plan ────────────────────────────────────────────
//
// Ce job date d'avant le calendrier editorial : sans brief, il vise toujours
// « activite + premiere commune ». Il tournait aussi pour les campagnes qui ont
// un plan, a cote de leur calendrier, et des son deuxieme passage il tombait sur
// l'adresse prise par le premier : « L'adresse /taxi-troyes est deja occupee »,
// une ligne « Sans titre » en echec tous les deux jours.

describe('listDueCampaigns', () => {
  it('ecarte toute campagne qui a un plan de cycle, meme en brouillon', async () => {
    nextRows = [
      { id: 'sans-plan', cycle_plans: [] },
      { id: 'avec-plan', cycle_plans: [{ id: 'p1' }] },
    ]

    const due = await listDueCampaigns()

    expect(due.map((campaign) => campaign.id)).toEqual(['sans-plan'])
  })

  it('ne laisse pas fuir la jointure dans la campagne rendue', async () => {
    nextRows = [{ id: 'sans-plan', cycle_plans: [] }]

    const [campaign] = await listDueCampaigns()

    expect(campaign).not.toHaveProperty('cycle_plans')
  })

  it('demande les plans de cycle et garde les filtres existants', async () => {
    await listDueCampaigns()

    expect(calls.find((call) => call.method === 'select')?.args[0]).toContain('cycle_plans(id)')
    expect(equalities()).toContainEqual(['is_active', true])
  })
})

// ─── Le cycle de vie d'un site et d'une campagne ─────────────────────────────
//
// Les routes PATCH et DELETE de /api/sites/[id] et /api/campaigns/[id] rendent
// au navigateur ce que ces fonctions lisent. Deux choses ne se voient pas dans
// le code des routes et se casseraient en silence : la projection (un `*`
// remettrait le mot de passe WordPress sur le fil) et la question posee avant
// de supprimer (sans elle, un site part pendant qu'un travailleur publie dessus).

const SECRET_COLUMNS = ['wp_app_password', 'github_token']

function projection(): string {
  return String(calls.find((call) => call.method === 'select')?.args[0] ?? '')
}

describe('lecture et ecriture d\'un site destine au navigateur', () => {
  it('getSiteByIdSafe ne demande jamais les secrets', async () => {
    await getSiteByIdSafe('s1')

    expect(tables).toEqual(['sites'])
    expect(equalities()).toContainEqual(['id', 's1'])
    for (const column of SECRET_COLUMNS) expect(projection()).not.toContain(column)
    expect(projection()).not.toBe('*')
  })

  it('updateSiteSafe rend la ligne ecrite, projetee sans les secrets', async () => {
    nextRows = [{ id: 's1', name: 'AFS' }]

    const site = await updateSiteSafe('s1', { name: 'AFS' })

    expect(site).toEqual({ id: 's1', name: 'AFS' })
    expect(calls.find((call) => call.method === 'update')?.args[0]).toEqual({ name: 'AFS' })
    expect(equalities()).toContainEqual(['id', 's1'])
    for (const column of SECRET_COLUMNS) expect(projection()).not.toContain(column)
  })

  it('updateSiteSafe rend null quand aucune ligne ne porte cet id', async () => {
    expect(await updateSiteSafe('absent', { name: 'x' })).toBeNull()
  })
})

describe('countInFlightGenerations', () => {
  it('ne compte que ce que le moteur a encore en main', async () => {
    await countInFlightGenerations({ site_id: 's1' })

    expect(tables).toEqual(['generations'])
    expect(equalities()).toContainEqual(['site_id', 's1'])

    // 'generating' : un travailleur ecrit dedans. 'publishing' : un publieur
    // est a mi-chemin chez le client. 'pending' ou 'generated' n'ont personne
    // dessus et ne doivent pas bloquer une suppression.
    const statuses = calls.find((call) => call.method === 'in')?.args
    expect(statuses?.[0]).toBe('status')
    expect([...(statuses?.[1] as string[])].sort()).toEqual(['generating', 'publishing'])
  })

  it('sait poser la meme question pour une campagne', async () => {
    await countInFlightGenerations({ campaign_id: 'c1' })

    expect(equalities()).toContainEqual(['campaign_id', 'c1'])
    expect(equalities().map(([column]) => column)).not.toContain('site_id')
  })

  it('vaut zero quand la base ne rend pas de compte', async () => {
    expect(await countInFlightGenerations({ site_id: 's1' })).toBe(0)
  })
})

describe('suppressions', () => {
  it('deleteSite cible une seule ligne et ne rend que son identite', async () => {
    nextRows = [{ id: 's1', name: 'AFS' }]

    const deleted = await deleteSite('s1')

    expect(tables).toEqual(['sites'])
    expect(calls.map((call) => call.method)).toContain('delete')
    expect(equalities()).toEqual([['id', 's1']])
    expect(projection()).toBe('id,name')
    expect(deleted).toEqual({ id: 's1', name: 'AFS' })
  })

  it('deleteCampaign fait de meme avec le nom de l\'activite', async () => {
    nextRows = [{ id: 'c1', business_name: 'Taxi Troyes' }]

    const deleted = await deleteCampaign('c1')

    expect(tables).toEqual(['campaigns'])
    expect(calls.map((call) => call.method)).toContain('delete')
    expect(equalities()).toEqual([['id', 'c1']])
    expect(projection()).toBe('id,business_name')
    expect(deleted).toEqual({ id: 'c1', business_name: 'Taxi Troyes' })
  })

  it('une suppression sans ligne rend null plutot qu\'un succes', async () => {
    expect(await deleteSite('absent')).toBeNull()
    expect(await deleteCampaign('absent')).toBeNull()
  })
})
