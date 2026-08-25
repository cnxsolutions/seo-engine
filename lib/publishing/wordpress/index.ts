// ─────────────────────────────────────────────────────────────────────────────
// WordPress connector
// SEO Engine - Look, decide, write, then read back what actually landed.
// ─────────────────────────────────────────────────────────────────────────────
//
// The four steps matter in that order, and the old publisher had only the third.
//
// The read-back is the one that stops the lying. WordPress does not store what
// you send it: KSES strips `<script>` from the content of any author without
// `unfiltered_html`, which is every account that is not an administrator — so
// the JSON-LD the engine embedded simply vanished, silently, on most installs.
// Post meta for a plugin that is not installed is accepted and ignored. A page
// created by an account without `publish_pages` comes back as `pending`, not
// `publish`. All three used to be reported as a successful publication.

import { detectDialect, dialectNote, metaFor, type SeoDialect } from './dialect'
import { diagnose } from './describe'
import { createWpClient, WpError, type WpClient } from './rest'
import { decideTarget, refusalKindFor, type WpPage } from './target'
import type { Connector } from '../connector'
import { rejectedOnArrival } from '../http-evidence'
import type { PublishOutcome, PublishRequest } from '../outcome'
import type { GeneratedPage } from '@/lib/ai/openai'

export const wordPressConnector: Connector = {
  label: 'WordPress',
  credentialColumns: ['wp_username', 'wp_app_password'],

  async describe(site) {
    const diagnosis = await diagnose({
      siteUrl: site.url,
      username: site.wp_username || '',
      appPassword: site.wp_app_password || '',
    })
    return {
      ok: diagnosis.ok,
      message: [diagnosis.message, ...diagnosis.notes].join(' · '),
    }
  },

  async publish(request: PublishRequest): Promise<PublishOutcome> {
    const { site, page, intent, force, signal } = request
    const notes: string[] = []

    let client: WpClient
    try {
      client = createWpClient({
        siteUrl: site.url,
        username: site.wp_username || '',
        appPassword: site.wp_app_password || '',
        signal,
      })
    } catch (error) {
      return fail(error, false)
    }

    // Where we are in the sequence, tracked rather than inferred.
    //
    // The first version guessed `written` from the ERROR TYPE, and guessed
    // wrong in both directions on the two most likely failures: a 20 s timeout
    // on a slow host raises `rest_injoignable` AFTER WordPress inserted the row
    // (reported as not written → the next tick creates a second page), while a
    // failed lookup BEFORE the POST was reported as written (row marked
    // published, no page anywhere). Position is knowable; error type is not a
    // proxy for it.
    let attemptedWrite = false

    try {
      // ─── 1. Where does this go? ────────────────────────────────────────────
      const target = await decideTarget(client, {
        slug: page.slug,
        knownRemoteId: request.knownRemoteId,
        force,
        // La reprise ciblee. Sans cette ligne `target.ts` recevait une option
        // que personne ne lui envoyait jamais : une mise a jour validee a la
        // main dans /publish repartait en refus 'occupe', et le seul moyen
        // restant d'ecrire sur cette page-la etait `force` — exactement le
        // resultat que `replaces` existe pour eviter.
        replaces: request.replaces,
        recovering: request.recovering,
        expectedTitle: page.title,
      })

      if (target.action === 'refuser') {
        return {
          ok: false,
          refusal: {
            // Classified by `target.ts`, which owns the reasons it writes. The
            // probe asks the same question and must get the same answer.
            kind: refusalKindFor(target.reason),
            message: target.reason,
          },
          written: false,
          live: false,
          discoverable: false,
          notes,
        }
      }
      if (target.action === 'mettre-a-jour') notes.push(target.reason)

      // ─── 2. Which plugin will read our metadata? ───────────────────────────
      // A failed discovery is NOT "no SEO plugin installed". Read that way, a
      // site running Rank Math shipped every page with no SEO title at all, and
      // the note blamed the site for a plugin it has.
      let discovery: { namespaces?: string[] } | null = null
      try {
        discovery = await client.anonymous<{ namespaces?: string[] }>('/')
      } catch {
        notes.push(
          'Impossible de lire /wp-json : extension SEO non identifiee, aucune metadonnee SEO posee ' +
            'sur cette page. Verifier que /wp-json est accessible publiquement.'
        )
      }
      const dialect = discovery ? detectDialect(discovery.namespaces) : 'aucun'
      const plugin = discovery ? dialectNote(dialect) : null
      if (plugin) notes.push(plugin)

      // ─── 3. Write ──────────────────────────────────────────────────────────
      //
      // Taking over an existing page must not change its visibility. The default
      // intent on the HTTP route is `brouillon`, so forcing over the owner's
      // `/contact` would have replaced its content AND pulled it offline — a 404
      // for visitors, gone from wp-sitemap.xml, reported as a success.
      const takeover = target.action === 'mettre-a-jour' && target.page.status === 'publish'
      const status = takeover || intent === 'publie' ? 'publish' : 'draft'
      if (takeover && intent !== 'publie') {
        notes.push('Page deja publiee sur le site : son statut est conserve plutot que remis en brouillon')
      }
      const body: Record<string, unknown> = {
        title: page.title,
        content: contentWithSchema(page),
        slug: page.slug,
        status,
        meta: metaFor(dialect, {
          title: page.title,
          description: page.metaDescription,
          // Taken from the page WordPress itself returns whenever we have one:
          // guessing `${siteUrl}/${slug}/` is what pointed a canonical at the
          // owner's page after WordPress quietly renamed ours to `slug-2`.
          canonical: target.action === 'mettre-a-jour' ? target.page.link : '',
          focusKeyword: page.focusKeyword,
          ogTitle: page.ogTitle,
          ogDescription: page.ogDescription,
        }),
      }
      if (site.wp_page_template) body.template = site.wp_page_template

      // The target's own post type, not `pages` by reflex: updating a post at
      // `/wp/v2/pages/{id}` is a 404 against an unrelated content id.
      const path =
        target.action === 'mettre-a-jour' ? `/wp/v2/${target.type}/${target.page.id}` : '/wp/v2/pages'

      // Set BEFORE the call, not after. A create that times out has already
      // reached WordPress; only a create never sent is safe to retry, and the
      // moment we stop being sure is the moment we hand it the request.
      attemptedWrite = true
      const written = await client.post<WpPage>(path, body)

      // From here the content exists on the site. Nothing below may report
      // `written: false`, whatever it finds.
      // ─── 4. Read back ──────────────────────────────────────────────────────
      const review = await readBack(client, written.id, dialect, notes)

      const live = review.status === 'publish'
      if (!live) {
        notes.push(
          review.status === 'pending'
            ? 'Page en attente de relecture : le compte ne peut pas publier'
            : `Enregistree en « ${review.status} » : invisible tant qu elle n est pas publiee`
        )
      }

      return {
        ok: true,
        written: true,
        live,
        // wp-sitemap.xml builds itself, but only lists published content.
        discoverable: live,
        pageUrl: review.link || written.link,
        remoteId: String(written.id),
        mode: `wp-${target.action === 'creer' ? 'creation' : 'maj'}-${dialect}`,
        notes,
      }
    } catch (error) {
      // Position answers UNCERTAINTY. A received 4xx is not uncertainty.
      //
      // Tracking the position fixed the timeout case and immediately broke the
      // opposite one: a template WordPress does not know, a WAF blocking the
      // POST because the body carries a <script>, a revoked password — all
      // answer 4xx, all prove nothing was inserted, and all were being reported
      // as written. The row then said "published" with no page anywhere and left
      // every queue for good.
      //
      // 5xx stays "possibly written": a plugin can fatal AFTER wp_insert_post().
      // 408 too — a proxy can time out on a request WordPress already served.
      //
      // The rule itself now lives in ../http-evidence, shared with the Google
      // listing connector, whose POST is just as non-idempotent as this one. Read
      // there why it is decided on the status and not on the failure name — and
      // why 429 joined 408. Anything that is not a `WpError` carries no status at
      // all: no answer came back, so nothing is proved either way.
      const httpStatus = error instanceof WpError ? error.status : undefined
      return fail(error, attemptedWrite && !rejectedOnArrival(httpStatus), notes)
    }
  },
}

