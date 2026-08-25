// ─────────────────────────────────────────────────────────────────────────────
// Forme de GET /api/gbp/posts, POST /api/gbp/posts et POST /api/gbp/posts/publish
// ─────────────────────────────────────────────────────────────────────────────
//
// Declare une fois, importe par les routes qui produisent et par l'onglet
// « Fiche Google » qui rend — exactement le patron de app/api/generate/feed-types.ts,
// et pour la raison ecrite dans son en-tete : les deux vues de /generate et
// /publish redeclaraient chacune leur `Generation`, et les deux avaient derive de
// la table.
//
// POURQUOI UN SECOND MODULE PLUTOT QUE DES CHAMPS DE PLUS DANS LE PREMIER.
//
// `GenerationFeedResponse` ne peut pas porter les posts, et ce n'est pas une
// question de gout : `gbp_posts_status_check` autorise 'incertain', absent de
// `GenerationStatus` ; `generations.city` est NOT NULL alors qu'un post de fiche
// n'a pas de ville ; `slug`, `page_type`, `published_url` et `publish_mode`
// seraient nuls et mensongers sur chaque ligne de post.
//
// La raison de LIVRAISON pese plus lourd encore : le chantier A (conscience de
// l'existant) ne doit jamais dependre de la migration 019. Si les posts
// partageaient /api/generate, un depot ou 019 n'est pas appliquee verrait le feed
// des PAGES tomber avec le feed des posts. Deux routes, deux migrations, deux
// pannes independantes.
//
// CE QUE CE MODULE TIRE : deux types, et rien d'autre. `FeedSite`, pour que la
// liste des sites soit la meme des deux cotes, et `GbpPostAngle`, la seule
// declaration des sept angles du produit. Les deux sont effacables a la
// compilation ; l'onglet est un composant client et n'embarque donc aucun code de
// domaine par ce chemin.

import type { FeedSite } from '@/app/api/generate/feed-types'
import type { GbpPostAngle } from '@/src/core/domain/gbp/rotation'

// ─── Angles ─────────────────────────────────────────────────────────────────

/**
 * Les sept angles, sous le nom que le front leur donne.
 *
 * Un ALIAS, jamais une seconde union. `GbpPostAngle`
 * (src/core/domain/gbp/rotation.ts) est le miroir exact de
 * `gbp_posts_angle_check` et la valeur sur laquelle tourne toute la politique de
 * rotation. Recopier ses sept membres ici creerait une union capable de nommer un
 * angle que la base refuse a l'insertion — et personne ne l'apprendrait avant le
 * premier 23514 en production.
 */
export type GbpAngle = GbpPostAngle

// ─── Statuts ────────────────────────────────────────────────────────────────

/**
 * Les huit statuts d'une ligne `gbp_posts`, dans l'ordre du cycle de vie.
 *
 * Un tableau, avec l'union DERIVEE de lui, et non l'inverse : les routes ont
 * besoin de la liste a l'execution (huit comptages, un par statut) et la vue en a
 * besoin pour ses filtres. Declarer l'union d'un cote et la liste de l'autre,
 * c'est la garantie qu'un neuvieme statut n'arrive que dans l'une des deux — le
 * defaut exact que `ALL_STATUSES` de app/api/generate/route.ts:97 ne peut pas
 * detecter aujourd'hui.
 *
 * C'est le SEUL export non effacable de ce module. Il ne tire aucune dependance :
 * un tableau de huit chaines reste sans danger pour le composant client qui
 * l'importe.
 *
 * 'incertain' est le statut qui n'a pas d'equivalent cote page. Il ne dit ni
 * succes ni echec : il dit que le POST localPosts n'a ni abouti ni echoue
 * franchement, et qu'un rejeu a l'aveugle publierait un second post sur la fiche
 * d'un client. Toute couche qui le confond avec 'failed' reintroduit ce doublon.
 */
export const GBP_POST_STATUSES = [
  'pending',
  'generating',
  'generated',
  'publishing',
  'published',
  'rejected',
  'failed',
  'incertain',
] as const

export type GbpPostStatus = (typeof GBP_POST_STATUSES)[number]

// ─── La ligne ───────────────────────────────────────────────────────────────

/**
 * La page publiee vers laquelle le post pointe.
 *
 * Jamais nulle sur un post 'engine' passe le stade 'generating' : la contrainte
 * `gbp_posts_engine_needs_link` l'exige des le statut 'generated'. Elle l'est en
 * revanche sur un post 'remote' (le proprietaire n'annonce pas nos pages) et sur
 * un post 'rejected' ou 'failed', que la contrainte exempte pour que la trace du
 * refus « aucune page a annoncer » soit elle-meme inscriptible.
 */
