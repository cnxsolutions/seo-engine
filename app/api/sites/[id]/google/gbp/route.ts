import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('gbp_profiles')
    .select('*')
    .eq('site_id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ connected: false, profile: null })
  }

  return NextResponse.json({ connected: true, profile: data })
}