interface ReadBack {
  status: string
  link: string
}

/**
 * Ask WordPress what it kept.
 *
 * Cheap — one GET — and it is the only way to know whether the metadata took,
 * whether the structured data survived KSES, and what status the page really
 * has. Its findings become notes, never failures: the page is online either way,
 * and the operator needs to be told, not blocked.
 */
async function readBack(
  client: WpClient,
  id: number,
  dialect: SeoDialect,
  notes: string[]
): Promise<ReadBack> {
  const stored = await client
    .get<WpPage & { content?: { rendered?: string; raw?: string } }>(`/wp/v2/pages/${id}`, {
      context: 'edit',
    })
    .catch(() => null)

  if (!stored) {
    notes.push('Relecture impossible : impossible de confirmer ce que WordPress a enregistre')
    return { status: 'inconnu', link: '' }
  }

  const html = stored.content?.raw ?? stored.content?.rendered ?? ''
  if (!html.includes('application/ld+json')) {
    notes.push(
      'Les donnees structurees ont ete retirees par WordPress (KSES) : le compte utilise ' +
        "n'a pas le droit `unfiltered_html`. Aucun balisage schema.org sur cette page."
    )
  }

  if (dialect !== 'aucun') {
    const meta = (stored.meta ?? {}) as Record<string, unknown>
    const posed = Object.keys(metaFor(dialect, EMPTY_PROBE)).filter((key) => key in meta)
    if (posed.length === 0 && Object.keys(meta).length > 0) {
      notes.push(
        `Les cles ${dialect} n apparaissent pas dans la reponse : l extension ne les expose ` +
          'peut-etre pas via REST. Verifier le titre SEO dans wp-admin.'
      )
    }
  }

  return { status: stored.status ?? 'inconnu', link: stored.link ?? '' }
}

