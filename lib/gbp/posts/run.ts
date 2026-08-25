// ─────────────────────────────────────────────────────────────────────────────
// Un post de fiche, du premier choix a la derniere trace
// SEO Engine - GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// UNE SEULE SEQUENCE, PARTAGEE. Le declencheur planifie (un creneau
// `editorial_calendar` de kind 'gbp_post') et le declencheur manuel
// (POST /api/gbp/posts) traversent EXACTEMENT ce chemin. Deux implementations de
// la meme suite d'etapes, c'est deux idees de ce que « publier » veut dire, et
// c'est la moitie du chantier A qui recommence sur un autre canal.
//
// SYMETRIE AVEC lib/publishing/publish.ts : gate → connecteur → record, dans cet
// ordre. Un lecteur qui connait la publication d'une page connait celle d'un
// post.
//
// LA LIGNE EST ECRITE AVANT LA PUBLICATION, et c'est la regle la plus importante
// de ce fichier. Un `POST .../localPosts` n'est pas idempotent et l'API n'accepte
// aucune clef d'idempotence : si la ligne etait ecrite APRES, un processus qui
// meurt entre l'appel et l'ecriture laisserait un post sur la fiche d'un client
// dont ce depot n'aurait aucune trace — donc republiable au tick suivant. Ecrire
// d'abord coute un INSERT ; ne pas le faire coute un doublon public.
//
// RIEN NE PART SANS QUE LE DOUTE PRECEDENT SOIT LEVE. Tant qu'une ligne
// 'incertain' existe pour ce site, ce module tente de la RECONCILIER (une
// relecture, jamais un rejeu) et, si le doute persiste, REPORTE. Publier
// par-dessus un doute est la facon la plus sure de fabriquer le doublon que tout
// le reste du chantier evite.
//
// UN CRENEAU REPORTE NE BRULE PAS DE TENTATIVE. Aucune ligne n'est ecrite quand
// la politique n'a rien a dire : `nextAngle` qui rend null, aucune page a
// annoncer, aucun contexte Google. Ce n'est pas une panne, c'est le seul
// resultat honnete — et un creneau reporte ne coute rien, la ou un post
// redondant s'affiche sur la fiche d'un client.
//
// AUCUN SEUIL N'EST RECOPIE ICI. RECENT_POST_WINDOW, LINK_COOLDOWN,
// ANGLE_COOLDOWN, POST_SIMILARITY_BLOCK, les bornes de format et la liste des
// boutons vivent dans src/core/domain/gbp/rotation.ts et
// lib/publishing/gbp/format.ts. Ce module les applique en appelant leurs
// fonctions ; il n'en connait aucune valeur.

import { getCampaignById } from '@/lib/db'
import { generateGbpPost } from '@/lib/ai/gbp-post'
import { getAuthenticatedClient, getGoogleConnection } from '@/lib/google/client'
import { getGoogleContext } from '@/lib/google/context'
import { fetchPosts, type GbpLocalPost } from '@/lib/google/gbp'
import { GBP_QUOTA_MESSAGE } from '@/lib/google/sync'
import { gbpPostConnector } from '@/lib/publishing/gbp/connector'
import { GBP_TOPIC_TYPE, type GbpActionType, type LocalPostDraft } from '@/lib/publishing/gbp/format'
import { gbpRefusalMessage, runGbpPostGate, type GbpProfileFacts } from '@/lib/publishing/gbp/gate'
import { recordGbpPost, type GbpRefusalKind } from '@/lib/publishing/gbp/record'
import type { PublishOutcome } from '@/lib/publishing/outcome'
import { createServiceClient } from '@/lib/supabase'
import type { Campaign, Site } from '@/lib/types'
import {
  describeAngles,
  fingerprintSummary,
  GBP_POST_ANGLES,
  linksInCooldown,
  nextAngle,
  RECENT_POST_WINDOW,
  type AngleAvailability,
  type GbpPostAngle,
  type RecentPost,
} from '@/src/core/domain/gbp/rotation'

// ─── Le scope qui autorise l'ecriture ───────────────────────────────────────

/**
 * Le scope OAuth sans lequel aucune ecriture de fiche n'est possible.
 *
 * Il est DEJA demande au consentement (lib/google/auth.ts) et stocke dans
 * `google_connections.scopes`, un `text[] NOT NULL DEFAULT '{}'`. Une connexion
 * etablie avant qu'il ne soit demande ne le porte pas : le verifier ici, avant
 * tout reseau, transforme un 403 illisible en une phrase qui dit quoi faire.
 */
const BUSINESS_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'

/**
 * Combien de generations publiees sont examinees pour trouver la page a
 * annoncer.
 *
 * Largement au-dela de LINK_COOLDOWN : il faut assez de candidates pour qu'au
 * moins une echappe au cooldown, et assez peu pour que la lecture reste une
 * requete bornee. Ce n'est PAS un seuil de politique — c'est la profondeur d'une
 * lecture, et la politique, elle, est `linksInCooldown`.
 */
const LINK_CANDIDATE_DEPTH = 40

// ─── Contrat ────────────────────────────────────────────────────────────────

/** Composer un post neuf, puis le publier. */
export interface ComposeGbpPostInput {
  /** Un post appartient toujours a une campagne : c'est elle qui l'autorise. */
  campaignId: string
  /**
   * Suggestion de l'operateur. VALIDEE contre la rotation, jamais imposee :
   * un angle en cooldown est refuse avec son motif plutot qu'accepte par
   * politesse. Absente, la politique choisit.
   */
  angle?: GbpPostAngle
  /** Meme regime que `angle` : une suggestion, confrontee aux cooldowns. */
  linkedGenerationId?: string
  /**
   * Le creneau du calendrier a l'origine de ce run, quand il y en a un.
   *
   * Le declencheur manuel n'en a pas ; le scheduler, si. Ecrit dans
   * `gbp_posts.calendar_slot_id` pour que la date planifiee reste joignable —
   * un seul calendrier, c'est la these du lot, et deux plannings seraient deux
   * verites sur la meme date.
   */
  calendarSlotId?: string
}

