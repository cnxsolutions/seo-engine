// ─────────────────────────────────────────────────────────────────────────────
// Le calendrier des posts de fiche
// SEO Engine - GBP
// « Quand un post peut-il partir, et lequel ? »
// ─────────────────────────────────────────────────────────────────────────────
//
// UN SEUL CALENDRIER, UN DISCRIMINANT. Un creneau de post est une ligne
// `editorial_calendar` portant `artifact_kind = 'gbp_post'`, `page_type` NULL et
// `target_keyword` NULL — exactement ce que `editorial_calendar_page_type_check`
// et `editorial_calendar_target_keyword_check` (migration 019) autorisent pour ce
// genre, et interdisent pour une page. En creer une seconde table dupliquerait la
// reclamation de creneau, le budget de tentatives (`attempt_count`) et l'ecran
// /calendar : trois mecanismes eprouves, reecrits une seconde fois pour diverger.
//
// OPT-IN STRICT. `campaigns.gbp_posts_enabled` vaut `false` par defaut en base et
// rien ne se planifie sans lui. Une campagne qui n'a rien decide n'ecrit pas sur
// la fiche etablissement d'un client : ce n'est pas une panne, c'est le cas
// normal, et c'est le seul defaut acceptable pour une ecriture publique faite au
// nom de quelqu'un d'autre.
//
// LE PLAFOND EST UN AVEU D'IGNORANCE, PAS UNE OPTIMISATION. Deux posts par
// semaine ISO, en dur. Le quota reellement accorde au projet Google Cloud est
// INCONNU depuis ce depot — le defaut documente est de zero requete par minute
// tant que l'« Application For Basic API Access » n'est pas approuvee, et aucun
// appel d'ecriture n'a jamais pu etre passe. Voir docs/gbp-acces-api.md. Coder
// une cadence plus ambitieuse deguiserait une supposition en regle.
//
// LES COOLDOWNS S'APPLIQUENT AVANT L'INSERTION. Un creneau qu'on sait deja
// condamne a etre reporte n'est pas un creneau, c'est une ligne rouge de plus
// dans le calendrier de l'operateur. La politique — sept angles, cooldown
// d'angle, cooldown de lien — vit dans src/core/domain/gbp/rotation.ts ; ce
// module l'INTERROGE et n'en recopie aucune valeur.
//
// AUCUNE STATISTIQUE N'EST PROMISE NULLE PART : `localPosts.reportInsights` est
// supprime depuis fevrier 2023, et rien ici ne mesure l'effet d'un post.

import { getCampaignById } from '@/lib/db'
import { getGoogleConnection } from '@/lib/google/client'
import type { GbpProfileFacts } from '@/lib/publishing/gbp/gate'
import { formatLocalDate } from '@/lib/scheduler/editorial'
import { createServiceClient } from '@/lib/supabase'
import type { Campaign } from '@/lib/types'
import {
  describeAngles,
  GBP_POST_ANGLES,
  linksInCooldown,
  RECENT_POST_WINDOW,
  type AngleAvailability,
  type AngleUnavailability,
  type GbpPostAngle,
  type RecentPost,
} from '@/src/core/domain/gbp/rotation'
import type { GbpEligibility, GbpLinkTarget } from '@/app/api/gbp/posts/feed-types'
import type { RunGbpPostReport } from './run'

type ServiceClient = ReturnType<typeof createServiceClient>

// ─── Les seules constantes de ce module ─────────────────────────────────────

/**
 * Posts autorises par semaine ISO, toutes origines du moteur confondues.
 *
 * DEUX, et le nombre est arbitraire au sens strict : il ne derive d'aucun quota
 * connu. C'est precisement pourquoi il est BAS. Le seul chiffre que ce depot
 * puisse citer est le quota par defaut de l'API — zero requete par minute tant
 * que l'acces de base n'est pas accorde — et un plafond genereux pose sur cette
 * base serait une promesse que personne ici n'est en mesure de tenir.
 *
 * A CONFIRMER CONTRE L'API REELLE, comme les constantes de format : le jour ou
 * un quota est reellement accorde, c'est cette valeur qu'il faut relire.
 */
export const GBP_WEEKLY_POST_CAP = 2

/**
 * Profondeur de planification, en jours.
 *
 * Quatre semaines ISO : assez pour qu'un operateur voie venir le rythme, assez
 * peu pour que la planification reste une PREVISION revisable. Planifier un
 * trimestre a partir des cooldowns d'aujourd'hui donnerait des creneaux calcules
 * sur un corpus qui n'existera plus.
 */
export const GBP_PLAN_HORIZON_DAYS = 28

/**
 * Cadence retenue quand la campagne n'en porte aucune.
 *
 * Miroir du `DEFAULT 7` de `campaigns.gbp_post_cadence_days` (migration 019).
 * Une valeur de repli est inevitable : la colonne est optionnelle cote
 * TypeScript, parce qu'un createur de campagne qui ne decide rien ne l'ecrit
 * pas — et un `undefined` en arithmetique de dates produit des « Invalid Date »
 * silencieuses.
 */
