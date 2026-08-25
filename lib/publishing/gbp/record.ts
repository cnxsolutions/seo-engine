// ─────────────────────────────────────────────────────────────────────────────
// Ce qui reste apres un POST localPosts
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// MEME ROLE QUE lib/publishing/record.ts, POUR UN AUTRE CANAL. Le connecteur
// rend un `PublishOutcome`, ce module le traduit en une ligne `gbp_posts` et ne
// fait rien d'autre. La symetrie est voulue : la sequence du produit a une seule
// forme — gate, connecteur, record — et un lecteur qui connait l'une connait
// l'autre.
//
// CE MODULE N'APPELLE NI submitForIndexing NI indexPublishedPage, ET C'EST UNE
// REGLE, PAS UN OUBLI. Deux raisons independantes, dont chacune suffirait.
//
//  1. Ce serait ACTIVEMENT NUISIBLE. L'Indexing API de Google sert a signaler
//     des pages d'un site que l'on controle ; un `localPost` n'est pas une page
//     du site, il vit sur la fiche, a une adresse Google. Lui demander d'indexer
//     l'adresse d'un post revient a depenser du budget d'exploration pour une
//     ressource qui n'est pas la notre, et a apprendre au moteur que ce site
//     annonce des pages qu'il ne sert pas. Le meme raisonnement vaut pour
//     IndexNow.
//  2. Ce ne COMPILERAIT MEME PAS proprement. `indexPublishedPage` alimente
//     `generations` et `vector_embeddings`, dont le CHECK
//     vector_embeddings_document_type_check n'accueille pas un post de fiche ; et
//     `generations.published_page_id` est un `integer` (db/000_baseline.sql), la
//     ou `remote_name` vaut `accounts/{a}/locations/{l}/localPosts/{id}` —
//     `toNumericId` (lib/publishing/record.ts) rendrait `undefined` sur ce nom de
//     ressource textuel, donc l'identifiant qui rend l'idempotence possible
//     serait silencieusement perdu.
//
// L'IDEMPOTENCE EST DANS L'INDEX, PAS DANS CE CODE. `gbp_posts_remote_name_key`
// (migration 019, UNIQUE partiel sur (site_id, remote_name)) est ce qui fait
// d'une course entre une reprise et une reconciliation un no-op au lieu d'un
// second post sur la fiche du client. Une violation 23505 n'est donc PAS une
// panne : c'est l'index qui repond « ce post est deja enregistre », et le seul
// traitement correct est de le croire.
//
// NE JETTE JAMAIS. Quand ce module s'execute, le post est deja — ou peut-etre
// deja — sur la fiche. Transformer un incident d'ecriture en echec de
// publication est exactement ce qui pousse un appelant a recommencer un POST qui
// n'est pas idempotent.

import { createServiceClient } from '@/lib/supabase'
import type { PublishOutcome } from '../outcome'

/**
 * Les quatre valeurs que `gbp_posts_refusal_check` autorise (migration 019).
 *
 * Deux d'entre elles seulement peuvent venir d'un `PublishRefusal` : 'duplicat'
 * et 'identifiants'. 'quota' et 'format' n'existent pas dans `PublishRefusal`
 * — ce sont des ECHECS cote connecteur (429 / 403 RESOURCE_EXHAUSTED, et 400) —
 * et c'est l'appelant qui les qualifie. Sans le parametre `refusalKind`
 * ci-dessous, ces deux valeurs seraient enumerees par la base et inscriptibles
 * par personne.
 */
export type GbpRefusalKind = 'duplicat' | 'identifiants' | 'quota' | 'format'

const ALLOWED_REFUSAL_KINDS: readonly GbpRefusalKind[] = [
  'duplicat',
  'identifiants',
  'quota',
  'format',
]

/** Le code que PostgreSQL rend quand un index unique refuse la ligne. */
const UNIQUE_VIOLATION = '23505'

