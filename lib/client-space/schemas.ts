// ─────────────────────────────────────────────────────────────────────────────
// Input shapes of the client-space routes (décision 10 : zod, new routes only)
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'
import {
  SIGN_IN_CODE_PATTERN,
  normalizeEmail,
  normalizeSignInCode,
} from '@/src/core/domain/client-access/policy'

/** RFC 5321's ceiling. Normalised BEFORE the format check, so `  Marie@X.FR ` passes as `marie@x.fr`. */
export const EmailField = z.string().max(254).transform(normalizeEmail).pipe(z.email())

export const SignInCodeField = z.string().max(20).transform(normalizeSignInCode).pipe(z.string().regex(SIGN_IN_CODE_PATTERN))

export const CodeRequestBody = z.object({ email: EmailField })

export const CodeVerificationBody = z.object({
  email: EmailField,
  code: SignInCodeField,
  suite: z.string().max(500).optional(),
})

/** `z.guid()`, not `z.uuid()`: the demonstration rows derive their ids from md5, which no RFC version nibble constrains. */
export const InvitationBody = z.object({
  email: EmailField,
  client: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('existing'), id: z.guid() }),
      z.object({ kind: z.literal('new'), name: z.string().trim().min(1).max(120) }),
    ])
    .nullable()
    .optional(),
})

/** A JSON body, or `null` when the request carries something else. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
