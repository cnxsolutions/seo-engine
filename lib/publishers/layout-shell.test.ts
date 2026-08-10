// ─────────────────────────────────────────────────────────────────────────────
// Layout shell
// SEO Engine - Two connected sites do the opposite thing.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import { readLayoutShell } from './layout-shell'

// cnxsolutions/renovation-bt — the layout wraps everything.
const ENVELOPPANT = `
import type { Metadata } from "next";
import { TopBanner } from "@/components/layout/TopBanner";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <TopBanner />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
`

// cnxsolutions/taxidriver10 — the layout wraps nothing; pages carry their shell.
const TRANSPARENT = `
import type { Metadata } from 'next'
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
      </body>
    </html>
  )
}
`

describe('readLayoutShell', () => {
  it('voit un layout qui enveloppe la page', () => {
    const shell = readLayoutShell(ENVELOPPANT)
    expect(shell.hasMain).toBe(true)
    expect(shell.components).toEqual(['TopBanner', 'Header', 'Footer'])
    expect(shell.wraps).toBe(true)
  })

  it('lit les imports nommes autant que les imports par defaut', () => {
    // This site imports `{ Header }`, not `Header`. A default-only reader saw an
    // empty layout and concluded the pages had to build their own shell.
    expect(readLayoutShell(ENVELOPPANT).components).toContain('Header')
  })

  it('voit un layout transparent', () => {
    const shell = readLayoutShell(TRANSPARENT)
    expect(shell.hasMain).toBe(false)
    expect(shell.components).toEqual([])
    expect(shell.wraps).toBe(false)
  })

  it('ignore un composant importe mais jamais monte', () => {
    const inutilise = TRANSPARENT.replace(
      "import './globals.css'",
      "import { Header } from '@/components/Header'"
    )
    expect(readLayoutShell(inutilise).components).toEqual([])
  })

  it('ne rend rien plutot que de lever sur un layout absent', () => {
    expect(readLayoutShell(null).wraps).toBe(false)
    expect(readLayoutShell(undefined).wraps).toBe(false)
  })
})