/** Publier une ligne DEJA ECRITE : la reprise manuelle d'un post en attente. */
export interface ResumeGbpPostInput {
  postId: string
}

/**
 * Les deux facons d'entrer, et elles ne se recouvrent pas.
 *
 * COMPOSER part d'une campagne et n'a pas encore de ligne ; REPRENDRE part d'une
 * ligne et ne redige rien. Une union discriminee plutot qu'un objet a champs
 * tous optionnels : `{ campaignId?, postId? }` autoriserait les deux a la fois et
 * les zero — deux etats qui n'ont aucun sens et qu'il faudrait alors refuser a
 * l'execution, dans chaque appelant.
 *
 * LA REPRISE NE REDIGE JAMAIS UN SECOND TEXTE. Le resume, l'angle et la page
 * annoncee sont ceux que la ligne porte : les regenerer produirait un post
 * different de celui que l'operateur a lu avant de cliquer, et paierait une
 * generation pour cela.
 */
export type RunGbpPostInput = ComposeGbpPostInput | ResumeGbpPostInput

export interface RunGbpPostReport {
  /** La ligne `gbp_posts` ouverte. ABSENTE quand le creneau a ete reporte. */
  postId?: string
  /** Le post est en ligne sur la fiche. */
  published: boolean
  /**
   * Pourquoi rien n'a ete produit, en francais et pret a afficher.
   *
   * Renseigne si et seulement si `postId` est absent : un creneau reporte n'est
   * ni un succes ni un echec, et l'appelant a besoin de la phrase, pas d'un code.
   */
  reported?: string
  /** Qualifie un refus, quand il y en a un. Miroir de `gbp_posts.refusal_kind`. */
  refusalKind?: GbpRefusalKind
  /** Ce qui s'est mal passe sans empecher la suite. Jamais une raison de rejouer. */
  problems: string[]
}

// ─── La sequence ────────────────────────────────────────────────────────────

/**
 * Compose — ou reprend — UN post, une fois.
 *
 * NE JETTE PAS sur les refus previsibles : une campagne desactivee, une fiche
 * non connectee, aucun angle disponible et aucune page a annoncer rendent tous
 * un rapport. Les erreurs de lecture Supabase, elles, remontent — l'appelant
 * (route ou scheduler) les traite comme des pannes, ce qu'elles sont.
 */
export async function runGbpPostNow(input: RunGbpPostInput): Promise<RunGbpPostReport> {
  return 'postId' in input ? resumeGbpPost(input.postId) : composeGbpPost(input)
}

// ─── Chemin 1 : composer ────────────────────────────────────────────────────

async function composeGbpPost(input: ComposeGbpPostInput): Promise<RunGbpPostReport> {
  const problems: string[] = []
  const supabase = createServiceClient()

  // ─── 1. PRECONDITIONS, AVANT TOUT RESEAU ─────────────────────────────────
  const context = await openContext(input.campaignId)
  if (!context.ok) return postponed(context.reason, problems, context.refusalKind)

  const { campaign, site, siteId, accountId, locationId, scopes } = context.value

  // ─── 2. LE CORPUS RECENT, TOUTES ORIGINES ────────────────────────────────
  //
  // Les posts 'remote' — tapes a la main par le proprietaire sur sa fiche —
  // comptent au meme titre que les notres. Les ignorer ferait proposer de redire
  // ce que le proprietaire vient d'ecrire : le pire post possible, redondant ET
  // visiblement automatique.
  //
  // Lu AVANT l'insertion de la ligne, ce qui est ce qui empeche le gate de
  // comparer le brouillon a lui-meme quelques lignes plus bas.

  const recent = await loadRecentPosts(supabase, siteId)

  // ─── 3. LE DOUTE D'ABORD ─────────────────────────────────────────────────

  const doubt = await resolveDoubt(supabase, siteId, accountId, locationId, problems)
  if (doubt) return postponed(doubt, problems)

  // ─── 4. LA PAGE A ANNONCER ───────────────────────────────────────────────
  //
  // AVANT l'angle, et l'ordre n'est pas indifferent : `hasUnlinkedPublishedPage`
  // (angle 'nouvelle-page') EST l'existence de cette cible. La calculer deux
  // fois donnerait deux politiques de maillage.

  const linkTarget = await pickLinkTarget(
    supabase,
    siteId,
    linksInCooldown(recent),
    input.linkedGenerationId,
  )
  if (!linkTarget.ok) return postponed(linkTarget.reason, problems)

  // ─── 5. L'ANGLE ──────────────────────────────────────────────────────────

  const profile = await loadProfileFacts(supabase, siteId)
  const angle = chooseAngle(recent, describeAvailability(profile, campaign, true), input.angle)
  if (!angle.ok) return postponed(angle.reason, problems)

  // ─── 6. LE CONTEXTE GOOGLE ───────────────────────────────────────────────
  //
  // Null fait REPORTER, jamais generer a l'aveugle. Un post ecrit sans les faits
  // de la fiche est un post dont aucune phrase n'a de source — exactement ce que
  // le controle d'integrite factuelle refusera en aval, apres avoir ete paye.

  const gbpContext = await getGoogleContext(siteId)
  if (!gbpContext) {
    return postponed(
      'Aucune donnée Google pour ce site : synchronisez la fiche d’établissement avant de publier, '
        + 'un post écrit sans ses faits n’aurait aucune source.',
      problems,
    )
  }

  // ─── 7. LA REDACTION ─────────────────────────────────────────────────────

  const generated = await generateGbpPost({
    site,
    campaign,
    gbpContext,
    angle: angle.value,
    linkedGeneration: linkTarget.value,
    recentSummaries: recent.map(post => post.summary),
  })

  // ─── 8. LA TRACE, AVANT LA PUBLICATION ───────────────────────────────────

  const postId = await openPostRow(supabase, {
    siteId,
    campaign,
    calendarSlotId: input.calendarSlotId,
    linkTargetId: linkTarget.value.id,
    angle: angle.value,
    generated,
  })

  // ─── 9 a 11. GATE → CONNECTEUR → RECORD ──────────────────────────────────

  return gateThenPublish({
    supabase,
    postId,
    site,
    accountId,
    locationId,
    scopes,
    draft: {
      languageCode: 'fr',
      summary: generated.summary,
      topicType: GBP_TOPIC_TYPE,
      callToAction: { actionType: generated.ctaActionType, url: generated.ctaUrl },
    },
    angle: angle.value,
    linkedGenerationId: linkTarget.value.id,
    recent,
    profile,
    problems,
  })
}

