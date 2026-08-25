// ─────────────────────────────────────────────────────────────────────────────
// Google synchronisation — and the record of whether it actually worked
//
// Two things live here. The reads themselves (Search Console performance rows,
// Business Profile content), and the evidence they leave behind.
//
// The evidence is the point. `gsc_performance` sitting empty used to mean four
// different things — Google never connected, no property picked, the sync
// failed, or the site genuinely has no impressions — and every one of them
// rendered as "0 clic". The operator's only way to tell them apart was to run a
// job by hand and read the server logs. Every function below therefore returns
// a described outcome instead of a boolean, logs that outcome, and persists it
// on `google_connections` (migration 013).
//
// The boolean-returning wrappers `syncGscData` / `syncGbpData` are kept because
// the scheduler and app/api/sites/[id]/google/route.ts call them; they are thin
// adapters over the described versions, not a second implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { getAuthenticatedClient, listConnectedSiteIds, type GoogleFetch } from './client'
import { fetchProfile, fetchReviews, fetchPhotos, fetchPosts, fetchQA, summarizeReviews, type GbpLocalPost } from './gbp'
import { fetchPerformance } from './gsc'
import { createServiceClient } from '@/lib/supabase'
import { fingerprintSummary } from '@/src/core/domain/gbp/rotation'

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Window the daily job re-reads. Search Console keeps 16 months; 28 days is what changes. */
export const DEFAULT_SYNC_DAYS = 28

/**
 * Window of the first sync, the one fired when a property is selected. Reading
 * 28 days there would leave a site that has been live for a year looking almost
 * empty on its first screen, which is the exact impression this module exists to
 * remove.
 */
export const INITIAL_SYNC_DAYS = 90

/** Search Console publishes with roughly a three-day lag; later dates come back empty. */
const GSC_REPORTING_LAG_DAYS = 3

/** Rows per Search Console request. 25 000 is the hard API maximum. */
const GSC_ROWS_PER_REQUEST = 25000

/**
 * Ceiling on one paginated read. Reached only by a site far larger than this
 * tool targets — and when it is reached the result says so (`truncated`) rather
 * than presenting a partial read as the whole truth.
 */
const GSC_MAX_ROWS = 50000

/** Supabase rejects very large statements; upserts go in chunks of this size. */
const UPSERT_CHUNK = 500

/** Business Profile account listing — the cheapest call that proves the API answers at all. */
const GBP_ACCOUNTS_ENDPOINT = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'

// ─── Types ───────────────────────────────────────────────────────────────────

export type GscSyncStatus = 'success' | 'skipped' | 'failed'
export type GscSkipReason = 'no_connection' | 'no_property'

export interface GscSyncResult {
  siteId: string
  status: GscSyncStatus
  /** Search Console property queried, null when none is selected. */
  property: string | null
  /** Rows written to `gsc_performance`. 0 with status `success` is a fact about the site. */
  rows: number
  /** Rows Search Console returned, before duplicates were collapsed. */
  rowsFetched: number
  rangeStart: string | null
  rangeEnd: string | null
  /** true when the read hit GSC_MAX_ROWS: more data exists than was stored. */
  truncated: boolean
  durationMs: number
  error: string | null
  skipReason: GscSkipReason | null
}

export type GbpSyncStatus = 'success' | 'skipped' | 'quota_exhausted' | 'failed'
export type GbpSkipReason = 'no_connection' | 'no_location'

export interface GbpSyncResult {
  siteId: string
  status: GbpSyncStatus
  /** HTTP status of the probe when the API refused, 0 otherwise. */
  httpStatus: number
  /** Ready to display, in French. Explains the quota case instead of leaking a raw error. */
  message: string
  durationMs: number
  error: string | null
  skipReason: GbpSkipReason | null
}

/** Everything the interface needs to explain the state of a site's Google link. */
export interface GoogleSyncState {
  connected: boolean
  email: string | null
  scopes: string[]
  gscProperty: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  gsc: {
    lastSyncAt: string | null
    status: string | null
    rows: number | null
    rangeStart: string | null
    rangeEnd: string | null
    truncated: boolean
    error: string | null
  }
  gbp: {
    lastSyncAt: string | null
    status: string | null
    error: string | null
  }
  /**
   * false when migration 013 has not been applied: the sync runs, but nothing
   * records its outcome, and the interface must say that rather than display
   * "jamais synchronisé" about a sync that may well have happened.
   */
  historyAvailable: boolean
}

