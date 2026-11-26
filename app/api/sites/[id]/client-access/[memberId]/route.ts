import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { revokeMember } from '@/lib/client-space/access'

/**
 * DELETE /api/sites/[id]/client-access/[memberId] — withdraws a member's
 * access, at once (lib/client-space/access.ts). The row stays: the operator
 * still sees who had access, and an invitation reopens it.
 */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await context.params
  if (!z.guid().safeParse(id).success || !z.guid().safeParse(memberId).success) {
    return NextResponse.json({ error: 'Accès introuvable.' }, { status: 404 })
  }

  try {
    const result = await revokeMember(id, memberId)
    if (result === 'not_found') return NextResponse.json({ error: 'Accès introuvable.' }, { status: 404 })
    return NextResponse.json({ status: 'revoked' })
  } catch (error) {
    console.error('[client-access] revocation :', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Le retrait a échoué. Réessayez.' }, { status: 500 })
  }
}
