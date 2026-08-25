import type { GoogleFetch } from './client'

const GBP_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const GBP_API_V4 = 'https://mybusiness.googleapis.com/v4'

export interface GbpAccount {
  name: string
  accountName: string
  type: string
}

export interface GbpLocation {
  name: string
  title: string
  storefrontAddress?: {
    addressLines: string[]
    locality: string
    postalCode: string
    regionCode: string
  }
  phoneNumbers?: { primaryPhone?: string }
  websiteUri?: string
}

/**
 * Le corps d'un post de fiche, tel qu'il part dans la requete.
 *
 * CE QUE CE FICHIER NE PEUT PAS PROUVER, ET LE DIT. La forme exacte du corps de
 * `localPosts.create`, la liste des `topicType` et celle des `actionType` NE
 * SONT PAS VERIFIABLES DEPUIS LE DEPOT : il n'existe aucune dependance
 * `googleapis` pour fournir ces types a notre place, et ce module n'a JAMAIS
 * ecrit — tant que l'« Application For Basic API Access » n'est pas approuvee,
 * le quota par defaut est de zero requete par minute (docs/gbp-acces-api.md).
 *
 * Les valeurs, leurs bornes et la mention « a confirmer contre l'API reelle »
 * vivent dans `lib/publishing/gbp/format.ts`, UN SEUL ENDROIT ; ce module ne les
 * recopie pas et ne l'importe pas — une couche de transport qui connaitrait la
 * politique editoriale du produit serait un second endroit ou la corriger.
 * `LocalPostDraft` y est structurellement assignable a ce type.
 *
 * Le corps de tout 400 est remonte VERBATIM dans `GbpWriteResult.rawError` et
 * persiste tel quel dans `gbp_posts.error_message` (migration 019) : c'est ainsi,
 * et pas autrement, qu'une de ces mentions disparaitra un jour.
 *
 * `actionType` est declare `string` et non une union : la liste autorisee est
 * une decision de `format.ts`, verifiee avant d'arriver ici. Une union a la
 * frontiere du reseau ne prouverait rien de plus et dupliquerait la liste.
 */
export interface GbpLocalPostBody {
  languageCode: 'fr'
  summary: string
  topicType: 'STANDARD'
  callToAction?: { actionType: string; url?: string }
}

/**
 * Un post tel que Google le rend : le corps, plus ce que lui seul sait.
 *
 * `name` est le SEUL champ obligatoire de cette moitie, et il est obligatoire
 * parce que tout le reste du chantier en depend (voir `fetchPosts`). Les autres
 * sont optionnels parce qu'aucun d'eux n'est garanti par une documentation que
 * nous ayons pu verifier, et qu'un champ declare obligatoire qui arriverait
 * absent ferait mentir le type sans qu'aucune erreur ne le signale.
 */
export interface GbpLocalPost extends GbpLocalPostBody {
  name: string
  state?: string
  searchUrl?: string
  createTime?: string
  updateTime?: string
}

export interface GbpReview {
  reviewer: { displayName: string }
  starRating: string
  comment: string
  createTime: string
  reviewReply?: { comment: string }
}

export async function listAccounts(googleFetch: GoogleFetch): Promise<GbpAccount[]> {
  const res = await googleFetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')
  if (!res.ok) {
    const text = await res.text()
    console.error('GBP listAccounts error:', res.status, text)
    return []
  }
  const data = await res.json()
  return (data as { accounts?: GbpAccount[] }).accounts || []
}

export async function listAllLocations(googleFetch: GoogleFetch): Promise<Array<{ account: GbpAccount; location: GbpLocation }>> {
  const accounts = await listAccounts(googleFetch)
  const results: Array<{ account: GbpAccount; location: GbpLocation }> = []

  for (const account of accounts) {
    const accountId = account.name.split('/')[1]
    const locations = await listLocations(googleFetch, accountId)
    for (const location of locations) {
      results.push({ account, location })
    }
  }

  return results
}

export async function listLocations(googleFetch: GoogleFetch, accountId: string): Promise<GbpLocation[]> {
  const res = await googleFetch(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri`)
  if (!res.ok) {
    const text = await res.text()
    console.error('GBP listLocations error:', res.status, text)
    return []
  }
  const data = await res.json()
  return (data as { locations?: GbpLocation[] }).locations || []
}

export async function fetchProfile(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(
    `${GBP_API}/accounts/${accountId}/locations/${locationId}?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,profile`
  )
  if (!res.ok) return null
  return res.json()
}

export async function fetchReviews(googleFetch: GoogleFetch, accountId: string, locationId: string): Promise<GbpReview[]> {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/reviews?pageSize=50`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { reviews?: GbpReview[] }).reviews || []
}

