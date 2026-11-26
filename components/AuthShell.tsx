// ─────────────────────────────────────────────────────────────────────────────
// The hero register around one card — sign-in and the status pages of the
// client space (docs/design.md § 1, § 7). Styles: app/(espace)/espace.css.
// ─────────────────────────────────────────────────────────────────────────────

import { BrandLockup } from './BrandMark'

/** Where a client goes with a question: the CNX contact address, nothing internal. */
export const CLIENT_SUPPORT_EMAIL = 'contact@cnx-solutions.fr'
const PRIVACY_URL = 'https://cnx-solutions.fr/politique-de-confidentialite/'

interface AuthShellProps {
  eyebrow?: string
  title: string
  intro?: React.ReactNode
  children?: React.ReactNode
}

export function AuthShell({ eyebrow, title, intro, children }: AuthShellProps) {
  return (
    <main id="contenu" className="auth-shell">
      <div className="auth-shell__inner">
        <div className="auth-shell__brand">
          <BrandLockup tone="inverse" />
        </div>
        <section className="auth-shell__card" aria-labelledby="auth-shell-title">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 id="auth-shell-title" className="auth-shell__title">{title}</h1>
          {intro && <p className="auth-shell__intro">{intro}</p>}
          {children}
        </section>
        <p className="auth-shell__footer">
          Une question ? <a href={`mailto:${CLIENT_SUPPORT_EMAIL}`}>{CLIENT_SUPPORT_EMAIL}</a>
          {' · '}
          <a href={PRIVACY_URL}>Confidentialité</a>
        </p>
      </div>
    </main>
  )
}
