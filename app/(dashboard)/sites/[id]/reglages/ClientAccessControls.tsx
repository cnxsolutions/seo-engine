'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, UserMinus, UserPlus } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button, FieldError, Notice, formatMoment } from '@/components/ui'
import type { MemberView, SiteAccess } from '@/lib/client-space/access'
import type { MemberState } from '@/src/core/domain/client-access/policy'

const NEW_CLIENT = '__nouveau'

const STATE_BADGES: Record<MemberState, { cls: string; label: string }> = {
  active: { cls: 'badge badge-success', label: 'Actif' },
  pending: { cls: 'badge badge-info', label: 'Jamais connecté' },
  revoked: { cls: 'badge badge-muted', label: 'Accès retiré' },
}

const INVITE_DONE: Record<string, string> = {
  invited: 'Accès ouvert : un code de connexion vient de partir.',
  reopened: 'Accès rouvert : un code de connexion vient de partir.',
  resent: 'Un nouveau code de connexion vient de partir.',
}

interface InviteBody {
  email: string
  client?: { kind: 'existing'; id: string } | { kind: 'new'; name: string } | null
}

/** Resolves to the success sentence, or throws the server's own refusal. */
async function invite(siteId: string, body: InviteBody): Promise<string> {
  let response: Response
  try {
    response = await fetch(`/api/sites/${siteId}/client-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }
  const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string }
  if (!response.ok) throw new Error(data.error ?? `Invitation refusée (erreur ${response.status}).`)
  return INVITE_DONE[data.status ?? ''] ?? INVITE_DONE.resent
}

export function ClientAccessControls({ access }: { access: SiteAccess }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clientChoice, setClientChoice] = useState<string>(access.clients[0]?.id ?? NEW_CLIENT)
  const [clientName, setClientName] = useState(access.siteName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (!email.includes('@')) {
      setError('Saisissez une adresse e-mail valide.')
      return
    }
    if (!access.client && clientChoice === NEW_CLIENT && !clientName.trim()) {
      setError('Donnez un nom au client.')
      return
    }

    const body: InviteBody = { email }
    if (!access.client) {
      body.client = clientChoice === NEW_CLIENT
        ? { kind: 'new', name: clientName.trim() }
        : { kind: 'existing', id: clientChoice }
    }

    setBusy(true)
    try {
      setDone(await invite(access.siteId, body))
      setEmail('')
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invitation refusée.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="access">
      {access.client ? (
        <p className="access__client">
          Client : <strong>{access.client.name}</strong>
          {access.otherSites.length > 0 && (
            <span className="meta"> — voit aussi {access.otherSites.map((site) => site.name).join(', ')}</span>
          )}
        </p>
      ) : (
        <p className="meta access__client">Ce site n’est rattaché à aucun client : la première invitation l’y rattache.</p>
      )}

      {access.members.length > 0 && (
        <ul className="access-members" aria-label="Personnes ayant accès">
          {access.members.map((member) => (
            <MemberRow key={member.id} siteId={access.siteId} member={member} />
          ))}
        </ul>
      )}

      <form className="access-form" onSubmit={submit} noValidate>
        {!access.client && (
          <div className="access-form__row">
            <div className="access-form__field">
              <label className="field-label" htmlFor="access-client">Client</label>
              <select
                id="access-client"
                className="input"
                value={clientChoice}
                onChange={(event) => setClientChoice(event.target.value)}
              >
                {access.clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
                <option value={NEW_CLIENT}>Nouveau client…</option>
              </select>
            </div>
            {clientChoice === NEW_CLIENT && (
              <div className="access-form__field">
                <label className="field-label" htmlFor="access-client-name">Nom du client</label>
                <input
                  id="access-client-name"
                  className="input"
                  maxLength={120}
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                />
              </div>
            )}
          </div>
        )}
        <div className="access-form__row">
          <div className="access-form__field">
            <label className="field-label" htmlFor="access-email">Adresse e-mail à inviter</label>
            <input
              id="access-email"
              className="input"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'access-error' : undefined}
            />
          </div>
          <div className="access-form__submit">
            <Button type="submit" icon={UserPlus} loading={busy}>Inviter</Button>
          </div>
        </div>
        {error && <div id="access-error"><FieldError>{error}</FieldError></div>}
        {done && <div role="status"><Notice tone="good" title={done} body="La personne se connecte depuis /espace/connexion avec ce code." inline /></div>}
      </form>
    </div>
  )
}

function MemberRow({ siteId, member }: { siteId: string; member: MemberView }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState<string | null>(null)
  const badge = STATE_BADGES[member.state]

  const revoke = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/sites/${siteId}/client-access/${member.id}`, { method: 'DELETE' })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? `Retrait refusé (erreur ${response.status}).`)
      setConfirming(false)
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Retrait refusé.')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setBusy(true)
    setResent(null)
    try {
      setResent(await invite(siteId, { email: member.email }))
      router.refresh()
    } catch (failure) {
      setResent(failure instanceof Error ? failure.message : 'Envoi refusé.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="access-member">
      <div className="access-member__who">
        <span className="access-member__email">{member.email}</span>
        <span className="meta">
          {member.lastLoginAt ? `Dernière connexion le ${formatMoment(member.lastLoginAt)}` : 'Aucune connexion'}
        </span>
        {resent && <span className="meta" role="status">{resent}</span>}
      </div>
      <span className={badge.cls}>{badge.label}</span>
      <div className="access-member__actions">
        <Button variant="ghost" size="sm" icon={Send} onClick={resend} disabled={busy}>
          {member.state === 'revoked' ? 'Rouvrir l’accès' : 'Renvoyer un code'}
        </Button>
        {member.state !== 'revoked' && (
          <Button variant="ghost" size="sm" icon={UserMinus} onClick={() => setConfirming(true)} disabled={busy}>
            Retirer l’accès
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Retirer cet accès ?"
        subject={member.email}
        confirmLabel="Retirer l’accès"
        confirmIcon={UserMinus}
        busy={busy}
        error={error}
        errorTitle="Accès non retiré"
        onConfirm={revoke}
        onClose={() => { setConfirming(false); setError(null) }}
      >
        <p>La personne est déconnectée tout de suite et ne peut plus demander de code. Vous pourrez rouvrir l’accès plus tard.</p>
      </ConfirmDialog>
    </li>
  )
}
