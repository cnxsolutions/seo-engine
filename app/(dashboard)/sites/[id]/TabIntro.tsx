// ─────────────────────────────────────────────────────────────────────────────
// L'en-tête d'un onglet de site
//
// Le nom du site est le <h1> du layout, une seule fois pour tous les onglets.
// Chaque onglet ouvre donc sur un <h2> : un second <h1> par page ferait annoncer
// deux titres de premier rang à un lecteur d'écran, et le plan de la page ne
// dirait plus de quoi elle parle.
//
// Pas de 'use client' : rien ici n'a d'état, le composant se rend aussi bien
// depuis la page serveur d'un onglet que depuis un composant client.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'

export function TabIntro({
  title, subtitle, actions,
}: {
  title: string
  subtitle?: ReactNode
  /** Les commandes de l'onglet entier — jamais celles d'un panneau. */
  actions?: ReactNode
}) {
  return (
    <div className="tab-intro">
      <div style={{ minWidth: 0 }}>
        <h2 className="tab-intro__title">{title}</h2>
        {subtitle && <p className="tab-intro__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="tab-intro__actions">{actions}</div>}
    </div>
  )
}
