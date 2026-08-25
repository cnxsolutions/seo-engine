// ─────────────────────────────────────────────────────────────────────────────
// Le connecteur d'ecriture de la fiche Google Business Profile
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// CE MODULE N'IMPLEMENTE PAS `Connector` ET N'ENTRE PAS DANS `CONNECTORS`, et ce
// n'est pas un oubli : c'est la seule forme qui compile sans casser les deux
// connecteurs existants.
//
//  - `Connector.credentialColumns` designe des colonnes de la table `sites`,
//    lues par `missingCredentials()` (lib/publishing/publish.ts:70). Les
//    identifiants d'une fiche ne sont pas la : ils vivent dans
//    `google_connections` (jeton, scopes, gbp_account_id, gbp_location_id).
//  - `CONNECTORS` est indexe par `SiteType`, et `sites_type_check` n'autorise que
//    'wordpress' et 'nextjs'. Un site a exactement UN type ; un post de fiche est
//    un SECOND CANAL du meme site, pas un troisieme type de site.
//  - `PublishRequest` porte une `GeneratedPage`. Un post n'en est pas une, et
//    lui en fabriquer une bidon pour passer par `runPrePublishGate` produirait
//    LENGTH_BELOW_TARGET, MISSING_H1 et MISSING_H2 sur un texte de 400
//    caracteres qui n'a ni titre ni sous-titre — et la seule facon de faire
//    taire ce gate, `gateAlreadyRan: true`, supprimerait TOUS les garde-fous.
//
// Ce qui EST partage : `PublishOutcome` (le vocabulaire written/live/
// discoverable, dont depend `lib/publishing/gbp/record.ts`) et
// `lib/publishing/http-evidence.ts` (la regle « puis-je renvoyer cette
// requete ? »). Rien d'autre. C'est une SŒUR de lib/publishing, pas un membre.
//
// LA SEQUENCE EST CALQUEE SUR CELLE DE lib/publishing/wordpress/index.ts, et
// l'ordre est la moitie du travail : refuser d'abord ce qui ne coute rien,
// relire ensuite ce qui existe peut-etre deja, sonder l'acces, et n'ecrire
// qu'apres — en ayant note, AVANT l'appel, que l'appel part.
//
// UNE ECRITURE PAR APPEL, SANS AUCUN REJEU INTERNE, A AUCUNE CONDITION.
// `POST .../localPosts` n'est pas idempotent et l'API n'accepte aucune clef
// d'idempotence : un second essai lance d'ici serait un second post sur la fiche
// d'un client, visible de ses prospects et impossible a depublier depuis le
// moteur. Le plafond par tick, lui, appartient a l'appelant (lib/gbp/posts/run.ts)
// — ce module se contente de ne jamais boucler.
//
// CE QUE LE DEPOT NE PEUT PAS PROUVER, ET LE DIT. L'acces en ECRITURE n'a pas ete
// accorde : tant que l'« Application For Basic API Access » n'est pas approuvee,
// le quota par defaut est de zero requete par minute (docs/gbp-acces-api.md).
// Aucun `POST localPosts` n'a donc jamais ete emis depuis ce depot. Les
// constantes de format vivent dans ./format.ts avec leur mention « a confirmer
// contre l'API reelle » ; ce fichier n'en recopie aucune.

import { GBP_QUOTA_MESSAGE, probeGbpAccess } from '@/lib/google/sync'
import { TOKEN_MARGIN_WRITE_MS, getAuthenticatedClient, type GoogleFetch } from '@/lib/google/client'
import { createLocalPost, getLocalPost, type GbpLocalPost } from '@/lib/google/gbp'
import { evidenceFor } from '../http-evidence'
import { failed, refuse, type PublishIntent, type PublishOutcome } from '../outcome'
import type { LocalPostDraft } from './format'
import type { Site } from '@/lib/types'

/**
 * Le scope OAuth sans lequel aucune ecriture de fiche n'est possible.
 *
 * RECOPIE, faute de pouvoir l'importer : `SCOPES` est un `const` module-prive de
 * lib/google/auth.ts (ligne 9), qui n'est pas dans les livrables de ce lot. La
 * valeur est une CONSTANTE DE GOOGLE, pas un seuil du produit : elle ne derive
 * pas, contrairement a une longueur ou a un cooldown. Le jour ou auth.ts
 * l'exporte, c'est cette declaration qui disparait.
 */
