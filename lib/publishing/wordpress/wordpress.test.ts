// ─────────────────────────────────────────────────────────────────────────────
// WordPress connector
// SEO Engine - The site nobody could test against, tested.
// ─────────────────────────────────────────────────────────────────────────────
//
// No WordPress site is connected to this engine: both real sites are Next.js.
// Every correction to this connector used to be validated by publishing on
// someone's live site. These doubles are the replacement — the six failure
// causes, the slug collision, the redirect, the KSES strip and the draft are all
// exercised here instead.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWpClient, looksLikeApplicationPassword, WpError } from './rest'
import { detectDialect, metaFor } from './dialect'
import { decideTarget, refusalKindFor } from './target'
import { wordPressConnector } from './index'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { Site } from '@/lib/types'

const SITE_URL = 'https://exemple.fr'

const CLIENT = () => createWpClient({ siteUrl: SITE_URL, username: 'admin', appPassword: 'x' })

/**
 * Answer WordPress calls by matching the URL, in declaration order.
 *
 * Returns what was sent, so a test can assert on the body — which is how the
 * canonical bug is caught.
 */
function wp(routes: Array<{ match: RegExp; status?: number; body?: unknown; text?: string }>) {
  const sent: Array<{ url: string; method: string; body: unknown }> = []

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })

    const route = routes.find((r) => r.match.test(url))
    if (!route) return new Response('[]', { status: 200 })
    if (route.text !== undefined) return new Response(route.text, { status: route.status ?? 200 })
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 })
  }))

  return sent
}

afterEach(() => vi.unstubAllGlobals())

// ─── Le client ───────────────────────────────────────────────────────────────

describe('client REST', () => {
  it('refuse http:// a la construction', () => {
    // WordPress disables application passwords over plain HTTP: the credentials
    // are right, the login is refused, and nothing says why.
    expect(() => createWpClient({ siteUrl: 'http://exemple.fr', username: 'a', appPassword: 'b' }))
      .toThrow(/HTTPS/)
  })

  it('nomme les six causes au lieu d une seule phrase', async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, { code: 'rest_forbidden' }, 'auth_refusee'],
      [403, { code: 'rest_cannot_create' }, 'droits_insuffisants'],
      [403, { code: 'waf_block' }, 'rest_filtre'],
      [404, { code: 'rest_no_route' }, 'rest_desactive'],
    ]

    for (const [status, body, expected] of cases) {
      wp([{ match: /.*/, status, body }])
      await expect(CLIENT().get('/wp/v2/users/me')).rejects.toMatchObject({ failure: expected })
    }
  })

  it('distingue une reponse HTML d une erreur d authentification', async () => {
    // A security plugin answering with an HTML page used to surface as
    // "Erreur inconnue".
    wp([{ match: /.*/, status: 200, text: '<!DOCTYPE html><html>…' }])
    await expect(CLIENT().get('/wp/v2/users/me')).rejects.toMatchObject({ failure: 'reponse_illisible' })
  })

  it('rend le site injoignable plutot que de lever brut', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(CLIENT().get('/')).rejects.toMatchObject({ failure: 'rest_injoignable' })
  })
})

// ─── Les dialectes ───────────────────────────────────────────────────────────

describe('dialecte SEO', () => {
  it('reconnait l extension par son namespace REST', () => {
    expect(detectDialect(['wp/v2', 'rankmath/v1'])).toBe('rankmath')
    expect(detectDialect(['wp/v2', 'yoast/v1'])).toBe('yoast')
    expect(detectDialect(['wp/v2', 'seopress/v1'])).toBe('seopress')
    expect(detectDialect(['wp/v2'])).toBe('aucun')
  })

  it('n envoie AUCUNE cle quand aucune extension ne les lira', () => {
    // Nineteen rank_math_* keys used to go out unconditionally. On a Yoast site
    // they become orphan postmeta rows and the page ships with the theme title.
    expect(metaFor('aucun', FIELDS)).toEqual({})
  })

  it('traduit les six champs surs dans le bon dialecte', () => {
    expect(metaFor('yoast', FIELDS)._yoast_wpseo_title).toBe('Titre')
    expect(metaFor('seopress', FIELDS)._seopress_titles_desc).toBe('Description')
    expect(metaFor('rankmath', FIELDS).rank_math_focus_keyword).toBe('taxi troyes')
  })

  it('n emet plus les cles de schema, qui recevaient du JSON-LD brut', () => {
    // RankMath stores its schema in its own %variable% format; handing it a raw
    // JSON-LD blob stored something unusable and reported success.
    const keys = Object.keys(metaFor('rankmath', FIELDS)).join(' ')
    expect(keys).not.toContain('schema')
    expect(keys).not.toContain('advanced_robots')
  })

  it('omet un champ vide au lieu d ecraser avec du vide', () => {
    expect(metaFor('rankmath', { ...FIELDS, canonical: '' })).not.toHaveProperty('rank_math_canonical_url')
  })
})

