// ─────────────────────────────────────────────────────────────────────────────
// Google property selection — the moment the data becomes fetchable
//
// Choosing a Search Console property is what turns a valid OAuth token into
// something the engine can actually query: before it, no code knows WHICH site
// to ask Google about. That makes this handler, and not the OAuth callback, the
// real starting gun for the first synchronisation.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse, after } from 'next/server'
import { updateGoogleConnection } from '@/lib/google/client'
import { markGscSyncStarted, triggerGscSyncOnConnect } from '@/lib/google/sync'

export async function POST(req: NextRequest) {
  const form = await req.formData()

  const siteId = readField(form, 'site_id')
  if (!siteId) {
    return NextResponse.redirect(new URL('/sites?error=site_id_manquant', req.url), 303)
  }

  const gscSiteUrl = readField(form, 'gsc_site')
  const gbpLocationId = readField(form, 'gbp_location')
  const gbpAccountId = gbpLocationId ? readField(form, `gbp_account_${gbpLocationId}`) : null

  try {
    await updateGoogleConnection(siteId, {
      gbp_account_id: gbpAccountId,
      gbp_location_id: gbpLocationId,
      gsc_site_url: gscSiteUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Enregistrement de la sélection impossible'
    return NextResponse.redirect(
      new URL(`/sites/${siteId}/google?error=${encodeURIComponent(message)}`, req.url),
      303
    )
  }

  if (gscSiteUrl) {
    // Written before the redirect so the status page the operator lands on says
    // "en cours" rather than "jamais synchronisé" — a one-row UPDATE, invisible
    // in the response time.
    await markGscSyncStarted(siteId)

    // The read itself runs after the response. It cannot delay the redirect, it
    // cannot fail it, and it logs its own outcome — rows, period covered, or the
    // error — instead of disappearing.
    after(async () => {
      await triggerGscSyncOnConnect(siteId, 'property_selected')
    })
  }

  // 303, not the default 307: a 307 preserves the method and would make the
  // browser POST the form again to the destination page.
  return NextResponse.redirect(new URL(`/sites/${siteId}/google?selected=1`, req.url), 303)
}

function readField(form: FormData, name: string): string | null {
  const value = form.get(name)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
