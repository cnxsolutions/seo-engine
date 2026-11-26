import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { BrandLockup } from '@/components/BrandMark'
import { getClientSession } from '@/lib/client-space/session'

export const dynamic = 'force-dynamic'

/**
 * Every page of a member's space sits under this layout, and this layout
 * re-checks the membership — the second of the three checks (§ 4.4): the
 * proxy saw a session, this sees a MEMBER, not revoked, not expired.
 *
 * A refused session goes through /auth/deconnexion, which can clear the
 * cookies a server component cannot, and lands on the sign-in page saying why.
 *
 * L1 ships the frame and the home; the bottom navigation of design.md § 9.1
 * arrives with the pages it leads to (L2).
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const result = await getClientSession()
  if (result.status === 'none') redirect('/espace/connexion')
  if (result.status === 'revoked') redirect('/auth/deconnexion?motif=revoque')
  if (result.status === 'expired') redirect('/auth/deconnexion?motif=expiree')

  return (
    <div className="espace">
      <a href="#contenu" className="sr-only skip-link">Aller au contenu</a>
      <header className="espace-topbar">
        <BrandLockup size="sm" />
        <div className="espace-topbar__actions">
          <span className="espace-topbar__who">{result.session.email}</span>
          <form action="/auth/deconnexion" method="post">
            <button type="submit" className="btn-ghost btn-sm">
              <LogOut size={14} aria-hidden="true" />
              Se déconnecter
            </button>
          </form>
        </div>
      </header>
      <main id="contenu" className="espace-main">{children}</main>
    </div>
  )
}