export const GBP_DEFAULT_CADENCE_DAYS = 7

/**
 * Combien de generations publiees sont examinees pour trouver une page a
 * annoncer.
 *
 * PROFONDEUR DE LECTURE, pas politique : la politique est `linksInCooldown`.
 * Meme valeur que la lecture equivalente de run.ts, pour que l'ecran et le
 * moteur regardent le meme lot de candidates.
 */
const GBP_LINK_CANDIDATE_DEPTH = 40

/**
 * Le scope OAuth sans lequel aucune ecriture de fiche n'est possible.
 *
 * Declare ici plutot qu'importe de `lib/publishing/gbp/connector.ts` (qui
 * l'exporte sous `GBP_MANAGE_SCOPE`) : cet import tirerait tout le chemin
 * d'ECRITURE — lib/google/sync, lib/google/gbp, le connecteur — dans un module
 * dont le seul travail est de lire un calendrier. C'est une constante de Google,
 * pas un seuil du produit ; elle disparaitra d'ici le jour ou lib/google/auth.ts
 * exportera sa liste de scopes.
 */
const BUSINESS_MANAGE_SCOPE = 'https://www.googleapis.com/auth/business.manage'

// ─── Planification ──────────────────────────────────────────────────────────

export interface PlanGbpPostSlotsReport {
  /** Creneaux reellement inseres. */
  created: number
  /**
   * Ce qui n'a PAS ete planifie, et pourquoi, en francais.
   *
   * Un plafond silencieux se lit exactement comme « il n'y avait rien a faire ».
   */
  skipped: string[]
}

/**
 * Planifie les prochains creneaux de post d'une campagne.
 *
 * NE JETTE PAS sur les refus previsibles — campagne absente, opt-in absent,
 * aucun angle ouvert, aucune page a annoncer rendent tous un rapport. Une erreur
 * d'ECRITURE, elle, remonte : l'appelant doit savoir que le calendrier n'a pas
 * ete rempli.
 *
 * IDEMPOTENTE PAR CONSTRUCTION. Les creneaux deja poses sont relus, comptes dans
 * le plafond hebdomadaire et leurs dates sont exclues : deux appels le meme jour
 * ne produisent pas deux series.
 */
