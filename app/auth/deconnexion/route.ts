import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { readSignInNotice } from '@/lib/client-space/labels'
import { createRequestAuthClient } from '@/lib/client-space/request-auth'
import { publicUrl } from '@/lib/public-origin'

/**
 * Closing a session.
 *
 *   POST — the « Se déconnecter » button of the space (a form, never a link:
 *          a prefetched link would sign the member out on its own).
 *   GET  — where the space sends a session it refuses (`?motif=revoque` or
 *          `expiree`): the layout of a server component cannot clear cookies,
 *          this route can. A GET that only ever signs out: the worst a
 *          third-party page can do with it is sign a member out.
 */
export async function POST(req: NextRequest) {
  await closeSession()
  return NextResponse.redirect(publicUrl('/espace/connexion?motif=deconnecte', req), 303)
}

export async function GET(req: NextRequest) {
  await closeSession()
  const notice = readSignInNotice(req.nextUrl.searchParams.get('motif') ?? undefined)
  const target = notice === 'revoque' || notice === 'expiree' ? `/espace/connexion?motif=${notice}` : '/espace/connexion'
  return NextResponse.redirect(publicUrl(target, req))
}

/**
 * Supabase forgets the session; the cookies go whatever it answers — a banned
 * user's sign-out can fail at Supabase, and must still end in the browser.
 */
async function closeSession(): Promise<void> {
  const auth = await createRequestAuthClient()
  if (auth) await auth.auth.signOut({ scope: 'local' }).catch(() => undefined)

  const store = await cookies()
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')) store.delete(cookie.name)
  }
}
