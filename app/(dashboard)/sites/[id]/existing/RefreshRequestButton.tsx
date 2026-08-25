'use client'

// ─────────────────────────────────────────────────────────────────────────────
// « Mettre à jour cette page » — la seule action de l'écran d'inventaire
// ─────────────────────────────────────────────────────────────────────────────
//
// LE SEUL 'use client' DE CET ÉCRAN, et il porte sa raison : un état de
// confirmation, un état d'envoi, un message d'erreur local et une boîte de
// dialogue qui écoute Échap. Un `<form method="POST">` ne peut pas confirmer
// AVANT d'écrire, et cette confirmation est la garde principale contre
// l'écrasement d'une page qui ranke. Tout le reste de /sites/[id]/existing
// reste un composant serveur et ne coûte pas un octet de JavaScript.
//
// CE QUE LE CLIC FAIT, ET CE QU'IL NE FAIT PAS. Il appelle
// POST /api/generations/refresh, qui ENREGISTRE UNE INTENTION : une ligne
// `generations` d'intention 'refresh', laissée en attente. Aucun jeton n'est
// dépensé ici, aucune page distante n'est touchée, rien n'est publié. La mise à
// jour attendra ensuite un second clic humain à l'étape Publier, dans un panneau
// qui nomme la page visée — c'est `listPendingPublishGenerations`, avec son
// `.eq('intent', 'create')`, qui garantit qu'aucun job différé ne la ramassera
// tout seul.
//
// LE LIBELLÉ DU BOUTON DE CONFIRMATION DIT L'ACTE : « Préparer la mise à jour »,
// et non « Confirmer ». Il prépare une rédaction, il ne remplace rien encore.
//
// CE QU'ON NE PROMET PAS. La portée est enregistrée sur la demande ; on n'écrit
// nulle part que « le corps qui ranke reste intact ». `PublishRequest`
// (lib/publishing/outcome.ts) ne porte aucune notion de portée et `publishPage`
// pousse la page entière : promettre à l'écran une garantie que le contrat de
// publication ne donne pas est exactement le genre de phrase que ce lot existe
// pour supprimer ailleurs.

import { useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/charts'
import { Button, FormField, Notice } from '@/components/ui'
import type { InventoryEntryDto } from '@/app/api/sites/[id]/inventory/types'
import type { RefreshScope } from '@/src/core/domain/existing/action'

/** La portée la MOINS destructrice est celle qui est présélectionnée. */
const DEFAULT_SCOPE: RefreshScope = 'metadata'

const SCOPE_OPTIONS: Array<{ value: RefreshScope; label: string }> = [
  { value: 'metadata', label: 'Titre et description seulement' },
  { value: 'content', label: 'Contenu complet' },
]

/** Le motif servi quand l'appelant n'en fournit aucun — jamais un bouton gris muet. */
const DEFAULT_DISABLED_REASON =
  'Le site n’a jamais été analysé : le moteur ne peut pas proposer la mise à jour d’une page qu’il n’a pas vue.'

export interface RefreshRequestButtonProps {
  siteId: string
  /**
   * Les seuls champs que la modale affiche. Un `Pick` plutôt que l'entrée
   * entière : ce composant ne doit pas pouvoir se mettre à lire le reste de
   * l'inventaire pour en déduire quoi que ce soit.
   */
  entry: Pick<InventoryEntryDto, 'path' | 'url' | 'title' | 'metaDescription' | 'origin' | 'generationId'>
  /** Vrai en régime aveugle : le bouton est rendu DÉSACTIVÉ, jamais masqué. */
  disabled?: boolean
  /** Pourquoi il l'est. Un bouton grisé sans motif n'explique rien. */
  disabledReason?: string
}

export function RefreshRequestButton({ siteId, entry, disabled, disabledReason }: RefreshRequestButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<RefreshScope>(DEFAULT_SCOPE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState(false)

  const reason = disabledReason ?? DEFAULT_DISABLED_REASON

  if (disabled) {
    // Le motif voyage en `title` pour le pointeur ET en `aria-label` pour le
    // clavier : un `title` sur un bouton désactivé n'est atteignable autrement
    // par personne.
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={RefreshCw}
        disabled
        title={reason}
        ariaLabel={`Mettre à jour ${entry.path} — ${reason}`}
      >
        Mettre à jour cette page
      </Button>
    )
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/generations/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, targetPath: entry.path, scope }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        // Le corps de la route porte une phrase française directement
        // affichable — le 409 du régime aveugle compris. On la rend telle
        // quelle plutôt que d'en réécrire une seconde ici.
        setError(typeof data.error === 'string' ? data.error : `Demande refusée (erreur ${res.status}).`)
        return
      }

      setOpen(false)
      setPrepared(true)
      // Revalide le composant serveur parent : l'inventaire n'a pas changé, mais
      // la ligne créée doit exister avant que l'opérateur ne suive le lien.
      router.refresh()
    } catch {
      setError('Impossible de joindre le serveur.')
    } finally {
      setBusy(false)
    }
  }

  // L'issue s'affiche DANS la cellule, jamais en bannière globale et jamais en
  // `alert()` : l'opérateur doit lire le résultat à l'endroit exact où il a
  // cliqué, sur une ligne parmi cinquante.
  if (prepared) {
    return (
      <Notice
        inline
        tone="good"
        title="Mise à jour préparée"
        body="Elle attend votre validation à l’étape Publier. Rien n’a encore été écrit sur le site."
        action={{ label: 'Voir la file des mises à jour', href: '/publish' }}
      />
    )
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setOpen(true)}>
        Mettre à jour cette page
      </Button>

      {error && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Notice inline tone="critical" title="Mise à jour impossible" body={error} />
        </div>
      )}

      {open && (
        <Modal
          title="Mettre à jour cette page ?"
          subtitle={entry.path}
          onClose={() => setOpen(false)}
          maxWidth={560}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Annuler
              </Button>
              {/* Le verbe de l'acte : ce clic PRÉPARE une rédaction, il ne
                  publie rien. La variante 'danger' rappelle que la ligne
                  produite vise une page déjà en ligne. */}
              <Button variant="danger" loading={busy} onClick={submit}>
                Préparer la mise à jour
              </Button>
            </div>
          }
        >
          <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <Notice
              inline
              tone="warning"
              title="Cette page est déjà en ligne"
              body="Une mise à jour remplace son contenu. Si elle est bien positionnée aujourd’hui, la réécrire peut la faire chuter."
            />

            <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <div className="eyebrow">Ce qui est en ligne aujourd’hui</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)', fontWeight: 600 }}>
                {entry.title ?? 'Aucun titre relevé sur cette page'}
              </div>
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 'var(--lh-snug)' }}>
                {entry.metaDescription ?? 'Aucune description relevée sur cette page.'}
              </p>
              {entry.url && (
                <a className="btn-link" href={entry.url} target="_blank" rel="noopener noreferrer">
                  Ouvrir la page <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </div>

            <FormField label="Ce qui sera réécrit">
              <select
                className="input"
                value={scope}
                onChange={(event) => setScope(event.target.value as RefreshScope)}
                disabled={busy}
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            {/* La vérité vérifiable, et rien de plus : la portée est enregistrée
                sur la demande, c'est le moteur qui l'applique à la rédaction. */}
            <p className="meta" style={{ margin: 0 }}>
              La portée est enregistrée sur la demande&nbsp;; c’est le moteur qui l’applique à la rédaction.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
