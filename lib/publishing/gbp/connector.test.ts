// ─────────────────────────────────────────────────────────────────────────────
// Le connecteur de fiche, teste sans qu'aucune fiche n'existe
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// AUCUN DE CES TESTS NE TOUCHE LE RESEAU, et ce n'est pas une precaution de
// style : l'acces en ECRITURE a l'API Google Business Profile n'a pas ete
// accorde (docs/gbp-acces-api.md), le quota par defaut est de zero requete par
// minute, et il n'existe donc aucune fiche contre laquelle ce connecteur
// pourrait etre valide « pour de vrai ». Ces doubles sont le remplacement : le
// scope absent, le rejeu, le quota, le refus de format, le 5xx douteux et le 2xx
// illisible sont tous exerces ici.
//
// `globalThis.fetch` est remplace par un espion QUI JETTE. Un test qui partirait
// en reseau echouerait donc bruyamment au lieu de passer lentement — et le seul
// `fetch` legitime de ce fichier est celui que `getAuthenticatedClient` est
// cense rendre, qui est lui aussi un double.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GBP_MANAGE_SCOPE, gbpPostConnector, type GbpPostRequest } from './connector'
import { GBP_TOPIC_TYPE, type LocalPostDraft } from './format'
import { GBP_QUOTA_MESSAGE } from '@/lib/google/sync'
import type { Site } from '@/lib/types'

// `vi.hoisted` : la fabrique de `vi.mock` s'execute AVANT le corps du fichier,
// donc avant qu'un `const` ordinaire declare ici soit initialise.
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))

vi.mock('@/lib/google/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google/client')>()
  // Le module entier est conserve — `TOKEN_MARGIN_WRITE_MS` et
  // `listConnectedSiteIds` (importe par sync.ts) doivent rester ce qu'ils sont.
  // Seule la porte d'entree Supabase + OAuth est remplacee.
  return { ...actual, getAuthenticatedClient: authenticate }
})

// ─── Doubles ─────────────────────────────────────────────────────────────────

const SITE: Site = {
  id: 'site-1',
  name: 'Taxi Troyes',
  type: 'nextjs',
  url: 'https://exemple.fr',
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const DRAFT: LocalPostDraft = {
  languageCode: 'fr',
  summary: 'Nous assurons les transports conventionnes vers les hopitaux de l agglomeration.',
  topicType: GBP_TOPIC_TYPE,
  callToAction: { actionType: 'LEARN_MORE', url: 'https://exemple.fr/transport-medical' },
}

const RESOURCE = 'accounts/111/locations/222/localPosts/333'

const PROBE_URL = /mybusinessaccountmanagement\.googleapis\.com/
const CREATE_URL = /\/locations\/222\/localPosts$/
const READ_URL = /\/localPosts\/333$/

interface Route {
  match: RegExp
  status?: number
  body?: unknown
  text?: string
  /** Rien ne revient : connexion coupee, delai depasse, DNS. */
  throws?: string
}

interface Sent {
  url: string
  method: string
  body: unknown
}

/**
 * Un `GoogleFetch` qui repond par table, et retient ce qu'on lui a donne.
 *
 * Retenir le corps est ce qui permet d'affirmer qu'aucun POST n'est parti — la
 * propriete la plus importante de ce connecteur, et la seule qu'une assertion
 * sur la valeur de retour ne pourrait pas prouver.
 */
function google(routes: Route[]) {
  const sent: Sent[] = []

  const googleFetch = vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    const route = routes.find((r) => r.match.test(url))
    if (!route) return new Response('{}', { status: 200 })
    if (route.throws) throw new Error(route.throws)
    if (route.text !== undefined) return new Response(route.text, { status: route.status ?? 200 })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 })
  })

  authenticate.mockResolvedValue({
    fetch: googleFetch,
    connection: { scopes: [GBP_MANAGE_SCOPE], gbp_account_id: '111', gbp_location_id: '222' },
  })

  return { googleFetch, sent }
}

function request(overrides: Partial<GbpPostRequest> = {}): GbpPostRequest {
  return {
    site: SITE,
    connection: { accountId: '111', locationId: '222', scopes: [GBP_MANAGE_SCOPE] },
    post: DRAFT,
    postId: 'post-1',
    ...overrides,
  }
}

