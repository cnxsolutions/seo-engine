// ─────────────────────────────────────────────────────────────────────────────
// One word per thing, for each audience — docs/design.md § 10 (UX-6)
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine speaks in cycles, slots, briefs, gates and generations; the
// operator reads « cycle », « créneau », « brief », « contrôle qualité »; the
// client reads « période », « page prévue » — and never a brief, a model or a
// table. Each term lives HERE once, with its two readings, and the label
// modules (lib/client-space/labels.ts, lib/keyword-requests/operator-labels.ts,
// lib/types.ts for the page types) read it rather than spell it again: two
// spellings of the same status drift at the first edit.
//
// `client: null` is a statement: the client never sees this thing at all.

import type { RequestStatus } from '@/src/core/domain/keyword-requests/lifecycle'
import { PAGE_TYPE_LABELS } from './types'

export interface Term {
  operator: string
  client: string | null
}

export const GLOSSARY = {
  cycle: { operator: 'Cycle', client: 'Période' },
  currentCycle: { operator: 'Cycle en cours', client: 'Période en cours' },
  slot: { operator: 'Créneau', client: 'Page prévue' },
  brief: { operator: 'Brief', client: null },
  qualityRefusal: { operator: 'Bloquée au contrôle qualité', client: null },
  generation: { operator: 'Rédaction', client: 'Page' },
  keywordRequest: { operator: 'Demande client', client: 'Votre demande' },
} as const satisfies Record<string, Term>

/**
 * The page types, as the operator reads them; a client never sees a page type.
 * Spelled in lib/types.ts, which imports nothing and is read by every layer.
 */
export const PAGE_TYPE_TERMS = PAGE_TYPE_LABELS

/** A client request's status, for each audience. */
export const REQUEST_STATUS_TERMS: Readonly<Record<RequestStatus, { operator: string; client: string }>> = {
  received: { operator: 'Reçue — analyse en cours', client: 'Reçue — analyse en cours' },
  review: { operator: 'À examiner', client: 'À l’étude chez CNX' },
  deferred: { operator: 'Reportée au cycle suivant', client: 'Gardée pour la période suivante' },
  scheduled: { operator: 'Planifiée', client: 'Prévue' },
  in_production: { operator: 'En rédaction', client: 'En rédaction' },
  published: { operator: 'Publiée', client: 'En ligne' },
  covered: { operator: 'Couverte', client: 'Déjà couverte' },
  declined: { operator: 'Refusée', client: 'Non retenue' },
  withdrawn: { operator: 'Retirée par le client', client: 'Retirée' },
}

/**
 * Words a client must never read (design.md § 10): the engine's own, and the
 * operator's. The client labels are checked against this list.
 */
export const CLIENT_FORBIDDEN_WORDS = ['cycle', 'créneau', 'brief', 'slot', 'gate', 'génération', 'refusé', 'prompt', 'modèle'] as const
