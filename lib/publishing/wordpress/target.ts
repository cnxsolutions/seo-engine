// ─────────────────────────────────────────────────────────────────────────────
// Where this page is going, decided by looking
// SEO Engine - The read that is also the guard.
// ─────────────────────────────────────────────────────────────────────────────
//
// The publisher this replaces created blind. If the slug was taken — by
// `/contact`, by `/tarifs`, by anything the owner wrote — WordPress did not
// refuse: it silently made a second page at `/contact-2`. And the canonical the
// engine then wrote pointed at `${siteUrl}/${slug}/`, that is, at the owner's
// ORIGINAL page. Google was being told, in the site's own markup, to treat the
// real page as a duplicate of the generated one.
//
// That is the most destructive thing this product could do, and it needed one
// GET to prevent.
//
// The lookup is not a separate `inspect()` step called before writing. It IS the
// step that decides where to write, and it returns the target, so there is no
// window between checking and acting in which a page can appear.

import { WpError, type WpClient } from './rest'

export interface WpPage {
  id: number
  link: string
  status: string
  slug: string
  title?: { rendered?: string; raw?: string }
  /** Present when the engine wrote it, absent on a page a human made. */
  meta?: Record<string, unknown>
}

export type WpTarget =
  | { action: 'creer' }
  /**
   * `type` is load-bearing. `findBySlug` looks in pages AND posts — a post can
   * hold the slug — but the write went to `/wp/v2/pages/{id}` regardless, which
   * for a post id is a 404 on someone else's content id.
   */
  | { action: 'mettre-a-jour'; page: WpPage; type: 'pages' | 'posts'; reason: string }
  | { action: 'refuser'; reason: string }

export interface TargetOptions {
  slug: string
  /**
   * The id this engine recorded for this page last time, from `generations`.
   *
   * The database is the reference for "did I write here?": it answers without a
   * network call and stays true even if someone edits the page in wp-admin. A
   * marker stored on the remote page would be blind to everything the engine
   * published elsewhere.
   */
  knownRemoteId?: number
  /** Skip the occupancy and redirect guards. An admission, not a solution. */
  force?: boolean
  /**
   * Authorise the takeover of ONE named page, and only that one.
   *
   * The difference with `force` is the whole point: `force` says "whatever is
   * there, take it", this says "the page at THIS path, which a human looked at".
   * A `path` that does not match the slug about to be written gets the ordinary
   * occupancy refusal, unchanged. Without this field nothing below behaves
   * differently.
   */
  replaces?: { path: string; remoteId?: number }
  /** A previous attempt on this page was interrupted mid-publish. */
  recovering?: boolean
  /** Used only to recognise a half-written page during a recovery. */
  expectedTitle?: string
}

/**
 * Look once, decide once.
 *
 * Both post types are searched. WordPress lets a post and a page share a slug,
 * and the second one to exist is reachable at a different URL — so a page
 * created on top of an existing post is not a duplicate the engine can see, but
 * it is a collision the visitor gets.
 */