// ─── User-facing explanations ────────────────────────────────────────────────

/**
 * The Business Profile APIs ship with a default quota of ZERO requests per
 * minute on a Google Cloud project created after 2021. Every call answers 429
 * RESOURCE_EXHAUSTED until a human fills Google's quota form and Google grants
 * it — usually within a few days. There is no code-side workaround, and trying
 * to build one (retries, backoff, another endpoint) only burns time against a
 * quota that is zero by construction.
 */
export const GBP_QUOTA_MESSAGE =
  "L'API Google Business Profile répond 429 RESOURCE_EXHAUSTED : le quota de ce projet Google Cloud est à zéro requête par minute. " +
  "C'est la valeur par défaut de Google sur les projets récents, pas une panne du moteur. " +
  "Il faut demander un relèvement via le formulaire officiel « Business Profile APIs — quota increase request » ; " +
  "Google répond en général sous quelques jours. " +
  'En attendant, Search Console, la génération et la publication fonctionnent normalement — seules les données de fiche établissement manquent.'

const GBP_FORBIDDEN_MESSAGE =
  "L'API Google Business Profile répond 403 : le compte connecté n'a pas accès à cette fiche, ou l'API n'est pas activée sur le projet Google Cloud."

// ─── Search Console ──────────────────────────────────────────────────────────

export interface SyncGscOptions {
  /** Days of history to read, ending at the last day Search Console has published. */
  days?: number
}

/**
 * Reads a site's Search Console performance and stores it, describing what
 * happened.
 *
 * Never throws: a synchronisation triggered by a user action must not be able to
 * break the action that triggered it. Everything it could have thrown comes back
 * in `status` and `error`, and is logged.
 */
export async function syncGscPerformance(siteId: string, options: SyncGscOptions = {}): Promise<GscSyncResult> {
  const startedAt = Date.now()
  const days = options.days ?? DEFAULT_SYNC_DAYS

  const base: GscSyncResult = {
    siteId,
    status: 'failed',
    property: null,
    rows: 0,
    rowsFetched: 0,
    rangeStart: null,
    rangeEnd: null,
    truncated: false,
    durationMs: 0,
    error: null,
    skipReason: null,
  }

  try {
    const { fetch: googleFetch, connection } = await getAuthenticatedClient(siteId)

    if (!connection.gsc_site_url) {
      // Not a failure: the OAuth callback runs before the property is chosen, so
      // this is the expected state for a few seconds on every connection.
      return finishGsc({ ...base, status: 'skipped', skipReason: 'no_property' }, startedAt)
    }

    const endDate = new Date()
    endDate.setDate(endDate.getDate() - GSC_REPORTING_LAG_DAYS)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - days)

    const rangeStart = formatDate(startDate)
    const rangeEnd = formatDate(endDate)

    const fetched = await fetchPerformance(googleFetch, connection.gsc_site_url, {
      startDate: rangeStart,
      endDate: rangeEnd,
      // Explicit, because the defaults in gsc.ts are deliberately conservative.
      // Without startRow pagination — which fetchPerformance does apply — a read
      // stops at the first page and looks complete; these bounds decide how far
      // it is allowed to walk.
      rowLimit: GSC_ROWS_PER_REQUEST,
      maxRows: GSC_MAX_ROWS,
    })

    const truncated = fetched.length >= GSC_MAX_ROWS
    const withRange = { ...base, property: connection.gsc_site_url, rangeStart, rangeEnd, rowsFetched: fetched.length, truncated }

    if (fetched.length === 0) {
      return finishGsc({ ...withRange, status: 'success' }, startedAt)
    }

    // Two rows sharing (date, page, query) inside one chunk make PostgreSQL
    // reject the whole statement ("ON CONFLICT DO UPDATE cannot affect row a
    // second time"). The API does not return duplicates, but a paginated read
    // whose underlying report shifted between pages can; deduplicating costs one
    // pass and removes the failure mode entirely.
    const deduplicated = new Map<string, (typeof fetched)[number]>()
    for (const row of fetched) {
      deduplicated.set(`${row.date}|${row.page_url}|${row.query}`, row)
    }

    const payload = [...deduplicated.values()].map((row) => ({
      site_id: siteId,
      date: row.date,
      page_url: row.page_url,
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }))

    const supabase = createServiceClient()
    let written = 0

    for (let i = 0; i < payload.length; i += UPSERT_CHUNK) {
      const chunk = payload.slice(i, i + UPSERT_CHUNK)
      const { error } = await supabase
        .from('gsc_performance')
        .upsert(chunk, { onConflict: 'site_id,date,page_url,query', ignoreDuplicates: false })

      // The return value used to be discarded, so a missing table or a missing
      // unique index — the exact two things migration 010 repairs — made the
      // sync report success while storing nothing.
      if (error) {
        return finishGsc({ ...withRange, status: 'failed', rows: written, error: error.message }, startedAt)
      }
      written += chunk.length
    }

    return finishGsc({ ...withRange, status: 'success', rows: written }, startedAt)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // getAuthenticatedClient throws when no connection row exists at all.
    const missingConnection = message.includes('Aucune connexion Google')
    return finishGsc(
      missingConnection
        ? { ...base, status: 'skipped', skipReason: 'no_connection' }
        : { ...base, status: 'failed', error: message },
      startedAt
    )
  }
}

