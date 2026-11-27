'use client'

// ─────────────────────────────────────────────────────────────────────────────
// La confirmation de suppression d'une campagne — UNE définition, deux écrans.
//
// La liste des stratégies et la page de modification offrent toutes deux le
// bouton « Supprimer ». Un `window.confirm` aurait suffi techniquement, mais il
// ne dit rien de ce qui est conservé, n'affiche pas la raison d'un refus (409 :
// une génération tourne) et n'existe nulle part ailleurs dans ce dépôt — tous
// les autres dialogues passent par `Modal`, qui gère le focus et la touche Échap.
//
// La route DELETE décide seule de ce qu'elle refuse. Ce dialogue ne fait que
// relayer son message, sans réinterpréter le code : un 409 et un 500 se lisent
// tous deux comme « la suppression n'a pas eu lieu, voici pourquoi ».
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Notice } from '@/components/ui'
import { Modal } from '@/components/charts'
import './strategy.css'

export function DeleteCampaignDialog({
  campaign, onClose, onDeleted,
}: {
  campaign: { id: string; name: string }
  onClose: () => void
  /** Appelé UNIQUEMENT après un 200 : l'appelant décide s'il recharge ou navigue. */
  onDeleted: () => void | Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Le dialogue reste ouvert : l'opérateur lit le motif, puis choisit
        // d'annuler ou de réessayer une fois la génération terminée.
        setError(data.error || `Suppression refusée (erreur ${res.status})`)
        return
      }
      await onDeleted()
    } catch {
      setError('Impossible de joindre le serveur')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal
      title="Supprimer cette campagne ?"
      subtitle={campaign.name}
      onClose={onClose}
      size="md"
      footer={
        <div className="modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Annuler
          </Button>
          <Button variant="danger" icon={Trash2} loading={deleting} onClick={remove}>
            Supprimer la campagne
          </Button>
        </div>
      }
    >
      <div className="delete-campaign__body">
        <p className="delete-campaign__text">
          La suppression efface le plan de cycle et le calendrier éditorial de cette campagne :
          aucun créneau restant ne sera généré.
        </p>
        <p className="delete-campaign__text">
          <strong>Les pages déjà générées ou publiées sont conservées</strong>, sur le site comme dans
          l’historique des générations. Rien n’est retiré du site du client.
        </p>
        <p className="meta">
          Une campagne dont une génération ou une publication est en cours ne peut pas être supprimée :
          attendez la fin du créneau, puis réessayez.
        </p>
        {error && <Notice inline tone="critical" title="Campagne non supprimée" body={error} />}
      </div>
    </Modal>
  )
}
