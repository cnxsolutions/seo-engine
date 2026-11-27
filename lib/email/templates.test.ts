import { describe, expect, it } from 'vitest'
import { CLIENT_FORBIDDEN_WORDS } from '@/lib/glossary'
import type { ClientDelivery, OperatorDelivery, OutboxEntry } from '@/src/core/domain/email/deliveries'
import { escapeHtml, safeHref } from './layout'
import { renderClientEmail, renderOperatorEmail, unsubscribeLinks } from './templates'

const URL_ = 'https://seo.cnx-solutions.fr'

function entry(overrides: Partial<OutboxEntry['request']> = {}, id = 'o1'): OutboxEntry {
  return {
    id,
    kind: 'client_request',
    requestStatus: overrides.status ?? 'scheduled',
    attempts: 0,
    createdAt: '2026-11-28T09:58:00Z',
    member: null,
    request: {
      id: `r-${id}`, keyword: 'débouchage', city: 'Troyes', note: null, desired_by: null, status: 'scheduled',
      reason_code: null, reasons: ['Motif interne : la ville est hors du périmètre de la campagne.'],
      evidence: [], scheduled_for: '2026-12-12', published_url: null, published_at: null,
      decided_at: '2026-11-28T09:58:00Z', created_at: '2026-11-28T09:56:00Z', updated_at: '2026-11-28T09:58:00Z',
      siteId: 's1', siteName: 'Plomberie Martin',
      ...overrides,
    },
  }
}

function clientDelivery(entries: OutboxEntry[]): ClientDelivery {
  return { kind: 'client', to: 'marie@martin-batiment.test', memberId: 'm1', unsubscribeToken: '6f1c2c8e-1111-4a4a-9b9b-123456789abc', entries }
}

describe('renderClientEmail', () => {
  it('annonce une demande dans les mots de l’espace, avec son lien de désinscription', () => {
    const email = renderClientEmail(clientDelivery([entry()]), URL_)
    expect(email.subject).toBe('Votre demande « débouchage » : prévue le 12 déc.')
    expect(email.text).toContain('Elle est au programme : la page est prévue le 12 déc.')
    expect(email.text).toContain(`${URL_}/espace/s1/demandes`)
    expect(email.text).toContain(`${URL_}/espace/desinscription/6f1c2c8e-1111-4a4a-9b9b-123456789abc`)
    expect(email.html).toContain('Ne plus recevoir ces e-mails')
    expect(email.headers).toEqual({
      'List-Unsubscribe': `<${URL_}/api/espace/desinscription/6f1c2c8e-1111-4a4a-9b9b-123456789abc>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('montre le lien de la page mise en ligne', () => {
    const email = renderClientEmail(
      clientDelivery([entry({ status: 'published', published_url: 'https://plomberie-martin.test/debouchage-troyes' })]),
      URL_,
    )
    expect(email.subject).toBe('Votre demande « débouchage » : en ligne')
    expect(email.html).toContain('href="https://plomberie-martin.test/debouchage-troyes"')
  })

  it('ne livre jamais les motifs internes ni le vocabulaire du moteur au client', () => {
    const email = renderClientEmail(
      clientDelivery([
        entry(),
        entry({ status: 'declined', reasons: ['Votre site ne propose pas ce service.', 'Note interne CNX.'] }, 'o2'),
        entry({ status: 'deferred' }, 'o3'),
        entry({ status: 'covered' }, 'o4'),
      ]),
      URL_,
    )
    expect(email.text).not.toContain('Motif interne')
    expect(email.text).not.toContain('Note interne CNX')
    // The motif of a declined request is the one free text written FOR the client.
    expect(email.text).toContain('Votre site ne propose pas ce service.')
    const words = email.text.toLowerCase()
    for (const word of CLIENT_FORBIDDEN_WORDS) expect(words).not.toContain(word)
  })

  it('échappe ce qui vient de la base', () => {
    const email = renderClientEmail(clientDelivery([entry({ keyword: '<script>alert(1)</script>' })]), URL_)
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('renvoie à l’accueil de l’espace quand les demandes touchent deux sites', () => {
    const email = renderClientEmail(clientDelivery([entry(), entry({ siteId: 's2', siteName: 'Toitures Lambert' }, 'o2')]), URL_)
    expect(email.text).toContain(`Ouvrir mon espace : ${URL_}/espace\n`)
  })
})

describe('renderOperatorEmail', () => {
  it('donne à CNX les motifs du moteur et le chemin de la file', () => {
    const delivery: OperatorDelivery = { kind: 'operator', to: 'contact@cnx-solutions.fr', entries: [entry({ status: 'review' })] }
    const email = renderOperatorEmail(delivery, URL_)
    expect(email.subject).toBe('Demande client à examiner : « débouchage » (Plomberie Martin)')
    expect(email.text).toContain('Motif interne : la ville est hors du périmètre de la campagne.')
    expect(email.text).toContain(`${URL_}/sites/s1/demandes`)
    expect(email.headers).toEqual({})
  })
})

describe('layout', () => {
  it('échappe le HTML et ne garde que les liens http(s)', () => {
    expect(escapeHtml(`"a" & <b>'`)).toBe('&quot;a&quot; &amp; &lt;b&gt;&#39;')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('https://exemple.fr/?a=1&b=2')).toBe('https://exemple.fr/?a=1&amp;b=2')
  })

  it('construit les deux liens de désinscription', () => {
    expect(unsubscribeLinks(URL_, 'abc')).toEqual({
      page: `${URL_}/espace/desinscription/abc`,
      oneClick: `${URL_}/api/espace/desinscription/abc`,
    })
  })
})