/**
 * Boolean form kept for the scheduler and app/api/sites/[id]/google/route.ts.
 * Same semantics as before: a site with no property selected reports false.
 */
export async function syncGscData(siteId: string): Promise<boolean> {
  const result = await syncGscPerformance(siteId)
  return result.status === 'success'
}

// ─── Business Profile ────────────────────────────────────────────────────────

export interface GbpAccessProbe {
  available: boolean
  status: 'ok' | 'quota_exhausted' | 'forbidden' | 'unauthorized' | 'http_error' | 'network_error'
  httpStatus: number
  /** French, displayable as-is. Empty when the API answers normally. */
  message: string
}

/**
 * One cheap call that tells whether the Business Profile APIs answer at all.
 *
 * lib/google/gbp.ts collapses every failure to `[]` or `null`, which makes a
 * zero quota indistinguishable from "this account owns no business listing" —
 * and those two need opposite reactions from the operator. This probe reads the
 * status code before that collapse happens.
 */
export async function probeGbpAccess(googleFetch: GoogleFetch): Promise<GbpAccessProbe> {
  try {
    const res = await googleFetch(GBP_ACCOUNTS_ENDPOINT)

    if (res.ok) return { available: true, status: 'ok', httpStatus: res.status, message: '' }

    const body = await res.text().catch(() => '')

    // Google answers 429 for a spent quota, but also serves RESOURCE_EXHAUSTED
    // with a 403 on some of the Business Profile endpoints; the reason string is
    // the reliable signal, the status alone is not.
    if (res.status === 429 || body.includes('RESOURCE_EXHAUSTED')) {
      return { available: false, status: 'quota_exhausted', httpStatus: res.status, message: GBP_QUOTA_MESSAGE }
    }
    if (res.status === 401) {
      return {
        available: false,
        status: 'unauthorized',
        httpStatus: res.status,
        message: "Google a refusé le jeton (401). Reconnectez le compte Google de ce site.",
      }
    }
    if (res.status === 403) {
      return { available: false, status: 'forbidden', httpStatus: res.status, message: GBP_FORBIDDEN_MESSAGE }
    }

    return {
      available: false,
      status: 'http_error',
      httpStatus: res.status,
      message: `L'API Google Business Profile a répondu HTTP ${res.status}.`,
    }
  } catch (err) {
    return {
      available: false,
      status: 'network_error',
      httpStatus: 0,
      message: err instanceof Error ? err.message : 'Appel Google Business Profile impossible.',
    }
  }
}

/**
 * Reads a site's Business Profile content, describing what happened.
 *
 * Probes first: when the quota is zero, the five content calls that follow would
 * all fail for the same reason and produce five useless round-trips before
 * degrading into "no data".
 */