/** Un post tel que Google le rend. */
function localPost(overrides: Record<string, unknown> = {}) {
  return {
    name: RESOURCE,
    languageCode: 'fr',
    summary: DRAFT.summary,
    topicType: GBP_TOPIC_TYPE,
    state: 'LIVE',
    searchUrl: 'https://posts.gle/abcdef',
    ...overrides,
  }
}

const posted = (sent: Sent[]) => sent.filter((call) => call.method === 'POST')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error('Aucun test de ce fichier n a le droit d appeler le reseau')
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ─── Ce qui est refuse avant tout reseau ─────────────────────────────────────

describe('refus sans appel reseau', () => {
  it('refuse le scope business.manage absent SANS ouvrir la moindre connexion', async () => {
    const { googleFetch } = google([])

    const outcome = await gbpPostConnector.publish(
      request({ connection: { accountId: '111', locationId: '222', scopes: ['https://www.googleapis.com/auth/webmasters'] } }),
    )

    expect(outcome.ok).toBe(false)
    expect(outcome.refusal?.kind).toBe('identifiants')
    expect(outcome.refusal?.message).toContain(GBP_MANAGE_SCOPE)
    expect(outcome.written).toBe(false)

    // LE CŒUR DE CE TEST. Un 403 distant coute une requete, un jeton rafraichi et
    // un message que personne ne sait relier a une case decochee au moment de la
    // connexion. Ni la connexion Google, ni le reseau ne sont sollicites.
    expect(authenticate).not.toHaveBeenCalled()
    expect(googleFetch).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('refuse une fiche non rattachee, avec le meme kind et toujours sans reseau', async () => {
    const { googleFetch } = google([])

    const outcome = await gbpPostConnector.publish(
      request({ connection: { accountId: '', locationId: '222', scopes: [GBP_MANAGE_SCOPE] } }),
    )

    expect(outcome.refusal?.kind).toBe('identifiants')
    expect(outcome.refusal?.message).toContain('gbp_location_id')
    expect(authenticate).not.toHaveBeenCalled()
    expect(googleFetch).not.toHaveBeenCalled()
  })

  it("refuse l'intention « brouillon » plutot que de faire semblant de l'honorer", async () => {
    const { googleFetch } = google([{ match: PROBE_URL }, { match: CREATE_URL, body: localPost() }])

    const outcome = await gbpPostConnector.publish(request({ intent: 'brouillon' }))

    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(false)
    expect(outcome.live).toBe(false)
    expect(outcome.error).toMatch(/brouillon/)
    // L'alternative refusee : publier quand meme et rendre `live: false`. Rien
    // n'est parti, donc rien n'est a verifier sur la fiche.
    expect(googleFetch).not.toHaveBeenCalled()
    expect(outcome.notes).toEqual([])
  })

  it('refuse quand la connexion Google est introuvable, sans jamais jeter', async () => {
    authenticate.mockRejectedValue(new Error('Aucune connexion Google pour ce site'))

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.refusal?.kind).toBe('identifiants')
    expect(outcome.refusal?.message).toContain('Aucune connexion Google')
    expect(outcome.written).toBe(false)
  })
})

// ─── Le rejeu idempotent ─────────────────────────────────────────────────────

describe('rejeu', () => {
  it('RELIT le post connu au lieu d en creer un second', async () => {
    const { sent } = google([{ match: READ_URL, body: localPost() }])

    const outcome = await gbpPostConnector.publish(request({ knownResourceName: RESOURCE }))

    expect(outcome).toMatchObject({
      ok: true,
      written: true,
      live: true,
      discoverable: true,
      remoteId: RESOURCE,
      pageUrl: 'https://posts.gle/abcdef',
      mode: 'gbp-relecture',
    })

    // Un seul aller-retour, et c'est un GET. Ni sonde, ni POST : la sequence
    // s'arrete des que le post est observe.
    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe('GET')
    expect(posted(sent)).toHaveLength(0)
  })

  it('ne cree RIEN quand la relecture echoue : un null n est pas une preuve d absence', async () => {
    const { sent } = google([{ match: READ_URL, status: 500, text: 'backend error' }])

    const outcome = await gbpPostConnector.publish(request({ knownResourceName: RESOURCE }))

    expect(outcome.ok).toBe(false)
    // 'incertain' cote record.ts : ni succes invente, ni echec qui autoriserait
    // une reprise. C'est le seul statut que la reconciliation sait reprendre.
    expect(outcome.written).toBe(true)
    expect(outcome.error).toMatch(/pas une preuve/i)
    expect(posted(sent)).toHaveLength(0)
  })

  it('rapporte l etat reel d un post relu, sans le declarer en ligne par defaut', async () => {
    google([{ match: READ_URL, body: localPost({ state: 'REJECTED' }) }])

    const outcome = await gbpPostConnector.publish(request({ knownResourceName: RESOURCE }))

    expect(outcome.ok).toBe(true)
    expect(outcome.written).toBe(true)
    // `live: true` en dur aurait fait dater `published_at` sur un post que Google
    // a refuse — et fausse toute mesure posterieure a « la publication ».
    expect(outcome.live).toBe(false)
    expect(outcome.notes.join(' ')).toContain('REJECTED')
  })
})

// ─── Le quota, qui est le cas NOMINAL aujourd hui ────────────────────────────

describe('quota', () => {
  it('REPORTE quand la sonde annonce un quota epuise, sans rien envoyer', async () => {
    const { sent } = google([{ match: PROBE_URL, status: 429, text: 'RESOURCE_EXHAUSTED' }])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe(GBP_QUOTA_MESSAGE)
    // Rien n'est parti : `written: false` est un FAIT ici, pas une prudence.
    expect(outcome.written).toBe(false)
    expect(outcome.notes.join(' ')).toMatch(/report/i)
    expect(posted(sent)).toHaveLength(0)
  })

  it('reporte aussi sur un 429 recu APRES l envoi, mais sans nier l ecriture', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 429, text: '{"error":{"status":"RESOURCE_EXHAUSTED"}}' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.error).toBe(GBP_QUOTA_MESSAGE)
    // ECART ASSUME, epingle ici. `rejectedOnArrival` exclut 429 : personne ne
    // documente si le limiteur de debit se trouve devant le gestionnaire ou
    // derriere. Ecrire `written: false` reintroduirait pour ce seul statut la
    // deduction locale que http-evidence existe pour supprimer.
    expect(outcome.written).toBe(true)
    expect(outcome.notes.join(' ')).toMatch(/pas idempotent/i)
  })

  it('reconnait RESOURCE_EXHAUSTED servi avec un 403', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 403, text: '{"error":{"status":"RESOURCE_EXHAUSTED"}}' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.error).toBe(GBP_QUOTA_MESSAGE)
    // 403 est un refus a l'arrivee : rien n'a pu etre ecrit.
    expect(outcome.written).toBe(false)
  })
})

