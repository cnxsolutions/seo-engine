import { NextResponse } from 'next/server'
import { describeSerpStatus, getSerpStatus } from '@/lib/serp/status'

export const dynamic = 'force-dynamic'

/** Whether SerpApi answers, and why not when it does not. Never returns the key. */
export async function GET() {
  const status = await getSerpStatus()
  return NextResponse.json({ status, summary: describeSerpStatus(status) })
}