export async function syncGbpProfile(siteId: string): Promise<GbpSyncResult> {
  const startedAt = Date.now()

  const base: GbpSyncResult = {
    siteId,
    status: 'failed',
    httpStatus: 0,
    message: '',
    durationMs: 0,
    error: null,
    skipReason: null,
  }

  try {
    const { fetch: googleFetch, connection } = await getAuthenticatedClient(siteId)

    if (!connection.gbp_account_id || !connection.gbp_location_id) {
      return finishGbp(
        { ...base, status: 'skipped', skipReason: 'no_location', message: "Aucune fiche d'établissement sélectionnée pour ce site." },
        startedAt
      )
    }

    const probe = await probeGbpAccess(googleFetch)
    if (!probe.available) {
      return finishGbp(
        {
          ...base,
          status: probe.status === 'quota_exhausted' ? 'quota_exhausted' : 'failed',
          httpStatus: probe.httpStatus,
          message: probe.message,
          error: probe.status === 'quota_exhausted' ? null : probe.message,
        },
        startedAt
      )
    }

    const accountId = connection.gbp_account_id
    const locationId = connection.gbp_location_id

    const [profile, reviews, photos, posts, qa] = await Promise.all([
      fetchProfile(googleFetch, accountId, locationId),
      fetchReviews(googleFetch, accountId, locationId),
      fetchPhotos(googleFetch, accountId, locationId),
      fetchPosts(googleFetch, accountId, locationId),
      fetchQA(googleFetch, accountId, locationId),
    ])

    const address = profile?.storefrontAddress
      ? {
          street: profile.storefrontAddress.addressLines?.join(', ') || '',
          city: profile.storefrontAddress.locality || '',
          postalCode: profile.storefrontAddress.postalCode || '',
          region: profile.storefrontAddress.administrativeArea || '',
          country: profile.storefrontAddress.regionCode || 'FR',
        }
      : null

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('gbp_profiles')
      .upsert({
        site_id: siteId,
        business_name: profile?.title || null,
        address,
        phone: profile?.phoneNumbers?.primaryPhone || null,
        website: profile?.websiteUri || null,
        categories: profile?.categories || null,
        hours: profile?.regularHours || null,
        reviews: reviews.slice(0, 50),
        reviews_summary: summarizeReviews(reviews),
        photos: photos.slice(0, 20).map((p: { googleUrl: string; category: string }) => ({ url: p.googleUrl, category: p.category })),
        // `posts` N'EST PLUS ECRITE ICI, et la colonne N'EST PAS SUPPRIMEE.
        //
        // Ce jsonb etait ECRASE a chaque synchronisation (upsert sur site_id),
        // reduit aux dix derniers posts, et la lecture jetait le champ `name` de
        // l'API. Rien ne pouvait donc y etre trace : ni un post que nous aurions
        // ecrit, ni un doublon, ni une ancre d'idempotence — la trace
        // disparaissait a la synchro suivante. Les posts partent desormais dans
        // `gbp_posts` avec `source = 'remote'` (voir `mirrorRemotePosts`
        // ci-dessous), ou ils PERSISTENT et entrent dans le meme corpus
        // d'anti-duplication que les notres.
        //
        // Cesser d'ecrire une colonne est reversible ; la supprimer ne l'est pas.
        // Verifie avant la bascule : `rg "\.posts\b" app components lib src` ne
        // montre AUCUN lecteur de ce champ.
        qa: qa.slice(0, 20).map((q: { text: string; topAnswers?: Array<{ text: string }> }) => ({
          question: q.text,
          answer: q.topAnswers?.[0]?.text || '',
        })),
        attributes: profile?.attributes || null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'site_id' })

    if (error) {
      return finishGbp({ ...base, status: 'failed', message: error.message, error: error.message }, startedAt)
    }

    const mirror = await mirrorRemotePosts(siteId, posts)

    return finishGbp(
      {
        ...base,
        status: 'success',
        // Le miroir des posts est rapporte, pas tu. Il ne fait PAS echouer la
        // synchronisation — le profil, lui, est bien a jour, et renvoyer 'failed'
        // ferait croire a une fiche non lue. Mais un corpus incomplet affaiblit
        // l'anti-duplication en silence, et le silence est precisement ce que ce
        // module existe pour supprimer.
        message: mirror.problems.length > 0
          ? `Fiche établissement à jour. ${mirror.problems.join(' ')}`
          : 'Fiche établissement à jour.',
      },
      startedAt
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Aucune connexion Google')) {
      return finishGbp({ ...base, status: 'skipped', skipReason: 'no_connection', message: 'Google non connecté pour ce site.' }, startedAt)
    }
    const described = describeAuthFailure(message)
    return finishGbp({ ...base, status: 'failed', message: described, error: described }, startedAt)
  }
}

