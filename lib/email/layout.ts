// ─────────────────────────────────────────────────────────────────────────────
// The frame of every e-mail the engine sends — the CNX look of
// supabase/templates/code-connexion.html, the sign-in code: a HERO band, one
// white card, a pill button, the values of components/tokens.css.
//
// Inline styles and tables: it is what mail clients read, they ignore
// stylesheets. (The no-inline-style rule of CLAUDE.md is about the screens; an
// e-mail has no other way.) Every value that comes from the database goes
// through `escapeHtml`, every link through `safeHref`.
// ─────────────────────────────────────────────────────────────────────────────

const INK = '#08090d'
const MUTED = '#687080'
const PAGE = '#f4f5f7'
const LINE = '#e8eaef'
const HERO = '#0d1440'
const ACCENT = '#0b6cf9'
const FONT = 'Inter,Segoe UI,Helvetica,Arial,sans-serif'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

/** An http(s) address, escaped for an attribute — or null for anything else (javascript:, data:…). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? escapeHtml(parsed.toString()) : null
  } catch {
    return null
  }
}

export interface EmailFrame {
  /** The small caps line of the band. */
  eyebrow: string
  /** The band's title. */
  title: string
  /** The card's content, already escaped. */
  body: string
  /** One call to action, under the content. */
  action: { label: string; href: string } | null
  /** The fine print under the card, already escaped. */
  footer: string
}

export function emailFrame(frame: EmailFrame): string {
  const action = frame.action
    ? `<p style="margin:24px 0 0;"><a href="${frame.action.href}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${ACCENT};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(frame.action.label)}</a></p>`
    : ''
  // The viewport line: without it a phone lays the message out 980 px wide and
  // shows its left third (seen in the L7 run-through at 375 px).
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(frame.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAGE};font-family:${FONT};color:${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:20px;overflow:hidden;">
            <tr>
              <td style="background:${HERO};padding:24px 28px;">
                <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.72);">${escapeHtml(frame.eyebrow)}</p>
                <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(frame.title)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${frame.body}
                ${action}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;max-width:560px;font-size:12px;line-height:1.55;color:${MUTED};">${frame.footer}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/** A paragraph of running text. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};">${html}</p>`
}

/** One item of a list of news: a title line, a small context line, then its text. */
export function newsItem(item: { title: string; context: string; badge: string; text: string; link: { label: string; href: string } | null }): string {
  const link = item.link
    ? ` <a href="${item.link.href}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${escapeHtml(item.link.label)}</a>`
    : ''
  return `<tr>
                    <td style="padding:16px 0;border-top:1px solid ${LINE};">
                      <p style="margin:0;font-size:16px;font-weight:700;color:${INK};">${escapeHtml(item.title)}</p>
                      <p style="margin:4px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(item.context)} · <strong style="color:${INK};">${escapeHtml(item.badge)}</strong></p>
                      <p style="margin:8px 0 0;font-size:15px;line-height:1.55;color:${INK};">${escapeHtml(item.text)}${link}</p>
                    </td>
                  </tr>`
}

export function newsList(items: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.join('')}</table>`
}
