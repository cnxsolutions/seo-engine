import { NextRequest, NextResponse } from 'next/server'
import { createSite, listSites, updateSite } from '@/lib/db'
import { analyzeNextJsRepo } from '@/lib/publishers/nextjs-analyzer'

/**
 * Both handlers below hand a site straight to the client, so both depend on
 * `listSites()` / `createSite()` never selecting `wp_app_password` nor
 * `github_token` (see SITE_SAFE_COLUMNS in lib/db.ts). Re-reading the row here
 * with a `select('*')` of any kind would put them back on the wire.
 */
export async function GET() {
  try {
    const sites = await listSites()
    return NextResponse.json({ sites })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const required = ['name', 'type', 'url']

    for (const field of required) {
      if (!payload[field]) {
        return NextResponse.json({ error: `Champ requis manquant: ${field}` }, { status: 400 })
      }
    }

    // An unknown connector inserts a row nothing can ever publish to: the
    // publisher branches on this exact value, and a typo would only surface as a
    // silent no-op on the day a cycle runs.
    if (payload.type !== 'wordpress' && payload.type !== 'nextjs') {
      return NextResponse.json({ error: 'Type de site invalide : "wordpress" ou "nextjs".' }, { status: 400 })
    }

    if (payload.type === 'wordpress' && (!payload.wp_username || !payload.wp_app_password)) {
      return NextResponse.json({ error: 'Les identifiants WordPress sont requis.' }, { status: 400 })
    }

    if (payload.type === 'nextjs' && (!payload.github_repo || !payload.github_token)) {
      return NextResponse.json({ error: 'Le repo et le token GitHub sont requis.' }, { status: 400 })
    }

    const site = await createSite({
      name: payload.name,
      type: payload.type,
      url: payload.url,
      wp_username: payload.wp_username || null,
      wp_app_password: payload.wp_app_password || null,
      wp_page_template: payload.wp_page_template || '',
      github_repo: payload.github_repo || null,
      github_token: payload.github_token || null,
      github_branch: payload.github_branch || undefined,
      // Only meaningful alongside a branch: without one, publication already
      // targets the default branch and there is nothing to promote.
      auto_promote: Boolean(payload.github_branch) && payload.auto_promote !== false,
      is_active: payload.is_active ?? true,
    })

    // Analyse the repository in the background so the first publication already
    // knows where pages go. A failure here is not a failure of the creation, but
    // it must be traceable: the sites page shows "jamais analysé" and offers a
    // manual retry, and this log is the only place that says why.
    if (payload.type === 'nextjs' && payload.github_repo && payload.github_token) {
      analyzeNextJsRepo(payload.github_repo, payload.github_token, payload.github_branch || undefined)
        .then((profile) => updateSite(site.id, { repo_profile: profile }))
        .catch((error) => {
          console.warn(`[sites] analyse du depot ${payload.github_repo} impossible :`, error instanceof Error ? error.message : error)
        })
    }

    return NextResponse.json({ success: true, site }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