export async function fetchPhotos(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/media`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { mediaItems?: Array<{ mediaFormat: string; googleUrl: string; category: string }> }).mediaItems || []
}

/**
 * Les posts deja presents sur la fiche, TELS QUE Google les decrit.
 *
 * Le type de retour annote ici jetait `name`, `state`, `topicType` et
 * `searchUrl` — et `name` est precisement l'identifiant de ressource sur lequel
 * repose l'index unique `gbp_posts_remote_name_key` (site_id, remote_name),
 * migration 019. Sans lui, un post ecrit par la fiche et un post ecrit par le
 * moteur ne peuvent pas etre apparies, une ecriture dont l'issue est douteuse ne
 * peut pas etre relue, et le meme resume peut partir deux fois.
 *
 * Une annotation de type ne filtre RIEN a l'execution : les champs arrivaient
 * deja dans la reponse, ce correctif cesse simplement de les cacher au reste du
 * programme.
 *
 * Pas de pagination : le comportement d'avant est conserve tel quel, et la
 * fenetre d'anti-duplication (RECENT_POST_WINDOW = 12) tient largement dans une
 * page. A revoir le jour ou une fiche en portera assez pour que ce soit faux.
 */
export async function fetchPosts(googleFetch: GoogleFetch, accountId: string, locationId: string): Promise<GbpLocalPost[]> {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/localPosts`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { localPosts?: GbpLocalPost[] }).localPosts || []
}

