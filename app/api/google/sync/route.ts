// ─────────────────────────────────────────────────────────────────────────────
// Manual Search Console re-sync
//
// The automatic paths (OAuth callback, property selection, nightly cron) cover
// the normal life of a site. This one exists for the abnormal: a failed run to
// retry, a property changed at Google's end, a doubt to settle. It is awaited on
// purpose — the operator asked for it and wants the answer on the next screen,
// not in a log file.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { INITIAL_SYNC_DAYS, syncGscPerformance, syncGbpProfile } from '@/lib/google/sync'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const siteId = typeof form.get('site_id') === 'string' ? String(form.get('site_id')).trim() : ''
  const scope = String(form.get('scope') ?? 'gsc')

  if (!siteId) {
    return NextResponse.json({ error: 'site_id requis' }, { status: 400 })
  }

  if (scope === 'gbp') {
    const result = await syncGbpProfile(siteId)
    return NextResponse.redirect(
      new URL(`/sites/${siteId}/google?gbp=${result.status}`, req.url),
      303
    )
  }

  const result = await syncGscPerformance(siteId, { days: INITIAL_SYNC_DAYS })

  const params = new URLSearchParams({ gsc: result.status, rows: String(result.rows) })
  if (result.error) params.set('error', result.error)

  return NextResponse.redirect(new URL(`/sites/${siteId}/google?${params.toString()}`, req.url), 303)
}