export interface GbpLinkTarget {
  id: string
  title: string | null
  slug: string | null
  published_url: string | null
}

export interface FeedGbpPost {
  id: string
  site_id: string
  campaign_id: string | null
  /**
   * 'remote' = ecrit a la main par le proprietaire sur sa fiche, recupere a la
   * synchronisation. Il entre dans le MEME corpus anti-duplication que les
   * notres : l'ignorer ferait proposer au moteur de redire ce que le
   * proprietaire vient d'ecrire, le plus mauvais post possible — redondant ET
   * visiblement automatique.
   */
  source: 'engine' | 'remote'
  /** Nul sur un post 'remote' : le proprietaire n'a pas choisi dans notre liste. */
  angle: GbpAngle | null
  summary: string
  status: GbpPostStatus
  /**
   * 'duplicat' | 'identifiants' | 'quota' | 'format', les quatre valeurs de
   * `gbp_posts_refusal_check`. Type `string | null` et non une union : la colonne
   * est un `text` nu cote base et la vue n'indexe aucun dictionnaire avec — elle
   * l'affiche via un `Record<string, string>` qui rend la valeur brute sur une
   * clef inconnue.
   */
  refusal_kind: string | null
  /**
   * Pourquoi le gate a refuse, sous la forme `CODE: phrase | CODE: phrase` que
   * produit `gbpRefusalMessage` — la meme que pour une page, pour que
   * l'operateur n'ait qu'une lecture a apprendre.
   */
  error_message: string | null
  cta_action_type: string | null
  cta_url: string | null
  /**
   * `accounts/{a}/locations/{l}/localPosts/{id}`.
   *
   * L'ANCRE D'IDEMPOTENCE, precisement l'identifiant que la lecture jetait avant
   * ce chantier. Sans lui, un delai depasse suivi d'une reprise cree un SECOND
   * post sur la fiche du client, visible par ses prospects.
   */
  remote_name: string | null
  remote_search_url: string | null
  /** 'LIVE' | 'PROCESSING' | 'REJECTED' … tel que la fiche le rapporte. */
  remote_state: string | null
  linked_generation_id: string | null
  linked_generation: GbpLinkTarget | null
  /**
   * La date du creneau `editorial_calendar` qui a produit ce post.
   *
   * N'est PAS une colonne de `gbp_posts` : la migration 019 n'en cree aucune. Un
   * seul calendrier, un discriminant — la date vit sur le creneau, jointe par
   * `calendar_slot_id`. Nulle sur un post compose a la main depuis l'ecran, qui
   * n'a jamais eu de creneau.
   */
  scheduled_for: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  site: FeedSite | null
  campaign: { id: string; name: string } | null
}

// ─── Compteurs ──────────────────────────────────────────────────────────────

/**
 * Huit compteurs et leur somme, chacun pouvant valoir INCONNU.
 *
 * `number | null`, et c'est le point de ce type. « Nous n'avons pas pu compter »
 * et « il n'y en a aucun » sont deux faits differents, et afficher le second pour
 * le premier est exactement la facon dont un tableau de bord commence a mentir :
 * un operateur qui lit « 0 refuse » cesse d'aller voir, alors que douze posts
 * attendent peut-etre une decision.
 *
 * `total` est nul des qu'UN des huit l'est. Une somme partielle presentee comme
 * un total serait le meme mensonge, en moins visible.
 *
 * ECART ASSUME par rapport au contrat FRONT initial, qui declarait
 * `Record<GbpPostStatus, number> & { total: number }` : ce contrat n'avait pas de
 * valeur pour dire l'ignorance, et la route n'avait donc que deux issues, jeter
 * (le feed entier disparait a cause d'un compteur) ou ecrire zero. La vue rend
 * `null` avec `<UnknownValue />`, qui existe dans components/ui.tsx pour cela.
 */
export type GbpPostCounts = Record<GbpPostStatus, number | null> & {
  total: number | null
}

// ─── Ce que le moteur peut faire maintenant ─────────────────────────────────

/**
 * La DECISION de la politique, calculee cote serveur, jamais devinee par la vue.
 *
 * Toute cette structure existe pour une raison : la vue ne recalcule aucun
 * cooldown, aucun quota, aucune cadence. Un second exemplaire de la politique
 * cote client divergerait du premier au premier reglage de constante, et
 * l'operateur verrait une option proposee que le serveur refuserait ensuite.
 */