export async function planGbpPostSlots(
  campaignId: string,
  opts?: { now?: Date },
): Promise<PlanGbpPostSlotsReport> {
  const now = opts?.now ?? new Date()
  const campaign = await getCampaignById(campaignId)

  if (!campaign) {
    return { created: 0, skipped: ['Campagne introuvable : aucun créneau de post planifié.'] }
  }

  // OPT-IN STRICT, et c'est le premier controle du fichier a dessein : rien
  // au-dela de cette ligne ne doit couter une requete a une campagne qui n'a
  // rien demande.
  if (campaign.gbp_posts_enabled !== true) {
    return {
      created: 0,
      skipped: ['Les posts de fiche sont désactivés pour cette campagne : aucun créneau planifié.'],
    }
  }

  if (!campaign.site_id) {
    return {
      created: 0,
      skipped: ['Cette campagne n’est rattachée à aucun site : impossible de savoir sur quelle fiche publier.'],
    }
  }

  const supabase = createServiceClient()
  const siteId = campaign.site_id
  const cadence = cadenceDaysOf(campaign)
  const skipped: string[] = []

  // ─── Ce que la fiche permet de dire aujourd'hui ──────────────────────────

  const recent = await loadRecentGbpPosts(supabase, siteId)
  const [profile, links, writes] = await Promise.all([
    loadGbpProfileFacts(supabase, siteId),
    loadLinkCandidates(supabase, siteId),
    readRecentWrites(supabase, siteId, now),
  ])

  const blockedLinks = linksInCooldown(recent)
  const freeLinks = links.filter(link => !blockedLinks.has(link.id))
  const options = describeAngles(recent, describeAngleAvailability(profile, campaign, freeLinks.length > 0))
  const openAngles = options.filter(option => option.available)

  // LES DEUX COOLDOWNS, APPLIQUES AVANT LA MOINDRE INSERTION. Un creneau pose
  // alors qu'aucun angle n'est ouvert ou qu'aucune page n'est annoncable ne
  // produira jamais qu'un report : il occupe une date, il alarme l'operateur, et
  // il ne publie rien.
  if (openAngles.length === 0) {
    skipped.push(
      'Aucun angle disponible : les derniers posts ont déjà utilisé tout ce que cette fiche permet de dire.',
    )
    return { created: 0, skipped }
  }

  if (freeLinks.length === 0) {
    skipped.push(
      links.length === 0
        ? 'Aucune page publiée à annoncer : un post de fiche renvoie vers une page du site, et ce site n’en a encore aucune en ligne.'
        : 'Toutes les pages publiées viennent d’être annoncées : un créneau de plus ne ferait que répéter une annonce.',
    )
    return { created: 0, skipped }
  }

  // ─── Le registre de la semaine ISO ───────────────────────────────────────

  // Lu depuis un mois en arriere et non depuis lundi : les dates passees ne
  // peuvent plus etre choisies, mais elles portent la CADENCE — un creneau pose
  // il y a trois jours interdit d'en poser un aujourd'hui.
  //
  // LIMITE ASSUMEE : un creneau en retard (le scheduler etait arrete) est compte
  // dans SA semaine, pas dans celle ou il finira par tourner. Le plafond est une
  // regle de PLANIFICATION ; le verrou d'execution, lui, est
  // `gbpWeeklyCapReached`, interroge juste avant chaque run.
  const readFrom = addDays(startOfLocalDay(now), -RECENT_WRITES_DAYS)
  const existingDates = await loadGbpSlotDates(supabase, campaign.id, formatLocalDate(readFrom))
  const usage = new Map<string, number>()
  const occupied = new Set<string>()

  for (const date of existingDates) {
    occupied.add(date)
    bump(usage, isoWeekKey(parseLocalDate(date)))
  }

  // Les posts composes A LA MAIN depuis l'ecran n'ont aucun creneau et pesent
  // pourtant sur la meme fiche. Les ignorer ferait du plafond « deux creneaux
  // par semaine » au lieu de « deux posts par semaine », et c'est le second que
  // le quota inconnu de Google nous demande de tenir.
  if (writes.unslottedThisIsoWeek > 0) {
    const currentWeek = isoWeekKey(startOfLocalDay(now))
    usage.set(currentWeek, (usage.get(currentWeek) ?? 0) + writes.unslottedThisIsoWeek)
  }

  // ─── Les dates ───────────────────────────────────────────────────────────

  const today = startOfLocalDay(now)
  const horizon = addDays(today, GBP_PLAN_HORIZON_DAYS)
  const budget = Math.min(openAngles.length, freeLinks.length)
  const cappedWeeks = new Set<string>()
  const dates: string[] = []

  let cursor = firstCandidateDay(today, existingDates, writes.lastWriteAt, cadence)

  while (cursor <= horizon) {
    if (dates.length >= budget) {
      skipped.push(
        `${budget} créneau(x) planifié(s) au plus : la fiche n’ouvre aujourd’hui que `
          + `${openAngles.length} angle(s) et ${freeLinks.length} page(s) à annoncer.`,
      )
      break
    }

    const week = isoWeekKey(cursor)
    if ((usage.get(week) ?? 0) >= GBP_WEEKLY_POST_CAP) {
      cappedWeeks.add(week)
      // Au lundi suivant, et non au lendemain : la semaine est pleine tout
      // entiere, et avancer d'un jour ne ferait que reposer la meme question
      // six fois.
      cursor = nextIsoMonday(cursor)
      continue
    }

    const day = formatLocalDate(cursor)
    if (!occupied.has(day)) {
      dates.push(day)
      occupied.add(day)
      bump(usage, week)
    }

    cursor = addDays(cursor, cadence)
  }

  if (cappedWeeks.size > 0) {
    skipped.push(
      `Plafond de ${GBP_WEEKLY_POST_CAP} post(s) par semaine ISO atteint sur : `
        + `${[...cappedWeeks].sort().join(', ')}.`,
    )
  }

  if (dates.length === 0) {
    if (skipped.length === 0) {
      skipped.push('Aucune date libre dans l’horizon de planification : le calendrier est déjà pourvu.')
    }
    return { created: 0, skipped }
  }

  // `page_type` et `target_keyword` sont ECRITS A NULL plutot qu'omis : la
  // migration 019 les EXIGE nuls sur un creneau de post, et les nommer dans la
  // charge utile est ce qui rend le contrat lisible sur le site d'ecriture
  // plutot que dans un CHECK.
  const { error } = await supabase.from('editorial_calendar').insert(
    dates.map(scheduled_date => ({
      campaign_id: campaign.id,
      scheduled_date,
      artifact_kind: 'gbp_post',
      page_type: null,
      target_keyword: null,
      status: 'planned',
    })),
  )

  if (error) throw new Error(`Créneaux de post non planifiés : ${error.message}`)

  return { created: dates.length, skipped }
}

/**
 * Planifie toutes les campagnes qui ont dit oui.
 *
 * Existe parce que le scheduler ne doit PAS apprendre a reconnaitre une campagne
 * qui a consenti : `gbp_posts_enabled` est une colonne de la migration 019, et la
 * connaissance de 019 s'arrete a ce dossier. Une table absente ne fait donc pas
 * tomber le tick — elle rend un rapport qui le dit.
 */
