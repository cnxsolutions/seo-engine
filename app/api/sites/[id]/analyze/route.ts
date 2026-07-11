import { NextRequest, NextResponse } from 'next/server'
import { getSiteById, updateSite } from '@/lib/db'
import { analyzeNextJsRepo } from '@/lib/publishers/nextjs-analyzer'

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const site = await getSiteById(id)

    if (!site) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })
    }

    if (site.type !== 'nextjs') {
      return NextResponse.json({ error: 'Analyse repo uniquement pour les sites Next.js' }, { status: 400 })
    }

    if (!site.github_repo || !site.github_token) {
      return NextResponse.json({ error: 'GitHub repo et token requis' }, { status: 400 })
    }

    const profile = await analyzeNextJsRepo(site.github_repo, site.github_token)
    await updateSite(id, { repo_profile: profile } as Partial<typeof site>)

    return NextResponse.json({ success: true, profile })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur analyse repo' },
      { status: 500 }
    )
  }
}
