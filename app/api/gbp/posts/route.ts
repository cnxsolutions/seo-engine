// ─────────────────────────────────────────────────────────────────────────────
// Posts de fiche Google Business Profile — la file et l'historique
// GET  /api/gbp/posts — ce qui est parti, ce qui attend, ce qui a ete refuse
// POST /api/gbp/posts — composer un post maintenant
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE CANAL EST SEPARE DE /api/generate, ET NON UN ONGLET DE PLUS DESSUS.
//
// Le chantier de la conscience de l'existant (migration 018) doit rester
// livrable sans celui-ci (migration 019). Si les posts etaient servis par
// /api/generate, un depot ou 019 n'est pas appliquee verrait le feed des PAGES
// tomber avec celui des posts : le premier `select` sur une table absente fait
// echouer la reponse entiere. Deux routes, deux migrations, deux pannes
// independantes — la raison est operationnelle avant d'etre esthetique.
//
// CETTE ROUTE EST UN AIGUILLAGE. Elle n'implemente aucune regle.
//
// La rotation des angles, les deux cooldowns, la cadence, le plafond
// hebdomadaire et le choix de la page a annoncer vivent dans
// `describeGbpEligibility` (lib/gbp/posts/schedule.ts), qui applique la politique
// de src/core/domain/gbp/rotation.ts. La composition, le gate, le connecteur et
// l'enregistrement vivent dans `runGbpPostNow` (lib/gbp/posts/run.ts). Ce fichier
// lit des colonnes, appelle ces deux fonctions, et traduit leurs verdicts en
// codes HTTP. Recalculer ici le moindre cooldown en creerait un second
// exemplaire, condamne a diverger du premier au premier reglage de constante.
//
// CE QUE LE DEPOT NE PEUT PAS PROUVER. L'acces en ECRITURE a l'API GBP n'a pas
// encore ete accorde : le quota par defaut est de zero requete par minute tant
// que l'« Application For Basic API Access » n'est pas approuvee, et aucun appel
// reel n'a pu etre passe depuis ce depot. Cette route ne promet donc aucune
// statistique par post — `localPosts.reportInsights` est supprime depuis
// fevrier 2023 — et ne code aucune constante de format : elles vivent toutes dans
// lib/publishing/gbp/format.ts, chacune avec sa mention « a confirmer contre
// l'API reelle ». Voir docs/gbp-acces-api.md.

import { NextRequest, NextResponse } from 'next/server'
// CONTRAT ATTENDU, ecrit ici parce que cette route en est le seul appelant :
//   describeGbpEligibility(siteId: string): Promise<GbpEligibility>
// `GbpEligibility` est declaree dans ./feed-types et importee par la politique,
// pas redeclaree la-bas : la vue, la route et la politique doivent lire la meme
// structure, sinon `anglesBlocked` finit par porter des motifs que l'ecran ne
// sait pas rendre. La fonction ne jette pas pour un site sans connexion Google —
// elle rend `credentialsReady: false` et un `blockedReason` qui NOMME ce qui
// manque (compte, fiche, ou scope business.manage).
import { describeGbpEligibility } from '@/lib/gbp/posts/schedule'
import { runGbpPostNow } from '@/lib/gbp/posts/run'
import { createServiceClient } from '@/lib/supabase'
import { GBP_POST_ANGLES } from '@/src/core/domain/gbp/rotation'
import {
  GBP_MIGRATION_MISSING,
  GBP_POST_STATUSES,
  isMissingGbpTable,
  splitReasons,
  type FeedGbpPost,
  type GbpAngle,
  type GbpEligibility,
  type GbpPostCounts,
  type GbpPostStatus,
} from './feed-types'

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * Les colonnes du contrat, plus la seule qui n'y figure pas.
 *
 * `calendar_slot_id` est lue sans etre servie : elle ne sert qu'a retrouver la
 * date du creneau, que le contrat expose sous `scheduled_for`. Les trois autres
 * exclusions sont des jointures, pas des colonnes.
 */
type ProjectedColumn =
  | Exclude<keyof FeedGbpPost, 'site' | 'campaign' | 'linked_generation' | 'scheduled_for'>
  | 'calendar_slot_id'