// ─── Chemin 2 : reprendre ───────────────────────────────────────────────────

/** La ligne telle que la reprise a besoin de la lire. */
interface ResumeRow {
  id: string
  site_id: string
  campaign_id: string | null
  source: string
  status: string
  angle: string | null
  summary: string
  cta_action_type: string | null
  cta_url: string | null
  linked_generation_id: string | null
  remote_name: string | null
}

/**
 * Republie une ligne qui existe deja, sans rien reecrire.
 *
 * LE TEXTE N'EST PAS REGENERE, et c'est le point. L'operateur a lu ce resume
 * avant de cliquer ; lui en envoyer un autre publierait sur la fiche de son
 * client un post qu'il n'a jamais vu — et ferait payer une generation pour cela.
 *
 * LE GATE EST REJOUE, en revanche, et sur le corpus D'AUJOURD'HUI. Entre la
 * composition et la reprise, un post a pu paraitre sur la fiche : le verdict
 * d'hier ne dit rien de la fiche de maintenant.
 *
 * `remote_name` EST TRANSMIS AU CONNECTEUR quand la ligne en porte un. C'est le
 * rejeu idempotent : sa presence signifie « une ecriture a peut-etre deja
 * abouti », le connecteur relit avant d'ecrire, et rien ne part si le post
 * existe.
 */