// ─── L ecriture, et ce qu on a le droit d en dire ────────────────────────────

describe('ecriture', () => {
  it('envoie le brouillon TEL QUEL et rend le post cree', async () => {
    const { sent } = google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, body: localPost() },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome).toMatchObject({
      ok: true,
      written: true,
      live: true,
      discoverable: true,
      remoteId: RESOURCE,
      pageUrl: 'https://posts.gle/abcdef',
      mode: 'gbp-creation',
    })

    const writes = posted(sent)
    expect(writes).toHaveLength(1)
    // Aucune traduction en chemin : le corps verifie par format.ts est celui qui
    // part. Une conversion ici serait un second endroit ou le format vit.
    expect(writes[0].body).toEqual(DRAFT)
  })

  it('un 403 franc est un echec franc : rien n a ete ecrit', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 403, text: '{"error":{"status":"PERMISSION_DENIED"}}' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(false)
    expect(outcome.error).toContain('403')
    expect(outcome.error).toContain('PERMISSION_DENIED')
    // Pas de « allez verifier la fiche » : il n'y a rien a y voir.
    expect(outcome.notes).toEqual([])
  })

  it("un 502 rend 'incertain' : l insertion a pu avoir lieu avant la panne", async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 502, text: '<html>Bad Gateway</html>' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(true)
    expect(outcome.live).toBe(false)
    expect(outcome.notes.join(' ')).toMatch(/ouvrez la fiche google/i)
  })

  it('une absence totale de reponse rend incertain elle aussi', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, throws: 'fetch failed' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    // httpStatus 0 n'est pas un statut, c'est son absence, et `evidenceFor` le lit
    // deja comme telle. Aucune conversion en `undefined` n'est faite ici.
    expect(outcome.written).toBe(true)
    expect(outcome.error).toContain('fetch failed')
  })

  it('remonte le corps d un 400 VERBATIM, seule preuve contre nos constantes', async () => {
    const body = '{"error":{"code":400,"message":"summary exceeds 1500 characters"}}'
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 400, text: body },
    ])

    const outcome = await gbpPostConnector.publish(request())

    // `error` est le corps NU : record.ts le recopie tel quel dans
    // gbp_posts.error_message. Le prefixer aurait suffi a le rendre inutilisable
    // comme preuve du jour ou la vraie borne du resume se lira.
    expect(outcome.error).toBe(body)
    expect(outcome.written).toBe(false)
    expect(outcome.notes.join(' ')).toContain('format.ts')
  })

  it('ne conseille jamais de reconnecter le compte sur un 401 en vol', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 401, text: 'invalid credentials' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    // La sonde vient de repondre et le jeton a ete verifie a dix minutes de sa
    // fin de vie : envoyer l'operateur reconnecter un compte qui fonctionne lui
    // coute une manipulation et ne corrige rien.
    expect(outcome.error).not.toMatch(/reconnectez/i)
    expect(outcome.error).toMatch(/OWNER ou MANAGER/)
    expect(outcome.written).toBe(false)
  })

  it("un 2xx illisible n est PAS un succes : le post existe mais n est pas identifie", async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, status: 200, text: 'ok' },
    ])

    const outcome = await gbpPostConnector.publish(request())

    // `ok: true` sans `remoteId` aurait ecrit une ligne 'published' sans ancre
    // d'idempotence, que gbp_posts_remote_name_key ne protegerait plus jamais.
    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(true)
    expect(outcome.remoteId).toBeUndefined()
    expect(outcome.error).toMatch(/n'est pas identifie/)
    expect(outcome.notes.join(' ')).toContain('Corps de la reponse : ok')
  })

  it('ne declare pas « en ligne » un post que Google traite encore', async () => {
    google([
      { match: PROBE_URL, body: { accounts: [] } },
      { match: CREATE_URL, body: localPost({ state: 'PROCESSING', searchUrl: undefined }) },
    ])

    const outcome = await gbpPostConnector.publish(request())

    expect(outcome.ok).toBe(true)
    expect(outcome.written).toBe(true)
    expect(outcome.live).toBe(false)
    expect(outcome.discoverable).toBe(false)
    expect(outcome.notes.join(' ')).toContain('PROCESSING')
  })
})