/**
 * Un jeton refuse et une panne de reseau ne demandent PAS la meme chose.
 *
 * `refreshAccessToken` (lib/google/auth.ts) jette une `Error` generique dont le
 * message commence par « Google token refresh failed: » suivi de
 * l'`error_description` de Google — « Token has been expired or revoked. » sur un
 * `invalid_grant`. Une coupure reseau, elle, jette AVANT que cette phrase ne
 * soit construite : le `fetch` echoue et le message est celui du transport.
 *
 * Ce prefixe est donc le discriminant, et il est fiable dans les deux sens : sa
 * PRESENCE prouve que Google a repondu et a refuse le jeton — l'operateur doit
 * reconnecter le compte, et aucune reprise automatique n'y changera rien. Son
 * ABSENCE laisse le message brut, qui est le seul indice disponible sur une
 * panne dont nous ne savons rien.
 *
 * Sans cette distinction, `gbp_last_sync_error` affichait la meme ligne
 * illisible dans les deux cas, et un compte revoque ressemblait a une
 * indisponibilite passagere — donc n'etait jamais reconnecte.
 */
function describeAuthFailure(message: string): string {
  if (!message.includes('Google token refresh failed')) return message

  return "Google a refusé de renouveler l'accès de ce site (jeton expiré ou révoqué) : "
    + 'reconnectez le compte Google depuis la page du site. '
    + `Ce n'est pas une panne réseau et aucune reprise automatique ne le corrigera. (${message})`
}

// ─── Le miroir des posts ecrits a la main ────────────────────────────────────

export interface GbpPostMirrorReport {
  /** Lignes `gbp_posts` creees en `source = 'remote'`. */
  inserted: number
  /** Lignes deja connues dont l'etat distant a ete rafraichi. */
  refreshed: number
  /** Posts que la fiche porte mais que ce miroir ne sait pas representer. */
  ignored: number
  /** Ce qui s'est mal passe, en francais, sans faire echouer la synchronisation. */
  problems: string[]
}

/**
 * Fait entrer dans `gbp_posts` les posts que le proprietaire a ecrits lui-meme.
 *
 * POURQUOI CES POSTS COMPTENT. L'anti-duplication compare un brouillon a tout ce
 * que la fiche porte deja, sans distinguer la main qui l'a ecrit
 * (src/core/domain/gbp/rotation.ts). Ignorer les posts du proprietaire ferait
 * proposer au moteur de redire ce qu'il vient d'ecrire : redondant ET
 * visiblement automatique, le pire post disponible.
 *
 * IDEMPOTENT PAR `name`, ET PAS PAR `upsert`. `gbp_posts_remote_name_key` est un
 * index unique PARTIEL — `(site_id, remote_name) WHERE remote_name IS NOT NULL`
 * — et PostgreSQL ne retient un index partiel pour un `ON CONFLICT (…)` que si
 * la requete repete son predicat, ce que l'upsert de PostgREST ne sait pas
 * exprimer. Un `upsert(onConflict: 'site_id,remote_name')` echouerait donc a
 * chaque synchronisation avec « no unique or exclusion constraint matching ».
 * La lecture prealable des noms deja connus fait le meme travail, en une requete
 * de plus et sans dependre de ce que PostgREST sait ecrire.
 *
 * ON N'ECRASE JAMAIS UNE LIGNE 'engine'. Un post que le moteur a publie porte
 * deja ce `remote_name` : le rencontrer ici n'en fait pas un post « du
 * proprietaire ». Seuls son etat distant et son adresse de recherche sont
 * rafraichis — `source`, `angle`, `summary` et `linked_generation_id` restent
 * ceux que la publication a poses. Ecraser `summary` reecrirait notre propre
 * journal avec ce que Google veut bien nous rendre.
 *
 * NE JETTE JAMAIS : une synchronisation declenchee par un clic ne doit pas
 * pouvoir casser l'action qui l'a declenchee, et le profil, lui, est deja ecrit.
 */
