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

  for (const method of ['select', 'eq', 'neq', 'not', 'in', 'is', 'order', 'limit']) {
    builder[method] = record(method)
  }

  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null })

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

const { listPendingPublishGenerations } = await import('./db')

// ─── Lecture des appels ──────────────────────────────────────────────────────

/** Les couples (colonne, valeur) passes a `.eq()`, dans l'ordre. */
function equalities(): Array<[unknown, unknown]> {
  return calls.filter(call => call.method === 'eq').map(call => [call.args[0], call.args[1]])
}

beforeEach(() => {
  tables.length = 0
  calls.length = 0
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
