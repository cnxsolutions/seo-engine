import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
// After globals.css: the shared components' modifiers refine its base classes.
import '@/components/ui.css'

/**
 * The two families of the CNX Solutions site, self-hosted by next/font (no
 * third-party request, no layout shift): Plus Jakarta Sans for what is read at
 * a glance — titles, figures, buttons — and Inter for running text.
 *
 * Each publishes its hashed family name as a CSS variable on <html>, which
 * components/tokens.css turns into --font-display and --font-sans.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'CNX SEO Engine',
    template: '%s · CNX SEO Engine',
  },
  description: 'Le moteur de référencement de CNX Solutions : analyse, planification, rédaction et publication des pages.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" className={`${jakarta.variable} ${inter.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
