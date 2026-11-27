import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AuthShell } from '@/components/AuthShell'
import { Button, Notice } from '@/components/ui'
import { readEmailPreference } from '@/lib/client-space/email-preference'
import { EMAIL_PREFERENCE_TEXT } from '@/lib/client-space/labels'

export const metadata: Metadata = { title: 'E-mails de suivi' }
export const dynamic = 'force-dynamic'

/**
 * /espace/desinscription/[token] — the link at the foot of every client e-mail
 * (L7). Public (lib/client-space/gate.ts): it works from any mailbox, without
 * signing in, and opens one setting and nothing else.
 *
 * The page changes nothing by being opened — link scanners open every link of
 * an e-mail. The button posts to /api/espace/desinscription/[token], which
 * comes back here with `?fait=`. A plain form: no JavaScript needed.
 */
export default async function EmailPreferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const { fait } = await searchParams
  const preference = await readEmailPreference(token)
  if (!preference) notFound()

  const text = EMAIL_PREFERENCE_TEXT
  const done = fait === 'desinscrit' ? text.doneUnsubscribed : fait === 'reabonne' ? text.doneResubscribed : null

  return (
    <AuthShell
      eyebrow={text.eyebrow}
      title={preference.optedOut ? text.titleUnsubscribed : text.titleSubscribed}
      intro={text.intro(preference.maskedEmail)}
    >
      {done && (
        <div className="auth-shell__notice">
          <Notice tone="good" title={done.title} body={done.body} inline />
        </div>
      )}
      <form method="post" action={`/api/espace/desinscription/${encodeURIComponent(token)}`} className="auth-form">
        <input type="hidden" name="choix" value={preference.optedOut ? 'reabonner' : 'desinscrire'} />
        <Button type="submit" variant={preference.optedOut ? 'primary' : 'secondary'} size="lg" fullWidth>
          {preference.optedOut ? text.resubscribe : text.unsubscribe}
        </Button>
        <Button href="/espace" variant="ghost" size="lg" fullWidth>{text.openSpace}</Button>
      </form>
    </AuthShell>
  )
}