export async function mirrorRemotePosts(
  siteId: string,
  remotePosts: GbpLocalPost[],
): Promise<GbpPostMirrorReport> {
  const report: GbpPostMirrorReport = { inserted: 0, refreshed: 0, ignored: 0, problems: [] }
  if (remotePosts.length === 0) return report

  // Un post sans `name` ne peut pas etre ancre — c'est la colonne de
  // l'idempotence — et un post sans `summary` n'apporte rien au corpus (la
  // colonne est NOT NULL, et un post-photo n'a aucun texte a comparer). Les deux
  // sont comptes plutot que jetes en silence : « 3 ignores » est une information,
  // un tableau plus court n'en est pas une.
  const usable = remotePosts.filter(post =>
    typeof post.name === 'string' && post.name.length > 0
    && typeof post.summary === 'string' && post.summary.trim().length > 0)

  report.ignored = remotePosts.length - usable.length
  if (usable.length === 0) return report

  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('gbp_posts')
      .select('id, remote_name')
      .eq('site_id', siteId)
      .not('remote_name', 'is', null)

    if (error) throw new Error(error.message)

    const known = new Map<string, string>()
    for (const row of (data ?? []) as Array<{ id: string; remote_name: string | null }>) {
      if (row.remote_name) known.set(row.remote_name, row.id)
    }

    const fresh = usable.filter(post => !known.has(post.name))

    if (fresh.length > 0) {
      const { error: insertError } = await supabase.from('gbp_posts').insert(
        fresh.map(post => ({
          site_id: siteId,
          source: 'remote',
          // NULL, et la base l'autorise (`gbp_posts_engine_needs_angle` ne
          // contraint que 'engine') : le proprietaire n'a pas choisi dans notre
          // liste d'angles, et lui en attribuer un occuperait un cooldown qui
          // n'est pas le sien.
          angle: null,
          summary: post.summary,
          summary_fingerprint: fingerprintSummary(post.summary),
          language_code: post.languageCode || 'fr',
          cta_action_type: post.callToAction?.actionType ?? null,
          cta_url: post.callToAction?.url ?? null,
          // 'published' : ces posts sont sur la fiche, c'est de la qu'ils
          // viennent. Aucun autre statut ne serait vrai.
          status: 'published',
          remote_name: post.name,
          remote_search_url: post.searchUrl ?? null,
          remote_state: post.state ?? null,
          published_at: post.createTime ?? null,
        }))
      )

      if (insertError) {
        // Y compris un 23505 : une synchronisation concurrente a insere la meme
        // ligne entre la lecture et l'ecriture. Rien a corriger, rien a
        // reessayer — le fait EST enregistre, par l'autre passage.
        report.problems.push(`${fresh.length} post(s) de la fiche non enregistré(s) : ${insertError.message}.`)
      } else {
        report.inserted = fresh.length
      }
    }

    // Les lignes deja connues : seul l'etat distant bouge. Une par une, parce
    // que chacune vise un `id` different et qu'un upsert groupe reecrirait les
    // colonnes que les lignes 'engine' possedent.
    for (const post of usable) {
      const rowId = known.get(post.name)
      if (!rowId) continue

      const { error: updateError } = await supabase
        .from('gbp_posts')
        .update({
          remote_state: post.state ?? null,
          remote_search_url: post.searchUrl ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId)

      if (updateError) {
        report.problems.push(`état distant non rafraîchi pour un post de la fiche : ${updateError.message}.`)
        continue
      }
      report.refreshed++
    }
  } catch (err) {
    report.problems.push(
      `Les posts de la fiche n'ont pas pu être enregistrés (${err instanceof Error ? err.message : String(err)}) : `
      + "l'anti-duplication travaillera sans eux jusqu'à la prochaine synchronisation."
    )
  }

  return report
}

/** Boolean form kept for the scheduler and app/api/sites/[id]/google/route.ts. */
export async function syncGbpData(siteId: string): Promise<boolean> {
  const result = await syncGbpProfile(siteId)
  return result.status === 'success'
}

// ─── Connection-time trigger ─────────────────────────────────────────────────

export type SyncTrigger = 'oauth_callback' | 'property_selected' | 'manual' | 'scheduler'

/**
 * Fires the Search Console sync after a connection step, without ever letting it
 * affect the user's navigation.
 *
 * Two rules make this safe to call from a route handler:
 *   · it never throws — every failure comes back as a described result;
 *   · it never stays silent — success, empty result and failure each produce a
 *     distinct log line. The codebase is full of `.catch(() => null)` that hid
 *     outages for months; this is the shape that replaces them.
 *
 * Callers still must not `await` it inside the request that redirects the user.
 * `after()` from next/server is the supported way to run it once the response
 * has been sent.
 */
