import { NextRequest, NextResponse } from 'next/server'
import {
  countInFlightGenerations,
  deleteSite,
  getSiteByIdSafe,
  listSites,
  updateSiteSafe,
} from '@/lib/db'
import { normalizeSiteUrl } from '@/lib/site-url'
import type { Site } from '@/lib/types'

/**
 * Both handlers hand a site straight to the client, so both depend on
 * `getSiteByIdSafe()` / `updateSiteSafe()` never selecting `wp_app_password`
 * nor `github_token` (see SITE_SAFE_COLUMNS in lib/db.ts). The body of a
 * PATCH may CONTAIN those secrets — that is how they are rotated — but they
 * only ever travel inwards.
 */

/** Fields a PATCH may carry. Anything else in the body is ignored, not refused. */
const PATCHABLE_TEXT = ['name', 'url', 'wp_username', 'wp_page_template', 'github_repo', 'github_branch'] as const
const PATCHABLE_SECRETS = ['wp_app_password', 'github_token'] as const
const PATCHABLE_FLAGS = ['auto_promote', 'is_active'] as const

/**
 * What this route writes. `Site` types its optional columns as `string`, but
 * clearing one means writing SQL NULL, not an empty string — a `''` login
 * would still look « filled » to every `if (site.wp_username)` downstream.
 */
type SitePatch = { [K in keyof Site]?: Site[K] | null }

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const payload = await req.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
    }

    const existing = await getSiteByIdSafe(id)
    if (!existing) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    const values: SitePatch = {}

    for (const field of PATCHABLE_TEXT) {
      if (!(field in payload)) continue
      const value = payload[field]
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `Champ invalide : ${field}` }, { status: 400 })
      }
      values[field] = value === null ? null : value.trim()
    }

    for (const field of PATCHABLE_FLAGS) {
      if (!(field in payload)) continue
      if (typeof payload[field] !== 'boolean') {
        return NextResponse.json({ error: `Champ invalide : ${field}` }, { status: 400 })
      }
      values[field] = payload[field]
    }

    // An empty secret is the form's way of saying « unchanged » : the field is
    // rendered blank because the stored value never reaches the browser, and
    // saving the form must not wipe a password the operator did not retype.
    for (const field of PATCHABLE_SECRETS) {
      if (typeof payload[field] === 'string' && payload[field].trim()) {
        values[field] = payload[field].trim()
      }
    }

    if ('name' in values && !values.name) {
      return NextResponse.json({ error: 'Le nom du site est requis.' }, { status: 400 })
    }

    if ('url' in values) {
      if (!values.url) {
        return NextResponse.json({ error: "L'adresse du site est requise." }, { status: 400 })
      }
      // Same guard as the creation: one site per address, so that two rows can
      // never be published to for the same client site. Only when the address
      // actually moves — re-saving the form with the current URL is not a move.
      const wanted = normalizeSiteUrl(values.url)
      if (wanted !== normalizeSiteUrl(existing.url)) {
        const duplicate = (await listSites()).find((site) => site.id !== id && normalizeSiteUrl(site.url) === wanted)
        if (duplicate) {
          return NextResponse.json(
            { error: `Ce site existe déjà : « ${duplicate.name} » (${duplicate.url}).` },
            { status: 409 }
          )
        }
      }
    }

    // A WordPress site without a login is a row nothing can publish to, and the
    // failure would only surface on the day a cycle runs. The password cannot
    // be cleared through this route at all (see the secrets loop above). Same
    // for the repository of a Next.js site.
    if (existing.type === 'wordpress' && 'wp_username' in values && !values.wp_username) {
      return NextResponse.json({ error: 'Les identifiants WordPress sont requis.' }, { status: 400 })
    }
    if (existing.type === 'nextjs' && 'github_repo' in values && !values.github_repo) {
      return NextResponse.json({ error: 'Le repo et le token GitHub sont requis.' }, { status: 400 })
    }
    if ('wp_username' in values && !values.wp_username) values.wp_username = null
    if ('github_repo' in values && !values.github_repo) values.github_repo = null

    // No branch means publication targets the default branch directly, and
    // there is nothing left to promote: the flag follows the branch, whether
    // the branch was just cleared or was never set.
    if ('github_branch' in values && !values.github_branch) values.github_branch = null
    const branch = 'github_branch' in values ? values.github_branch : existing.github_branch
    if ('github_branch' in values || 'auto_promote' in values) {
      values.auto_promote = Boolean(branch) && (values.auto_promote ?? existing.auto_promote ?? false)
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ success: true, site: existing })
    }

    const site = await updateSiteSafe(id, values as Partial<Site>)
    if (!site) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    return NextResponse.json({ success: true, site })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params

    const existing = await getSiteByIdSafe(id)
    if (!existing) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    // A worker mid-generation or a publisher mid-upload would finish against a
    // site that no longer exists. Refusing is cheaper than cleaning up a page
    // that landed on the client's site with no record left to point at it.
    if ((await countInFlightGenerations({ site_id: id })) > 0) {
      return NextResponse.json(
        { error: 'Une publication ou une génération est en cours sur ce site — réessayez dans quelques minutes.' },
        { status: 409 }
      )
    }

    const deleted = await deleteSite(id)
    if (!deleted) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