// ─── La sonde exposee ────────────────────────────────────────────────────────

describe('describe', () => {
  it('nomme le scope manquant plutot que de sonder pour rien', async () => {
    const { googleFetch } = google([])
    authenticate.mockResolvedValue({ fetch: googleFetch, connection: { scopes: [] } })

    const diagnosis = await gbpPostConnector.describe('site-1')

    expect(diagnosis.ok).toBe(false)
    expect(diagnosis.message).toContain(GBP_MANAGE_SCOPE)
    expect(googleFetch).not.toHaveBeenCalled()
  })

  it('rend le message de la sonde quand le quota est a zero', async () => {
    google([{ match: PROBE_URL, status: 429, text: 'RESOURCE_EXHAUSTED' }])

    const diagnosis = await gbpPostConnector.describe('site-1')

    expect(diagnosis.ok).toBe(false)
    expect(diagnosis.message).toBe(GBP_QUOTA_MESSAGE)
  })

  it('confirme un acces joignable', async () => {
    google([{ match: PROBE_URL, body: { accounts: [] } }])

    const diagnosis = await gbpPostConnector.describe('site-1')

    expect(diagnosis.ok).toBe(true)
    expect(diagnosis.message).toMatch(/joignable/)
  })

  it('ne jette pas quand aucune connexion Google n existe', async () => {
    authenticate.mockRejectedValue(new Error('Aucune connexion Google pour ce site'))

    const diagnosis = await gbpPostConnector.describe('site-1')

    expect(diagnosis.ok).toBe(false)
    expect(diagnosis.message).toContain('Aucune connexion Google')
  })
})