export interface GbpEligibility {
  /** `campaigns.gbp_posts_enabled`. Faux par defaut en base : opt-in strict. */
  enabled: boolean
  /**
   * `google_connections` : compte, fiche ET scope business.manage presents.
   *
   * Les trois ensemble. Une connexion Google sans `gbp_location_id` ne designe
   * aucune fiche, et une connexion consentie avant que le scope d'ecriture ne
   * soit demande lit la fiche sans pouvoir y ecrire — deux etats qui se lisent
   * « connecte » a l'oeil nu et qui ne permettent pourtant pas un seul post.
   */
  credentialsReady: boolean
  anglesAvailable: GbpAngle[]
  /**
   * Angle -> pourquoi il est indisponible, en francais, pret a afficher.
   *
   * Une option grisee sans motif est un cul-de-sac : l'operateur ne sait ni
   * quoi corriger ni s'il doit attendre. Le motif vient de la politique, pas de
   * la vue.
   */
  anglesBlocked: Array<{ angle: GbpAngle; reason: string }>
  nextLinkTarget: GbpLinkTarget | null
  /** `campaigns.gbp_post_cadence_days`, entre 3 et 30. */
  cadenceDays: number
  postsThisIsoWeek: number
  /**
   * Plafond dur de posts par semaine ISO.
   *
   * C'est un AVEU D'IGNORANCE, pas une optimisation : le quota reellement
   * accorde au projet Google Cloud est inconnu depuis le depot, et le defaut
   * documente est de zero requete par minute tant que l'« Application For Basic
   * API Access » n'est pas approuvee. Voir docs/gbp-acces-api.md.
   */
  weeklyCap: number
  /** Renseigne quand rien ne peut partir : phrase francaise prete a afficher. */
  blockedReason: string | null
}

// ─── Reponses ───────────────────────────────────────────────────────────────

export interface GbpPostFeedResponse {
  posts: FeedGbpPost[]
  counts: GbpPostCounts
  /**
   * Nul quand aucun site n'est selectionne — une eligibilite agregee sur
   * plusieurs fiches ne veut rien dire — ET quand la politique n'a pas pu
   * repondre. Les deux menent a la meme conduite cote vue : ne rien proposer.
   * Le second cas est journalise cote serveur ; aucun des deux n'autorise la vue
   * a supposer qu'un post peut partir.
   */
  eligibility: GbpEligibility | null
  sites: FeedSite[]
  campaigns: Array<{
    id: string
    name: string
    site_id: string | null
    gbp_posts_enabled: boolean
  }>
}

/** 200 de POST /api/gbp/posts : un post a ete compose et ecrit en base. */
export interface GbpPostComposeResponse {
  success: true
  post: FeedGbpPost
  /**
   * Ce qui a failli le retenir sans y parvenir — avertissements du gate, dont
   * GBP_SUMMARY_OFF_TARGET, le seul code de format qui ne bloque pas — et les
   * ecritures secondaires ratees. Jamais une raison de rejouer.
   */
  notes: string[]
}

/**
 * 200 de POST /api/gbp/posts/publish : un post est sur la fiche.
 *
 * `postId` peut DIFFERER de celui envoye, et c'est le point le plus important de
 * ce type. Cette route ne repousse pas la ligne nommee — voir l'en-tete de
 * app/api/gbp/posts/publish/route.ts : elle relance la sequence complete pour la
 * fiche de ce post, dont le premier acte est la reconciliation des lignes
 * 'incertain'. La vue doit donc lire CE `postId`, jamais celui qu'elle a envoye.
 */
export interface GbpPostPublishResponse {
  success: true
  /** La ligne reellement publiee. Pas necessairement celle qui a ete demandee. */
  postId: string
  /** Le statut de cette ligne APRES la tentative, pour ne pas afficher l'ancien. */
  status: GbpPostStatus
  /**
   * Nuls quand la fiche a repondu 2xx sans corps exploitable.
   *
   * Ce n'est PAS un echec : le post existe sur la fiche, il n'est simplement pas
   * identifie. `remote_name` restant vide, l'ancre d'idempotence manque, et c'est
   * la relecture par empreinte qui la retrouvera.
   */
  remoteName: string | null
  searchUrl: string | null
  state: string | null
  notes: string[]
}

/**
 * La forme d'erreur des deux routes, identique a celle de /api/generate et de
 * /api/publish/generation.
 *
 * Une enveloppe `{ code, message, details }` de plus obligerait la vue a porter
 * deux lecteurs d'erreur pour deux canaux du meme produit.
 *
 * `rejected` n'est present que sur un refus de GATE, ou les raisons existent et
 * sont redigees. Un echec de CONNECTEUR n'en porte pas : la vue rend alors le
 * titre seul, avec une liste de raisons vide — comportement deja etabli par
 * app/api/publish/generation/route.ts.
 */