export const GBP_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'

/**
 * Tout ce qu'il faut pour poser un post, et deliberement PAS un `PublishRequest`.
 *
 * `connection` est passe par l'appelant plutot que relu ici : c'est lui qui a
 * charge la ligne `google_connections` pour decider s'il y avait un post a
 * ecrire, et la relire donnerait deux lectures et deux verites possibles sur le
 * meme couple compte/etablissement.
 *
 * PAS DE `signal`. `GoogleFetch` accepte un `RequestInit` et pourrait donc en
 * porter un, mais AUCUN chemin Google du depot ne propage aujourd'hui
 * d'AbortSignal — ni sync.ts, ni gsc.ts, ni les routes API. En introduire un ici
 * serait soit un champ que personne ne renseigne, soit une annulation a
 * mi-requete sur un POST non idempotent, c'est-a-dire la fabrique a doublons que
 * tout ce fichier existe pour eviter. Ce commentaire remplace le champ.
 */
export interface GbpPostRequest {
  site: Site
  connection: { accountId: string; locationId: string; scopes: string[] }
  post: LocalPostDraft
  /** La ligne `gbp_posts` ouverte en 'generated'. Sert a tracer, jamais a ecrire. */
  postId: string
  /**
   * `gbp_posts.remote_name` d'une tentative anterieure — le rejeu idempotent.
   *
   * Sa presence signifie « une ecriture a peut-etre deja abouti pour cette
   * ligne ». Elle interdit donc la creation, quoi que la relecture trouve.
   */
  knownResourceName?: string
  /**
   * ECART ASSUME, ET IL EST OBLIGATOIRE. Le contrat de _ROLE-BACK.md ne liste pas
   * ce champ, mais la tache exige que l'intention 'brouillon' soit REFUSEE
   * EXPLICITEMENT — ce qui suppose de pouvoir la recevoir. Optionnel, avec
   * 'publie' pour defaut : un appelant qui l'ignore obtient exactement le
   * comportement du contrat d'origine.
   */
  intent?: PublishIntent
}

// ─── Les phrases, ecrites une fois ──────────────────────────────────────────

const SCOPE_MISSING =
  `Le compte Google connecte n'a pas accorde le droit d'ecrire sur la fiche `
  + `(scope ${GBP_MANAGE_SCOPE} absent de google_connections.scopes). `
  + `Reconnectez le compte Google de ce site pour redemander ce droit ; `
  + `aucune requete n'a ete envoyee.`

const NO_LOCATION =
  `Aucune fiche etablissement n'est rattachee a ce site : `
  + `gbp_account_id et gbp_location_id doivent etre choisis avant de publier un post.`

/**
 * L'API GBP N'A PAS DE BROUILLON, et faire semblant serait pire que refuser.
 *
 * `localPosts` ne connait que deux etats poses par Google : le post est soumis,
 * puis il est LIVE, PROCESSING ou REJECTED. Il n'existe rien qui corresponde a un
 * brouillon WordPress, c'est-a-dire un contenu ecrit chez le client et invisible
 * de ses clients. Honorer l'intention en publiant puis en rendant `live: false`
 * serait un champ toujours faux qui ne porterait aucune information ; l'honorer en
 * ne publiant pas et en rendant `ok: true` serait un succes invente.
 *
 * `failed(..., false)` et non `refuse(...)` : les QUATRE kinds de
 * `PublishRefusal` decrivent tous l'etat d'une DESTINATION — occupee, redirigee,
 * identifiants refuses, sujet deja couvert — et aucun ne dit « l'appelant a
 * demande une capacite qui n'existe pas ». En inventer un signifierait modifier
 * outcome.ts, hors de ce lot, et `gbp_posts_refusal_check` refuserait la valeur,
 * ce qui ferait echouer l'UPDATE entier et perdrait le statut avec lui. Le champ
 * qui porte le sens ici est `written: false`, et il est exact : rien n'a ete
 * tente.
 */
