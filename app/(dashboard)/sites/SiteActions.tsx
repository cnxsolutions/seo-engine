'use client'

import { useState } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button, FormField } from '@/components/ui'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import './sites.css'

// ─────────────────────────────────────────────────────────────────────────────
// Deleting a site — two entry points, one call
//
// The card on /sites wants a quick « Supprimer » confirmed in a dialog; the
// edit page wants a slower ritual where the operator types the site name. Both
// end in the same DELETE and the same list of consequences, so the call and the
// wording live here once. A second copy of « what gets deleted » would drift
// the first time the API changes what it cascades.
// ─────────────────────────────────────────────────────────────────────────────

/** What `DELETE /api/sites/[id]` cascades — kept in one place so both screens say the same thing. */
export const DELETION_SCOPE =
  'Seront supprimés : ses campagnes, son calendrier éditorial, sa connexion Google et les pages connues. ' +
  'Les pages déjà générées sont conservées, mais ne sont plus rattachées à aucun site.'

/**
 * Resolves to `null` on success, to a sentence otherwise.
 *
 * A 409 is the one answer worth reading: the API refuses to delete while a
 * generation or a publication is running on this site, and its message says
 * so. Swallowing it into a generic « erreur » would send the operator
 * retrying something that must simply wait.
 */
async function deleteSite(siteId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/sites/${siteId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return data.error || `Suppression refusée (erreur ${res.status})`
    return null
  } catch {
    return 'Impossible de joindre le serveur'
  }
}

// ─── Card button ─────────────────────────────────────────────────────────────

/**
 * The « Supprimer » of a site card. The card has no room for the typed-name
 * ritual of the settings tab, so it asks in a dialog that says what goes and
 * what stays — and keeps the server's refusal in view (a 409 while a
 * generation runs) instead of the browser's confirm() closing before it.
 */
export function DeleteSiteButton({ siteId, siteName }: { siteId: string; siteName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setDeleting(true)
    setError(null)
    const failure = await deleteSite(siteId)
    setDeleting(false)
    if (failure) {
      setError(failure)
      return
    }
    setOpen(false)
    // The list is a server component: refreshing it is what makes the card go.
    router.refresh()
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setOpen(true)} title="Supprimer ce site">
        Supprimer
      </Button>
      <ConfirmDialog
        open={open}
        title="Supprimer ce site ?"
        subject={siteName}
        confirmLabel="Supprimer le site"
        confirmIcon={Trash2}
        busy={deleting}
        error={error}
        errorTitle="Site non supprimé"
        onConfirm={remove}
        onClose={() => { setOpen(false); setError(null) }}
      >
        <p>{DELETION_SCOPE}</p>
        <p><strong>Cette action est irréversible.</strong></p>
      </ConfirmDialog>
    </>
  )
}

// ─── Danger zone ─────────────────────────────────────────────────────────────

/**
 * The bottom of the site settings tab. Deleting a site takes its campaigns and its
 * calendar with it, so the confirmation is the site name typed back — a
 * click on a red button is too cheap for something a cron was running on.
 */
export function DeleteSiteZone({ siteId, siteName }: { siteId: string; siteName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Exact match, whitespace trimmed on both sides: a trailing space pasted
  // along with the name should not block someone who clearly means it.
  const matches = typed.trim() === siteName.trim()

  const remove = async () => {
    if (!matches) return
    setDeleting(true)
    setError(null)
    const failure = await deleteSite(siteId)
    if (failure) {
      setError(failure)
      setDeleting(false)
      return
    }
    router.push('/sites')
    router.refresh()
  }

  return (
    <section
      className="panel danger-zone"
      aria-labelledby="danger-zone-title"
      // No top margin of its own: it closes the settings tab, whose sections
      // are spaced by the tab's own gap.
    >
      <div className="panel__header">
        <div className="danger-zone__title-row">
          <TriangleAlert size={15} color="var(--status-critical)" aria-hidden="true" />
          <h3 id="danger-zone-title" className="card-title">Zone dangereuse</h3>
        </div>
      </div>

      <div className="panel__body danger-zone__body">
        <p className="danger-zone__text">
          {DELETION_SCOPE} La suppression est refusée tant qu’une génération ou une publication est en cours sur ce site.
          Cette action est irréversible.
        </p>

        {!open ? (
          <div>
            <Button variant="danger" icon={Trash2} onClick={() => setOpen(true)}>
              Supprimer ce site
            </Button>
          </div>
        ) : (
          <div className="inset danger-zone__confirm">
            <FormField
              label="Confirmez en tapant le nom du site"
              required
              htmlFor="confirm-site-name"
              hint={siteName}
            >
              <input
                id="confirm-site-name"
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={siteName}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="confirm-site-name-help"
              />
              <p id="confirm-site-name-help" className="meta site-form__note">
                Le bouton ne s’active que lorsque le nom correspond exactement.
              </p>
            </FormField>

            {error && (
              <p role="alert" className="meta danger-zone__error">
                {error}
              </p>
            )}

            <div className="danger-zone__actions">
              <Button variant="danger" icon={Trash2} loading={deleting} disabled={!matches} onClick={remove}>
                Supprimer définitivement
              </Button>
              <Button
                variant="ghost"
                disabled={deleting}
                onClick={() => {
                  setOpen(false)
                  setTyped('')
                  setError(null)
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