const FIELDS = {
  title: 'Titre',
  description: 'Description',
  canonical: 'https://exemple.fr/taxi/',
  focusKeyword: 'taxi troyes',
  ogTitle: 'OG',
  ogDescription: 'OG desc',
}

// ─── La cible ────────────────────────────────────────────────────────────────

describe('decideTarget', () => {
  it('cree quand le slug est libre', async () => {
    wp([{ match: /pages\?|posts\?/, body: [] }])
    expect(await decideTarget(CLIENT(), { slug: 'taxi-gare' })).toEqual({ action: 'creer' })
  })

  it('REFUSE un slug occupe par une page du proprietaire', async () => {
    // THE destructive scenario. WordPress does not refuse: it creates
    // `/contact-2`, and the canonical the engine wrote pointed at `/contact` —
    // the owner's real page, offered to Google as the duplicate.
    wp([{ match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/contact/`, status: 'publish', slug: 'contact' }] }])

    const target = await decideTarget(CLIENT(), { slug: 'contact' })
    expect(target.action).toBe('refuser')
    expect(target.action === 'refuser' && target.reason).toContain('ecraser une page du proprietaire')
  })

  it('met a jour la page que le moteur a lui-meme publiee', async () => {
    wp([{ match: /pages\?/, body: [{ id: 42, link: `${SITE_URL}/taxi/`, status: 'publish', slug: 'taxi' }] }])

    const target = await decideTarget(CLIENT(), { slug: 'taxi', knownRemoteId: 42 })
    expect(target.action).toBe('mettre-a-jour')
  })

  it('voit un ARTICLE qui occupe le meme slug', async () => {
    // WordPress lets a post and a page share a slug; the visitor gets a
    // collision the engine never looked for.
    wp([
      { match: /pages\?/, body: [] },
      { match: /posts\?/, body: [{ id: 9, link: `${SITE_URL}/actu/`, status: 'publish', slug: 'actu' }] },
    ])
    expect((await decideTarget(CLIENT(), { slug: 'actu' })).action).toBe('refuser')
  })

  it('REFUSE une URL que le site redirige', async () => {
    // `.htaccess` and redirection plugins are invisible to the REST API. Only
    // asking the URL sees them — the lesson the Next.js side learned by
    // publishing onto a deliberately redirected path.
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /exemple\.fr\/taxi-troyes\//, status: 301 },
    ])
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/wp-json/.test(url)) return new Response('[]', { status: 200 })
      return new Response(null, { status: 301, headers: { location: '/' } })
    }))

    const target = await decideTarget(CLIENT(), { slug: 'taxi-troyes' })
    expect(target.action).toBe('refuser')
    expect(target.action === 'refuser' && target.reason).toContain('redirection')
    // And it is filed as a REDIRECTION, not as an occupancy. The two call for
    // different sentences to the operator, and `generations.refusal_kind` is
    // what the screen branches on.
    expect(target.action === 'refuser' && refusalKindFor(target.reason)).toBe('redirection')
  })

  it('classe les deux refus de decideTarget, et une seule fois pour ses deux appelants', () => {
    // The connector stores this in `refusal_kind`; the occupancy probe returns
    // it as a `ProbeReason`. Both used to carry their own copy of the test, and
    // a third refusal reason would have been filed under two different kinds.
    // Fed with the exact sentences `decideTarget` writes.
    expect(
      refusalKindFor(
        '/taxi-troyes est une source de redirection sur ce site (HTTP 301 vers /). ' +
          'La page publiee serait inatteignable — changer le slug.'
      )
    ).toBe('redirection')
    expect(
      refusalKindFor(
        '/taxi-troyes existe deja sur ce site (page 7, statut publish) et le moteur ne l a pas ecrite.'
      )
    ).toBe('occupe')
  })

  it('ne prend pas « je ne peux pas lire » pour « rien la »', async () => {
    // The assumption that created the duplicate in the first place.
    wp([{ match: /pages\?/, status: 403, body: { code: 'rest_cannot_read' } }])
    await expect(decideTarget(CLIENT(), { slug: 'taxi' })).rejects.toBeInstanceOf(WpError)
  })

  it('force reprend la page existante au lieu d en creer une seconde', async () => {
    wp([{ match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/x/`, status: 'publish', slug: 'x' }] }])
    const target = await decideTarget(CLIENT(), { slug: 'x', force: true })
    expect(target.action).toBe('mettre-a-jour')
  })

  it('replaces n ouvre QUE la page qu il nomme', async () => {
    // The whole safety property of the targeted override, in one test. A key
    // that opens the named door is useful; a key that opens any door is `force`
    // under another name, and the owner of this site has pages that rank.
    //
    // Both assertions live here on purpose: proving the door opens proves
    // nothing about the lock. Only the mismatch, refused with the sentence it
    // has always been refused with, proves the target is load-bearing.
    const owned = { id: 7, link: `${SITE_URL}/tarifs/`, status: 'publish', slug: 'tarifs' }

    wp([{ match: /pages\?/, body: [owned] }])
    const named = await decideTarget(CLIENT(), { slug: 'tarifs', replaces: { path: '/tarifs' } })
    expect(named.action).toBe('mettre-a-jour')
    expect(named.action === 'mettre-a-jour' && named.reason).toContain('demande explicite')

    wp([{ match: /pages\?/, body: [owned] }])
    const elsewhere = await decideTarget(CLIENT(), { slug: 'tarifs', replaces: { path: '/contact' } })
    expect(elsewhere.action).toBe('refuser')
    expect(elsewhere.action === 'refuser' && elsewhere.reason).toContain('ecraser une page du proprietaire')
  })

  it('compare le chemin nomme sans se laisser arreter par un slash ou une majuscule', async () => {
    // `/Tarifs/` and `tarifs` come from two different screens and mean the same
    // page. Refusing on the spelling would push the operator towards `force`,
    // which is the one outcome this feature exists to avoid.
    wp([{ match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/tarifs/`, status: 'publish', slug: 'tarifs' }] }])

    const target = await decideTarget(CLIENT(), { slug: 'tarifs', replaces: { path: '/Tarifs/' } })
    expect(target.action).toBe('mettre-a-jour')
  })

  it('sans replaces, le refus est mot pour mot celui d avant', async () => {
    // The default path must be untouched by the addition: a request that names
    // nothing behaves exactly as it did.
    wp([{ match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/tarifs/`, status: 'publish', slug: 'tarifs' }] }])

    const target = await decideTarget(CLIENT(), { slug: 'tarifs' })
    expect(target.action).toBe('refuser')
    expect(target.action === 'refuser' && refusalKindFor(target.reason)).toBe('occupe')
  })
})