export interface GbpPostErrorResponse {
  error: string
  rejected?: { reasons: string[]; refusal_kind: string | null }
  /**
   * La qualification d'un refus rendu SANS raisons redigees — typiquement un
   * report pour 'identifiants' ou 'quota', ou un echec de connecteur. Redondante
   * avec `rejected.refusal_kind` quand celui-ci existe, et c'est voulu : les deux
   * cas ne se ressemblent pas et la vue doit pouvoir badger le second sans avoir
   * a inventer une liste de raisons vide pour le premier.
   */
  refusal_kind?: string
  /**
   * `true` signifie « le post existe peut-etre sur la fiche ».
   *
   * Ce n'est PAS un succes degrade, c'est l'interdiction de rejouer : un POST
   * localPosts n'est pas idempotent et l'API n'accepte aucune clef
   * d'idempotence. La vue propose d'aller VOIR la fiche, jamais de recliquer.
   */
  written?: boolean
  /**
   * Le statut de la ligne APRES la tentative, quand une ligne est en cause.
   *
   * Present sur une erreur parce que la tentative a change le statut — 'generated'
   * est devenu 'rejected' ou 'incertain' — et qu'une vue qui affiche l'ancien
   * statut a cote du message d'erreur invite l'operateur a recliquer sur
   * « Publier » : precisement le rejeu a l'aveugle que 'incertain' existe pour
   * empecher.
   */
  status?: GbpPostStatus
  /** La ligne concernee, quand la tentative en a ouvert une. */
  postId?: string
  /** La ligne entiere, sur les refus de POST /api/gbp/posts, pour eviter un aller-retour. */
  post?: FeedGbpPost
  /**
   * Ce qui s'est mal passe sans empecher la suite — avertissements du gate,
   * ecritures secondaires ratees. JAMAIS une raison de rejouer.
   */
  notes?: string[]
}

// ─── Deux lectures du contrat, partagees par les deux routes ────────────────
//
// Elles vivent ici, dans le module de contrat, et non dans l'un des deux
// fichiers de route : Next.js n'autorise sur un Route Handler que les exports
// qu'il connait (GET, POST, `dynamic`, …) et refuse de compiler un fichier qui
// en porte d'autres. Sans ce module, ces trois declarations existeraient en deux
// exemplaires — et la phrase de migration absente finirait par differer d'une
// route a l'autre.
//
// Elles n'importent RIEN : ni `next/server`, ni Supabase, ni React. L'onglet
// client qui importe ce module n'embarque donc toujours qu'une poignee de
// chaines et deux fonctions pures.

/**
 * Ce qu'on repond quand la table `gbp_posts` n'existe pas encore.
 *
 * Nomme la cause au lieu de dire « erreur interne » : un operateur qui lit une
 * erreur interne cherche un defaut de code, alors qu'il manque une commande de
 * migration. La derniere phrase existe pour qu'il ne redoute pas une panne
 * generale — le chantier des pages ne depend pas de 019, et c'est precisement
 * pour cela que les deux canaux ont deux routes.
 */
export const GBP_MIGRATION_MISSING =
  'Les posts de fiche ne sont pas encore installés sur cette base : la migration 019 '
  + 'n’a pas été appliquée. Les pages, elles, continuent de fonctionner.'

/**
 * `gbp_posts` n'existe pas encore.
 *
 * Deux codes, parce que les deux arrivent : `42P01` est l'`undefined_table` de
 * PostgreSQL, `PGRST205` celui que PostgREST rend quand la table n'est pas dans
 * son cache de schema — ce qui se produit aussi pendant quelques secondes APRES
 * la migration, avant le rechargement du cache. Le repli sur le message couvre
 * les versions de PostgREST qui ne posent pas de code.
 */
export function isMissingGbpTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  return message.includes('gbp_posts') && (message.includes('does not exist') || message.includes('schema cache'))
}

/**
 * `'A: x | B: y'` → `['A: x', 'B: y']`.
 *
 * La lecture de `error_message`, dont la forme est fixee par `gbpRefusalMessage`
 * (lib/publishing/gbp/gate.ts), qui joint `CODE: phrase` par ' | '.
 *
 * `splitReasons` de components/ui.tsx fait presque la meme chose et n'est pas
 * reutilisee ici pour deux raisons : elle retire en tete un prefixe
 * « Rejete par le pipeline : » que le canal GBP n'ecrit jamais, et l'importer
 * ferait dependre un Route Handler du systeme de design — lucide-react et
 * next/link tires dans le paquet serveur d'une route qui ne rend aucun pixel.
 */
export function splitReasons(message: string | null): string[] {
  if (!message) return []
  return message
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}
