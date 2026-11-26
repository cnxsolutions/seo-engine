import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { safeNextPath } from '@/src/core/domain/client-access/policy'
import { AuthShell } from '@/components/AuthShell'
import { Notice } from '@/components/ui'
import { SIGN_IN_NOTICES, readSignInNotice } from '@/lib/client-space/labels'
import { getClientSession } from '@/lib/client-space/session'
import { SignInForm } from './SignInForm'

export const metadata: Metadata = { title: 'Connexion' }

/**
 * /espace/connexion — ACC-2, ACC-6. Public (lib/client-space/gate.ts).
 *
 * `?motif=` says why the visitor is here (session expired, access withdrawn,
 * dead link, signed out); `?suite=` where to go after signing in, honoured
 * only inside the space (safeNextPath, server side).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const notice = readSignInNotice(query.motif)
  const next = typeof query.suite === 'string' ? query.suite : undefined

  // Already in: straight to the space, no second code.
  if ((await getClientSession()).status === 'active') redirect(safeNextPath(next))

  return (
    <AuthShell
      eyebrow="Espace client"
      title="Connexion à votre espace"
      intro="Saisissez l’adresse e-mail que CNX Solutions a enregistrée : vous recevrez un code à 6 chiffres. Aucun mot de passe à retenir."
    >
      {notice && (
        <div className="auth-shell__notice">
          <Notice tone={SIGN_IN_NOTICES[notice].tone} title={SIGN_IN_NOTICES[notice].title} body={SIGN_IN_NOTICES[notice].body} inline />
        </div>
      )}
      <SignInForm next={next} />
    </AuthShell>
  )
}
