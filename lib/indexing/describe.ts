// ─────────────────────────────────────────────────────────────────────────────
// An index state put into words — and into the one thing to do about it
// SEO Engine - What the Indexation screen says for each page.
// ─────────────────────────────────────────────────────────────────────────────
//
// The advice names who acts. A page Google has not crawled yet is the engine's
// job (it resends the sitemap); everything else is a fix on the site that no
// resubmission can replace, and the text says so plainly so nobody waits for
// the robot to solve a noindex.

import { normalizePageUrl } from '@/lib/google/performance'
import type { TrackingTone } from '@/lib/google/tracking'
import type { IndexState, IndexStateGroup } from '@/src/core/domain/indexing/status'
import type { PageIndexingRow } from './store'

export interface IndexStateDescription {
  label: string
  tone: TrackingTone
  advice: string
}

export const INDEX_GROUP_LABELS: Record<IndexStateGroup, string> = {
  to_fix: 'À corriger',
  not_indexed: 'Non indexées',
  indexed: 'Indexées',
  unchecked: 'Pas encore vérifiées',
}

const STATE_LABELS: Record<IndexState, { label: string; tone: TrackingTone }> = {
  unchecked: { label: 'Pas encore vérifiée', tone: 'muted' },
  indexed: { label: 'Indexée', tone: 'good' },
  not_discovered: { label: 'Pas encore explorée', tone: 'info' },
  crawled_not_indexed: { label: 'Explorée, non indexée', tone: 'warning' },
  blocked: { label: 'Bloquée', tone: 'critical' },
  fetch_error: { label: 'Erreur d’exploration', tone: 'critical' },
  canonical_elsewhere: { label: 'Canonique ailleurs', tone: 'warning' },
}

const FETCH_ADVICE: Record<string, string> = {
  NOT_FOUND:
    'Google tombe sur une page introuvable (404) : la rétablir, ou la rediriger (301) vers celle qui la remplace et la retirer du sitemap.',
  SOFT_404:
    'Google la juge vide ou équivalente à une page d’erreur (soft 404) : lui donner un vrai contenu, ou renvoyer un vrai code 404 si elle n’a plus lieu d’être.',
  SERVER_ERROR:
    'Le serveur a répondu en erreur (5xx) au passage de Google : vérifier l’hébergement ; Google repassera de lui-même une fois la page rétablie.',
  REDIRECT_ERROR:
    'La redirection est cassée (boucle, chaîne trop longue ou URL invalide) : faire pointer l’adresse directement vers la page finale.',
  ACCESS_DENIED:
    'Google se voit demander une authentification (401) : vérifier qu’aucun mot de passe ne protège la page.',
  ACCESS_FORBIDDEN:
    'Google se voit refuser l’accès (403) : vérifier qu’aucun pare-feu, Cloudflare ou extension de sécurité ne bloque Googlebot.',
  BLOCKED_4XX:
    'Le serveur refuse la page à Google (erreur 4xx) : vérifier qu’aucune protection ne bloque Googlebot.',
}

type Describable = Pick<
  PageIndexingRow,
  'url' | 'state' | 'indexing_state' | 'robots_txt_state' | 'page_fetch_state' | 'google_canonical' | 'user_canonical' | 'resubmit_count'
>

export function describeIndexState(row: Describable): IndexStateDescription {
  return { ...STATE_LABELS[row.state], advice: adviceFor(row) }
}

function adviceFor(row: Describable): string {
  switch (row.state) {
    case 'unchecked':
      return 'La vérification quotidienne de 5 h la passera en revue — deux jours après sa publication pour une page du moteur.'
    case 'indexed':
      return 'Rien à faire : la page est dans l’index de Google. Elle sera revérifiée dans un mois.'
    case 'not_discovered':
      return (
        (row.resubmit_count > 0
          ? `Google ne l’a pas encore explorée ; le moteur a renvoyé le sitemap ${row.resubmit_count === 1 ? 'une fois' : `${row.resubmit_count} fois`} et recommence chaque semaine tant qu’elle n’est pas vue. `
          : 'Google ne l’a pas encore explorée : le moteur renvoie le sitemap au prochain passage. ') +
        'Un lien depuis une page déjà indexée du site accélère sa découverte plus que n’importe quel renvoi.'
      )
    case 'crawled_not_indexed':
      return (
        'Google l’a lue et a choisi de ne pas l’indexer : la renvoyer n’y changera rien. ' +
        'Enrichir le contenu (une réponse plus complète, des éléments propres à l’entreprise) et la relier depuis des pages déjà indexées.'
      )
    case 'blocked':
      if (row.indexing_state === 'BLOCKED_BY_META_TAG') {
        return 'La page porte une balise noindex : la retirer (réglage SEO de la page dans le CMS) si elle doit apparaître dans Google.'
      }
      if (row.indexing_state === 'BLOCKED_BY_HTTP_HEADER') {
        return 'Le serveur envoie un en-tête X-Robots-Tag: noindex pour cette page : le retirer de la configuration si elle doit apparaître dans Google.'
      }
      return 'Le fichier robots.txt interdit à Google d’explorer cette page : retirer la règle Disallow qui la couvre si elle doit apparaître dans Google.'
    case 'fetch_error':
      return (row.page_fetch_state && FETCH_ADVICE[row.page_fetch_state])
        ?? 'Google n’a pas pu lire la page à son dernier passage : l’ouvrir dans Search Console pour le détail.'
    case 'canonical_elsewhere':
      if (row.user_canonical && normalizePageUrl(row.user_canonical) !== normalizePageUrl(row.url)) {
        return `La page déclare elle-même une autre adresse comme canonique (${row.user_canonical}) : normal si c’est voulu, sinon corriger sa balise canonical.`
      }
      return (
        `Google a retenu une autre page comme version principale${row.google_canonical ? ` (${row.google_canonical})` : ''} : ` +
        'les deux se ressemblent trop. Différencier franchement le contenu, ou fusionner les deux pages.'
      )
  }
}