const DRAFT_UNSUPPORTED =
  `L'API Google Business Profile ne connait pas de brouillon : un post est publie `
  + `ou n'existe pas. Rien n'a ete envoye. Relancez avec l'intention « publie », `
  + `ou laissez le post en attente dans le calendrier editorial.`

/** Le seul texte qui rattrape un doute : ne pas recommencer, aller regarder. */
const RETRY_FORBIDDEN =
  `Un post a PEUT-ETRE ete cree sur la fiche : ouvrez la fiche Google avant de relancer. `
  + `Un POST localPosts n'est pas idempotent, une reprise a l'aveugle publierait un doublon.`

const POSTPONED =
  `Ecriture reportee, pas abandonnee : le creneau repartira a la prochaine cadence. `
  + `Aucun rejeu immediat — il consommerait le meme quota epuise.`

/**
 * NE JAMAIS DIRE « Reconnectez le compte Google » ICI, contrairement a la sonde.
 *
 * Le jeton vient d'etre verifie a `TOKEN_MARGIN_WRITE_MS` de sa fin de vie et le
 * scope a ete controle avant tout appel : un 401 recu SUR L'ECRITURE, alors que
 * la sonde vient de repondre, ne prouve pas que la connexion est morte. Envoyer
 * l'operateur reconnecter un compte qui fonctionne lui coute une manipulation et
 * ne corrige rien ; la cause probable est un droit retire sur la fiche
 * elle-meme, cote Google Business Profile, pas cote OAuth.
 */
const TOKEN_REFUSED =
  `Google a refuse le jeton au moment de l'ecriture (401), alors que la lecture venait `
  + `de reussir. Verifiez que le compte connecte est toujours OWNER ou MANAGER de cette `
  + `fiche avant de conclure a un probleme de connexion.`

const UNIDENTIFIED =
  `Google a accepte le post (2xx) mais sa reponse ne porte aucun nom de ressource : `
  + `le post EXISTE sur la fiche et n'est pas identifie. La ligne reste incertaine `
  + `jusqu'a ce que la reconciliation l'apparie par son empreinte.`

const REPLAY_UNOBSERVED =
  `Le post publie precedemment n'a pas pu etre relu (API muette, 5xx ou jeton refuse). `
  + `Ce n'est PAS une preuve qu'il n'existe pas, et aucun nouveau post n'a ete cree.`

// ─── Le connecteur ──────────────────────────────────────────────────────────