export async function triggerGscSyncOnConnect(siteId: string, trigger: SyncTrigger): Promise<GscSyncResult> {
  const result = await syncGscPerformance(siteId, { days: INITIAL_SYNC_DAYS })

  const context = {
    siteId,
    trigger,
    property: result.property,
    rows: result.rows,
    rowsFetched: result.rowsFetched,
    range: result.rangeStart && result.rangeEnd ? `${result.rangeStart} → ${result.rangeEnd}` : null,
    durationMs: result.durationMs,
  }

  if (result.status === 'failed') {
    log('ERROR', 'Synchronisation Search Console en échec après connexion', { ...context, error: result.error })
  } else if (result.status === 'skipped') {
    log('INFO', `Synchronisation Search Console non déclenchée (${result.skipReason})`, context)
  } else if (result.rows === 0) {
    log('WARN', 'Synchronisation Search Console terminée sans aucune ligne — la propriété est-elle la bonne ?', context)
  } else {
    log('INFO', 'Synchronisation Search Console terminée', context)
  }

  if (result.truncated) {
    log('WARN', `Lecture Search Console plafonnée à ${GSC_MAX_ROWS} lignes : la période contient davantage de données`, context)
  }

  return result
}

/**
 * Marks a sync as started, before the response that triggers it is sent.
 *
 * Without it the operator is redirected to a page that still says "jamais
 * synchronisé" for the few seconds the background read takes, which reads
 * exactly like the failure this whole change exists to remove. Written
 * synchronously, unlike the sync itself, because it is a single UPDATE.
 */