export async function planDueGbpPostSlots(opts?: { now?: Date }): Promise<PlanGbpPostSlotsReport> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('is_active', true)
    .eq('gbp_posts_enabled', true)

  if (error) {
    return { created: 0, skipped: [`Campagnes non lues : ${error.message}`] }
  }

  const report: PlanGbpPostSlotsReport = { created: 0, skipped: [] }

  for (const row of (data ?? []) as Array<{ id: string }>) {
    // Une campagne qui echoue n'emporte pas les autres : le calendrier des
    // suivantes n'a rien a voir avec sa panne.
    try {
      const one = await planGbpPostSlots(row.id, opts)
      report.created += one.created
      report.skipped.push(...one.skipped.map(reason => `${row.id} : ${reason}`))
    } catch (error) {
      report.skipped.push(`${row.id} : ${messageOf(error)}`)
    }
  }

  return report
}

// ─── Ce que le moteur peut faire maintenant ─────────────────────────────────

/**
 * L'eligibilite d'un site, calculee cote serveur et jamais devinee par la vue.
 *
 * `GbpEligibility` est declaree dans app/api/gbp/posts/feed-types.ts et importee
 * ici, pas redeclaree : la vue, la route et cette politique doivent lire la meme
 * structure, sinon `anglesBlocked` finit par porter des motifs que l'ecran ne
 * sait pas rendre.
 *
 * NE JETTE PAS pour un site sans connexion Google : elle rend
 * `credentialsReady: false` et un `blockedReason` qui NOMME ce qui manque. Une
 * panne de lecture, elle, remonte — l'appelant la traduit en « politique
 * indisponible » et garde la file lisible.
 */
export async function describeGbpEligibility(
  siteId: string,
  opts?: { now?: Date },
): Promise<GbpEligibility> {
  const now = opts?.now ?? new Date()
  const supabase = createServiceClient()

  const campaign = await pickGbpCampaign(supabase, siteId)
  const connection = await getGoogleConnection(siteId)
  const recent = await loadRecentGbpPosts(supabase, siteId)
  const [profile, links, writes] = await Promise.all([
    loadGbpProfileFacts(supabase, siteId),
    loadLinkCandidates(supabase, siteId),
    readRecentWrites(supabase, siteId, now),
  ])

  const blockedLinks = linksInCooldown(recent)
  const freeLinks = links.filter(link => !blockedLinks.has(link.id))
  const options = describeAngles(recent, describeAngleAvailability(profile, campaign, freeLinks.length > 0))

  const enabled = campaign?.gbp_posts_enabled === true
  const credentialsReady = Boolean(
    connection?.gbp_account_id
    && connection.gbp_location_id
    && connection.scopes?.includes(BUSINESS_MANAGE_SCOPE),
  )

  const anglesAvailable = options.filter(option => option.available).map(option => option.angle)
  const anglesBlocked = options
    .filter(option => !option.available)
    .map(option => ({
      angle: option.angle,
      reason: option.reason ? ANGLE_BLOCKED_LABELS[option.reason] : 'indisponible',
    }))

  return {
    enabled,
    credentialsReady,
    anglesAvailable,
    anglesBlocked,
    nextLinkTarget: freeLinks[0] ?? null,
    cadenceDays: campaign ? cadenceDaysOf(campaign) : GBP_DEFAULT_CADENCE_DAYS,
    postsThisIsoWeek: writes.postsThisIsoWeek,
    weeklyCap: GBP_WEEKLY_POST_CAP,
    blockedReason: firstBlockedReason({
      enabled,
      credentialsReady,
      connection,
      anglesAvailable,
      hasLink: freeLinks.length > 0,
      hasPublishedPage: links.length > 0,
      postsThisIsoWeek: writes.postsThisIsoWeek,
    }),
  }
}

/** Le motif francais de fermeture d'un angle, pret a afficher. */
const ANGLE_BLOCKED_LABELS: Record<AngleUnavailability, string> = {
  'angle-en-cooldown': 'déjà servi par un des derniers posts',
  'aucun-avis-reel': 'aucun avis avec commentaire sur la fiche',
  'aucune-page-a-annoncer': 'aucune page publiée qui ne vienne d’être annoncée',
  'aucun-horaire-declare': 'aucun horaire déclaré sur la fiche',
  'aucune-zone-declaree': 'aucune commune déclarée sur la campagne',
  'aucun-service-declare': 'aucun service nommé',
}

interface BlockedInput {
  enabled: boolean
  credentialsReady: boolean
  connection: { gbp_account_id: string | null; gbp_location_id: string | null; scopes: string[] } | null
  anglesAvailable: readonly GbpPostAngle[]
  hasLink: boolean
  hasPublishedPage: boolean
  postsThisIsoWeek: number
}

/**
 * La PREMIERE raison qui empeche un post de partir, ou null.
 *
 * Une seule phrase, dans l'ordre ou l'operateur peut agir : ce qu'il decide
 * (l'opt-in), ce qu'il branche (le compte Google), ce qu'il attend (le plafond),
 * puis ce que la fiche ne permet pas encore de dire. Lui en afficher cinq
 * l'obligerait a deviner par laquelle commencer.
 */
