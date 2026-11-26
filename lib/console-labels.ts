// ─────────────────────────────────────────────────────────────────────────────
// The words of the console's shell — rail, top bar, site header (L5b, UX-5)
// ─────────────────────────────────────────────────────────────────────────────
//
// Terms shared with the client space come from the glossary (lib/glossary.ts);
// the screens' own sentences are here, never spelled in a component.

import { GLOSSARY } from './glossary'

export const SHELL_TEXT = {
  openMenu: 'Ouvrir le menu',
  closeMenu: 'Fermer le menu',
  navigation: 'Navigation principale',
  home: 'CNX SEO Engine — tableau de bord',
} as const

export const SITE_HEADER_TEXT = {
  back: 'Sites',
  currentCycle: GLOSSARY.currentCycle.operator,
  span: (from: string, to: string) => `du ${from} au ${to}`,
  elapsed: (percent: number) => `${percent} % du cycle écoulés`,
  pages: (planned: number, published: number) =>
    `${planned} page${planned > 1 ? 's' : ''} prévue${planned > 1 ? 's' : ''} · ${published} en ligne`,
  noCycle: 'Aucun cycle en cours : la stratégie du site propose le prochain.',
  repository: (repo: string, branch?: string | null) => `dépôt ${repo} · branche ${branch || 'par défaut'}`,
  wordpressUser: (user: string) => `utilisateur ${user}`,
} as const
