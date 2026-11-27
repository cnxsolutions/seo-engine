// ─────────────────────────────────────────────────────────────────────────────
// The SMTP behind an interface of one method — the sender (send-due.ts) is
// tested with a fake, and nodemailer stays in this file.
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer'
import type { SmtpSettings } from './config'
import type { OutgoingEmail } from './templates'

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
}

export function createSmtpMailer(smtp: SmtpSettings, from: string): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.auth ? { auth: smtp.auth } : {}),
    // A hung SMTP must not hold the scheduler's slot: the next pass retries.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  return {
    async send(email) {
      await transport.sendMail({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      })
    },
  }
}
