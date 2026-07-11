import { NextRequest, NextResponse } from 'next/server'
import { createSite, listSites, updateSite } from '@/lib/db'
import { analyzeNextJsRepo } from '@/lib/publishers/nextjs-analyzer'

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
      github_mdx_path: payload.github_mdx_path || 'content/pages',
      is_active: payload.is_active ?? true,
    })

    // Analyze Next.js repo structure in background
    if (payload.type === 'nextjs' && payload.github_repo && payload.github_token) {
      analyzeNextJsRepo(payload.github_repo, payload.github_token)
        .then((profile) => updateSite(site.id, { repo_profile: profile }))
        .catch(() => null)
    }

    return NextResponse.json({ success: true, site }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
