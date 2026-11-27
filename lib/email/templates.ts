// ─────────────────────────────────────────────────────────────────────────────
// What each delivery says — subject, HTML and plain text (KW-12, L7)
// ─────────────────────────────────────────────────────────────────────────────
//
// The client's e-mail speaks the words of the client space: the state label and
// the one sentence of each request come from lib/client-space/labels.ts, the
// same functions RequestItem renders. Never an operator reason, a model or a
// technical term (CLIENT_FORBIDDEN_WORDS is checked by the test). Every client
// e-mail carries its unsubscribe link, and the RFC 8058 headers that let a mail
// client offer « Se désabonner » in one click.
//
// CNX's e-mail is for the operator: the engine's reasons in clear, a link to
// the request queue.

import { requestDetailSentence, requestStateLabel } from '@/lib/client-space/labels'
import { clientRequestView } from '@/src/core/domain/keyword-requests/client-view'
import type { ClientDelivery, Delivery, OperatorDelivery, OutboxEntry } from '@/src/core/domain/email/deliveries'
import { emailFrame, escapeHtml, newsItem, newsList, paragraph, safeHref } from './layout'

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  text: string
  headers: Record<string, string>
}

export function renderDelivery(delivery: Delivery, publicUrl: string): OutgoingEmail {
  return delivery.kind === 'client' ? renderClientEmail(delivery, publicUrl) : renderOperatorEmail(delivery, publicUrl)
}

/** The page to unsubscribe from, and the address a mail client posts to in one click. */
export function unsubscribeLinks(publicUrl: string, token: string): { page: string; oneClick: string } {
  const segment = encodeURIComponent(token)
  return {
    page: `${publicUrl}/espace/desinscription/${segment}`,
    oneClick: `${publicUrl}/api/espace/desinscription/${segment}`,
  }
}

// ── The client ──────────────────────────────────────────────────────────────

interface ClientNews {
  keyword: string
  where: string
  state: string
  text: string
  url: string | null
}

function clientNews(entry: OutboxEntry): ClientNews {
  const view = clientRequestView(entry.request)
  const { text, url } = requestDetailSentence(view)
  return {
    keyword: entry.request.city ? `${entry.request.keyword} · ${entry.request.city}` : entry.request.keyword,
    where: entry.request.siteName,
    state: requestStateLabel(view),
    text,
    url,
  }
}

export function renderClientEmail(delivery: ClientDelivery, publicUrl: string): OutgoingEmail {
  const news = delivery.entries.map(clientNews)
  const sites = new Set(delivery.entries.map((entry) => entry.request.siteId))
  const space = sites.size === 1 ? `${publicUrl}/espace/${delivery.entries[0].request.siteId}/demandes` : `${publicUrl}/espace`
  const unsubscribe = unsubscribeLinks(publicUrl, delivery.unsubscribeToken)

  const subject = news.length === 1
    ? `Votre demande « ${delivery.entries[0].request.keyword} » : ${news[0].state.charAt(0).toLowerCase()}${news[0].state.slice(1)}`
    : `Du nouveau sur ${news.length} de vos demandes`
  const intro = news.length === 1 ? 'Votre demande a avancé&nbsp;:' : 'Vos demandes ont avancé&nbsp;:'
  const reason = 'Vous recevez cet e-mail parce que vous avez envoyé ces demandes depuis votre espace CNX SEO Engine.'

  const html = emailFrame({
    eyebrow: 'CNX Solutions',
    title: 'Vos demandes de mots-clés',
    body: paragraph('Bonjour,') + paragraph(intro) + newsList(news.map((item) => newsItem({
      title: item.keyword,
      context: item.where,
      badge: item.state,
      text: item.text,
      link: item.url ? linkTo('Voir la page', item.url) : null,
    }))),
    action: linkTo('Ouvrir mon espace', space),
    footer: `${escapeHtml(reason)} <a href="${safeHref(unsubscribe.page) ?? ''}" style="color:#687080;">Ne plus recevoir ces e-mails</a>.<br>CNX Solutions · contact@cnx-solutions.fr`,
  })

  const text = [
    'Bonjour,',
    '',
    news.length === 1 ? 'Votre demande a avancé :' : 'Vos demandes ont avancé :',
    '',
    ...news.flatMap((item) => [`${item.keyword} (${item.where}) — ${item.state}`, item.url ? `${item.text} ${item.url}` : item.text, '']),
    `Ouvrir mon espace : ${space}`,
    '',
    reason,
    `Ne plus recevoir ces e-mails : ${unsubscribe.page}`,
    'CNX Solutions · contact@cnx-solutions.fr',
  ].join('\n')

  return {
    to: delivery.to,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribe.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

// ── CNX ─────────────────────────────────────────────────────────────────────

export function renderOperatorEmail(delivery: OperatorDelivery, publicUrl: string): OutgoingEmail {
  const queue = `${publicUrl}/demandes`
  const first = delivery.entries[0].request
  const subject = delivery.entries.length === 1
    ? `Demande client à examiner : « ${first.keyword} » (${first.siteName})`
    : `${delivery.entries.length} demandes clients à examiner`

  const items = delivery.entries.map((entry) => ({
    title: entry.request.city ? `${entry.request.keyword} · ${entry.request.city}` : entry.request.keyword,
    context: entry.request.siteName,
    text: entry.request.reasons.join(' ') || 'Le moteur n’a pas pu conclure seul.',
    href: `${publicUrl}/sites/${entry.request.siteId}/demandes`,
  }))

  const html = emailFrame({
    eyebrow: 'CNX SEO Engine',
    title: delivery.entries.length === 1 ? 'Une demande attend votre décision' : 'Des demandes attendent votre décision',
    body: paragraph('Le moteur n’a pas pu conclure seul&nbsp;: à vous de prévoir, de reporter ou de refuser.')
      + newsList(items.map((item) => newsItem({
        title: item.title,
        context: item.context,
        badge: 'À examiner',
        text: item.text,
        link: linkTo('Ouvrir', item.href),
      }))),
    action: linkTo('Ouvrir la file des demandes', queue),
    footer: 'Alerte de l’outil CNX SEO Engine, envoyée à l’adresse réglée sur le serveur (OPERATOR_EMAIL).',
  })

  const text = [
    'Le moteur n’a pas pu conclure seul : à vous de prévoir, de reporter ou de refuser.',
    '',
    ...items.flatMap((item) => [`${item.title} (${item.context})`, item.text, item.href, '']),
    `La file des demandes : ${queue}`,
  ].join('\n')

  return { to: delivery.to, subject, html, text, headers: {} }
}

/** A link for the frame: only an http(s) address becomes one. */
function linkTo(label: string, url: string): { label: string; href: string } | null {
  const href = safeHref(url)
  return href ? { label, href } : null
}