async function resumeGbpPost(postId: string): Promise<RunGbpPostReport> {
  const problems: string[] = []
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('gbp_posts')
    .select('id, site_id, campaign_id, source, status, angle, summary, cta_action_type, cta_url, '
      + 'linked_generation_id, remote_name')
    .eq('id', postId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  const row = (data ?? null) as ResumeRow | null
  if (!row) return postponed('Post introuvable : rien à republier.', problems)

  if (row.source !== 'engine') {
    // Il est dans notre journal parce qu'il entre dans le corpus
    // d'anti-duplication, pas parce qu'il nous appartient.
    return postponed(
      'Ce post a été écrit à la main sur la fiche : le moteur le lit pour éviter de le redire, '
        + 'il ne le republie pas.',
      problems,
    )
  }

  const context = await openContext(row.campaign_id)
  if (!context.ok) return postponed(context.reason, problems, context.refusalKind)

  const { site, siteId, accountId, locationId, scopes } = context.value

  if (siteId !== row.site_id) {
    return postponed(
      'Ce post et sa campagne ne désignent pas le même site : la fiche visée est ambiguë, '
        + 'et publier sur la mauvaise fiche ne se corrige pas.',
      problems,
    )
  }

  // Le doute AVANT toute nouvelle ecriture, ici comme dans l'autre chemin.
  const doubt = await resolveDoubt(supabase, siteId, accountId, locationId, problems)
  if (doubt) return postponed(doubt, problems)

  // La reconciliation ci-dessus a pu publier CETTE ligne. Republier apres cela
  // creerait exactement le doublon qu'elle vient d'eviter.
  const settled = await readStatus(supabase, postId)
  if (settled === 'published') {
    return { postId, published: true, problems }
  }

  if (!isAngle(row.angle)) {
    // `gbp_posts_engine_needs_angle` l'interdit sur une ligne 'engine', donc
    // c'est une ligne ecrite hors du moteur ou par une version anterieure.
    // La rejuger demanderait de lui inventer un angle, et un angle invente
    // consommerait un cooldown qui n'est pas le sien.
    return postponed(
      'Ce post ne porte aucun angle connu : le contrôle d’originalité ne peut pas le juger, '
        + 'et publier sans ce contrôle est précisément ce que le moteur refuse.',
      problems,
    )
  }

  return gateThenPublish({
    supabase,
    postId,
    site,
    accountId,
    locationId,
    scopes,
    draft: {
      languageCode: 'fr',
      summary: row.summary,
      topicType: GBP_TOPIC_TYPE,
      ...(row.cta_action_type
        ? {
            callToAction: {
              // Cast assume, a la frontiere exacte que format.ts documente :
              // `cta_action_type` est un `text` NU (la migration 019 n'y pose
              // aucun CHECK) et `validateLocalPost` lit deliberement ce champ
              // comme une chaine pour pouvoir emettre GBP_ACTION_UNKNOWN.
              // Normaliser ici une valeur inconnue la rendrait inatteignable.
              actionType: row.cta_action_type as GbpActionType,
              ...(row.cta_url ? { url: row.cta_url } : {}),
            },
          }
        : {}),
    },
    angle: row.angle,
    linkedGenerationId: row.linked_generation_id,
    // Recharge : le verdict se rend contre la fiche d'aujourd'hui, et la ligne
    // elle-meme est retiree de la fenetre — sans quoi le gate la comparerait a
    // elle-meme et rendrait GBP_DUPLICATE_SUMMARY a coup sur.
    recent: (await loadRecentPosts(supabase, siteId, postId)),
    profile: await loadProfileFacts(supabase, siteId),
    problems,
    knownResourceName: row.remote_name ?? undefined,
  })
}

// ─── La fin commune : gate → connecteur → record ────────────────────────────

interface PublishStage {
  supabase: ReturnType<typeof createServiceClient>
  postId: string
  site: Site
  accountId: string
  locationId: string
  scopes: string[]
  draft: LocalPostDraft
  angle: GbpPostAngle
  linkedGenerationId: string | null
  recent: readonly RecentPost[]
  profile: GbpProfileFacts | null
  problems: string[]
  knownResourceName?: string
}

/**
 * Les trois dernieres etapes, ecrites UNE fois pour les deux chemins.
 *
 * Composer et reprendre different par ce qu'ils apportent — un texte neuf ou un
 * texte relu — jamais par ce qu'ils en font. Les dupliquer donnerait deux idees
 * de l'ordre gate → connecteur → record, et c'est cet ordre qui porte toute la
 * securite : juger avant d'ecrire, tracer apres avoir ecrit.
 */
async function gateThenPublish(stage: PublishStage): Promise<RunGbpPostReport> {
  const { supabase, postId, site, problems } = stage

  // ─── LE GATE ─────────────────────────────────────────────────────────────

  const verdict = await runGbpPostGate({
    draft: stage.draft,
    angle: stage.angle,
    linkedGenerationId: stage.linkedGenerationId,
    site,
    recentPosts: stage.recent,
    gbpProfile: stage.profile,
  })

  if (!verdict.publishable) {
    const refusalKind = qualifyRefusal(verdict.blocking.map(finding => finding.code))
    await closeRejected(supabase, postId, gbpRefusalMessage(verdict), refusalKind, problems)
    return { postId, published: false, refusalKind, problems }
  }

  problems.push(...verdict.warnings.map(finding => `${finding.code}: ${finding.message}`))

  // ─── LE CONNECTEUR ───────────────────────────────────────────────────────
  //
  // Le statut passe a 'publishing' AVANT l'appel : un processus qui meurt
  // pendant l'ecriture distante laisse ainsi une ligne qui dit « une ecriture
  // etait en cours », pas une ligne qui dit « rien n'a ete tente ».

  await markPublishing(supabase, postId, problems)

  const outcome = await gbpPostConnector.publish({
    site,
    connection: { accountId: stage.accountId, locationId: stage.locationId, scopes: stage.scopes },
    post: stage.draft,
    postId,
    ...(stage.knownResourceName ? { knownResourceName: stage.knownResourceName } : {}),
  })

  // ─── L'ENREGISTREMENT ────────────────────────────────────────────────────

  const refusalKind = qualifyFailure(outcome)
  const record = await recordGbpPost({
    postId,
    outcome,
    ...(refusalKind ? { refusalKind } : {}),
  })
  problems.push(...record.problems)

  return {
    postId,
    published: outcome.ok && outcome.live,
    ...(refusalKind ? { refusalKind } : {}),
    problems,
  }
}

// ─── Preconditions ──────────────────────────────────────────────────────────

/** Tout ce qu'il faut savoir avant d'avoir le droit d'ecrire sur une fiche. */
interface RunContext {
  campaign: Campaign
  site: Site
  siteId: string
  accountId: string
  locationId: string
  scopes: string[]
}

/**
 * Le resultat d'une etape qui peut, legitimement, ne rien rendre.
 *
 * UNE SEULE FORME pour les trois decisions de ce module — les identifiants, la
 * page a annoncer, l'angle — parce qu'elles se traitent toutes de la meme
 * facon : rendre le motif a l'appelant, qui l'affiche. `refusalKind` reste
 * optionnel parce que deux d'entre elles n'ont rien a qualifier : « aucune page
 * a annoncer » n'est ni un doublon, ni un quota, ni un defaut de format, et lui
 * coller un motif de la liste serait ecrire une valeur fausse dans une colonne
 * que l'operateur filtre.
 */
type Refusable<T> = { ok: true; value: T } | { ok: false; reason: string; refusalKind?: GbpRefusalKind }

/**
 * Les trois preconditions, verifiees AVANT TOUT RESEAU.
 *
 * AUCUNE LIGNE N'EST ECRITE ICI, et c'est delibere : aucun angle n'a encore ete
 * choisi, or `gbp_posts_engine_needs_angle` exige `angle` NOT NULL sur toute
 * ligne 'engine'. Une trace d'un refus qui PRECEDE le choix de l'angle n'est
 * donc pas representable dans cette table, et l'inventer demanderait d'y ecrire
 * un angle que personne n'a decide. Le motif remonte a l'appelant, qui l'affiche.
 *
 * `refusalKind: 'identifiants'` qualifie les trois : de l'autorisation qui
 * manque, jamais d'une panne. Une panne se rejoue toute seule ; celles-ci
 * attendent une action humaine.
 */
async function openContext(campaignId: string | null): Promise<Refusable<RunContext>> {
  if (!campaignId) {
    return {
      ok: false,
      reason: 'Ce post n’est rattaché à aucune campagne : aucune campagne n’a donc autorisé '
        + 'd’écrire sur cette fiche.',
      refusalKind: 'identifiants',
    }
  }

  const campaign = await getCampaignById(campaignId)
  if (!campaign) {
    return { ok: false, reason: 'Campagne introuvable : ce post n’a personne pour l’autoriser.' }
  }

  const site = campaign.site
  if (!site || !campaign.site_id) {
    return {
      ok: false,
      reason: 'Cette campagne n’est rattachée à aucun site : impossible de savoir sur quelle fiche publier.',
    }
  }

  if (campaign.gbp_posts_enabled !== true) {
    // Le cas NORMAL, pas une panne : la colonne vaut `false` par defaut et
    // aucune campagne ne se met a ecrire sur la fiche d'un client sans decision
    // explicite de son proprietaire.
    return {
      ok: false,
      reason: 'Les posts de fiche sont désactivés pour cette campagne.',
      refusalKind: 'identifiants',
    }
  }

  const siteId = campaign.site_id
  const connection = await getGoogleConnection(siteId)

  if (!connection?.gbp_account_id || !connection.gbp_location_id) {
    return {
      ok: false,
      reason: 'Aucune fiche d’établissement sélectionnée pour ce site : connectez le compte Google '
        + 'et choisissez la fiche avant de publier.',
      refusalKind: 'identifiants',
    }
  }

  if (!connection.scopes?.includes(BUSINESS_MANAGE_SCOPE)) {
    return {
      ok: false,
      reason: 'Le compte Google connecté n’autorise pas l’écriture sur la fiche (scope '
        + 'business.manage absent) : reconnectez-le pour accorder cette permission.',
      refusalKind: 'identifiants',
    }
  }

  return {
    ok: true,
    value: {
      campaign,
      site,
      siteId,
      accountId: connection.gbp_account_id,
      locationId: connection.gbp_location_id,
      scopes: connection.scopes,
    },
  }
}

/** Le statut d'une ligne, relu apres une etape qui a pu le changer. */
async function readStatus(
  supabase: ReturnType<typeof createServiceClient>,
  postId: string,
): Promise<string | null> {
  const { data, error } = await supabase.from('gbp_posts').select('status').eq('id', postId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { status: string } | null)?.status ?? null
}

// ─── Le corpus ──────────────────────────────────────────────────────────────

/** Une ligne de `gbp_posts` reduite a ce que la rotation interroge. */
interface RecentPostRow {
  angle: string | null
  summary: string
  linked_generation_id: string | null
  published_at: string | null
  source: string
}

/**
 * Les derniers posts de la fiche, du PLUS RECENT au plus ancien.
 *
 * `created_at DESC` et non `published_at DESC` : c'est le contrat d'ordre de
 * src/core/domain/gbp/rotation.ts, et sa raison tient en une ligne —
 * `published_at` est nul sur une ligne 'generated' ou 'rejected', et trier sur
 * une colonne nullable placerait les brouillons au hasard dans la fenetre.
 * L'index `gbp_posts_site_created_idx` existe exactement pour cette lecture.
 */
async function loadRecentPosts(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
  /**
   * La ligne a EXCLURE de la fenetre.
   *
   * Uniquement le chemin de reprise l'emploie, et il en a besoin : la ligne
   * qu'il republie est deja en base, et se comparer a soi-meme rend un cosinus
   * de 1 — donc `GBP_DUPLICATE_SUMMARY` a coup sur, donc un post correct refuse
   * pour la seule raison qu'on avait pris soin de le tracer avant de l'envoyer.
   */
  excludeId?: string,
): Promise<RecentPost[]> {
  let query = supabase
    .from('gbp_posts')
    .select('angle, summary, linked_generation_id, published_at, source')
    .eq('site_id', siteId)

  if (excludeId) query = query.neq('id', excludeId)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(RECENT_POST_WINDOW)

  if (error) throw new Error(error.message)

  return ((data ?? []) as RecentPostRow[]).map(row => ({
    // `angle` est un `text` en base et son CHECK autorise NULL : une valeur
    // hors union serait une ligne ecrite par une version anterieure, et la lire
    // comme un angle inconnu vaut mieux que la caster en un angle reel — elle
    // occuperait alors un cooldown qui n'est pas le sien.
    angle: isAngle(row.angle) ? row.angle : null,
    summary: row.summary,
    linkedGenerationId: row.linked_generation_id,
    publishedAt: row.published_at,
    source: row.source === 'remote' ? 'remote' : 'engine',
  }))
}

function isAngle(value: string | null): value is GbpPostAngle {
  return value !== null && (GBP_POST_ANGLES as readonly string[]).includes(value)
}

// ─── Le doute ───────────────────────────────────────────────────────────────

/** Une ligne dont l'ecriture distante n'a ni abouti ni echoue franchement. */
interface UncertainRow {
  id: string
  summary_fingerprint: string
  created_at: string
}

/**
 * Leve — ou constate — le doute laisse par une tentative precedente.
 *
 * Rend le MOTIF DE REPORT quand un doute subsiste, `null` quand la voie est
 * libre.
 *
 * PAS DE REJEU, JAMAIS. Une ligne 'incertain' signifie « la requete a pu
 * aboutir cote Google sans que nous en recevions la reponse ». La seule action
 * legitime est de RELIRE la fiche (un GET est idempotent) et d'apparier par
 * empreinte. Republier « pour voir » afficherait deux fois le meme post sur la
 * fiche d'un client, devant ses prospects.
 *
 * ET SI LE DOUTE PERSISTE, ON REPORTE. C'est volontairement bloquant : tant
 * qu'un humain n'a pas tranche, chaque nouvelle publication risque d'etre le
 * second exemplaire d'un post que nous ne savons pas reconnaitre. Un creneau
 * reporte se rattrape ; un doublon public, non.
 *
 * LIMITE ASSUMEE, ecrite parce qu'elle est invisible autrement : `fetchPosts`
 * rend `[]` aussi bien sur une fiche sans post que sur un appel refuse. Une
 * lecture ratee produit donc « aucun appariement », donc un report — jamais une
 * promotion en 'published'. Le sens de l'erreur est le bon : on ne conclut
 * jamais a un succes faute d'avoir pu regarder.
 */
async function resolveDoubt(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
  accountId: string,
  locationId: string,
  problems: string[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from('gbp_posts')
    .select('id, summary_fingerprint, created_at')
    .eq('site_id', siteId)
    .eq('status', 'incertain')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  const uncertain = (data ?? []) as UncertainRow[]
  if (uncertain.length === 0) return null

  const remotePosts = await readRemotePosts(siteId, accountId, locationId, problems)
  const claimed = await loadClaimedResourceNames(supabase, siteId)

  let resolved = 0
  for (const row of uncertain) {
    const match = remotePosts.find(post =>
      !claimed.has(post.name)
      && typeof post.summary === 'string'
      && fingerprintSummary(post.summary) === row.summary_fingerprint
      // `createTime` est optionnel sur `GbpLocalPost` : rien de ce que nous
      // ayons pu verifier ne garantit que Google le rende. Absent, l'empreinte
      // decide seule ; present, il doit etre POSTERIEUR a l'ouverture de la
      // ligne, sinon nous apparierions un vieux post du proprietaire avec notre
      // tentative d'aujourd'hui.
      && (!post.createTime || post.createTime >= row.created_at),
    )

    if (!match) continue

    claimed.add(match.name)
    const { error: updateError } = await supabase
      .from('gbp_posts')
      .update({
        status: 'published',
        remote_name: match.name,
        remote_search_url: match.searchUrl ?? null,
        remote_state: match.state ?? null,
        published_at: match.createTime ?? new Date().toISOString(),
        error_message: null,
        refusal_kind: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    if (updateError) {
      problems.push(`réconciliation non enregistrée pour ${row.id} : ${updateError.message}`)
      continue
    }
    resolved++
  }

  const remaining = uncertain.length - resolved
  if (remaining === 0) return null

  return `${remaining} publication(s) précédente(s) restent dans un état incertain sur cette fiche : `
    + 'l’écriture distante a pu aboutir sans que nous en recevions la réponse. Rien de nouveau '
    + 'n’est publié tant qu’un humain n’a pas ouvert la fiche et tranché — republier à l’aveugle '
    + 'afficherait deux fois le même post.'
}

/** Les posts reellement presents sur la fiche. `[]` couvre aussi l'echec de lecture. */
async function readRemotePosts(
  siteId: string,
  accountId: string,
  locationId: string,
  problems: string[],
): Promise<GbpLocalPost[]> {
  try {
    const { fetch: googleFetch } = await getAuthenticatedClient(siteId)
    return await fetchPosts(googleFetch, accountId, locationId)
  } catch (error) {
    problems.push(`relecture de la fiche impossible : ${message(error)}`)
    return []
  }
}

/** Les noms de ressource deja portes par une ligne : ils ne sont plus a prendre. */
async function loadClaimedResourceNames(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('gbp_posts')
    .select('remote_name')
    .eq('site_id', siteId)
    .not('remote_name', 'is', null)

  if (error) throw new Error(error.message)

  const names = new Set<string>()
  for (const row of (data ?? []) as Array<{ remote_name: string | null }>) {
    if (row.remote_name) names.add(row.remote_name)
  }
  return names
}

// ─── La page a annoncer ─────────────────────────────────────────────────────

/** Ce que le post annonce, tel que lib/ai/gbp-post.ts l'attend. */
interface LinkTarget {
  id: string
  title: string
  published_url: string
}


interface PublishedGenerationRow {
  id: string
  title: string | null
  published_url: string | null
}

/**
 * La generation publiee la plus recente qu'aucun post recent n'annonce.
 *
 * PRECONDITION VERIFIEE EN BASE, pas une intention :
 * `gbp_posts_engine_needs_link` refuse une ligne 'engine' sans
 * `linked_generation_id` des le statut 'generated'. Un post de fiche qui ne
 * renvoie nulle part ne fait venir aucun visiteur — c'est la seule chose qu'un
 * post soit reellement capable de faire.
 *
 * La suggestion de l'operateur est CONFRONTEE au cooldown, pas contournee : lui
 * laisser annoncer deux fois la meme page en trois jours donnerait, pour le
 * lecteur de la fiche, deux fois la meme annonce.
 */
async function pickLinkTarget(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
  blocked: ReadonlySet<string>,
  requestedId?: string,
): Promise<Refusable<LinkTarget>> {
  const { data, error } = await supabase
    .from('generations')
    .select('id, title, published_url')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(LINK_CANDIDATE_DEPTH)

  if (error) throw new Error(error.message)

  const candidates = ((data ?? []) as PublishedGenerationRow[])
    .filter((row): row is PublishedGenerationRow & { published_url: string } =>
      typeof row.published_url === 'string' && row.published_url.length > 0)

  if (requestedId) {
    const requested = candidates.find(row => row.id === requestedId)
    if (!requested) {
      return {
        ok: false,
        reason: 'La page demandée n’est pas une page publiée de ce site : un post ne peut annoncer '
          + 'qu’une adresse qui répond déjà.',
      }
    }
    if (blocked.has(requested.id)) {
      return {
        ok: false,
        reason: 'Cette page vient d’être annoncée par un post récent : deux annonces de la même page '
          + 'restent, pour le lecteur de la fiche, deux fois la même annonce.',
      }
    }
    return { ok: true, value: toLinkTarget(requested) }
  }

  const free = candidates.find(row => !blocked.has(row.id))
  if (!free) {
    return {
      ok: false,
      reason: candidates.length === 0
        ? 'Aucune page publiée à annoncer : un post de fiche renvoie vers une page du site, et ce '
          + 'site n’en a encore aucune en ligne.'
        : 'Toutes les pages publiées viennent d’être annoncées par les derniers posts : le créneau '
          + 'est reporté plutôt que de répéter une annonce.',
    }
  }

  return { ok: true, value: toLinkTarget(free) }
}

function toLinkTarget(row: PublishedGenerationRow & { published_url: string }): LinkTarget {
  return {
    id: row.id,
    // Un titre vide ne bloque pas la publication : l'adresse suffit a annoncer,
    // et refuser un post pour une colonne de confort arreterait le moteur au
    // motif qu'une donnee manque.
    title: row.title?.trim() || 'la dernière page publiée',
    published_url: row.published_url,
  }
}

// ─── L'angle ────────────────────────────────────────────────────────────────

/**
 * Ce que la fiche permet REELLEMENT de dire.
 *
 * `hasRealReviews` se lit sur `reviews_summary.recent_positive`, la forme que
 * `summarizeReviews` produit reellement (lib/google/gbp.ts) : un tableau non
 * vide de commentaires. Une note sans commentaire ne suffit pas — l'angle 'avis'
 * a besoin de quelque chose a raconter, pas d'un chiffre.
 *
 * `hasDeclaredHours` et `hasServiceArea` ferment leur angle quand la source
 * n'existe PAS : un post sur des horaires non declares ou une zone inconnue est
 * une invention, refusee en aval par l'integrite factuelle du gate — apres avoir
 * ete payee.
 *
 * `hasNamedServices` reste volontairement NON RENSEIGNE, donc « disponible » :
 * `campaign.business_type` est toujours renseigne et il EST un service nomme,
 * declare par le proprietaire. Le fermer sur l'absence de categories Google
 * fermerait l'angle le plus sur du produit sur une donnee de confort.
 */
function describeAvailability(
  profile: GbpProfileFacts | null,
  campaign: Campaign,
  hasUnlinkedPublishedPage: boolean,
): AngleAvailability {
  const availability: AngleAvailability = {
    hasRealReviews: hasRealReviews(profile),
    hasUnlinkedPublishedPage,
    hasServiceArea: campaign.communes.length > 0,
  }

  // Renseigne SEULEMENT quand la fiche a ete lue : sans ligne `gbp_profiles`,
  // « pas d'horaires » et « pas encore synchronise » sont indiscernables, et le
  // defaut optionnel de rotation.ts existe pour ne pas trancher a leur place.
  if (profile) availability.hasDeclaredHours = Boolean(profile.hours)

  return availability
}

function hasRealReviews(profile: GbpProfileFacts | null): boolean {
  const summary = profile?.reviews_summary
  if (typeof summary !== 'object' || summary === null) return false

  const recent = (summary as { recent_positive?: unknown }).recent_positive
  return Array.isArray(recent) && recent.some(item => typeof item === 'string' && item.trim().length > 0)
}

/**
 * L'angle a servir, suggestion de l'operateur comprise.
 *
 * Une suggestion est VALIDEE par `describeAngles`, la meme fonction qui alimente
 * l'ecran de composition : l'operateur ne voit donc jamais un angle propose ici
 * et refuse la. La politique de fermeture n'est ecrite qu'une fois.
 */
function chooseAngle(
  recent: readonly RecentPost[],
  availability: AngleAvailability,
  requested?: GbpPostAngle,
): Refusable<GbpPostAngle> {
  if (requested) {
    const option = describeAngles(recent, availability).find(entry => entry.angle === requested)
    if (!option || !option.available) {
      return {
        ok: false,
        reason: `L’angle « ${requested} » n’est pas disponible (${option?.reason ?? 'angle inconnu'}).`,
      }
    }
    return { ok: true, value: requested }
  }

  const chosen = nextAngle(recent, availability)
  if (!chosen) {
    return {
      ok: false,
      reason: 'Créneau reporté : les derniers posts ont déjà utilisé tous les angles que cette fiche '
        + 'permet de servir.',
    }
  }
  return { ok: true, value: chosen }
}

// ─── Le profil ──────────────────────────────────────────────────────────────

/**
 * La ligne `gbp_profiles`, transportee entiere jusqu'au gate.
 *
 * Ni projection intermediaire ni objet taille sur mesure : `GbpProfileFacts`
 * (lib/publishing/gbp/gate.ts) declare exactement les trois colonnes qui
 * l'interessent, et c'est lui qui les lit defensivement. `null` n'est PAS un
 * motif de refus — un post qui n'affirme aucun chiffre passe sans profil.
 */
async function loadProfileFacts(
  supabase: ReturnType<typeof createServiceClient>,
  siteId: string,
): Promise<GbpProfileFacts | null> {
  const { data, error } = await supabase
    .from('gbp_profiles')
    .select('reviews_summary, categories, hours')
    .eq('site_id', siteId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as GbpProfileFacts | null
}

// ─── La ligne ───────────────────────────────────────────────────────────────

interface OpenRowInput {
  siteId: string
  campaign: Campaign
  calendarSlotId?: string
  linkTargetId: string
  angle: GbpPostAngle
  generated: { summary: string; ctaActionType: string; ctaUrl: string; model: string }
}

/**
 * Ouvre la ligne en 'generated', AVANT toute publication.
 *
 * `summary_fingerprint` est pose ici et jamais recalcule ailleurs : c'est
 * l'unique clef qui permettra, apres un delai depasse, de reconnaitre sur la
 * fiche le post que l'API a peut-etre cree. Une ligne sans empreinte est une
 * ligne qu'aucune reconciliation ne pourra jamais lever.
 *
 * JETTE si l'INSERT echoue, et c'est le bon sens : rien n'a encore ete envoye a
 * Google, donc echouer ici ne laisse aucun post orphelin. C'est l'inverse exact
 * de `recordGbpPost`, qui ne jette jamais parce qu'a ce moment-la le post est
 * peut-etre deja sur la fiche.
 */
async function openPostRow(
  supabase: ReturnType<typeof createServiceClient>,
  input: OpenRowInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('gbp_posts')
    .insert({
      site_id: input.siteId,
      campaign_id: input.campaign.id,
      calendar_slot_id: input.calendarSlotId ?? null,
      linked_generation_id: input.linkTargetId,
      source: 'engine',
      angle: input.angle,
      summary: input.generated.summary,
      summary_fingerprint: fingerprintSummary(input.generated.summary),
      language_code: 'fr',
      cta_action_type: input.generated.ctaActionType,
      cta_url: input.generated.ctaUrl,
      status: 'generated',
      ai_model: input.generated.model,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Ligne gbp_posts non ouverte : ${error.message}`)
  return (data as { id: string }).id
}

/**
 * Le passage en 'publishing', best-effort.
 *
 * Un echec ici ne doit PAS empecher la publication : la ligne existe deja avec
 * son resume et son empreinte, ce qui suffit a la retrouver. Faire echouer le
 * run sur un statut intermediaire couterait le post pour un detail de journal.
 */
async function markPublishing(
  supabase: ReturnType<typeof createServiceClient>,
  postId: string,
  problems: string[],
): Promise<void> {
  const { error } = await supabase
    .from('gbp_posts')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', postId)

  if (error) problems.push(`statut 'publishing' non enregistré : ${error.message}`)
}

/**
 * Ferme la ligne sur un refus du gate.
 *
 * `error_message` recoit `gbpRefusalMessage(verdict)`, la MEME mise en forme
 * `CODE: phrase` que pour une page refusee : un operateur qui parcourt les
 * publications refusees lit une seule forme, quel que soit le canal.
 */
async function closeRejected(
  supabase: ReturnType<typeof createServiceClient>,
  postId: string,
  reason: string,
  refusalKind: GbpRefusalKind,
  problems: string[],
): Promise<void> {
  const { error } = await supabase
    .from('gbp_posts')
    .update({
      status: 'rejected',
      refusal_kind: refusalKind,
      error_message: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)

  if (error) problems.push(`refus non enregistré : ${error.message}`)
}

// ─── Qualification ──────────────────────────────────────────────────────────

/** Les codes que le domaine emet quand un brouillon redit quelque chose. */
const ORIGINALITY_CODES: readonly string[] = [
  'GBP_NO_LINK',
  'GBP_ANGLE_COOLDOWN',
  'GBP_LINK_COOLDOWN',
  'GBP_DUPLICATE_SUMMARY',
]

/**
 * Le motif d'un refus du gate, contraint par `gbp_posts_refusal_check`.
 *
 * DEUX VALEURS ET PAS UNE. La spec initiale proposait d'ecrire 'doublon' quel
 * que soit le blocage — d'abord ce mot n'existe pas dans le CHECK (qui enumere
 * 'duplicat', 'identifiants', 'quota', 'format'), ensuite il serait FAUX sur la
 * moitie des cas : un resume trop long ou un bouton vers un domaine etranger
 * n'est pas un doublon, c'est un defaut de format. Ecrire un motif faux dans une
 * colonne que l'operateur filtre lui fait chercher au mauvais endroit.
 */
function qualifyRefusal(codes: readonly string[]): GbpRefusalKind {
  return codes.some(code => ORIGINALITY_CODES.includes(code)) ? 'duplicat' : 'format'
}

/**
 * Le motif d'un ECHEC du connecteur, quand ce depot sait le nommer.
 *
 * 'quota' est reconnu par identite avec `GBP_QUOTA_MESSAGE`, la phrase unique du
 * produit pour ce cas (lib/google/sync.ts) : la comparer plutot que de la
 * recopier est ce qui garantit que les deux restent la meme.
 *
 * LIMITE ASSUMEE POUR 'format' : `PublishOutcome` ne transporte AUCUN statut
 * HTTP — c'est un choix de lib/publishing/outcome.ts, partage avec les deux
 * connecteurs de page — donc un 400 ne se distingue pas ici d'un 500. Plutot
 * qu'inventer un motif sur une supposition, on n'en ecrit aucun : le corps
 * verbatim de la reponse, lui, arrive bien dans `error_message` via
 * `outcome.error`, et c'est la seule preuve qui compte pour lever les mentions
 * « a confirmer contre l'API reelle » de format.ts.
 */
function qualifyFailure(outcome: PublishOutcome): GbpRefusalKind | undefined {
  if (outcome.ok) return undefined
  if (outcome.error === GBP_QUOTA_MESSAGE) return 'quota'
  return undefined
}

// ─── Rapports ───────────────────────────────────────────────────────────────

function postponed(reason: string, problems: string[], refusalKind?: GbpRefusalKind): RunGbpPostReport {
  return {
    published: false,
    reported: reason,
    ...(refusalKind ? { refusalKind } : {}),
    problems,
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
