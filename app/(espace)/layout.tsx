import type { Metadata } from 'next'
import './espace.css'

/**
 * Everything a client sees: the sign-in page, the space, its status pages.
 * No operator rail here — that lives in app/(dashboard)/layout.tsx.
 *
 * Never indexed: a private space has nothing to offer a search engine, and the
 * sign-in page of a client space showing up in Google helps only whoever is
 * looking for doors.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function ClientSpaceLayout({ children }: { children: React.ReactNode }) {
  return children
}