export const gbpPostConnector = {
  label: 'Fiche Google',

  /**
   * Ce que le moteur peut dire de l'acces a la fiche, sans rien ecrire.
   *
   * Prend un `siteId` et non un `Site` : tout ce qu'elle lit vit dans
   * `google_connections`, et faire transiter une ligne `sites` pour n'en utiliser
   * que l'`id` inviterait un appelant a croire que les identifiants de fiche s'y
   * trouvent.
   *
   * Marge de jeton par DEFAUT (lecture) : une sonde qui meurt sur un jeton expire
   * est une sonde qu'on relance, rien n'est en jeu. La marge d'ecriture est
   * reservee a ce qui ne se rejoue pas.
   */
  async describe(siteId: string): Promise<{ ok: boolean; message: string }> {
    let client: { fetch: GoogleFetch; connection: { scopes: string[] } }
    try {
      client = await getAuthenticatedClient(siteId)
    } catch (error) {
      return { ok: false, message: `Acces Google indisponible : ${describeError(error)}` }
    }

    if (!hasManageScope(client.connection.scopes)) {
      return { ok: false, message: SCOPE_MISSING }
    }

    // La sonde, jamais une lecture inventee ici : elle distingue deja un quota a
    // zero d'une fiche inaccessible, et ces deux-la appellent des reactions
    // opposees de l'operateur (remplir un formulaire, ou changer de compte).
    const probe = await probeGbpAccess(client.fetch)
    return probe.available
      ? { ok: true, message: 'API Google Business Profile joignable : les posts de fiche peuvent partir.' }
      : { ok: false, message: probe.message }
  },

  async publish(request: GbpPostRequest): Promise<PublishOutcome> {
    const notes: string[] = []

    // Ou nous en sommes dans la sequence, SUIVI et jamais deduit.
    //
    // Le meme drapeau que dans le connecteur WordPress, pour la meme raison : le
    // TYPE d'une erreur n'est pas un indice de position. Il se trompait dans les
    // deux sens a la fois — un delai depasse APRES insertion rapporte « pas
    // ecrit » et le tick suivant publie un doublon ; une lecture ratee AVANT le
    // POST rapportee « ecrite » laisse une ligne publiee sans rien nulle part.
    // Tout ce qui suit jusqu'a l'ecriture peut donc echouer sans ambiguite : la
    // position, elle, est connue.
    let attemptedWrite = false

    // ─── 0. Ce que nous ne savons pas faire ────────────────────────────────
    // En premier parce que c'est le seul controle qui porte sur la DEMANDE et non
    // sur la destination : envoyer l'operateur verifier ses scopes Google pour une
    // requete que le moteur refuserait de toute facon lui ferait corriger la
    // mauvaise chose.
    if (request.intent === 'brouillon') return broke(DRAFT_UNSUPPORTED, false, notes)

    // ─── 1. Le droit d'ecrire, AVANT tout reseau ───────────────────────────
    // `google_connections.scopes` est un `text[] NOT NULL DEFAULT '{}'` ecrit au
    // callback OAuth. Un refus immediat et nomme vaut mieux qu'un 403 distant que
    // personne ne sait relier a une case decochee il y a six mois — et il ne coute
    // ni requete, ni quota, ni jeton rafraichi.
    if (!hasManageScope(request.connection.scopes)) {
      return refuse({ kind: 'identifiants', message: SCOPE_MISSING })
    }

    const accountId = request.connection.accountId?.trim() ?? ''
    const locationId = request.connection.locationId?.trim() ?? ''
    if (!accountId || !locationId) {
      return refuse({ kind: 'identifiants', message: NO_LOCATION })
    }

    // ─── 2. Le jeton, avec la marge des ecritures ──────────────────────────
    // UN SEUL client pour la relecture, la sonde et l'ecriture. Le jeton est fige
    // dans la closure de `googleFetch` et jamais reevalue : en redemander un juste
    // avant le POST ne rajeunirait rien de ce qui precede, et en demander deux
    // ferait deux rafraichissements pour une seule sequence.
    let googleFetch: GoogleFetch
    try {
      const client = await getAuthenticatedClient(request.site.id, { minRemainingMs: TOKEN_MARGIN_WRITE_MS })
      googleFetch = client.fetch
    } catch (error) {
      return refuse({ kind: 'identifiants', message: `Acces Google indisponible : ${describeError(error)}` })
    }

    // ─── 3. Rejeu idempotent : relire plutot que recreer ────────────────────
    if (request.knownResourceName) {
      const existing = await getLocalPost(googleFetch, request.knownResourceName)
      if (existing) return observed(existing, 'gbp-relecture', notes)

      // `null` veut dire « post NON OBSERVE », et lib/google/gbp.ts le dit
      // explicitement : un 404 prouve l'absence, un 500 ou un delai depasse
      // prouvent seulement que nous n'avons pas pu regarder, et rendent le MEME
      // null. Creer ici serait lire un doute comme une absence — exactement le
      // geste qui pose un doublon sur la fiche d'un client le jour ou l'API
      // repond mal. `written: true` ferme la porte au rejeu ; la levee du doute
      // appartient a la reconciliation par empreinte.
      return broke(REPLAY_UNOBSERVED, true, notes)
    }

    // ─── 4. L'acces repond-il seulement ? ──────────────────────────────────
    // Une requete de lecture, avant la seule qui ne se rejoue pas. Sur un quota a
    // zero — le cas NOMINAL tant que l'acces de base n'est pas accorde — elle
    // evite d'envoyer un POST dont l'issue serait douteuse pour une raison qui,
    // elle, ne l'est pas.
    const probe = await probeGbpAccess(googleFetch)
    if (!probe.available) {
      return probe.status === 'quota_exhausted'
        ? broke(GBP_QUOTA_MESSAGE, false, [...notes, POSTPONED])
        : broke(probe.message, false, notes)
    }

    // ─── 5. Ecrire ─────────────────────────────────────────────────────────
    //
    // Pose AVANT l'appel, sur la ligne d'avant, et jamais apres : une trace
    // ecrite APRES l'appel n'existe pas si le processus meurt pendant l'appel —
    // et c'est exactement le cas qu'il faut pouvoir diagnostiquer. Passer
    // `true` en litteral a `evidenceFor` serait une affirmation que le lecteur
    // devrait croire ; une variable posee ici est un fait qu'il verifie.
    attemptedWrite = true
    const result = await createLocalPost(googleFetch, accountId, locationId, request.post)

    const maybeWritten = evidenceFor(attemptedWrite, result.httpStatus) === 'peut-etre-ecrit'

    if (result.ok) {
      if (result.post) return observed(result.post, 'gbp-creation', notes)

      // 2xx sans ressource lisible. Le post EXISTE : repondre `ok: true` sans
      // `remoteId` ecrirait une ligne 'published' sans ancre d'idempotence, que
      // `gbp_posts_remote_name_key` ne protegerait plus jamais. `written: true` +
      // `ok: false` donne 'incertain' (record.ts), le seul statut que la
      // reconciliation par empreinte sait reprendre.
      if (result.rawError) notes.push(`Corps de la reponse : ${result.rawError}`)
      return broke(UNIDENTIFIED, true, notes)
    }

    return brokeOnStatus(result.httpStatus, result.rawError ?? '', maybeWritten, notes, request.postId)
  },
}

