// ─────────────────────────────────────────────────────────────────────────────
// Les contraintes de format d'un post GBP, verifiees
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// Un cas par CODE de refus, et c'est la forme du fichier qui porte l'exigence :
// « format invalide » ne dit pas a l'operateur quoi corriger, donc chaque defaut
// doit sortir sous un code qui lui est propre — et le test `codes distincts`
// plus bas est ce qui empeche deux defauts de se retrouver un jour sous le meme.
//
// Aucun reseau, aucune base, aucun montage : `validateLocalPost` est pure et le
// reste. C'est precisement ce qui rend testable une regle qu'aucun appel reel a
// l'API GBP n'a encore pu confirmer (l'acces en ecriture n'est pas accorde, voir
// docs/gbp-acces-api.md).

import { describe, expect, it } from 'vitest'
import type { Site } from '@/lib/types'
import {
  GBP_ALLOWED_ACTION_TYPES,
  GBP_SUMMARY_MAX_CHARS,
  GBP_SUMMARY_TARGET,
  GBP_TOPIC_TYPE,
  validateLocalPost,
  type GbpActionType,
  type LocalPostDraft,
} from './format'

// ─── Doubles ─────────────────────────────────────────────────────────────────

function siteAt(url: string): Site {
  return {
    id: 'site-1',
    name: 'Taxi Troyes',
    type: 'nextjs',
    url,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

const SITE = siteAt('https://taxi-troyes.fr')

/** Un resume de longueur exacte, sans un seul chiffre : aucun faux positif de telephone. */
function summaryOf(chars: number): string {
  const base = 'Nous assurons vos trajets dans toute l agglomeration troyenne, gare comprise. '
  return base.repeat(Math.ceil(chars / base.length)).slice(0, chars)
}

function draftOf(overrides: Partial<LocalPostDraft> = {}): LocalPostDraft {
  return {
    languageCode: 'fr',
    topicType: GBP_TOPIC_TYPE,
    summary: summaryOf(320),
    ...overrides,
  }
}

/**
 * Un bouton dont le type d'action est une CHAINE.
 *
 * Le seul `as` de ce fichier, et il reproduit exactement la frontiere que
 * `validateLocalPost` surveille : le JSON rendu par le modele et la colonne
 * `gbp_posts.cta_action_type`, un `text` sans CHECK. Sans lui, GBP_ACTION_UNKNOWN
 * ne serait atteignable qu'en desactivant le compilateur — c'est-a-dire jamais
 * verifie, alors que la valeur, elle, arrivera bien un jour.
 */
function ctaOf(actionType: string, url?: string): NonNullable<LocalPostDraft['callToAction']> {
  const typed = actionType as GbpActionType
  return url === undefined ? { actionType: typed } : { actionType: typed, url }
}

function codesOf(draft: LocalPostDraft, site: Site = SITE): string[] {
  return validateLocalPost(draft, site).map(finding => finding.code)
}

// ─── Les constantes, et ce qu'elles n'affirment pas ──────────────────────────

describe('les constantes de format', () => {
  it('exclut GET_OFFER, deprecie par Google', () => {
    expect(GBP_ALLOWED_ACTION_TYPES).not.toContain('GET_OFFER')
    expect([...GBP_ALLOWED_ACTION_TYPES]).toEqual(['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'])
  })

  it('borne le resume a 1500 caracteres et vise une fourchette editoriale plus etroite', () => {
    expect(GBP_SUMMARY_MAX_CHARS).toBe(1500)
    expect(GBP_SUMMARY_TARGET).toEqual({ min: 200, max: 700 })
    expect(GBP_SUMMARY_TARGET.max).toBeLessThan(GBP_SUMMARY_MAX_CHARS)
  })
})

// ─── Le post qui passe ──────────────────────────────────────────────────────

describe('un post valide', () => {
  it('ne produit aucun constat', () => {
    const draft = draftOf({ callToAction: ctaOf('LEARN_MORE', 'https://taxi-troyes.fr/reservation') })
    expect(validateLocalPost(draft, SITE)).toEqual([])
  })

  it('accepte un post sans bouton : le CTA n\'est requis que pour EVENT et OFFER', () => {
    expect(validateLocalPost(draftOf(), SITE)).toEqual([])
  })

  it('accepte un CALL sans adresse, qui est la forme exigee par Google', () => {
    expect(validateLocalPost(draftOf({ callToAction: ctaOf('CALL') }), SITE)).toEqual([])
  })

  it('accepte www et un sous-domaine du client, qui ne sont pas des tiers', () => {
    expect(codesOf(draftOf({ callToAction: ctaOf('BOOK', 'https://www.taxi-troyes.fr/devis') }))).toEqual([])
    expect(codesOf(draftOf({ callToAction: ctaOf('BOOK', 'https://reservation.taxi-troyes.fr/') }))).toEqual([])
    // Et l'inverse : une fiche declaree en www accepte le domaine nu.
    expect(codesOf(
      draftOf({ callToAction: ctaOf('BOOK', 'https://taxi-troyes.fr/devis') }),
      siteAt('https://www.taxi-troyes.fr'),
    )).toEqual([])
  })
})

// ─── Un code par defaut ─────────────────────────────────────────────────────

describe('le resume', () => {
  it('vide -> GBP_SUMMARY_EMPTY, et rien d\'autre', () => {
    expect(codesOf(draftOf({ summary: '' }))).toEqual(['GBP_SUMMARY_EMPTY'])
    // Des espaces ne sont pas un post : le meme constat, pas un hors-fourchette.
    expect(codesOf(draftOf({ summary: '   \n  ' }))).toEqual(['GBP_SUMMARY_EMPTY'])
  })

  it('au-dela du plafond -> GBP_SUMMARY_TOO_LONG, sans doubler avec le hors-fourchette', () => {
    const findings = validateLocalPost(draftOf({ summary: summaryOf(GBP_SUMMARY_MAX_CHARS + 1) }), SITE)

    expect(findings.map(f => f.code)).toEqual(['GBP_SUMMARY_TOO_LONG'])
    // La honnetete de la constante est elle-meme verifiee : le message doit dire
    // que 1500 est une limite produit, pas une garantie de l'API.
    expect(findings[0].message).toContain('limite PRODUIT')
  })

  it('hors de la fourchette editoriale -> GBP_SUMMARY_OFF_TARGET, des deux cotes', () => {
    expect(codesOf(draftOf({ summary: summaryOf(GBP_SUMMARY_TARGET.min - 80) })))
      .toEqual(['GBP_SUMMARY_OFF_TARGET'])
    expect(codesOf(draftOf({ summary: summaryOf(GBP_SUMMARY_TARGET.max + 200) })))
      .toEqual(['GBP_SUMMARY_OFF_TARGET'])
  })

  it('portant un numero de telephone -> GBP_PHONE_IN_SUMMARY', () => {
    const findings = validateLocalPost(
      draftOf({ summary: `${summaryOf(250)} Appelez le 03 25 12 34 56.` }),
      SITE,
    )

    expect(findings.map(f => f.code)).toEqual(['GBP_PHONE_IN_SUMMARY'])
    expect(findings[0].message).toContain('03 25 12 34 56')
  })

  it('reconnait les ecritures usuelles d\'un numero francais', () => {
    for (const phone of ['0325123456', '03.25.12.34.56', '03-25-12-34-56', '+33 6 12 34 56 78']) {
      expect(codesOf(draftOf({ summary: `${summaryOf(250)} Reservez au ${phone}.` })))
        .toEqual(['GBP_PHONE_IN_SUMMARY'])
    }
  })

  it('ne prend ni un prix ni une annee pour un numero', () => {
    // Le faux positif est le vrai risque : un motif trop large refuserait des
    // posts corrects, et un garde-fou qui bloque le travail legitime finit
    // desactive.
    expect(codesOf(draftOf({ summary: `${summaryOf(250)} Course a partir de 0,50 euros du km depuis 2015.` })))
      .toEqual([])
  })
})

describe('le bouton', () => {
  it('un type d\'action hors liste -> GBP_ACTION_UNKNOWN', () => {
    const findings = validateLocalPost(
      draftOf({ callToAction: ctaOf('GET_OFFER', 'https://taxi-troyes.fr/offre') }),
      SITE,
    )

    expect(findings.map(f => f.code)).toEqual(['GBP_ACTION_UNKNOWN'])
    expect(findings[0].message).toContain('deprecie')
  })

  it('un CALL porteur d\'une url -> GBP_CALL_HAS_URL', () => {
    const findings = validateLocalPost(
      draftOf({ callToAction: ctaOf('CALL', 'https://taxi-troyes.fr/contact') }),
      SITE,
    )

    expect(findings.map(f => f.code)).toEqual(['GBP_CALL_HAS_URL'])
    // Le defaut est la PRESENCE de l'adresse : une adresse par ailleurs correcte
    // ne l'excuse pas, et une adresse fautive ne recolte pas un second constat
    // expliquant comment bien ecrire un champ qui doit disparaitre.
    expect(codesOf(draftOf({ callToAction: ctaOf('CALL', 'http://ailleurs.fr') })))
      .toEqual(['GBP_CALL_HAS_URL'])
  })

  it('un bouton connu sans adresse -> GBP_CTA_URL_MISSING', () => {
    expect(codesOf(draftOf({ callToAction: ctaOf('SHOP') }))).toEqual(['GBP_CTA_URL_MISSING'])
    expect(codesOf(draftOf({ callToAction: ctaOf('SHOP', '   ') }))).toEqual(['GBP_CTA_URL_MISSING'])
  })

  it('une adresse qui n\'est pas en https -> GBP_CTA_NOT_HTTPS', () => {
    expect(codesOf(draftOf({ callToAction: ctaOf('ORDER', 'http://taxi-troyes.fr/commande') })))
      .toEqual(['GBP_CTA_NOT_HTTPS'])
  })

  it('une adresse relative ou illisible -> le meme GBP_CTA_NOT_HTTPS, une seule fois', () => {
    // Un seul constat : le domaine d'une adresse qu'on ne sait pas lire n'est pas
    // une seconde information, c'est la meme correction — donner une URL absolue.
    for (const url of ['/reservation', 'taxi-troyes.fr/reservation', 'mailto:contact@taxi-troyes.fr']) {
      expect(codesOf(draftOf({ callToAction: ctaOf('BOOK', url) }))).toEqual(['GBP_CTA_NOT_HTTPS'])
    }
  })

  it('une adresse sur un domaine tiers -> GBP_CTA_FOREIGN_DOMAIN', () => {
    const findings = validateLocalPost(
      draftOf({ callToAction: ctaOf('BOOK', 'https://reservation-taxi.example/troyes') }),
      SITE,
    )

    expect(findings.map(f => f.code)).toEqual(['GBP_CTA_FOREIGN_DOMAIN'])
    expect(findings[0].message).toContain('reservation-taxi.example')
  })

  it('ne conclut rien sur le domaine quand le site n\'a pas d\'adresse lisible', () => {
    // Un site mal configure n'est pas un motif de refus du post : la question
    // « ce lien sort-il du site ? » n'a alors pas de reponse, et refuser sur une
    // question sans reponse arreterait la production pour un defaut voisin.
    for (const url of ['', 'taxi-troyes.fr', 'https://localhost']) {
      expect(codesOf(draftOf({ callToAction: ctaOf('BOOK', 'https://ailleurs.fr/x') }), siteAt(url)))
        .toEqual([])
    }
  })

  it('sur un type inconnu, ne reclame pas une adresse qu\'il ne sait pas exiger', () => {
    // Un seul constat, le vrai. Ajouter GBP_CTA_URL_MISSING supposerait connaitre
    // les champs obligatoires d'un type d'action que nous venons de declarer
    // inconnu.
    expect(codesOf(draftOf({ callToAction: ctaOf('SEND_SMS') }))).toEqual(['GBP_ACTION_UNKNOWN'])
    // En revanche la forme d'une adresse PRESENTE se juge toujours : elle doit
    // etre en https et rester chez le client, quel que soit le bouton.
    expect(codesOf(draftOf({ callToAction: ctaOf('SEND_SMS', 'https://ailleurs.fr/x') })))
      .toEqual(['GBP_ACTION_UNKNOWN', 'GBP_CTA_FOREIGN_DOMAIN'])
  })
})

// ─── Ce que la liste de constats doit garantir dans son ensemble ────────────

describe('le vocabulaire des constats', () => {
  const CASES: Array<{ label: string; draft: LocalPostDraft }> = [
    { label: 'resume vide', draft: draftOf({ summary: '' }) },
    { label: 'resume trop long', draft: draftOf({ summary: summaryOf(GBP_SUMMARY_MAX_CHARS + 1) }) },
    { label: 'resume hors fourchette', draft: draftOf({ summary: summaryOf(60) }) },
    { label: 'telephone dans le resume', draft: draftOf({ summary: `${summaryOf(250)} Au 03 25 12 34 56.` }) },
    { label: 'action inconnue', draft: draftOf({ callToAction: ctaOf('GET_OFFER') }) },
    { label: 'CALL avec url', draft: draftOf({ callToAction: ctaOf('CALL', 'https://taxi-troyes.fr/x') }) },
    { label: 'url absente', draft: draftOf({ callToAction: ctaOf('SIGN_UP') }) },
    { label: 'url non https', draft: draftOf({ callToAction: ctaOf('SIGN_UP', 'http://taxi-troyes.fr/x') }) },
    { label: 'domaine tiers', draft: draftOf({ callToAction: ctaOf('SIGN_UP', 'https://ailleurs.fr/x') }) },
  ]

  it('rend un code DISTINCT par defaut : aucun operateur ne lit deux fois la meme phrase', () => {
    const codes = CASES.map(scenario => {
      const findings = validateLocalPost(scenario.draft, SITE)
      expect(findings, scenario.label).toHaveLength(1)
      return findings[0].code
    })

    expect(new Set(codes).size).toBe(CASES.length)
  })

  it('classe chaque constat sous la source « gbp » du vocabulaire partage', () => {
    // `source` est un membre du `FindingSource` de lib/pipeline/gate.ts, reutilise
    // et non redefini : un defaut de fiche depose sous 'seo' rendrait illisibles
    // les deux familles dans un meme journal.
    for (const scenario of CASES) {
      for (const finding of validateLocalPost(scenario.draft, SITE)) {
        expect(finding.source, scenario.label).toBe('gbp')
        expect(finding.message.length, scenario.label).toBeGreaterThan(0)
      }
    }
  })

  it('nomme le defaut plusieurs fois quand il y en a plusieurs', () => {
    // Le resume et le bouton sont deux axes independants : corriger l'un ne
    // revele pas l'autre a la tentative suivante.
    expect(codesOf(draftOf({
      summary: summaryOf(40),
      callToAction: ctaOf('LEARN_MORE', 'http://ailleurs.fr/x'),
    }))).toEqual(['GBP_SUMMARY_OFF_TARGET', 'GBP_CTA_NOT_HTTPS'])
  })
})
