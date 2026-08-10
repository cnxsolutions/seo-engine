import { NextRequest, NextResponse } from 'next/server'
import { diagnose } from '@/lib/publishing/wordpress/describe'

/** GitHub's own rule: `owner/repo`, nothing else — and above all no `..`. */
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Corps JSON invalide' }, { status: 400 })
  }

  const type = str(body.type)
  const url = str(body.url)
  const wpUsername = str(body.wp_username)
  const wpAppPassword = str(body.wp_app_password)
  const githubRepo = str(body.github_repo)
  const githubToken = str(body.github_token)

  if (type === 'wordpress') {
    if (!url || !wpUsername || !wpAppPassword)
      return NextResponse.json({ success: false, error: 'url, wp_username et wp_app_password requis' }, { status: 400 })

    // Diagnosed rather than pinged: the old check called `users/me` and went
    // green for a Subscriber account, which authenticates perfectly and cannot
    // create a page. The failure surfaced weeks later, at the first publication.
    const result = await diagnose({ siteUrl: url, username: wpUsername, appPassword: wpAppPassword })
    return NextResponse.json({
      success: result.ok,
      siteName: result.siteName,
      error: result.ok ? undefined : result.message,
      details: [result.message, ...result.notes].filter(Boolean),
    })
  }

  if (type === 'nextjs') {
    if (!githubRepo || !githubToken)
      return NextResponse.json({ success: false, error: 'github_repo et github_token requis' }, { status: 400 })

    // Interpolated straight into the API path below: `owner/../../gists` would
    // otherwise point the caller's token at an endpoint we never meant to call.
    if (!GITHUB_REPO_PATTERN.test(githubRepo))
      return NextResponse.json({ success: false, error: 'github_repo doit etre au format owner/repo' }, { status: 400 })

    // Test GitHub token validity
    try {
      const res = await fetch(`https://api.github.com/repos/${githubRepo}`, {
        headers: { Authorization: `token ${githubToken}`, Accept: 'application/vnd.github.v3+json' },
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

function str(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