// ─── Traduction d'un echec distant ──────────────────────────────────────────

/**
 * Ce qu'un statut autorise a dire, famille par famille.
 *
 * `maybeWritten` n'est JAMAIS redecide ici : il vient de `evidenceFor`, unique
 * dans le depot et partage avec le connecteur WordPress. Le redemontrer par
 * famille produirait deux regles qui divergeraient au premier statut oublie, et
 * le prix de la divergence est un doublon sur la fiche d'un client.
 *
 * ECART ASSUME, ET ASSUMER EST LE MOT. La spec ecrivait `failed(GBP_QUOTA_MESSAGE,
 * false)` pour un 429. `rejectedOnArrival` EXCLUT deliberement 429 (voir
 * http-evidence.ts) : ni l'API REST WordPress ni l'API GBP ne documente si son
 * limiteur de debit se trouve devant le gestionnaire ou derriere. Ecrire `false`
 * ici reintroduirait, pour ce seul statut, la deduction locale que ce module
 * partage existe pour supprimer. Un 429 recu APRES l'envoi rend donc
 * 'peut-etre-ecrit', et le 429 du cas nominal — quota a zero — est intercepte par
 * la sonde AVANT tout envoi, ou `written: false` est exact parce que rien n'est
 * parti.
 */
function brokeOnStatus(
  status: number,
  raw: string,
  maybeWritten: boolean,
  notes: string[],
  postId: string,
): PublishOutcome {
  console.error('GBP publish failed:', { postId, status, raw: raw.slice(0, 500) })

  // Meme lecture que `probeGbpAccess` : Google sert RESOURCE_EXHAUSTED avec un 403
  // sur certains points d'entree GBP, donc le motif du corps est le signal fiable
  // et le statut seul ne l'est pas.
  if (status === 429 || raw.includes('RESOURCE_EXHAUSTED')) {
    return broke(GBP_QUOTA_MESSAGE, maybeWritten, [...notes, POSTPONED])
  }

  if (status === 400) {
    // LE CORPS, VERBATIM, ET RIEN D'AUTRE DANS `error`. C'est la seule preuve que
    // ce depot puisse obtenir contre les mentions « a confirmer contre l'API
    // reelle » de format.ts, et `record.ts` la recopie telle quelle dans
    // `gbp_posts.error_message`. La reformuler, la tronquer ou la traduire
    // detruirait ce que nous avons attendu des semaines pour lire.
    notes.push(
      `Refus de format : le corps ci-dessus est la reponse BRUTE de Google, `
      + `a confronter aux constantes de lib/publishing/gbp/format.ts.`,
    )
    return broke(raw || 'HTTP 400 sans corps de reponse', maybeWritten, notes)
  }

  if (status === 401) return broke(TOKEN_REFUSED, maybeWritten, notes)

  // 0 n'est pas un statut : c'est son absence (connexion coupee, delai depasse,
  // DNS). `evidenceFor` le lit deja correctement — aucune conversion en
  // `undefined` n'est necessaire.
  if (status === 0) {
    return broke(`Aucune reponse de l'API Google Business Profile : ${raw || 'appel interrompu'}`, maybeWritten, notes)
  }

  return broke(`L'API Google Business Profile a repondu HTTP ${status}${raw ? ` : ${raw}` : ''}`, maybeWritten, notes)
}

