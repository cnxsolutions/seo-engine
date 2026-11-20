// One sentence for the outcome of an index check — the button's answer.
// Kept apart from describe.ts: a client component imports it, and this module
// must not pull a database client into the browser bundle.

import type { InspectionFailure } from '@/lib/google/url-inspection'
import type { IndexCheckReport } from './check'

const STOP_REASONS: Record<InspectionFailure, string> = {
  quota: 'le quota Search Console du jour est atteint, la suite passera demain',
  forbidden: 'le compte Google connecté n’a pas accès à cette propriété Search Console',
  unauthorized: 'la connexion Google a expiré, reconnecter le site dans Réglages',
  invalid: 'Search Console refuse ces adresses',
  error: 'Search Console ne répond pas',
}

export function summarizeIndexCheck(report: IndexCheckReport): { text: string; failed: boolean } {
  if (report.status === 'skipped') {
    if (report.skipReason === 'already_running') return { text: 'Une vérification est déjà en cours.', failed: false }
    if (report.skipReason === 'no_property') return { text: 'Aucune propriété Search Console n’est choisie pour ce site.', failed: true }
    return { text: 'Google n’est pas connecté pour ce site.', failed: true }
  }

  if (report.status === 'failed') {
    return { text: report.stoppedBy ? `Vérification impossible : ${STOP_REASONS[report.stoppedBy]}.` : `Vérification en échec : ${report.error ?? 'erreur inconnue'}.`, failed: true }
  }

  if (report.inspected === 0 && !report.stoppedBy) {
    return { text: 'Rien à revérifier : chaque page a été inspectée il y a moins de six heures.', failed: false }
  }

  const checked = `${report.inspected} page${report.inspected > 1 ? 's' : ''} vérifiée${report.inspected > 1 ? 's' : ''}`
  const resent = report.resubmitted > 0 ? `, ${report.resubmitted} renvoyée${report.resubmitted > 1 ? 's' : ''} à Google` : ''
  const stop = report.stoppedBy ? `, puis arrêt : ${STOP_REASONS[report.stoppedBy]}` : ''
  return { text: `${checked}${resent}${stop}.`, failed: report.stoppedBy !== null }
}