function firstBlockedReason(input: BlockedInput): string | null {
  if (!input.enabled) {
    return 'Les posts de fiche sont désactivés pour ce site : activez-les sur la campagne pour que le moteur puisse écrire sur la fiche.'
  }

  if (!input.credentialsReady) {
    if (!input.connection) {
      return 'Aucun compte Google connecté pour ce site : connectez-le avant de publier sur la fiche.'
    }
    if (!input.connection.gbp_account_id || !input.connection.gbp_location_id) {
      return 'Aucune fiche d’établissement sélectionnée pour ce site : choisissez la fiche à alimenter.'
    }
    return 'Le compte Google connecté n’autorise pas l’écriture sur la fiche (scope business.manage absent) : reconnectez-le pour accorder cette permission.'
  }

  if (input.postsThisIsoWeek >= GBP_WEEKLY_POST_CAP) {
    return `Plafond atteint : ${input.postsThisIsoWeek} post(s) cette semaine ISO pour un maximum de ${GBP_WEEKLY_POST_CAP}. `
      + 'Le quota réellement accordé par Google est inconnu depuis ce produit, et ce plafond est la prudence qui en tient lieu.'
  }

  if (!input.hasPublishedPage) {
    return 'Aucune page publiée à annoncer : un post de fiche renvoie vers une page du site, et ce site n’en a encore aucune en ligne.'
  }

  if (!input.hasLink) {
    return 'Toutes les pages publiées viennent d’être annoncées par les derniers posts : deux annonces de la même page restent, pour le lecteur de la fiche, deux fois la même annonce.'
  }

  if (input.anglesAvailable.length === 0) {
    return 'Aucun angle disponible : les derniers posts ont déjà utilisé tout ce que cette fiche permet de dire.'
  }

  return null
}

/**
 * Le plafond hebdomadaire, verifie JUSTE AVANT un run, ou `null`.
 *
 * LE VERROU D'EXECUTION, la ou `planGbpPostSlots` n'est qu'une regle de
 * planification. Entre le jour ou un creneau est pose et celui ou il tourne, un
 * operateur a pu composer des posts a la main depuis l'ecran : sans cette
 * relecture, la semaine deborderait sans que personne n'ait desobei.
 *
 * UNE SEULE LECTURE, et c'est ce qui la rend appelable a chaque tick.
 */
export async function gbpWeeklyCapReached(
  siteId: string,
  opts?: { now?: Date },
): Promise<string | null> {
  const now = opts?.now ?? new Date()
  const writes = await readRecentWrites(createServiceClient(), siteId, now)

  if (writes.postsThisIsoWeek < GBP_WEEKLY_POST_CAP) return null

  return `Créneau reporté : ${writes.postsThisIsoWeek} post(s) déjà écrit(s) cette semaine ISO pour un plafond de `
    + `${GBP_WEEKLY_POST_CAP}. Le quota réellement accordé par Google est inconnu depuis ce produit, et ce `
    + 'plafond est la prudence qui en tient lieu.'
}

// ─── Ce qu'un run fait au creneau qui l'a declenche ─────────────────────────

/**
 * La modification a appliquer au creneau apres un run, sans aucune ecriture.
 *
 * Volontairement une VALEUR et non un effet : c'est la seule forme qui rende la
 * regle « un report ne brule pas de tentative » verifiable sans monter tout le
 * scheduler, et c'est cette regle qui empeche trois reports consecutifs de tuer
 * un creneau auquel rien n'est arrive.
 */
export interface GbpSlotPatch {
  status: 'planned' | 'published' | 'failed'
  error_message?: string
  /** Renseigne UNIQUEMENT sur un report : la tentative est rendue au creneau. */
  attempt_count?: number
  /** Renseigne UNIQUEMENT sur un report : la date recule d'un jour. */
  scheduled_date?: string
  gbp_post_id?: string
}

/**
 * Ce que devient un creneau de post apres un passage du moteur.
 *
 * TROIS ISSUES, ET UNE SEULE REND LA TENTATIVE.
 *
 * REPORT (`postId` absent) — la politique n'avait rien a dire : aucun angle
 * ouvert, aucune page a annoncer, un doute d'ecriture non leve, un contexte
 * Google manquant. Rien n'a echoue, rien n'a ete paye, aucun modele n'a ete
 * appele. Compter une tentative ici tuerait le creneau apres trois reports
 * alors que le moteur s'est comporte exactement comme il devait. Le creneau
 * repart donc en 'planned' AVEC son compteur d'origine, et sa date avance d'un
 * jour : un report qui reste du au meme quart d'heure rejouerait la meme
 * question toutes les quinze minutes, et le doute, lui, coute une lecture de la
 * fiche a chaque fois.
 *
 * PUBLIE — le post est en ligne, le creneau pointe sur lui.
 *
 * LIGNE OUVERTE MAIS RIEN EN LIGNE — refus du gate, echec distant ou doute.
 * TERMINAL, et ce n'est pas de la severite : le chemin de composition insere
 * toujours une ligne NEUVE, donc rejouer paierait une seconde redaction et
 * risquerait un second post sur la fiche d'un client. La reprise d'une ligne
 * existante est une decision humaine, depuis l'ecran.
 */