export async function fetchQA(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/questions`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { questions?: Array<{ text: string; topAnswers?: Array<{ text: string }> }> }).questions || []
}

export function summarizeReviews(reviews: GbpReview[]) {
  if (!reviews.length) return { average_rating: 0, total_count: 0, recent_positive: [] }

  const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
  const ratings = reviews.map((r) => ratingMap[r.starRating] || 0).filter(Boolean)
  const average = ratings.reduce((a, b) => a + b, 0) / ratings.length

  const positiveReviews = reviews
    .filter((r) => (ratingMap[r.starRating] || 0) >= 4 && r.comment)
    .slice(0, 10)
    .map((r) => r.comment.slice(0, 100))

  return {
    average_rating: Math.round(average * 10) / 10,
    total_count: reviews.length,
    recent_positive: positiveReviews,
  }
}

// ─── Ecriture ────────────────────────────────────────────────────────────────
//
// Les deux SEULES ecritures du moteur sur une fiche, a cote des lectures qui les
// precedent : meme URL de base (GBP_API_V4), meme `GoogleFetch`, donc aucune
// plomberie d'authentification et aucune dependance de plus. `GoogleFetch`
// accepte deja un `RequestInit` (lib/google/client.ts) et pose l'en-tete
// `Authorization` ainsi que `Content-Type: application/json` — les redeclarer ici
// donnerait deux endroits ou les corriger.

/**
 * Ce qu'une tentative d'ecriture permet de dire, et rien de plus.
 *
 * `ok` signifie EXACTEMENT « la destination a repondu 2xx », pas « le post est en
 * ligne » : un post accepte peut etre rejete ensuite par la moderation de Google,
 * ce que dit `post.state`, et lui seul.
 *
 * `httpStatus` vaut 0 quand AUCUNE reponse n'est arrivee — connexion coupee,
 * delai depasse, DNS. Zero n'est pas un statut HTTP, c'est l'absence de statut,
 * et il se lit comme telle : `rejectedOnArrival(0)` est faux, donc
 * `evidenceFor(true, 0)` conclut « peut-etre ecrit ». C'est le verdict correct
 * pour un POST non idempotent dont on n'a aucune nouvelle.
 *
 * `post` peut manquer sur un `ok: true` : l'ecriture a eu lieu, mais la reponse
 * n'a pas pu etre lue comme une ressource portant un `name`. NE PAS TRAITER CE
 * CAS COMME UN ECHEC — le post existe sur la fiche, il n'est simplement pas
 * identifie. C'est le cas exact que `gbp_posts.status = 'incertain'` et
 * `summary_fingerprint` (migration 019) servent a rattraper par une relecture,
 * jamais par un rejeu.
 */
export interface GbpWriteResult {
  ok: boolean
  post?: GbpLocalPost
  httpStatus: number
  rawError?: string
}

/**
 * Publie un post sur une fiche. NE JETTE JAMAIS.
 *
 * Une exception traversant cet appel obligerait l'appelant a deduire du TYPE de
 * l'erreur si la requete est partie — exactement la deduction que
 * `lib/publishing/http-evidence.ts` existe pour interdire. Tout ce qui peut mal
 * se passer redescend donc en `GbpWriteResult`, ou seul le statut parle.
 *
 * Aucun rejeu ici, a aucune condition : `POST localPosts` n'est pas idempotent,
 * et il n'existe pas de clef d'idempotence a envoyer. Un second essai lance
 * depuis cette fonction serait un second post sur la fiche d'un client, visible
 * de ses clients et impossible a depublier d'ici.
 *
 * Le corps de l'erreur est remonte VERBATIM, jamais reformule : c'est la seule
 * source qui puisse un jour confirmer ou dementir les constantes de format.
 */
export async function createLocalPost(
  googleFetch: GoogleFetch,
  accountId: string,
  locationId: string,
  body: GbpLocalPostBody
): Promise<GbpWriteResult> {
  const url = `${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/localPosts`

  let res: Response
  try {
    res = await googleFetch(url, { method: 'POST', body: JSON.stringify(body) })
  } catch (error) {
    // Aucune reponse : voir `httpStatus` ci-dessus, 0 est l'absence de statut.
    const message = error instanceof Error ? error.message : String(error)
    console.error('GBP createLocalPost transport error:', message)
    return { ok: false, httpStatus: 0, rawError: message }
  }

  const raw = await readBody(res)

  if (!res.ok) {
    console.error('GBP createLocalPost error:', res.status, raw)
    return { ok: false, httpStatus: res.status, rawError: raw }
  }

  const post = parseLocalPost(raw)

  // Un 2xx illisible reste un 2xx. Repondre `ok: false` ici affirmerait que rien
  // n'a ete ecrit alors que la fiche porte deja le post, et la prochaine cadence
  // en publierait un second.
  return post
    ? { ok: true, post, httpStatus: res.status }
    : { ok: true, httpStatus: res.status, rawError: raw }
}

/**
 * Relit un post par son nom de ressource — le rejeu idempotent.
 *
 * `resourceName` est ce que Google appelle `name` :
 * `accounts/{a}/locations/{l}/localPosts/{p}`, la valeur conservee dans
 * `gbp_posts.remote_name`. Un GET est idempotent : le relire ne coute qu'une
 * requete et ne peut rien creer.
 *
 * ATTENTION, ET C'EST LE POINT DELICAT DE CE FICHIER : `null` signifie
 * « post NON OBSERVE », ce qui n'est PAS une preuve d'absence. Un 404 dit que le
 * post n'existe pas ; un 500, un delai depasse ou un jeton refuse disent
 * seulement que nous n'avons pas pu regarder, et rendent le meme `null`. Un
 * appelant qui lit `null` comme « il n'existe pas » et poste alors sans autre
 * garde-fou cree un doublon le jour ou l'API repond mal.
 *
 * Le contrat de retour est celui du chantier et il est volontairement pauvre :
 * la levee du doute n'appartient pas a cette couche mais a
 * `gbp_posts.status = 'incertain'`, qui garde la ligne en attente d'une
 * relecture ulterieure au lieu de la rejouer a l'aveugle.
 */
export async function getLocalPost(googleFetch: GoogleFetch, resourceName: string): Promise<GbpLocalPost | null> {
  // Les slashs de tete sont retires pour que `accounts/…` et `/accounts/…`
  // designent la meme ressource : `remote_name` transite par du JSON, une base et
  // une interface avant d'arriver ici.
  const path = resourceName.replace(/^\/+/, '')

  let res: Response
  try {
    res = await googleFetch(`${GBP_API_V4}/${path}`)
  } catch (error) {
    console.error('GBP getLocalPost transport error:', path, error instanceof Error ? error.message : String(error))
    return null
  }

  if (!res.ok) {
    console.error('GBP getLocalPost error:', res.status, path)
    return null
  }

  return parseLocalPost(await readBody(res))
}

/** Le corps d'une reponse, ou une phrase qui explique pourquoi il manque. */
async function readBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch (error) {
    return `corps de reponse illisible: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Une ressource `localPost` lue dans du JSON qui n'est verifie par personne.
 *
 * Le seul champ CONTROLE est `name`, parce qu'il est le seul dont l'absence rend
 * la reponse inutilisable : sans lui, rien ne peut etre appareille ni relu.
 * Verifier les autres reviendrait a decider ici quels champs Google doit rendre,
 * une affirmation que le depot ne peut pas soutenir (voir `GbpLocalPost`).
 */
function parseLocalPost(raw: string): GbpLocalPost | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string' || name.length === 0) return null

  return parsed as GbpLocalPost
}
