// ─────────────────────────────────────────────────────────────────────────────
// Where the e-mails leave from, read from the environment — and when they must not
// docs/cadrage.md decisions 17 and 22, .env.example
// ─────────────────────────────────────────────────────────────────────────────
//
// Production: the SMTP account of the CNX site (SMTP_*), sender
// contact@cnx-solutions.fr, links on APP_PUBLIC_URL.
//
// Everywhere else, only a loopback SMTP is accepted — the Mailpit of the local
// Supabase (127.0.0.1:54325). A `.env.local` that borrowed the production SMTP
// would otherwise write to real clients from a laptop, while the VPS does the
// same: decision 17 says « en local, aucun envoi réel », and this is where it
// holds.
//
// A missing or refused setting is not an error to throw every two minutes: the
// result says why nothing leaves, and the sender writes it once in the log.

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string } | null
}

export interface EmailConfig {
  smtp: SmtpSettings
  /** « CNX Solutions <contact@cnx-solutions.fr> » unless EMAIL_FROM says otherwise. */
  from: string
  /** Where « a request is waiting for you » goes; null: no such e-mail. */
  operatorEmail: string | null
  /** The origin the links of an e-mail point to, without a trailing slash. */
  publicUrl: string
}

export type EmailConfigResult = { ok: true; config: EmailConfig } | { ok: false; reason: string }

export const DEFAULT_FROM = 'CNX Solutions <contact@cnx-solutions.fr>'
const LOCAL_PUBLIC_URL = 'http://localhost:3000'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

type Env = Readonly<Record<string, string | undefined>>

export function readEmailConfig(env: Env = process.env): EmailConfigResult {
  const production = env.NODE_ENV === 'production'
  const host = env.SMTP_HOST?.trim()
  if (!host) return { ok: false, reason: 'SMTP_HOST absente : aucun e-mail ne part.' }
  if (!production && !LOOPBACK.has(host)) {
    return { ok: false, reason: `Hors production, seul un SMTP local est accepté (Mailpit, 127.0.0.1:54325), pas ${host}.` }
  }

  const port = Number(env.SMTP_PORT ?? 587)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { ok: false, reason: `SMTP_PORT invalide : ${env.SMTP_PORT}.` }

  const user = env.SMTP_USER?.trim()
  const pass = env.SMTP_PASSWORD
  if (Boolean(user) !== Boolean(pass)) return { ok: false, reason: 'SMTP_USER et SMTP_PASSWORD vont ensemble.' }

  const publicUrl = (env.APP_PUBLIC_URL?.trim() || (production ? '' : LOCAL_PUBLIC_URL)).replace(/\/+$/, '')
  if (!publicUrl) return { ok: false, reason: 'APP_PUBLIC_URL absente : les liens des e-mails seraient faux.' }
  if (production && !publicUrl.startsWith('https://')) return { ok: false, reason: 'APP_PUBLIC_URL doit commencer par https:// en production.' }

  return {
    ok: true,
    config: {
      smtp: {
        host,
        port,
        // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
        secure: env.SMTP_SECURE === 'true' || port === 465,
        auth: user && pass ? { user, pass } : null,
      },
      from: env.EMAIL_FROM?.trim() || DEFAULT_FROM,
      operatorEmail: env.OPERATOR_EMAIL?.trim() || null,
      publicUrl,
    },
  }
}