export function decideGbpSlotOutcome(
  slot: { attempt_count?: number; scheduled_date: string },
  report: RunGbpPostReport,
  opts?: { now?: Date },
): GbpSlotPatch {
  if (!report.postId) {
    return {
      status: 'planned',
      error_message: truncate(
        report.reported ?? 'Créneau reporté : la politique n’avait rien à publier aujourd’hui.',
      ),
      attempt_count: slot.attempt_count ?? 0,
      scheduled_date: formatLocalDate(addDays(startOfLocalDay(opts?.now ?? new Date()), 1)),
    }
  }

  if (report.published) {
    return { status: 'published', gbp_post_id: report.postId }
  }

  const head = report.refusalKind
    ? `Post refusé (${report.refusalKind})`
    : 'Publication non aboutie sur la fiche'

  return {
    status: 'failed',
    // Le detail vit sur la ligne `gbp_posts` — `error_message` y porte le verdict
    // du gate ou le corps verbatim de la reponse distante. Le creneau en dit
    // assez pour qu'on sache ou regarder, et pas assez pour qu'on croie savoir.
    error_message: truncate([head, ...report.problems].join(' | ')),
    gbp_post_id: report.postId,
  }
}

// ─── Lectures partagees ─────────────────────────────────────────────────────

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
 *
 * DUPLICATION ASSUMEE, ET NOMMEE : lib/gbp/posts/run.ts porte aujourd'hui la
 * meme lecture en fonction privee. Elle est exportee ici parce que ce module est
 * celui de la POLITIQUE de calendrier ; le proprietaire de run.ts peut supprimer
 * sa copie et importer celle-ci en une ligne, sans qu'aucun comportement ne
 * change. Deux lectures divergentes du meme corpus donneraient deux idees de ce
 * que « recent » veut dire.
 */
