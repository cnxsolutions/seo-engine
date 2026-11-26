import { NextResponse } from 'next/server'
import { countRequestsToReview } from '@/lib/keyword-requests/repository'

export const dynamic = 'force-dynamic'

/**
 * GET /api/demandes/compteur — the requests waiting for CNX, for the rail.
 *
 * The rail is a client component kept mounted across navigations: it re-reads
 * this count on each one, as it re-reads the sites. A failed read answers
 * `null` rather than a zero that would claim the queue is empty.
 */
export async function GET() {
  try {
    return NextResponse.json({ review: await countRequestsToReview() })
  } catch (error) {
    console.warn('[demandes] compteur :', error instanceof Error ? error.message : error)
    return NextResponse.json({ review: null })
  }
}
