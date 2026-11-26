import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { inviteMember, type InviteRefusal } from '@/lib/client-space/access'
import { InvitationBody, readJson } from '@/lib/client-space/schemas'

/**
 * POST /api/sites/[id]/client-access — the operator opens a client's access
 * to this site's space, or sends a fresh code (lib/client-space/access.ts).
 * Behind the Basic gate, like every operator route.
 */
const STATUS_OF_REFUSAL: Record<InviteRefusal, number> = {
  site_not_found: 404,
  client_required: 400,
  client_not_found: 404,
  site_has_other_client: 409,
  other_client: 409,
  code_too_soon: 429,
  send_failed: 502,
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'Site introuvable.' }, { status: 404 })
  const parsed = InvitationBody.safeParse(await readJson(req))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Adresse e-mail ou client invalide.' }, { status: 400 })
  }

  try {
    const result = await inviteMember({ siteId: id, email: parsed.data.email, client: parsed.data.client ?? null })
    if (result.status === 'refused') {
      return NextResponse.json({ error: result.message, code: result.code }, { status: STATUS_OF_REFUSAL[result.code] })
    }
    return NextResponse.json({ status: result.status })
  } catch (error) {
    console.error('[client-access] invitation :', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'L’invitation a échoué. Réessayez, puis consultez les journaux si cela persiste.' }, { status: 500 })
  }
}
