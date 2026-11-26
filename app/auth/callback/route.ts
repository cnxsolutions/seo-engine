import { NextResponse, type NextRequest } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { createRequestAuthClient } from '@/lib/client-space/request-auth'
import { verifySignInLink } from '@/lib/client-space/sign-in'
import { publicUrl } from '@/lib/public-origin'

/**
 * GET /auth/callback?token_hash=…&type=email — the fallback link of the code
 * e-mail (supabase/templates/code-connexion.html).
 *
 * Verified HERE, server side, with the hash: no token ever travels in the URL
 * fragment, and the session lands in HttpOnly cookies. A dead or reused link
 * goes back to the sign-in page, which says so and offers a code.
 */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash')
  const type = req.nextUrl.searchParams.get('type')
  const failed = () => NextResponse.redirect(publicUrl('/espace/connexion?motif=lien', req))

  if (!tokenHash || type !== 'email' || tokenHash.length > 200) return failed()

  const auth = await createRequestAuthClient()
  if (!auth) return failed()

  const result = await verifySignInLink({ tokenHash, ip: clientIp(req.headers), auth })
  return result.status === 'signed_in' ? NextResponse.redirect(publicUrl('/espace', req)) : failed()
}