export async function markGscSyncStarted(siteId: string): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('google_connections')
      .update({ gsc_last_sync_at: new Date().toISOString(), gsc_last_sync_status: 'running', gsc_last_sync_error: null })
      .eq('site_id', siteId)

    if (error) throw new Error(error.message)
  } catch (err) {
    log('WARN', 'Démarrage de synchronisation non enregistré — migration 013 appliquée ?', {
      siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

/** A `running` status older than this was left behind by a process that died. */
export const SYNC_STALE_AFTER_MS = 10 * 60 * 1000

// ─── State exposed to the interface ──────────────────────────────────────────

/**
 * The Google state of one site, as the operator needs to read it.
 *
 * Selects `*` on purpose: the observability columns come from migration 013, and
 * naming a column PostgREST does not know makes it reject the entire request —
 * which would break the page on a database that is merely one migration behind.
 */
export async function getGoogleSyncState(siteId: string): Promise<GoogleSyncState> {
  const empty: GoogleSyncState = {
    connected: false,
    email: null,
    scopes: [],
    gscProperty: null,
    gbpAccountId: null,
    gbpLocationId: null,
    gsc: { lastSyncAt: null, status: null, rows: null, rangeStart: null, rangeEnd: null, truncated: false, error: null },
    gbp: { lastSyncAt: null, status: null, error: null },
    historyAvailable: true,
  }

  const { data, error } = await createServiceClient()
    .from('google_connections')
    .select('*')
    .eq('site_id', siteId)
    .maybeSingle()

  if (error || !data) return empty

  const row = data as Record<string, unknown>
  const historyAvailable = 'gsc_last_sync_at' in row

  return {
    connected: true,
    email: asString(row.google_email),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    gscProperty: asString(row.gsc_site_url),
    gbpAccountId: asString(row.gbp_account_id),
    gbpLocationId: asString(row.gbp_location_id),
    gsc: {
      lastSyncAt: asString(row.gsc_last_sync_at),
      status: asString(row.gsc_last_sync_status),
      rows: typeof row.gsc_last_sync_rows === 'number' ? row.gsc_last_sync_rows : null,
      rangeStart: asString(row.gsc_last_sync_range_start),
      rangeEnd: asString(row.gsc_last_sync_range_end),
      truncated: row.gsc_last_sync_truncated === true,
      error: asString(row.gsc_last_sync_error),
    },
    gbp: {
      lastSyncAt: asString(row.gbp_last_sync_at),
      status: asString(row.gbp_last_sync_status),
      error: asString(row.gbp_last_sync_error),
    },
    historyAvailable,
  }
}

// ─── Bulk runs (scheduler) ───────────────────────────────────────────────────

export interface BulkSyncReport {
  synced: number
  failed: number
  skipped: number
  /** Total rows written across every site, so a nightly run of zero is visible. */
  rows: number
}

export async function syncAllGbp(): Promise<BulkSyncReport> {
  const siteIds = await listConnectedSiteIds()
  const report: BulkSyncReport = { synced: 0, failed: 0, skipped: 0, rows: 0 }

  for (const siteId of siteIds) {
    const result = await syncGbpProfile(siteId)
    if (result.status === 'success') report.synced++
    else if (result.status === 'skipped') report.skipped++
    else report.failed++

    if (result.status === 'quota_exhausted') {
      log('WARN', 'Google Business Profile indisponible : quota du projet Google Cloud à zéro', { siteId })
    } else if (result.status === 'failed') {
      log('ERROR', 'Synchronisation Google Business Profile en échec', { siteId, error: result.error })
    }
  }

  log('INFO', 'Synchronisation Google Business Profile terminée', { ...report, sites: siteIds.length })
  return report
}

export async function syncAllGsc(): Promise<BulkSyncReport> {
  const siteIds = await listConnectedSiteIds()
  const report: BulkSyncReport = { synced: 0, failed: 0, skipped: 0, rows: 0 }

  for (const siteId of siteIds) {
    const result = await syncGscPerformance(siteId)
    report.rows += result.rows
    if (result.status === 'success') report.synced++
    else if (result.status === 'skipped') report.skipped++
    else report.failed++

    if (result.status === 'failed') {
      log('ERROR', 'Synchronisation Search Console en échec', { siteId, error: result.error })
    }
  }

  log('INFO', 'Synchronisation Search Console terminée', { ...report, sites: siteIds.length })
  return report
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Awaited, not fired and forgotten: the caller of a sync is entitled to a result
 * whose trace is already on disk. A dangling write here would be lost the moment
 * the process moved on, which is precisely how a sync becomes unexplainable.
 */
async function finishGsc(result: GscSyncResult, startedAt: number): Promise<GscSyncResult> {
  const finished = { ...result, durationMs: Date.now() - startedAt }
  await persistGscState(finished)
  return finished
}

async function finishGbp(result: GbpSyncResult, startedAt: number): Promise<GbpSyncResult> {
  const finished = { ...result, durationMs: Date.now() - startedAt }
  await persistGbpState(finished)
  return finished
}

/**
 * Records the outcome next to the connection. Best-effort by design: a database
 * that has not received migration 013 must keep synchronising. But the failure
 * is logged — an unrecorded sync is exactly the blindness this module removes.
 */
async function persistGscState(result: GscSyncResult): Promise<void> {
  if (result.skipReason === 'no_connection') return

  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('google_connections')
      .update({
        gsc_last_sync_at: new Date().toISOString(),
        gsc_last_sync_status: result.status,
        gsc_last_sync_rows: result.rows,
        gsc_last_sync_range_start: result.rangeStart,
        gsc_last_sync_range_end: result.rangeEnd,
        gsc_last_sync_truncated: result.truncated,
        gsc_last_sync_error: result.error,
      })
      .eq('site_id', result.siteId)

    if (error) throw new Error(error.message)
  } catch (err) {
    log('WARN', 'État de synchronisation Search Console non enregistré — migration 013 appliquée ?', {
      siteId: result.siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

async function persistGbpState(result: GbpSyncResult): Promise<void> {
  if (result.skipReason === 'no_connection') return

  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('google_connections')
      .update({
        gbp_last_sync_at: new Date().toISOString(),
        gbp_last_sync_status: result.status,
        gbp_last_sync_error: result.error,
      })
      .eq('site_id', result.siteId)

    if (error) throw new Error(error.message)
  } catch (err) {
    log('WARN', 'État de synchronisation Business Profile non enregistré — migration 013 appliquée ?', {
      siteId: result.siteId,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const prefix = `[${level}] [google-sync]`
  if (level === 'ERROR') console.error(prefix, message, context ?? '')
  else if (level === 'WARN') console.warn(prefix, message, context ?? '')
  else console.log(prefix, message, context ?? '')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
