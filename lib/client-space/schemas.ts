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

/**
 * A keyword submission, by shape only. What a keyword may be is the domain's
 * (src/core/domain/keyword-requests/normalize.ts), which says it line by line;
 * these caps only stop what no form produces.
 */
export const RequestSubmissionBody = z.object({
  keywords: z.string().max(2000),
  city: z.string().max(120).nullish(),
  note: z.string().max(600).nullish(),
  desiredBy: z.string().max(10).nullish(),
})

/** Every body these routes accept fits in far less: an address, a code, a client name, ten keywords and a note. */
const MAX_BODY_BYTES = 4096

/**
 * A JSON body, or `null` — which the route answers with a 400 — when:
 *
 * - it is not declared `application/json`: an HTML form cannot send that type,
 *   so a cross-site form post is refused even by a browser that sends no
 *   `Sec-Fetch-Site` (the proxy's own check);
 * - it is larger than MAX_BODY_BYTES: read in chunks and dropped at the limit,
 *   never buffered whole — these routes are public, and parse before any limit.
 */
export async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type !== 'application/json') return null
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  if (!req.body) return null

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}