/**
 * Une projection ETROITE : tout ce que la vue rend, et rien de plus.
 *
 * `summary_fingerprint` est absente et le restera : c'est une clef d'index de
 * trente-deux bits, faite pour rapprocher une ligne 'incertain' du post que
 * l'API a peut-etre cree, et rien qu'un humain doive lire. `language_code` vaut
 * 'fr' sur toutes les lignes que ce produit ecrit. `ai_model` n'est affiche nulle
 * part sur un post.
 *
 * UNE seule chaine litterale, deliberement — ni un tableau joint a l'execution ni
 * une concatenation de morceaux. TypeScript elargit les deux en `string`, et
 * supabase-js analyse cet argument AU NIVEAU DES TYPES : une valeur elargie fait
 * echouer cette analyse et rend des lignes typees `ParserError`, dont aucun
 * `NextResponse.json()` ne se plaint jamais.
 */
const FEED_COLUMNS =
  'id,site_id,campaign_id,source,angle,summary,status,refusal_kind,error_message,cta_action_type,cta_url,remote_name,remote_search_url,remote_state,linked_generation_id,published_at,created_at,updated_at,calendar_slot_id'

/** `'a,b'` → `['a', 'b']`. Le seul moyen de verifier une projection qui est une chaine. */
type SplitOnComma<S extends string> = S extends `${infer Head},${infer Rest}`
  ? [Head, ...SplitOnComma<Rest>]
  : [S]

/**
 * Le piege que ceci ferme, dans les deux sens.
 *
 * Declarer un champ sur `FeedGbpPost` sans l'ajouter ci-dessus compile, rend vide
 * dans la vue et ne leve d'erreur nulle part — la colonne n'est simplement jamais
 * demandee a PostgREST. L'inverse, un nom mal orthographie, coute un 400 de
 * PostgREST a l'execution et un feed vide.
 *
 * Le meme garde-fou existe sur app/api/generate/route.ts ; l'utilitaire de types
 * y est local et non exporte, donc redeclare ici plutot qu'importe. Deux lignes
 * de type, aucune regle metier : la duplication qu'on refuse est celle des
 * SEUILS, pas celle d'un `Exclude`.
 */
type _ProjectionMatchesContract = [
  | Exclude<ProjectedColumn, SplitOnComma<typeof FEED_COLUMNS>[number]>
  | Exclude<SplitOnComma<typeof FEED_COLUMNS>[number], ProjectedColumn>,
] extends [never]
  ? true
  : never
const _projectionMatchesContract: _ProjectionMatchesContract = true
void _projectionMatchesContract

/** Les sites embarques ne portent ni `wp_app_password` ni `github_token`. */
const SITE_EMBED = 'site:sites(id,name,type,url)'

/** Le nom de la campagne, et rien d'autre : la vue n'affiche que lui. */
const CAMPAIGN_EMBED = 'campaign:campaigns(id,name)'

/**
 * La page annoncee par le post.
 *
 * Le maillage post -> page est la raison d'etre du canal : un post de fiche qui
 * ne renvoie nulle part ne fait venir personne sur le site, et
 * `gbp_posts_engine_needs_link` en fait une contrainte de base des le statut
 * 'generated'. `published_url` est ce que la vue affiche ; `title` et `slug`
 * servent quand la page n'est pas encore en ligne.
 */
const LINK_EMBED = 'linked_generation:generations!linked_generation_id(id,title,slug,published_url)'

const FULL_SELECT = `${FEED_COLUMNS}, ${SITE_EMBED}, ${CAMPAIGN_EMBED}, ${LINK_EMBED}`

// ─── Bornes ──────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 150

