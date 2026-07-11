import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const formData = await req.formData()

  const gbpLocationId = formData.get('gbp_location') as string
  const gscSiteUrl = formData.get('gsc_site') as string

  const gbpAccountId = gbpLocationId ? formData.get(`gbp_account_${gbpLocationId}`) as string : null

  const supabase = createServiceClient()
  await supabase
    .from('google_connections')
    .update({
      gbp_account_id: gbpAccountId || null,
      gbp_location_id: gbpLocationId || null,
      gsc_site_url: gscSiteUrl || null,
    })
    .eq('site_id', id)

  return NextResponse.redirect(new URL(`/sites?google=connected&site_id=${id}`, req.url))
}