export async function decideTarget(client: WpClient, options: TargetOptions): Promise<WpTarget> {
  const { slug, knownRemoteId, force } = options

  // The id first, the slug second.
  //
  // Looking up by slug alone made the guard blind to our own pages the moment
  // WordPress or a human renamed one: the requested slug came back free, the
  // engine created a second page, and it did so again on every republication.
  // The id is the only stable handle on a page we already wrote.
  if (knownRemoteId !== undefined) {
    const ours = await byId(client, knownRemoteId)
    if (ours) {
      return {
        action: 'mettre-a-jour',
        // Always a page: the engine only ever creates pages.
        type: 'pages',
        page: ours,
        reason:
          ours.slug === slug
            ? `page ${ours.id} deja publiee par le moteur`
            : `page ${ours.id} deja publiee par le moteur, sous le slug « ${ours.slug} »`,
      }
    }
    // Gone — deleted in wp-admin, or emptied from the trash. Falling through to
    // the slug lookup is right: we are creating again, and the occupancy guard
    // still applies.
  }

  const found = await findBySlug(client, slug)
  const existing = found?.page ?? null

  if (!existing) {
    // Nothing at that slug in WordPress — but something in front of WordPress
    // may still intercept the URL. Checked only when we are about to create:
    // updating a page we already own means the URL demonstrably works.
    if (!force) {
      const redirect = await redirectedAway(client, slug)
      if (redirect) return { action: 'refuser', reason: redirect }
    }
    return { action: 'creer' }
  }

  if (knownRemoteId !== undefined && existing.id === knownRemoteId) {
    return {
      action: 'mettre-a-jour',
      type: found!.type,
      page: existing,
      reason: `page ${existing.id} deja publiee par le moteur`,
    }
  }

  // A page we half-wrote, recognised by evidence rather than assumed.
  //
  // The reaper hands back a row whose push was cut off before the id could be
  // recorded. Without this, the retry finds the page it created itself, calls it
  // the owner's, and parks the row in `failed` with a reason that is false.
  // Requiring the title to match as well as the slug is what keeps this from
  // becoming a licence to overwrite.
  if (options.recovering && options.expectedTitle && titleOf(existing) === options.expectedTitle) {
    return {
      action: 'mettre-a-jour',
      type: found!.type,
      page: existing,
      reason: `page ${existing.id} reprise apres une publication interrompue (titre identique)`,
    }
  }

  // A takeover the operator asked for, on the page the operator was shown.
  //
  // Before `force`, deliberately: this is the narrow key and `force` is the
  // blunt one, so the narrow one must get the chance to describe what happened.
  // The comparison is an EXACT path match — a `replaces.path` pointing anywhere
  // else falls through to the refusal below, word for word. Anything looser
  // would make the named target decorative, and the target is the only thing
  // standing between this branch and overwriting a page that ranks.
  if (options.replaces && samePath(options.replaces.path, slug)) {
    return {
      action: 'mettre-a-jour',
      type: found!.type,
      page: existing,
      reason: `page ${existing.id} remplacee sur demande explicite (mise a jour validee par un operateur)`,
    }
  }

  if (force) {
    return {
      action: 'mettre-a-jour',
      type: found!.type,
      page: existing,
      reason: `page ${existing.id} reprise de force — le moteur ne l'avait pas enregistree`,
    }
  }

  return {
    action: 'refuser',
    reason:
      `/${slug} existe deja sur ce site (page ${existing.id}, statut ${existing.status}) et le moteur ` +
      `ne l'a pas ecrite. Publication annulee pour ne pas ecraser une page du proprietaire — ` +
      `changer le slug, ou forcer si cette page est bien la notre.`,
  }
}

/**
 * Which KIND of refusal a `refuser` reason is.
 *
 * `WpTarget` carries a sentence and no discriminant, because the sentence is
 * what the operator reads and there was, for a while, only one caller to
 * classify it. There are now two — the connector, which stores the kind in
 * `generations.refusal_kind`, and the occupancy probe — and they were about to
 * hold two copies of the same `includes('redirection')` test. Two copies of a
 * classification drift the day a third refusal reason is written: one caller
 * would file it under 'occupe' and the other would not.
 *
 * Deliberately narrower than `RefusalKind`: `decideTarget` produces exactly two
 * refusals, and neither is 'identifiants' (credentials fail by throwing, before
 * a target is ever decided) nor 'duplicat' (an editorial verdict, decided
 * upstream of any connector). Widening the return type would force both callers
 * to handle cases this function cannot produce.
 */
export function refusalKindFor(reason: string): 'occupe' | 'redirection' {
  return reason.includes('redirection') ? 'redirection' : 'occupe'
}

function titleOf(page: WpPage): string {
  return (page.title?.raw ?? page.title?.rendered ?? '').trim()
}