export interface RecordGbpPostOptions {
  /** La ligne `gbp_posts` ouverte en 'generated' AVANT la publication. */
  postId: string
  outcome: PublishOutcome
  /**
   * Le corps de la reponse distante, VERBATIM.
   *
   * C'est la seule chose qui, un jour, fera disparaitre les mentions « a
   * confirmer contre l'API reelle » de format.ts : l'acces en ecriture n'etant
   * pas accorde (docs/gbp-acces-api.md), la vraie borne du resume et la vraie
   * liste des `actionType` se liront dans le premier 400 recu. Le reformuler,
   * le tronquer ou le remplacer par une phrase francaise detruirait la seule
   * preuve que ce depot puisse obtenir.
   */
  rawError?: string
  /**
   * `LocalPost.state` tel que l'API l'a rendu — LIVE, PROCESSING, REJECTED…
   *
   * ECART ASSUME. `PublishOutcome` ne transporte pas cet etat : le connecteur
   * n'en derive que `live` (`post.state === 'LIVE'`). Le rededuire ici depuis
   * `live` ecrirait 'LIVE' quand c'est vrai et rien du tout quand c'est faux,
   * alors que 'PROCESSING' et 'REJECTED' sont precisement les deux etats qu'un
   * operateur a besoin de voir. Fourni, il est ecrit ; absent, la colonne n'est
   * PAS touchee — ecraser par `null` un etat qu'une reconciliation anterieure a
   * pose serait perdre une information au profit d'une absence.
   */
  remoteState?: string
  /**
   * Force `refusal_kind` quand l'echec en porte un que `PublishRefusal` ne sait
   * pas dire — 'quota' et 'format'. Sans cela, le refus se deduit de
   * `outcome.refusal.kind`.
   */
  refusalKind?: GbpRefusalKind
}

export interface RecordGbpPostReport {
  /**
   * La ligne `gbp_posts` porte desormais le resultat.
   *
   * Vrai aussi quand l'index unique a refuse l'ecriture : la ligne existe alors
   * ailleurs avec le meme `remote_name`, donc le fait EST enregistre. Le nier
   * pousserait l'appelant a recommencer.
   */
  stored: boolean
  /** Ce qui s'est mal passe ici, et qui ne fait jamais echouer la publication. */
  problems: string[]
}

/**
 * Fermer la ligne du post, et rien d'autre.
 *
 * LE STATUT 'incertain' EST ECRIT TEL QUEL. C'est le point entier de ce module.
 * Un `POST localPosts` n'est pas idempotent : sur un timeout ou un 5xx, la
 * requete a pu aboutir cote Google sans que nous en recevions la reponse. Le
 * convertir en 'failed' autoriserait une reprise qui publierait un DOUBLON sur
 * la fiche d'un client, visible par ses prospects ; le convertir en 'published'
 * inventerait un post et un `remote_name` que nous n'avons pas. Ni l'un ni
 * l'autre — la ligne reste 'incertain' jusqu'a ce que la reconciliation
 * (lib/gbp/posts/run.ts) apparie, ou non, un post reel par son empreinte.
 */
export async function recordGbpPost(opts: RecordGbpPostOptions): Promise<RecordGbpPostReport> {
  const problems: string[] = []

  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('gbp_posts')
      .update(buildPayload(opts))
      .eq('id', opts.postId)

    if (!error) return { stored: true, problems }

    if (error.code === UNIQUE_VIOLATION) {
      // L'index a arbitre. Ce `remote_name` est deja porte par une autre ligne
      // du meme site : une reconciliation, ou une reprise concurrente, a deja
      // enregistre ce post. Il n'y a rien a corriger et surtout rien a
      // reessayer — le compte-rendu le dit sans le deguiser en succes muet.
      problems.push(
        `post deja enregistre sous ce nom de ressource distante (${error.message}) : `
        + `l'index gbp_posts_remote_name_key a refuse un second enregistrement, `
        + `aucune nouvelle ecriture sur la fiche n'a eu lieu`,
      )
      return { stored: true, problems }
    }

    problems.push(`statut non enregistre : ${error.message}`)
    return { stored: false, problems }
  } catch (error) {
    // Base injoignable, variables d'environnement absentes : le post est peut-etre
    // deja sur la fiche, et une exception qui remonte ferait de cette incertitude
    // une raison de recommencer.
    problems.push(`statut non enregistre : ${message(error)}`)
    return { stored: false, problems }
  }
}

// ─── La charge utile ────────────────────────────────────────────────────────

