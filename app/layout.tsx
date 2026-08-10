import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

/**
 * One UI sans for the whole product, self-hosted by next/font (no third-party
 * request, no layout shift). Numbers stay in the same face everywhere: a
 * display or serif figure reads as decoration, not as measurement.
 *
 * `variable` publishes the loaded family under --font-sans so components can
 * name the token instead of the hashed class.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SEO Engine – AI Content Generator',
  description: 'Generate and publish local SEO pages automatically with AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    /*
     * The theme is an explicit attribute, never an automatic inversion of the
     * OS setting: the dark steps in components/tokens.css were each selected
     * and measured against the dark surface. Flip this to "dark" (or have a
     * future toggle stamp it) and the whole token set switches with it.
     */
    <html lang="fr" data-theme="light" className={inter.variable}>
      <body className={inter.className} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