/** The page we published last time, if it is still there. */
async function byId(client: WpClient, id: number): Promise<WpPage | null> {
  return client
    .get<WpPage>(`/wp/v2/pages/${id}`, { context: 'edit' })
    .catch((error) => {
      // ONLY a 404 means the page is gone. `refus_wordpress` is the catch-all
      // for everything WordPress rejects — reading it as "gone" would make the
      // engine create a second copy of a page that is still standing.
      if (error instanceof WpError && error.status === 404) return null
      throw error
    })
}

/** The page or post served at this slug, whatever its status. */
async function findBySlug(
  client: WpClient,
  slug: string
): Promise<{ page: WpPage; type: 'pages' | 'posts' } | null> {
  for (const type of ['pages', 'posts'] as const) {
    // `status=any` matters: a draft occupies the slug just as firmly as a
    // published page, and creating over it produces `slug-2` all the same.
    const found = await client
      .get<WpPage[]>(`/wp/v2/${type}`, { slug, status: 'any', per_page: '1', context: 'edit' })
      .catch((error) => {
        // A reader that cannot read must not be taken for "nothing is there":
        // that is exactly the assumption that created the duplicate.
        if (error instanceof WpError && error.failure === 'droits_insuffisants') {
          throw new WpError(
            'droits_insuffisants',
            "impossible de verifier si le slug est libre — un compte Editeur ou Administrateur est requis"
          )
        }
        throw error
      })

    if (Array.isArray(found) && found.length > 0) return { page: found[0], type }
  }
  return null
}

/**
 * Does the site send this URL somewhere else?
 *
 * WordPress knows nothing about `.htaccess`, about a redirection plugin's own
 * table, or about a rule at the CDN. Only asking the URL does. The engine
 * learned this the hard way on the Next.js side, where it published onto a path
 * the site had deliberately redirected — the page was unreachable and it broke
 * the site's own route checks.
 */
async function redirectedAway(client: WpClient, slug: string): Promise<string | null> {
  const url = `${client.origin}/${slug}/`
  const { status, location } = await client.probe(url)

  if (status < 300 || status >= 400 || !location) return null

  // WordPress redirects on its own, constantly, and none of it means the URL is
  // taken: it normalises the trailing slash, and its canonical-redirect guessing
  // sends an unknown slug to whatever it thinks you meant. Refusing on any 3xx
  // blocked publication on perfectly free slugs, with a reason that was false —
  // and on the scheduler that refusal came back every fifteen minutes.
  //
  // Only a redirect that lands somewhere ELSE counts.
  if (sameDestination(location, slug, client.origin)) return null

  return (
    `/${slug} est une source de redirection sur ce site (HTTP ${status} vers ${location}). ` +
    `La page publiee serait inatteignable — changer le slug.`
  )
}

/**
 * `/x`, `x`, `/x/` and `X` are the same address here.
 *
 * Local on purpose. `normalizePath` from lib/pipeline/internal-links would do,
 * and importing it would give this module its second dependency after `./rest` —
 * the absence of that coupling is what lets the guard be tested on its own.
 *
 * Leading slashes are stripped on both sides, not required on either: a caller
 * naming the page to replace writes `/taxi-troyes` or `taxi-troyes` depending on
 * where the value came from, and neither spelling should decide whether a page
 * that ranks gets overwritten.
 */
function samePath(a: string, b: string): boolean {
  const normalise = (value: string) =>
    value.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()

  return normalise(a) === normalise(b)
}

/**
 * `/x`, `/x/` and `https://site/x/` are the same destination — `https://autre.fr/x`
 * is not.
 *
 * Parsed rather than sliced by length: slicing assumed the redirect stayed on
 * the same host, so a redirect to `https://concurrent.fr/taxi-gare` produced a
 * path that happened to match and the guard waved it through.
 */
function sameDestination(location: string, slug: string, origin: string): boolean {
  let path = location
  if (/^https?:\/\//i.test(location)) {
    try {
      const target = new URL(location)
      if (target.origin.toLowerCase() !== new URL(origin).origin.toLowerCase()) return false
      path = target.pathname
    } catch {
      return false
    }
  }
  return samePath(path, slug)
}