export async function loadRecentGbpPosts(
  supabase: ServiceClient,
  siteId: string,
): Promise<RecentPost[]> {
  const { data, error } = await supabase
    .from('gbp_posts')
    .select('angle, summary, linked_generation_id, published_at, source')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(RECENT_POST_WINDOW)

  if (error) throw new Error(error.message)

  return ((data ?? []) as RecentPostRow[]).map(row => ({
    // Une valeur hors union serait une ligne ecrite par une version anterieure :
    // la lire comme un angle inconnu vaut mieux que la caster en un angle reel,
    // qui occuperait alors un cooldown qui n'est pas le sien.
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

/**
 * Ce que la fiche permet REELLEMENT de dire.
 *
 * MEME DERIVATION QUE run.ts, et pour les memes raisons : `hasRealReviews` se lit
 * sur `reviews_summary.recent_positive` (la forme que `summarizeReviews` produit
 * reellement), `hasDeclaredHours` n'est renseigne QUE si la fiche a ete lue —
 * sans ligne `gbp_profiles`, « pas d'horaires » et « pas encore synchronise » ne
 * se distinguent pas, et le defaut optionnel de rotation.ts existe pour ne pas
 * trancher a leur place. `hasNamedServices` reste volontairement absent :
 * `campaign.business_type` est toujours renseigne et EST un service nomme,
 * declare par le proprietaire.
 *
 * Exportee pour la meme raison que la lecture ci-dessus : que la copie privee de
 * run.ts puisse disparaitre sans qu'une seconde politique naisse.
 */
export function describeAngleAvailability(
  profile: GbpProfileFacts | null,
  campaign: Pick<Campaign, 'communes'> | null,
  hasUnlinkedPublishedPage: boolean,
): AngleAvailability {
  const availability: AngleAvailability = {
    hasRealReviews: hasRealReviews(profile),
    hasUnlinkedPublishedPage,
  }

  if (campaign) availability.hasServiceArea = campaign.communes.length > 0
  if (profile) availability.hasDeclaredHours = Boolean(profile.hours)

  return availability
}

function hasRealReviews(profile: GbpProfileFacts | null): boolean {
  const summary = profile?.reviews_summary
  if (typeof summary !== 'object' || summary === null) return false

  const recent = (summary as { recent_positive?: unknown }).recent_positive
  return Array.isArray(recent) && recent.some(item => typeof item === 'string' && item.trim().length > 0)
}

async function loadGbpProfileFacts(supabase: ServiceClient, siteId: string): Promise<GbpProfileFacts | null> {
  const { data, error } = await supabase
    .from('gbp_profiles')
    .select('reviews_summary, categories, hours')
    .eq('site_id', siteId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as GbpProfileFacts | null
}

interface PublishedGenerationRow {
  id: string
  title: string | null
  slug: string | null
  published_url: string | null
}

/** Les pages publiees qu'un post pourrait annoncer, la plus recente d'abord. */
async function loadLinkCandidates(supabase: ServiceClient, siteId: string): Promise<GbpLinkTarget[]> {
  const { data, error } = await supabase
    .from('generations')
    .select('id, title, slug, published_url')
    .eq('site_id', siteId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(GBP_LINK_CANDIDATE_DEPTH)

  if (error) throw new Error(error.message)

  return ((data ?? []) as PublishedGenerationRow[])
    .filter(row => typeof row.published_url === 'string' && row.published_url.length > 0)
    .map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      published_url: row.published_url,
    }))
}

/** Ce que le moteur a ecrit sur cette fiche ces derniers jours. */
interface RecentWrites {
  /** Posts du moteur dans la semaine ISO en cours, refus exclus. */
  postsThisIsoWeek: number
  /** Ceux d'entre eux qu'aucun creneau n'a produits : composes a la main. */
  unslottedThisIsoWeek: number
  /** Le plus recent d'entre eux, toutes semaines confondues, pour la cadence. */
  lastWriteAt: Date | null
}

/** La fenetre de lecture : la cadence maximale autorisee, plus un jour. */
const RECENT_WRITES_DAYS = 31

/**
 * Ce qui a ete ecrit sur la fiche recemment, en une seule lecture.
 *
 * UN REFUS NE CONSOMME PAS LE BUDGET DE LA SEMAINE : une ligne 'rejected' a ete
 * arretee par le gate AVANT le connecteur, elle n'a jamais atteint Google. Une
 * ligne 'failed' ou 'incertain', elle, compte — l'evidence d'ecriture est
 * precisement ce que ce chantier ne peut pas toujours obtenir, et le doute doit
 * peser du cote prudent.
 *
 * Les posts 'remote' — ecrits a la main par le proprietaire sur sa fiche — ne
 * comptent PAS dans le plafond : ils n'ont consomme aucun quota de NOTRE projet
 * Google Cloud. Ils pesent en revanche de tout leur poids dans la rotation, ou
 * c'est la redondance percue qui compte et non le quota.
 */
async function readRecentWrites(supabase: ServiceClient, siteId: string, now: Date): Promise<RecentWrites> {
  const since = addDays(startOfLocalDay(now), -RECENT_WRITES_DAYS)
  const { data, error } = await supabase
    .from('gbp_posts')
    .select('created_at, calendar_slot_id, status')
    .eq('site_id', siteId)
    .eq('source', 'engine')
    .gte('created_at', since.toISOString())

  if (error) throw new Error(error.message)

  const week = isoWeekKey(startOfLocalDay(now))
  const writes: RecentWrites = { postsThisIsoWeek: 0, unslottedThisIsoWeek: 0, lastWriteAt: null }

  for (const row of (data ?? []) as Array<{ created_at: string; calendar_slot_id: string | null; status: string }>) {
    if (row.status === 'rejected') continue

    const at = new Date(row.created_at)
    if (Number.isNaN(at.getTime())) continue

    if (!writes.lastWriteAt || at > writes.lastWriteAt) writes.lastWriteAt = at
    if (isoWeekKey(at) !== week) continue

    writes.postsThisIsoWeek++
    if (!row.calendar_slot_id) writes.unslottedThisIsoWeek++
  }

  return writes
}

/** Ce qu'un creneau a reellement produit, quand il a produit quelque chose. */
export interface GbpSlotProduct {
  id: string
  status: string
}

/**
 * Le post produit par chaque creneau, pour les creneaux abandonnes en cours de
 * route.
 *
 * SYMETRIQUE DE `getGenerationOutcomes` (lib/scheduler/editorial.ts), et pour la
 * meme raison exactement : un creneau abandonne dont le run a DEJA ecrit une
 * ligne ne doit pas etre rejoue. Cote page le rejeu coutait un second article ;
 * ici il coute un second post sur la fiche d'un client, devant ses prospects,
 * sans aucun moyen de le retirer depuis ce produit.
 *
 * `calendar_slot_id` et non `editorial_calendar.gbp_post_id` : la ligne est
 * ecrite AVANT la publication et porte donc son creneau des le depart, alors que
 * le pointeur inverse n'est pose qu'a la toute fin — c'est-a-dire jamais, sur un
 * run qui n'est pas revenu.
 *
 * Ne jette pas : une table absente (migration 019 non appliquee) ou une lecture
 * en echec rend une table vide, et le creneau reprend le comportement qu'il
 * avait avant ce chantier.
 */
export async function gbpPostsBySlot(
  slotIds: readonly string[],
): Promise<Map<string, GbpSlotProduct>> {
  const products = new Map<string, GbpSlotProduct>()
  if (slotIds.length === 0) return products

  const { data, error } = await createServiceClient()
    .from('gbp_posts')
    .select('id, status, calendar_slot_id')
    .in('calendar_slot_id', [...slotIds])
    .order('created_at', { ascending: true })

  if (error) return products

  // Le dernier ecrit l'emporte : si deux lignes portent le meme creneau, c'est
  // la plus recente qui decrit ou en est reellement ce creneau.
  for (const row of (data ?? []) as Array<{ id: string; status: string; calendar_slot_id: string | null }>) {
    if (row.calendar_slot_id) products.set(row.calendar_slot_id, { id: row.id, status: row.status })
  }

  return products
}

/** Les dates des creneaux de post deja poses pour cette campagne. */
async function loadGbpSlotDates(
  supabase: ServiceClient,
  campaignId: string,
  fromDate: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('editorial_calendar')
    .select('scheduled_date')
    .eq('campaign_id', campaignId)
    .eq('artifact_kind', 'gbp_post')
    .gte('scheduled_date', fromDate)

  if (error) throw new Error(error.message)

  return ((data ?? []) as Array<{ scheduled_date: string | null }>)
    .map(row => row.scheduled_date)
    .filter((date): date is string => typeof date === 'string' && date.length > 0)
}

/** La campagne qui porte la decision d'ecrire sur la fiche de ce site. */
async function pickGbpCampaign(supabase: ServiceClient, siteId: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const campaigns = (data ?? []) as Campaign[]
  // Celle qui a dit oui l'emporte sur la plus recente : un site peut porter
  // plusieurs campagnes et une seule a decide d'ecrire sur la fiche. Rendre la
  // plus recente afficherait « désactivé » a un operateur qui vient d'activer
  // l'autre.
  return campaigns.find(campaign => campaign.gbp_posts_enabled === true) ?? campaigns[0] ?? null
}

// ─── Cadence, semaines ISO et dates ─────────────────────────────────────────

function cadenceDaysOf(campaign: Pick<Campaign, 'gbp_post_cadence_days'>): number {
  const declared = campaign.gbp_post_cadence_days
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0
    ? declared
    : GBP_DEFAULT_CADENCE_DAYS
}

/**
 * La semaine ISO d'une date, sous la forme `2026-W53`.
 *
 * ALGORITHME ISO 8601 COMPLET, et il en faut un : la semaine appartient a
 * l'annee de son JEUDI. Un simple `getFullYear()` ferait basculer d'annee au
 * milieu d'une semaine — le 1er janvier 2027 est un vendredi, il appartient donc
 * a la semaine 53 de 2026, et un plafond hebdomadaire qui changerait de clef ce
 * jour-la autoriserait quatre posts en sept jours.
 *
 * Tout est calcule en heure LOCALE, comme `formatLocalDate` et `todayLocalDate`
 * (lib/scheduler/editorial.ts) : `toISOString()` repond en UTC et decale d'un
 * jour, chaque soir, a l'est de Greenwich.
 */
export function isoWeekKey(date: Date): string {
  const thursday = thursdayOfIsoWeek(date)
  const firstThursday = thursdayOfIsoWeek(new Date(thursday.getFullYear(), 0, 4))

  // Arrondi plutot que division entiere : entre deux jeudis il peut y avoir 23
  // ou 25 heures de plus a cause d'un changement d'heure, et un `floor` ferait
  // reculer d'une semaine tous les jeudis d'octobre.
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))

  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Le jeudi de la semaine ISO d'une date : ce jour porte l'annee de la semaine. */
function thursdayOfIsoWeek(date: Date): Date {
  const day = startOfLocalDay(date)
  day.setDate(day.getDate() - mondayOffset(day) + 3)
  return day
}

/** Distance en jours depuis le lundi de la semaine (lundi = 0, dimanche = 6). */
function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7
}

function startOfIsoWeek(date: Date): Date {
  return addDays(startOfLocalDay(date), -mondayOffset(date))
}

function nextIsoMonday(date: Date): Date {
  return addDays(startOfIsoWeek(date), 7)
}

/**
 * Le premier jour ou un creneau peut etre pose.
 *
 * La cadence se compte depuis la DERNIERE activite reelle — le dernier creneau
 * pose comme le dernier post ecrit a la main — et jamais depuis aujourd'hui :
 * planifier a J+0 le lendemain d'un post publierait deux fois en deux jours sur
 * une cadence de sept.
 */
function firstCandidateDay(
  today: Date,
  existingDates: readonly string[],
  lastWriteAt: Date | null,
  cadence: number,
): Date {
  let candidate = today

  for (const date of existingDates) {
    const next = addDays(parseLocalDate(date), cadence)
    if (next > candidate) candidate = next
  }

  if (lastWriteAt) {
    const next = addDays(startOfLocalDay(lastWriteAt), cadence)
    if (next > candidate) candidate = next
  }

  return candidate
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const shifted = startOfLocalDay(date)
  shifted.setDate(shifted.getDate() + days)
  return shifted
}

/** `YYYY-MM-DD` lu comme une date LOCALE — `new Date('2026-01-01')` est en UTC. */
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

// ─── Menu detail ────────────────────────────────────────────────────────────

function bump(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

/** Meme plafond que `failEditorialSlot` : la colonne est lue par un humain. */
function truncate(message: string): string {
  return message.slice(0, 2000)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
