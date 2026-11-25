'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation of an action that cannot be taken back
//
// Replaces `window.confirm()` (UX-4, docs/cadrage.md): the browser's box says
// neither what is kept nor what the server answered, cannot be styled, and
// closes before the request even starts — a refusal then lands somewhere else
// on the page, if anywhere. Here the dialog stays open while the action runs
// and while its refusal is read; it closes only once the caller says it worked.
//
// Built on `Modal` (components/charts.tsx), which already traps nothing it
// should not, returns focus to the opener and closes on Escape: one dialog
// system in the product, not two.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button, Notice } from '@/components/ui'
import { Modal } from '@/components/charts'

export interface ConfirmDialogProps {
  open: boolean
  /** The question, as the operator would ask it: « Supprimer ce site ? » */
  title: string
  /** What the action applies to — a site name, a campaign. */
  subject?: string
  /** What happens, what is kept. Plain sentences. */
  children: ReactNode
  confirmLabel: string
  confirmIcon?: LucideIcon
  /** `danger` for what destroys or cuts off; `primary` otherwise. */
  tone?: 'danger' | 'primary'
  /** True while the action runs: both buttons wait, Escape still cancels nothing. */
  busy: boolean
  /** The server's refusal, verbatim. The dialog stays open to show it. */
  error: string | null
  errorTitle?: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open, title, subject, children, confirmLabel, confirmIcon, tone = 'danger',
  busy, error, errorTitle = 'Action non effectuée', onConfirm, onClose,
}: ConfirmDialogProps) {
  // A request in flight is not cancelled by closing its dialog: closing would
  // only hide the outcome. Escape and « Annuler » wait for it.
  const close = () => {
    if (!busy) onClose()
  }

  return (
    <Modal
      open={open}
      title={title}
      subtitle={subject}
      onClose={close}
      size="md"
      footer={
        <div className="confirm-dialog__actions">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Annuler
          </Button>
          <Button variant={tone} icon={confirmIcon} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="confirm-dialog__body">
        {children}
        {error && <Notice inline tone="critical" title={errorTitle} body={error} />}
      </div>
    </Modal>
  )
}