// ─── Le connecteur de bout en bout ───────────────────────────────────────────

const PAGE = {
  title: 'Taxi gare',
  metaDescription: 'Reserver.',
  slug: 'taxi-gare',
  focusKeyword: 'taxi gare',
  ogTitle: 'Taxi',
  ogDescription: 'Reserver.',
  htmlContent: '<h1>Taxi</h1>',
  schemaLocalBusiness: '{"@type":"TaxiService"}',
  schemaFaqPage: '{}',
  schemaBreadcrumb: '{}',
} as unknown as GeneratedPage

const SITE = {
  id: 's1', name: 'Exemple', type: 'wordpress', url: SITE_URL,
  wp_username: 'admin', wp_app_password: 'x',
} as unknown as Site

describe('connecteur WordPress', () => {
  it('publie, puis relit ce que WordPress a garde', async () => {
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { name: 'Exemple', namespaces: ['wp/v2', 'rankmath/v1'] } },
      { match: /pages$/, body: { id: 55, link: `${SITE_URL}/taxi-gare/`, status: 'publish', slug: 'taxi-gare' } },
      {
        match: /pages\/55/,
        body: {
          id: 55, link: `${SITE_URL}/taxi-gare/`, status: 'publish', slug: 'taxi-gare',
          content: { raw: '<h1>Taxi</h1><script type="application/ld+json">{}</script>' },
          meta: { rank_math_title: 'Taxi gare' },
        },
      },
    ])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })

    expect(outcome.ok).toBe(true)
    expect(outcome.written).toBe(true)
    expect(outcome.live).toBe(true)
    expect(outcome.remoteId).toBe('55')
    expect(outcome.pageUrl).toBe(`${SITE_URL}/taxi-gare/`)
  })

  it('signale que WordPress a retire les donnees structurees', async () => {
    // KSES strips <script> for every account without `unfiltered_html`, which is
    // every non-administrator. The JSON-LD simply vanished, silently.
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages$/, body: { id: 55, link: `${SITE_URL}/x/`, status: 'publish' } },
      { match: /pages\/55/, body: { id: 55, link: `${SITE_URL}/x/`, status: 'publish', content: { raw: '<h1>Taxi</h1>' } } },
    ])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })
    expect(outcome.notes.join(' ')).toContain('KSES')
  })

  it('un brouillon n est PAS en ligne', async () => {
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages$/, body: { id: 55, link: `${SITE_URL}/?page_id=55`, status: 'draft' } },
      { match: /pages\/55/, body: { id: 55, link: `${SITE_URL}/?page_id=55`, status: 'draft', content: { raw: '' } } },
    ])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'brouillon' })
    expect(outcome.ok).toBe(true)
    expect(outcome.live).toBe(false)
    expect(outcome.discoverable).toBe(false)
  })

  it('dit qu aucune extension SEO ne lira les metadonnees', async () => {
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages$/, body: { id: 55, link: `${SITE_URL}/x/`, status: 'publish' } },
      { match: /pages\/55/, body: { id: 55, status: 'publish', link: `${SITE_URL}/x/`, content: { raw: '' } } },
    ])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })
    expect(outcome.notes.join(' ')).toContain('Aucune extension SEO')
  })

  it('n invente pas de canonical a la creation', async () => {
    // `${siteUrl}/${slug}/` was guessed — and after WordPress renamed our page
    // to `slug-2`, that guess pointed at the owner's original page.
    const sent = wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['rankmath/v1'] } },
      { match: /pages$/, body: { id: 55, link: `${SITE_URL}/taxi-gare-2/`, status: 'publish' } },
      { match: /pages\/55/, body: { id: 55, status: 'publish', link: `${SITE_URL}/taxi-gare-2/`, content: { raw: '' } } },
    ])

    await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })

    const create = sent.find((call) => call.method === 'POST')
    const meta = (create?.body as { meta?: Record<string, string> })?.meta ?? {}
    expect(meta.rank_math_canonical_url).toBeUndefined()
  })

  it('refuse sans rien ecrire quand le slug appartient au proprietaire', async () => {
    const sent = wp([
      { match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/contact/`, status: 'publish', slug: 'contact' }] },
    ])

    const outcome = await wordPressConnector.publish({
      site: SITE, page: { ...PAGE, slug: 'contact' } as GeneratedPage, intent: 'publie',
    })

    expect(outcome.refusal?.kind).toBe('occupe')
    expect(outcome.written).toBe(false)
    expect(sent.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('fait DESCENDRE `replaces` jusqu a la decision de destination', async () => {
    // LA COUTURE. `decideTarget` savait deja lire `replaces` et `target.ts` etait
    // teste ; le connecteur, lui, ne le lui passait pas. Une reprise validee a la
    // main dans /publish repartait donc en refus 'occupe', et le seul geste qui
    // restait a l'operateur pour ecrire sur cette page etait `force` — c'est-a-
    // dire l'ecrasement en aveugle que `replaces` existe pour remplacer.
    //
    // Le test precedent tient l'autre moitie : SANS `replaces`, meme fixture,
    // meme slug, le refus est intact.
    const owned = { id: 7, link: `${SITE_URL}/contact/`, status: 'publish', slug: 'contact' }
    const sent = wp([
      { match: /pages\/7/, body: { ...owned, content: { raw: '<h1>Taxi</h1>' } } },
      { match: /pages\?|posts\?/, body: [owned] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
    ])

    const outcome = await wordPressConnector.publish({
      site: SITE,
      page: { ...PAGE, slug: 'contact' } as GeneratedPage,
      intent: 'publie',
      replaces: { path: '/contact' },
    })

    expect(outcome.refusal).toBeUndefined()
    expect(outcome.written).toBe(true)
    expect(outcome.remoteId).toBe('7')

    // Ecrit SUR la page nommee, et jamais a cote : une creation supplementaire
    // laisserait la page du proprietaire intacte et poserait un doublon.
    const writes = sent.filter((call) => call.method === 'POST')
    expect(writes.map((call) => call.url).some((url) => /\/pages\/7$/.test(url))).toBe(true)
    expect(writes.map((call) => call.url).some((url) => /\/pages$/.test(url))).toBe(false)
  })
})

// ─── Ce que la revue adversariale a trouve ───────────────────────────────────
//
// Twelve findings survived verification. These lock the ones that touched this
// connector. Each block names the scenario that made the first version wrong.

describe('written : la position, pas le type d erreur', () => {
  it('un timeout PENDANT la creation compte comme ecrit', async () => {
    // The likeliest half-write there is: a shared host takes 25 s to insert the
    // page, the 20 s budget fires, and WordPress has the row. Reported as "not
    // written", the scheduler requeues and the next tick makes a second page.
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls += 1
      if (init?.method === 'POST') throw new Error('The operation was aborted due to timeout')
      if (/wp-json\/$|wp-json$/.test(url)) return new Response(JSON.stringify({ namespaces: ['wp/v2'] }), { status: 200 })
      return new Response('[]', { status: 200 })
    }))

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })

    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(true)
    expect(calls).toBeGreaterThan(0)
  })

  it('un echec AVANT la creation ne compte pas comme ecrit', async () => {
    // The mirror image: reported as written, the row is marked published with no
    // page anywhere and leaves every queue.
    wp([{ match: /pages\?/, status: 500, body: { code: 'internal' } }])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })

    expect(outcome.ok).toBe(false)
    expect(outcome.written).toBe(false)
  })
})

describe('la page que le moteur possede', () => {
  it('la retrouve par son identifiant meme si le slug a change', async () => {
    // WordPress renames on collision, and humans rename in wp-admin. Looking up
    // by slug alone made the guard blind to our own pages and created a copy on
    // every republication.
    wp([
      { match: /pages\/42/, body: { id: 42, link: `${SITE_URL}/taxi-gare-2/`, status: 'publish', slug: 'taxi-gare-2' } },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages\/42$/, body: { id: 42, link: `${SITE_URL}/taxi-gare-2/`, status: 'publish', content: { raw: '' } } },
    ])

    const target = await decideTarget(CLIENT(), { slug: 'taxi-gare', knownRemoteId: 42 })
    expect(target.action).toBe('mettre-a-jour')
    expect(target.action === 'mettre-a-jour' && target.reason).toContain('taxi-gare-2')
  })

  it('ne prend pas une lecture refusee pour une page disparue', async () => {
    // Reading that as "gone" makes the engine create a second copy of a page
    // that is still standing.
    wp([{ match: /pages\/42/, status: 403, body: { code: 'rest_forbidden' } }])
    await expect(decideTarget(CLIENT(), { slug: 'x', knownRemoteId: 42 })).rejects.toBeInstanceOf(WpError)
  })
})

describe('la sonde de redirection', () => {
  it('ignore la normalisation du slash finale de WordPress', async () => {
    // WordPress redirects `/x/` to `/x` constantly and it means nothing. Refusing
    // on any 3xx blocked free slugs with a false reason — and on the scheduler
    // that refusal came back every fifteen minutes.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/wp-json/.test(url)) return new Response('[]', { status: 200 })
      return new Response(null, { status: 301, headers: { location: '/taxi-gare' } })
    }))

    expect((await decideTarget(CLIENT(), { slug: 'taxi-gare' })).action).toBe('creer')
  })

  it('refuse toujours une redirection qui mene ailleurs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/wp-json/.test(url)) return new Response('[]', { status: 200 })
      return new Response(null, { status: 301, headers: { location: '/' } })
    }))

    expect((await decideTarget(CLIENT(), { slug: 'taxi-gare' })).action).toBe('refuser')
  })
})

describe('les degradations qui mentaient', () => {
  it('ne conclut pas « aucune extension SEO » quand la decouverte echoue', async () => {
    // A site running Rank Math shipped every page with no SEO title, and the
    // note accused it of not having the plugin it has.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (/wp-json\/$|wp-json$/.test(url) && init?.method !== 'POST') {
        if (!/wp\/v2/.test(url)) return new Response('nope', { status: 500 })
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 5, link: `${SITE_URL}/x/`, status: 'publish' }), { status: 200 })
      }
      if (/pages\/5/.test(url)) {
        return new Response(JSON.stringify({ id: 5, status: 'publish', link: `${SITE_URL}/x/`, content: { raw: '' } }), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    }))

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })
    expect(outcome.notes.join(' ')).toContain('/wp-json')
    expect(outcome.notes.join(' ')).not.toContain('Aucune extension SEO detectee')
  })

  it('force ne depublie pas la page qu il reprend', async () => {
    // The default intent on the HTTP route is `brouillon`. Forcing over a
    // published page would have replaced its content AND pulled it offline.
    const sent = wp([
      { match: /pages\?/, body: [{ id: 7, link: `${SITE_URL}/contact/`, status: 'publish', slug: 'contact' }] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages\/7$/, body: { id: 7, link: `${SITE_URL}/contact/`, status: 'publish', content: { raw: '' } } },
    ])

    await wordPressConnector.publish({
      site: SITE, page: { ...PAGE, slug: 'contact' } as GeneratedPage, intent: 'brouillon', force: true,
    })

    const write = sent.find((call) => call.method === 'POST')
    expect((write?.body as { status?: string })?.status).toBe('publish')
  })
})

// ─── Ce que la SECONDE revue a trouve, sur les correctifs eux-memes ──────────

describe('written : la preuve prime sur la position', () => {
  it('un 4xx RECU pendant la creation prouve que rien n a ete ecrit', async () => {
    // My own overcorrection. Tracking the position fixed the timeout case and
    // broke the opposite one: a template WordPress does not know, a WAF blocking
    // the POST because the body carries a <script>, a revoked password — all
    // answer 4xx, all prove nothing was inserted, all were reported as written.
    for (const [status, body] of [[400, { code: 'rest_invalid_param' }], [403, { code: 'waf' }]] as const) {
      wp([
        { match: /pages\?|posts\?/, body: [] },
        { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
        { match: /pages$/, status, body },
      ])

      const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })
      expect(outcome.ok).toBe(false)
      expect(outcome.written).toBe(false)
    }
  })

  it('un 5xx reste « peut-etre ecrit » : une extension peut planter apres l insertion', async () => {
    wp([
      { match: /pages\?|posts\?/, body: [] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /pages$/, status: 502, text: '<html>bad gateway' },
    ])

    const outcome = await wordPressConnector.publish({ site: SITE, page: PAGE, intent: 'publie' })
    expect(outcome.written).toBe(true)
  })
})

describe('reprise apres une publication interrompue', () => {
  it('reconnait sa propre page par le titre plutot que de la refuser', async () => {
    // The nominal recovery: the reaper hands back a row whose push was cut off
    // before the id was recorded. Without this the retry finds the page it
    // created itself, calls it the owner's, and parks the row in `failed`.
    wp([{ match: /pages\?/, body: [{ id: 71, link: `${SITE_URL}/taxi-gare/`, status: 'publish', slug: 'taxi-gare', title: { raw: 'Taxi gare' } }] }])

    const target = await decideTarget(CLIENT(), {
      slug: 'taxi-gare', recovering: true, expectedTitle: 'Taxi gare',
    })
    expect(target.action).toBe('mettre-a-jour')
  })

  it('refuse toujours une page dont le titre differe', async () => {
    // The evidence is what keeps this from being a licence to overwrite.
    wp([{ match: /pages\?/, body: [{ id: 71, link: `${SITE_URL}/contact/`, status: 'publish', slug: 'contact', title: { raw: 'Nous contacter' } }] }])

    const target = await decideTarget(CLIENT(), {
      slug: 'contact', recovering: true, expectedTitle: 'Taxi gare',
    })
    expect(target.action).toBe('refuser')
  })
})

describe('la cible porte son type', () => {
  it('met a jour un ARTICLE sur /posts, pas sur /pages', async () => {
    // `/wp/v2/pages/{id}` for a post id is a 404 against unrelated content.
    const sent = wp([
      { match: /pages\?/, body: [] },
      { match: /posts\?/, body: [{ id: 9, link: `${SITE_URL}/actu/`, status: 'publish', slug: 'actu', title: { raw: 'Taxi gare' } }] },
      { match: /wp-json\/$|wp-json$/, body: { namespaces: ['wp/v2'] } },
      { match: /posts\/9$/, body: { id: 9, link: `${SITE_URL}/actu/`, status: 'publish', content: { raw: '' } } },
    ])

    await wordPressConnector.publish({
      site: SITE,
      page: { ...PAGE, slug: 'actu' } as GeneratedPage,
      intent: 'publie',
      force: true,
    })

    const write = sent.find((call) => call.method === 'POST')
    expect(write?.url).toContain('/wp/v2/posts/9')
  })
})

describe('samePath', () => {
  it('ne prend pas une redirection vers un autre domaine pour une normalisation', async () => {
    // Slicing by origin length assumed the redirect stayed on the same host: a
    // redirect to a competitor produced a path that matched, and the guard let
    // the publication through.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/wp-json/.test(url)) return new Response('[]', { status: 200 })
      return new Response(null, { status: 301, headers: { location: 'https://autre.fr/taxi-gare' } })
    }))

    expect((await decideTarget(CLIENT(), { slug: 'taxi-gare' })).action).toBe('refuser')
  })

  it('tolere toujours la normalisation sur le meme domaine', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/wp-json/.test(url)) return new Response('[]', { status: 200 })
      return new Response(null, { status: 301, headers: { location: `${SITE_URL}/taxi-gare` } })
    }))

    expect((await decideTarget(CLIENT(), { slug: 'taxi-gare' })).action).toBe('creer')
  })
})

// ─── Le premier vrai site WordPress ──────────────────────────────────────────
//
// Confirmed against a live installation: the field held an account password, the
// REST API answered 401, and the setup screen said « Connexion refusée » followed
// by the name of the site — the one thing that had worked.

describe('mot de passe d application', () => {
  it('reconnait la forme que WordPress genere', () => {
    expect(looksLikeApplicationPassword('AbCd 1234 EfGh 5678 IjKl 9012')).toBe(true)
    // WordPress strips the spaces itself before comparing.
    expect(looksLikeApplicationPassword('AbCd1234EfGh5678IjKl9012')).toBe(true)
  })

  it('refuse un mot de passe de compte', () => {
    // Same shape as the value that failed on the first real connection: 24
    // characters, the right length, but carrying symbols. WordPress never
    // generates those, and the REST API never accepts an account password.
    //
    // Synthetic on purpose — a real credential has no business in a test file,
    // let alone in a public repository.
    expect(looksLikeApplicationPassword('AbC&dEfG$HiJkLmNo(pQrStU')).toBe(false)
    expect(looksLikeApplicationPassword('court')).toBe(false)
  })

  it('retire les espaces avant de construire l en-tete', async () => {
    // `wp_authenticate_application_password` strips non-alphanumerics before
    // comparing, so the spaces WordPress itself displays are irrelevant — but
    // sending them made a correctly copied password fail.
    let header: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)?.Authorization ?? null
      return new Response('{}', { status: 200 })
    }))

    const client = createWpClient({
      siteUrl: SITE_URL, username: 'admin', appPassword: 'AbCd 1234 EfGh 5678 IjKl 9012',
    })
    await client.get('/wp/v2/users/me')

    const decoded = Buffer.from(String(header).replace('Basic ', ''), 'base64').toString('utf-8')
    expect(decoded).toBe('admin:AbCd1234EfGh5678IjKl9012')
  })
})
