'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, FieldError } from '@/components/ui'
import { SIGN_IN_TEXT } from '@/lib/client-space/labels'

// ─────────────────────────────────────────────────────────────────────────────
// Two steps on one page: the address, then the six digits.
//
// The code is typed here rather than through the e-mail's link because the
// link often opens in the mail app's own browser, which keeps the session to
// itself (décision 3). Hence a field built for phones: numeric keypad, the
// one-time-code autofill of iOS and Android, pasted spaces tolerated.
// ─────────────────────────────────────────────────────────────────────────────

/** Supabase sends one e-mail per address per minute; the button says so instead of failing. */
const RESEND_DELAY_SECONDS = 60

type Step = { kind: 'email' } | { kind: 'code'; email: string }

interface PostResult {
  ok: boolean
  data: { error?: string; message?: string; redirect?: string }
}

async function post(url: string, body: Record<string, unknown>): Promise<PostResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as PostResult['data']
    return { ok: response.ok, data }
  } catch {
    return { ok: false, data: { error: SIGN_IN_TEXT.unreachable } }
  }
}

export function SignInForm({ next }: { next?: string }) {
  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentMessage, setSentMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus()
  }, [step])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((left) => left - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const requestCode = async (address: string) => {
    setBusy(true)
    setError(null)
    const { ok, data } = await post('/api/espace/connexion/code', { email: address })
    setBusy(false)
    if (!ok) {
      setError(data.error ?? SIGN_IN_TEXT.unavailable)
      return false
    }
    setSentMessage(data.message ?? SIGN_IN_TEXT.codeSent)
    setCooldown(RESEND_DELAY_SECONDS)
    return true
  }

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault()
    const address = email.trim()
    if (!address.includes('@')) {
      setError(SIGN_IN_TEXT.invalidEmail)
      return
    }
    if (await requestCode(address)) {
      setCode('')
      setStep({ kind: 'code', email: address })
    }
  }

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'code') return
    if (code.replace(/[\s-]/g, '').length !== 6) {
      setError(SIGN_IN_TEXT.invalidCodeFormat)
      return
    }
    setBusy(true)
    setError(null)
    const { ok, data } = await post('/api/espace/connexion/verification', { email: step.email, code, suite: next })
    if (!ok || !data.redirect) {
      setBusy(false)
      setError(data.error ?? SIGN_IN_TEXT.codeRejected)
      return
    }
    // A full navigation, not a client-side one: the space is rendered by the
    // server, and must be rendered with the cookies this response just set.
    window.location.assign(data.redirect)
  }

  if (step.kind === 'email') {
    return (
      <form className="auth-form" onSubmit={submitEmail} noValidate>
        <div>
          <label className="field-label" htmlFor="signin-email">Adresse e-mail</label>
          <input
            id="signin-email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signin-error' : undefined}
          />
          {error && <div id="signin-error"><FieldError>{error}</FieldError></div>}
        </div>
        <Button type="submit" size="lg" fullWidth loading={busy} iconRight={ArrowRight}>
          Recevoir mon code
        </Button>
      </form>
    )
  }

  return (
    <form className="auth-form" onSubmit={submitCode} noValidate>
      <p className="auth-form__sent" role="status">{sentMessage}</p>
      <div>
        <label className="field-label" htmlFor="signin-code">Code reçu par e-mail</label>
        <input
          ref={codeRef}
          id="signin-code"
          className="input code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={9}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'signin-error' : undefined}
        />
        {error && <div id="signin-error"><FieldError>{error}</FieldError></div>}
      </div>
      <Button type="submit" size="lg" fullWidth loading={busy} iconRight={ArrowRight}>
        Se connecter
      </Button>
      <div className="auth-form__aside">
        <button
          type="button"
          className="link-button"
          onClick={() => { setStep({ kind: 'email' }); setError(null) }}
        >
          Changer d’adresse
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy || cooldown > 0}
          onClick={() => void requestCode(step.email)}
        >
          {cooldown > 0 ? `Renvoyer un code (${cooldown} s)` : 'Renvoyer un code'}
        </button>
      </div>
    </form>
  )
}