// ─── GET /api/gbp/posts ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const siteId = searchParams.get('site_id') || undefined
    const statuses = parseStatuses(searchParams.get('status'))
    const limit = parseLimit(searchParams.get('limit'))

    const supabase = createServiceClient()

    // Les filtres d'abord, l'ordre et la limite ensuite : `.limit()` rend un
    // constructeur de transformation, qui n'accepte plus `.eq()`.
    let filtered = supabase.from('gbp_posts').select(FULL_SELECT)

    if (siteId) filtered = filtered.eq('site_id', siteId)
    if (statuses.length > 0) filtered = filtered.in('status', statuses)

    // Les compteurs decrivent TOUTE la portee, pas la page de lignes rendue : un
    // operateur qui filtre sur « refuses » doit quand meme savoir que trois posts
    // attendent une publication.
    //
    // Un `select('status')` suivi d'un decompte en JS paraissait moins cher et
    // etait FAUX : PostgREST rend au plus mille lignes et ne dit rien du reste.
    // Huit comptages `head: true` ne transferent aucune ligne et ne peuvent pas
    // se tromper.
    const tallyQueries = GBP_POST_STATUSES.map((status) => {
      let query = supabase
        .from('gbp_posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      if (siteId) query = query.eq('site_id', siteId)
      return query
    })

    const [feed, sites, campaigns, ...tallies] = await Promise.all([
      // `overrideTypes` plutot qu'un cast : sans type `Database` genere,
      // supabase-js infere chaque colonne en `any` et chaque ressource embarquee
      // en TABLEAU — il ne peut pas savoir que `site_id`, `campaign_id` et
      // `linked_generation_id` sont des clefs etrangeres vers-un, pour lesquelles
      // PostgREST rend un objet seul. Enoncer la forme de la ligne ici est ce qui
      // rend `toFeedGbpPost` verifiable.
      filtered
        .order('created_at', { ascending: false })
        .limit(limit)
        .overrideTypes<FeedRow[], { merge: false }>(),
      supabase.from('sites').select('id,name,type,url').order('name'),
      supabase
        .from('campaigns')
        .select('id,name,site_id,gbp_posts_enabled')
        .order('created_at', { ascending: false }),
      ...tallyQueries,
    ])

    // La table absente n'est pas une panne : c'est la migration 019 qui n'a pas
    // ete appliquee. Le dire nommement evite qu'un operateur lise « erreur
    // interne » et cherche un defaut de code pendant une heure. `campaigns` est
    // interrogee ici aussi parce que `gbp_posts_enabled` est une colonne de 019.
    if ([feed, campaigns, ...tallies].some((result) => isMissingGbpTable(result.error))) {
      return NextResponse.json({ error: GBP_MIGRATION_MISSING }, { status: 503 })
    }

    if (feed.error) throw new Error(feed.error.message)
    if (sites.error) throw new Error(sites.error.message)
    if (campaigns.error) throw new Error(campaigns.error.message)

    const rows = feed.data ?? []

    const [scheduledDates, eligibility] = await Promise.all([
      loadScheduledDates(supabase, rows),
      loadEligibility(siteId),
    ])

    return NextResponse.json({
      posts: rows.map((row) => toFeedGbpPost(row, scheduledDates)),
      counts: tallyStatuses(tallies),
      eligibility,
      sites: sites.data ?? [],
      campaigns: campaigns.data ?? [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[GET /api/gbp/posts]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST /api/gbp/posts ─────────────────────────────────────────────────────

/**
 * Composer un post de fiche, maintenant.
 *
 * `angle` et `linked_generation_id` sont des SUGGESTIONS de l'operateur, pas des
 * ordres : `runGbpPostNow` les confronte aux cooldowns et refuse un angle ferme
 * AVEC son motif, plutot que de l'accepter par politesse. Sans suggestion, la
 * politique choisit. Dans les deux cas l'angle est arrete AVANT l'appel au
 * modele — jamais par le modele, qui n'a aucun moyen de savoir ce que la fiche a
 * deja dit.
 *
 * Synchrone, comme POST /api/generate et pour la meme raison : outil
 * mono-operateur, l'humain vient de cliquer et regarde.
 *
 * LES REFUS EXPLICITES, ET AUCUN N'EST UNE EXCEPTION. Deux sont decides ici, sur
 * des colonnes, parce qu'ils meritent un code HTTP qui leur soit propre : campagne
 * introuvable (404), campagne desactivee (409, le cas NORMAL). Tous les autres —
 * fiche non selectionnee, scope business.manage absent, doute d'ecriture non levé,
 * angle en cooldown, aucune page a annoncer, contexte Google manquant — reviennent
 * de `runGbpPostNow` sous forme de PHRASE francaise prete a afficher, rendue en
 * 422. Les redecider ici en donnerait une seconde version, et l'operateur lirait
 * un motif different selon qu'il regarde l'ecran ou le resultat de son clic.
 */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => ({}))
    const { campaignId, angle, linkedGenerationId, angleWasNamed } = readComposeBody(body)

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaign_id est requis : un post appartient toujours à une campagne.' },
        { status: 400 }
      )
    }
    // Un angle inconnu est refuse au lieu d'etre ignore : l'ignorer laisserait la
    // politique en choisir un autre, et l'operateur croirait avoir impose le sien.
    if (angleWasNamed && !angle) {
      return NextResponse.json(
        { error: `angle inconnu. Valeurs acceptées : ${GBP_POST_ANGLES.join(', ')}` },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const campaign = await supabase
      .from('campaigns')
      .select('id,gbp_posts_enabled')
      .eq('id', campaignId)
      .maybeSingle()
      .overrideTypes<CampaignRow | null, { merge: false }>()

    if (isMissingGbpTable(campaign.error)) {
      return NextResponse.json({ error: GBP_MIGRATION_MISSING }, { status: 503 })
    }
    if (campaign.error) throw new Error(campaign.error.message)
    if (!campaign.data) {
      return NextResponse.json({ error: 'Campagne introuvable' }, { status: 404 })
    }

    // Le cas NORMAL, pas une panne : `gbp_posts_enabled` vaut false par defaut en
    // base, pour qu'aucune campagne existante ne se mette a ecrire sur la fiche
    // d'un client sans une decision explicite, campagne par campagne.
    //
    // `runGbpPostNow` refuse la meme chose, avec la MEME phrase — deliberement,
    // pour que l'operateur lise les memes mots quel que soit le chemin qui
    // repond. Ce controle-ci existe pour lui donner un code HTTP qui le distingue
    // d'un report (409 contre 422) et pour ne pas ouvrir de session Supabase de
    // plus dans le moteur quand la reponse est connue d'avance.
    if (!campaign.data.gbp_posts_enabled) {
      return NextResponse.json(
        { error: 'Les posts de fiche sont désactivés pour cette campagne.' },
        { status: 409 }
      )
    }

    const run = await runGbpPostNow({ campaignId, angle, linkedGenerationId })

    // Pas de ligne : la sequence a REPORTE. Ce n'est pas une panne — c'est le
    // seul resultat honnete quand rien de nouveau ne peut etre dit — mais rien
    // n'a ete produit, donc l'appel n'aboutit pas.
    //
    // C'est par ici que reviennent, avec leur phrase : la campagne sans site, la
    // fiche non selectionnee, le scope business.manage absent, le doute
    // d'ecriture non leve, l'angle en cooldown, l'absence de page a annoncer et
    // le contexte Google manquant.
    if (!run.postId) {
      return NextResponse.json(
        {
          error: run.reported ?? 'Créneau reporté : rien de nouveau à dire sur la fiche.',
          ...(run.refusalKind ? { refusal_kind: run.refusalKind } : {}),
          notes: run.problems,
        },
        { status: 422 }
      )
    }

    const post = await readPost(supabase, run.postId)
    if (!post) {
      return NextResponse.json(
        {
          error:
            'Post composé mais introuvable en base. Ne relancez pas : vérifiez la fiche avant '
            + 'toute nouvelle tentative.',
        },
        { status: 500 }
      )
    }

    // Le doute d'ecriture. Il n'a rien d'un echec et tout d'une interdiction :
    // la fiche n'a ni confirme ni refuse, un POST localPosts n'est pas idempotent
    // et l'API n'accepte aucune clef d'idempotence. `written: true` dit a la vue
    // de proposer d'aller VOIR la fiche, jamais de recliquer.
    if (post.status === 'incertain') {
      return NextResponse.json(
        {
          error:
            'La fiche n’a ni confirmé ni refusé : ce post existe peut-être déjà. Ne relancez pas — '
            + 'ouvrez la fiche pour vérifier. Un second envoi publierait un doublon visible par vos '
            + 'prospects.',
          written: true,
          status: post.status,
          post,
        },
        { status: 422 }
      )
    }

    // Refus du gate ('rejected') ou echec franc du connecteur ('failed'). Les
    // deux portent `error_message` ; seul le premier porte des raisons redigees,
    // et `splitReasons` rend simplement une liste vide sur le second — la vue
    // affiche alors le titre seul, comportement deja etabli par
    // app/api/publish/generation/route.ts.
    if (post.status === 'rejected' || post.status === 'failed') {
      return NextResponse.json(
        {
          error: post.error_message ?? 'Post refusé par le contrôle qualité — il n’a pas été publié.',
          rejected: { reasons: splitReasons(post.error_message), refusal_kind: post.refusal_kind },
          written: false,
          status: post.status,
          post,
        },
        { status: 422 }
      )
    }

    // `notes` porte les avertissements du gate — GBP_SUMMARY_OFF_TARGET en tete,
    // le seul code de format qui ne bloque pas — et les ecritures secondaires
    // ratees. Un post part avec eux ; les taire priverait l'operateur de la seule
    // trace de ce qui a failli le retenir.
    return NextResponse.json({ success: true, post, notes: run.problems })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[POST /api/gbp/posts]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Formes de lignes ────────────────────────────────────────────────────────

type ServiceClient = ReturnType<typeof createServiceClient>

/**
 * Une ligne du feed telle que PostgREST la rend : trois champs y sont plus larges
 * que le contrat, et le contrat est ce que la vue croit.
 */
type FeedRow = Omit<FeedGbpPost, 'source' | 'angle' | 'status' | 'scheduled_for'> & {
  source: string
  angle: string | null
  status: string
  calendar_slot_id: string | null
}

/**
 * Ce que POST interroge de la campagne : son existence, et l'opt-in.
 *
 * Ni `site_id` ni `name` : le premier est relu par `runGbpPostNow`, qui charge
 * la campagne entiere de toute facon, et le second n'entre dans aucune decision.
 */
interface CampaignRow {
  id: string
  gbp_posts_enabled: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ComposeBody {
  campaignId: string
  angle: GbpAngle | undefined
  linkedGenerationId: string | undefined
  /** Vrai des que le corps a nomme un angle, meme illisible. */
  angleWasNamed: boolean
}

function readComposeBody(body: unknown): ComposeBody {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>

  return {
    campaignId: typeof raw.campaign_id === 'string' ? raw.campaign_id.trim() : '',
    // `find` sur la liste du domaine plutot qu'un cast : la valeur vient d'un
    // corps HTTP, et `gbp_posts_angle_check` refuserait a l'insertion tout ce que
    // cette liste ne contient pas.
    angle: GBP_POST_ANGLES.find((known) => known === raw.angle),
    linkedGenerationId:
      typeof raw.linked_generation_id === 'string' && raw.linked_generation_id.trim()
        ? raw.linked_generation_id.trim()
        : undefined,
    angleWasNamed: raw.angle != null && raw.angle !== '',
  }
}

/**
 * L'eligibilite du site, ou `null`.
 *
 * `null` sans site est le contrat : une eligibilite agregee sur plusieurs fiches
 * ne veut rien dire. `null` sur une panne de la politique est un choix : le feed
 * — la file, l'historique, les refus — reste lisible, et la vue ne propose
 * simplement rien. Faire tomber l'ecran entier parce qu'un cooldown n'a pas pu
 * etre calcule serait arreter le moteur parce qu'une source manque.
 */
async function loadEligibility(siteId: string | undefined): Promise<GbpEligibility | null> {
  if (!siteId) return null
  try {
    return await describeGbpEligibility(siteId)
  } catch (error) {
    console.error('[GET /api/gbp/posts] éligibilité indisponible', error)
    return null
  }
}

/** Un post, dans la forme exacte du feed. */
async function readPost(supabase: ServiceClient, postId: string): Promise<FeedGbpPost | null> {
  const { data, error } = await supabase
    .from('gbp_posts')
    .select(FULL_SELECT)
    .eq('id', postId)
    .maybeSingle()
    .overrideTypes<FeedRow | null, { merge: false }>()

  if (error) throw new Error(error.message)
  if (!data) return null

  return toFeedGbpPost(data, await loadScheduledDates(supabase, [data]))
}

/**
 * La date du creneau de chaque post, par identifiant de creneau.
 *
 * Une requete separee plutot qu'une jointure PostgREST, et ce n'est pas de la
 * frilosite : depuis la migration 019 il existe DEUX clefs etrangeres entre
 * `gbp_posts` et `editorial_calendar` — `gbp_posts.calendar_slot_id` et
 * `editorial_calendar.gbp_post_id`. PostgREST refuse une jointure ambigue et
 * repond 300 tant qu'on ne la desambigue pas par un indice, ce qui rendrait le
 * feed entier vide pour une date d'affichage.
 *
 * Un echec ne fait pas tomber le feed : les dates manquent, les posts restent.
 */
async function loadScheduledDates(
  supabase: ServiceClient,
  rows: readonly FeedRow[]
): Promise<ReadonlyMap<string, string | null>> {
  const slotIds = [...new Set(rows.map((row) => row.calendar_slot_id).filter(isNonEmpty))]
  if (slotIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('editorial_calendar')
    .select('id,scheduled_date')
    .in('id', slotIds)
    .overrideTypes<Array<{ id: string; scheduled_date: string | null }>, { merge: false }>()

  if (error) {
    console.error('[GET /api/gbp/posts] dates de créneau indisponibles', error.message)
    return new Map()
  }

  return new Map((data ?? []).map((slot) => [slot.id, slot.scheduled_date]))
}

function isNonEmpty(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Regle les trois champs que la base ne promet pas au type declare.
 *
 * Pas de la decoration : `FeedGbpPost` declare des unions fermees, et un DTO qui
 * en dit plus que la table peut en garantir est un mensonge sur lequel la vue
 * agit.
 */
function toFeedGbpPost(row: FeedRow, scheduled: ReadonlyMap<string, string | null>): FeedGbpPost {
  const { calendar_slot_id, ...rest } = row

  return {
    ...rest,
    // `gbp_posts_source_check` est verifiee des la creation de la table : aucune
    // autre valeur ne peut y entrer. Le test explicite existe pour que la valeur
    // servie ne depende d'aucune contrainte lue ailleurs.
    source: row.source === 'remote' ? 'remote' : 'engine',
    // Un angle inconnu devient `null`, ce qui n'est pas un mensonge : la colonne
    // est nullable par construction et un post 'remote' n'en porte aucun.
    angle: GBP_POST_ANGLES.find((known) => known === row.angle) ?? null,
    status: toStatus(row.status),
    scheduled_for: calendar_slot_id ? scheduled.get(calendar_slot_id) ?? null : null,
  }
}

/**
 * Un statut hors contrainte devient 'incertain', et non 'pending'.
 *
 * Les deux seraient faux, mais 'incertain' dit litteralement « nous ne savons pas
 * ou en est cette ligne » et conduit l'operateur a aller la regarder ; 'pending'
 * l'inviterait a lancer une publication sur une ligne dont l'etat reel est
 * inconnu — le rejeu a l'aveugle qu'on passe ce chantier a empecher.
 */
function toStatus(raw: string): GbpPostStatus {
  const known = GBP_POST_STATUSES.find((status) => status === raw)
  if (known) return known
  console.error('[GET /api/gbp/posts] statut hors gbp_posts_status_check', raw)
  return 'incertain'
}

function parseStatuses(raw: string | null): GbpPostStatus[] {
  if (!raw) return []
  const wanted = raw.split(',').map((value) => value.trim())
  // Les membres inconnus sont ignores plutot que refuses : un signet perime ne
  // doit pas devenir un 400 devant une liste qui se rendrait tres bien.
  return GBP_POST_STATUSES.filter((status) => wanted.includes(status))
}

function parseLimit(raw: string | null): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(Math.round(parsed), MAX_LIMIT)
}

/**
 * Un comptage exact par statut, dans l'ordre de `GBP_POST_STATUSES`.
 *
 * Un comptage en echec vaut INCONNU, jamais zero, et ne jette pas.
 *
 * Trois conduites etaient possibles et une seule est honnete. Jeter aurait fait
 * disparaitre la file entiere — les posts, les refus, l'historique — pour un
 * chiffre d'en-tete. Ecrire zero aurait dit « aucun post refuse » a un operateur
 * qui aurait alors cesse d'aller voir. `null` dit ce qui s'est passe, et la vue
 * le rend avec `<UnknownValue />`, qui existe pour cela.
 *
 * `total` suit la meme regle : une somme a laquelle il manque un terme n'est pas
 * un total, c'est le meme mensonge en moins visible.
 *
 * ECART ASSUME face a app/api/generate/route.ts, qui JETTE sur un comptage en
 * echec. Sa raison est bonne — ne pas afficher zero — mais son prix ne l'est
 * pas : il paie l'honnetete d'un compteur par la disparition de tout l'ecran.
 * `number | null` obtient la meme honnetete sans ce prix.
 */
function tallyStatuses(
  results: Array<{ count: number | null; error: { message: string } | null }>
): GbpPostCounts {
  const counts = {} as GbpPostCounts
  let total: number | null = 0

  GBP_POST_STATUSES.forEach((status, index) => {
    const result = results[index]
    if (!result || result.error) {
      if (result?.error) console.error(`[GET /api/gbp/posts] comptage ${status}`, result.error.message)
      counts[status] = null
      total = null
      return
    }
    const value = result.count ?? 0
    counts[status] = value
    if (total !== null) total += value
  })

  counts.total = total
  return counts
}