/** Only the KEYS of this matter — it is used to ask which ones the dialect uses. */
const EMPTY_PROBE = {
  title: 'x', description: 'x', canonical: 'x', focusKeyword: 'x', ogTitle: 'x', ogDescription: 'x',
}

/**
 * Structured data, still embedded in the content.
 *
 * Not because it is good — a `<script>` in post content is at the mercy of KSES
 * and of the editor — but because the alternative was handing raw JSON-LD to
 * `rank_math_schema_*`, which expects RankMath's own internal format and
 * therefore stored nothing usable. Embedding at least works for administrator
 * accounts, and the read-back now says when it did not.
 */
function contentWithSchema(page: GeneratedPage): string {
  const blocks = [page.schemaLocalBusiness, page.schemaFaqPage, page.schemaBreadcrumb]
    .filter((schema) => schema && schema !== '{}')
    .map((schema) => `<script type="application/ld+json">${schema}</script>`)
    .join('\n')

  return blocks ? `${page.htmlContent}\n\n${blocks}` : page.htmlContent
}

/**
 * @param written whether the create request had already been handed to
 *   WordPress. Taken from the caller's position in the sequence — never guessed
 *   from the kind of error, which is what made this wrong in both directions.
 */
function fail(error: unknown, written: boolean, notes: string[] = []): PublishOutcome {
  const message = error instanceof WpError ? error.message : error instanceof Error ? error.message : String(error)

  return {
    ok: false,
    error: message,
    written,
    live: false,
    discoverable: false,
    notes: written
      ? [...notes, 'Une page a peut-etre ete creee cote WordPress : verifier avant de relancer']
      : notes,
  }
}