/**
 * Les colonnes ecrites, et elles seules.
 *
 * `summary`, `summary_fingerprint`, `angle`, `cta_*` et `linked_generation_id`
 * sont deja poses par l'ouverture de la ligne en 'generated' (run.ts, etape 7,
 * exige par gbp_posts_engine_needs_link). Les reecrire ici ferait de ce module
 * un second auteur du contenu du post, avec sa propre idee de ce qui a ete
 * envoye.
 *
 * `updated_at` est ecrit explicitement : `gbp_posts` est creee par la migration
 * 019 SANS trigger de mise a jour, contrairement a `generations`. L'omettre
 * laisserait la colonne figee a la creation et rendrait l'ordre `updated_at
 * DESC` inutilisable pour retrouver ce qui vient de bouger.
 */
function buildPayload(opts: RecordGbpPostOptions): Record<string, unknown> {
  const { outcome } = opts
  const status = statusFor(outcome)

  const payload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    refusal_kind: refusalKindFor(opts),
    error_message: errorMessageFor(opts),
  }

  // `remote_name` est l'ancre d'idempotence : elle n'est posee que si la
  // destination nous a rendu un nom de ressource. Ecrire `null` dessus effacerait
  // l'ancre d'une tentative anterieure qui, elle, avait abouti.
  if (outcome.remoteId) payload.remote_name = outcome.remoteId
  if (outcome.pageUrl) payload.remote_search_url = outcome.pageUrl
  if (opts.remoteState) payload.remote_state = opts.remoteState

  // Date posee UNE FOIS, et seulement quand le post est reellement visible sur
  // la fiche. Meme regle que pour une page : dater un post que personne ne voit
  // encore fausserait toute mesure posterieure a sa publication.
  if (outcome.live) payload.published_at = new Date().toISOString()

  return payload
}

/**
 * Les quatre etats d'une tentative, dans l'ordre ou ils se distinguent.
 *
 * L'ordre des tests est la regle elle-meme : `written` est le dernier
 * discriminant, celui qui separe un echec franc d'un doute. `refusal` passe
 * avant lui parce qu'un refus delibere n'a jamais rien ecrit — le connecteur
 * refuse AVANT le reseau.
 */
function statusFor(outcome: PublishOutcome): string {
  if (outcome.ok) return 'published'
  if (outcome.refusal) return 'rejected'
  return outcome.written ? 'incertain' : 'failed'
}

/**
 * Le motif du refus, contraint par `gbp_posts_refusal_check`.
 *
 * `PublishRefusal` porte deux kinds — 'occupe' et 'redirection' — que ce CHECK
 * n'autorise pas. Ils sont propres a une page qu'on ecraserait sur un site : un
 * post de fiche ne remplace rien et le connecteur GBP ne les emet pas. Les
 * traduire serait leur inventer un sens ; les ecrire ferait echouer l'UPDATE
 * entier et perdrait le statut avec eux. Ils rendent donc `null`, et le message
 * du refus survit dans `error_message`.
 */
function refusalKindFor(opts: RecordGbpPostOptions): GbpRefusalKind | null {
  if (opts.refusalKind) return opts.refusalKind

  // Une publication reussie efface le motif d'un refus precedent : une pastille
  // « refuse » sur un post en ligne est pire qu'aucune pastille.
  if (opts.outcome.ok) return null

  const kind = opts.outcome.refusal?.kind
  if (!kind) return null

  return ALLOWED_REFUSAL_KINDS.includes(kind as GbpRefusalKind) ? (kind as GbpRefusalKind) : null
}

/**
 * Ce que l'operateur lira, par ordre de valeur de preuve.
 *
 * Le corps distant d'abord — c'est le seul texte que nous n'avons pas ecrit —
 * puis notre propre message d'erreur, puis la phrase du refus. Sur un succes,
 * la colonne est effacee : un message d'echec conserve a cote d'un post en ligne
 * ferait chercher une panne qui n'existe plus.
 */
function errorMessageFor(opts: RecordGbpPostOptions): string | null {
  if (opts.outcome.ok) return null
  return opts.rawError ?? opts.outcome.error ?? opts.outcome.refusal?.message ?? null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
