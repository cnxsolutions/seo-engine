import { NextRequest, NextResponse } from 'next/server'
import { testWordPressConnection } from '@/lib/publishers/wordpress'

export async function POST(req: NextRequest) {
  const { type, url, wp_username, wp_app_password, github_repo, github_token } = await req.json()

  if (type === 'wordpress') {
    if (!url || !wp_username || !wp_app_password)
      return NextResponse.json({ success: false, error: 'url, wp_username et wp_app_password requis' }, { status: 400 })

    const result = await testWordPressConnection(url, wp_username, wp_app_password)
    return NextResponse.json(result)
  }

  if (type === 'nextjs') {
    if (!github_repo || !github_token)
      return NextResponse.json({ success: false, error: 'github_repo et github_token requis' }, { status: 400 })

    // Test GitHub token validity
    try {
      const res = await fetch(`https://api.github.com/repos/${github_repo}`, {
        headers: { Authorization: `token ${github_token}`, Accept: 'application/vnd.github.v3+json' },
      })
      if (!res.ok) return NextResponse.json({ success: false, error: `Repo GitHub inaccessible (HTTP ${res.status})` })
      const data = await res.json()
      return NextResponse.json({ success: true, siteName: data.full_name })
    } catch {
      return NextResponse.json({ success: false, error: 'Impossible de joindre GitHub' })
    }
  }

  return NextResponse.json({ success: false, error: 'type invalide' }, { status: 400 })
}