// ─── Fabriques d'issues ─────────────────────────────────────────────────────

/**
 * Un post reellement OBSERVE, qu'il vienne d'etre cree ou qu'il ait ete relu.
 *
 * UNE SEULE LECTURE DE `state` POUR LES DEUX CHEMINS. La spec proposait
 * `live: true` en dur sur la relecture ; un post relu en 'REJECTED' n'est pas en
 * ligne, et deux regles pour un meme champ rendraient le meme post « en ligne »
 * ou non selon le chemin qui l'a regarde. `live` ouvre la porte a des
 * traitements posterieurs (record.ts n'ecrit `published_at` que sur `live`) : le
 * fabriquer fausserait toute mesure prise apres.
 *
 * Un `state` ABSENT rend donc `live: false` — et le dit dans une note, parce que
 * l'operateur ne doit pas lire « pas en ligne » comme « pas publie » : le post
 * est sur la fiche, c'est son etat que Google n'a pas donne.
 */
function observed(post: GbpLocalPost, mode: string, notes: string[]): PublishOutcome {
  const live = post.state === 'LIVE'

  if (!live) {
    notes.push(
      post.state
        ? `Le post est dans l'etat « ${post.state} » et non LIVE : il est enregistre sur la fiche `
          + `mais pas encore — ou pas — visible. Aucun rejeu : il existe deja.`
        : `Google n'a pas indique l'etat de ce post. Il est enregistre sur la fiche ; `
          + `son etat reel se lit sur la fiche elle-meme.`,
    )
  }

  return {
    ok: true,
    written: true,
    live,
    // Le seul lien public qu'un post de fiche possede. Un post sans `searchUrl`
    // est ecrit et introuvable autrement qu'en ouvrant la fiche.
    discoverable: Boolean(post.searchUrl),
    pageUrl: post.searchUrl,
    remoteId: post.name,
    mode,
    notes,
  }
}

/**
 * Une panne, avec les notes que le doute impose.
 *
 * `failed(error, written)` est REUTILISE et prend deux arguments — pas trois. Les
 * notes sont ajoutees par-dessus, exactement comme le fait le connecteur
 * WordPress, et la phrase « ne relancez pas » est attachee ICI plutot qu'a chaque
 * site d'appel : c'est le meme fait pour tous, et l'oublier une fois suffirait a
 * faire publier un doublon.
 */
function broke(error: string, written: boolean, notes: string[]): PublishOutcome {
  return {
    ...failed(error, written),
    notes: written ? [...notes, RETRY_FORBIDDEN] : notes,
  }
}

// ─── Lectures elementaires ──────────────────────────────────────────────────

/**
 * Le droit d'ecrire, lu sans faire confiance a la colonne.
 *
 * `scopes` traverse le JSON du callback OAuth puis une colonne `text[]` : le type
 * TypeScript promet un tableau, la valeur reelle peut etre `null` sur une ligne
 * ecrite avant que la colonne existe. `Array.isArray` coute une comparaison et
 * evite un `.includes` sur `null`, qui jetterait ici — c'est-a-dire au seul
 * endroit qui existe pour ne PAS jeter.
 */
function hasManageScope(scopes: string[] | null | undefined): boolean {
  return Array.isArray(scopes) && scopes.includes(GBP_MANAGE_SCOPE)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
