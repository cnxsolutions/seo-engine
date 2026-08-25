// ─────────────────────────────────────────────────────────────────────────────
// Les contraintes de format d'un post de fiche Google Business Profile
// SEO Engine - Publication GBP
// ─────────────────────────────────────────────────────────────────────────────
//
// LE SEUL ENDROIT OU VIVENT CES CONTRAINTES. Une longueur, une liste de types
// d'action, une regle sur l'adresse d'un bouton : si la valeur est ecrite
// ailleurs dans le depot, elle derivera de celle-ci au premier 400 qui nous
// apprend la vraie borne.
//
// CE QUE CE FICHIER NE PEUT PAS PROUVER, ET LE DIT.
//
// L'acces en ECRITURE a l'API GBP n'a pas ete accorde : tant que
// l'« Application For Basic API Access » n'est pas approuvee, le quota par
// defaut est de zero requete par minute (docs/gbp-acces-api.md). Aucun
// `POST localPosts` n'a donc jamais ete emis depuis ce depot, et il n'existe
// aucune dependance `googleapis` pour fournir les types a notre place.
//
// Chaque constante porte donc DEUX choses : sa source, et la mention
// « a confirmer contre l'API reelle » quand cette source ne suffit pas a la
// garantir. Le corps de tout 400 est persiste VERBATIM dans
// `gbp_posts.error_message` (migration 019) : c'est ainsi, et pas autrement,
// qu'une de ces mentions disparaitra un jour.
//
// Ce module est PUR. Son unique import de valeur n'existe pas : `GateFinding` et
// `Site` arrivent en `import type`, effaces a la compilation. Il se teste sans
// reseau, sans base, et sans monter le pipeline de validation des pages.

import type { GateFinding } from '@/lib/pipeline/gate'
import type { Site } from '@/lib/types'

// ─── Ce que Google documente ────────────────────────────────────────────────

/**
 * Plafond du resume d'un post.
 *
 * LIMITE PRODUIT, PAS LIMITE D'API — la distinction est le fond du sujet. Les
 * 1500 caracteres sont ce que l'interface Google Business Profile applique a la
 * saisie manuelle et ce que reprend l'aide destinee aux proprietaires de fiche.
 * La reference REST de `accounts.locations.localPosts` ne declare AUCUNE
 * longueur maximale pour `summary`. Ecrire ici que « Google garantit 1500 »
 * serait une invention, et cette invention deviendrait une regle bloquante.
 *
 * A CONFIRMER CONTRE L'API REELLE : la vraie borne — plus haute, plus basse, ou
 * inexistante — se lira dans le premier 400 recu sur une fiche de test.
 */
export const GBP_SUMMARY_MAX_CHARS = 1500

/**
 * La fourchette utile d'un resume, en caracteres.
 *
 * FOURCHETTE EDITORIALE, LA NOTRE, et rien d'autre : elle ne vient d'aucune
 * documentation Google et n'a pas a en venir. En dessous du plancher le post ne
 * dit rien qu'un titre ne dirait ; au-dessus du plafond il depasse ce qu'un
 * lecteur de fiche lit avant de passer au suivant.
 *
 * Elle n'engage donc que nous, et c'est pourquoi la sortir de cette fourchette
 * produit `GBP_SUMMARY_OFF_TARGET`, un AVERTISSEMENT — le post part quand meme.
 * `GBP_SUMMARY_MAX_CHARS`, lui, est une borne que l'API peut refuser.
 *
 * Injectee, jamais recopiee : le prompt de generation et l'apercu de l'interface
 * la recoivent depuis ici.
 */
export const GBP_SUMMARY_TARGET = { min: 200, max: 700 } as const

/**
 * Les types d'action qu'un bouton de post peut porter.
 *
 * DOCUMENTE par Google pour `callToAction.actionType` : BOOK, ORDER, SHOP,
 * LEARN_MORE, SIGN_UP, CALL.
 *
 * GET_OFFER est ABSENT DELIBEREMENT : il est deprecie. Le laisser dans la liste
 * reviendrait a autoriser le generateur a produire des posts dont la seule
 * incertitude est la date a laquelle ils cesseront de fonctionner.
 *
 * A CONFIRMER CONTRE L'API REELLE : que cette liste soit encore EXHAUSTIVE au
 * moment de la premiere ecriture. Une valeur retiree se verra a la premiere
 * requete refusee ; une valeur ajoutee par Google ne se verra jamais, puisque
 * nous ne l'emettrons pas.
 */
export const GBP_ALLOWED_ACTION_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'] as const

export type GbpActionType = typeof GBP_ALLOWED_ACTION_TYPES[number]

/**
 * Le seul `topicType` que le moteur emet.
 *
 * DOCUMENTE : `topicType` est REQUIS, et vaut STANDARD (resume + media), EVENT
 * (+ `event{title,schedule}` + CTA), OFFER (+ `event` + `offer` + CTA) ou ALERT.
 * Les trois autres exigent des champs que le moteur n'a pas — une date d'evenement,
 * les termes d'une offre — et qu'il ne peut pas inventer sur la fiche d'un client.
 *
 * CONSTANTE, ET PAS UNE COLONNE : `gbp_posts` n'en porte deliberement aucune
 * (migration 019). Un CHECK qui n'autorise qu'une valeur ne transporte aucune
 * information ; le jour ou un second topicType est emis, c'est ici que la
 * decision se prend, avec les champs obligatoires qui vont avec.
 */
export const GBP_TOPIC_TYPE = 'STANDARD' as const

/**
 * Le corps d'un post, tel qu'il partira.
 *
 * Pas de `media[]` en v1 : le champ n'accepte que `sourceUrl`, une adresse
 * publiquement joignable, et le moteur n'heberge aucune image dont il puisse
 * garantir qu'elle le restera.
 *
 * Pas de `scheduledTime` non plus, bien que la planification distante existe :
 * un seul calendrier est la these du chantier, et il vit dans
 * `editorial_calendar`. Deux plannings, c'est deux verites sur la meme date.
 */
export interface LocalPostDraft {
  languageCode: 'fr'
  summary: string
  topicType: typeof GBP_TOPIC_TYPE
  /** CALL est le seul type pour lequel Google impose que `url` reste VIDE. */
  callToAction?: { actionType: GbpActionType; url?: string }
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Ce qui, dans ce brouillon, empeche ou desservirait sa publication.
 *
 * UN CODE DISTINCT PAR DEFAUT, et ce n'est pas de la cosmetique : l'operateur
 * qui lit le constat doit savoir QUOI corriger. « Format invalide » ne lui dit ni
 * de changer le bouton, ni de raccourcir le texte, ni de retirer une adresse que
 * Google refuse sur un CALL.
 *
 * La liste est RENDUE A PLAT, sans classement bloquant/avertissement : trier les
 * codes est le travail de `lib/publishing/gbp/gate.ts`, qui agrege ces constats
 * avec ceux de l'originalite et de l'integrite factuelle. Deux classements pour
 * un meme code, c'est un code qui bloque d'un cote et passe de l'autre.
 *
 * `GateFinding` vient de `lib/pipeline/gate.ts`, REUTILISE et non redefini — un
 * second vocabulaire de constat obligerait chaque lecteur (interface, journal,
 * `formatBlockingReasons`) a connaitre les deux. `source: 'gbp'` existe dans
 * `FindingSource` pour cette raison exacte : classer un defaut de fiche sous
 * 'seo' rendrait les deux illisibles dans un journal.
 *
 * Ne jette jamais : une adresse illisible est un constat, pas une exception.
 */
export function validateLocalPost(draft: LocalPostDraft, site: Site): GateFinding[] {
  return [...checkSummary(draft.summary), ...checkCallToAction(draft.callToAction, site)]
}

// ─── Le resume ──────────────────────────────────────────────────────────────

/**
 * Un numero de telephone redige dans le corps du resume.
 *
 * Format francais : `+33` ou un `0` initial, puis quatre paires de chiffres,
 * separateurs libres. La classe de tete `(?:^|[^\d])` evite qu'une suite de
 * chiffres plus longue ne soit lue comme un numero a partir de son milieu, et
 * `(?!\d)` fait le meme travail par la fin.
 *
 * Un prix (`0,50 €`) n'est pas capte : la virgule n'appartient pas aux
 * separateurs admis.
 */
const PHONE_IN_TEXT = /(?:^|[^\d])((?:\+33|0)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4})(?!\d)/

function checkSummary(summary: string): GateFinding[] {
  const trimmed = summary.trim()

  // Un resume vide n'a rien d'autre a dire sur lui-meme : mesurer sa longueur
  // ou y chercher un numero produirait deux constats de plus pour un seul defaut.
  if (trimmed.length === 0) {
    return [{
      code: 'GBP_SUMMARY_EMPTY',
      source: 'gbp',
      message: 'Le resume du post est vide : il n\'y a rien a publier sur la fiche',
    }]
  }

  const findings: GateFinding[] = []

  // Mesure sur la chaine BRUTE, pas sur sa version ebarbee : c'est elle qui part
  // dans le corps de la requete, espaces de tete compris.
  if (summary.length > GBP_SUMMARY_MAX_CHARS) {
    findings.push({
      code: 'GBP_SUMMARY_TOO_LONG',
      source: 'gbp',
      message: `${summary.length} caracteres pour un plafond de ${GBP_SUMMARY_MAX_CHARS} `
        + `(limite PRODUIT largement rapportee, non garantie par l'API — a confirmer contre l'API reelle)`,
    })
  } else if (trimmed.length < GBP_SUMMARY_TARGET.min || trimmed.length > GBP_SUMMARY_TARGET.max) {
    // `else` et non un second `if` : au-dela du plafond, la fourchette editoriale
    // est evidemment depassee elle aussi, et le redire n'apprend rien.
    findings.push({
      code: 'GBP_SUMMARY_OFF_TARGET',
      source: 'gbp',
      message: `${trimmed.length} caracteres, hors de la fourchette utile `
        + `${GBP_SUMMARY_TARGET.min}-${GBP_SUMMARY_TARGET.max} (reperage editorial, pas une regle de Google)`,
    })
  }

  // Le numero de la fiche est deja affiche a cote du post, et il est maintenu la.
  // Recopie dans le resume, il devient une donnee que personne ne met a jour — un
  // post publie ne se corrige pas — et surtout une donnee que le modele a pu
  // fabriquer, exactement comme un NAP invente sur une page.
  const phone = PHONE_IN_TEXT.exec(summary)
  if (phone) {
    findings.push({
      code: 'GBP_PHONE_IN_SUMMARY',
      source: 'gbp',
      message: `Numero de telephone dans le resume (${phone[1]}) : la fiche porte deja le sien, `
        + `et un post publie ne se corrige pas quand ce numero change`,
    })
  }

  return findings
}

// ─── Le bouton ──────────────────────────────────────────────────────────────

function checkCallToAction(cta: LocalPostDraft['callToAction'], site: Site): GateFinding[] {
  // Un post STANDARD sans bouton est valide : le CTA n'est obligatoire que pour
  // EVENT et OFFER, que le moteur n'emet pas.
  if (!cta) return []

  const findings: GateFinding[] = []

  // Lu comme une CHAINE, deliberement, alors que le type declare une union.
  //
  // Cette valeur traverse deux frontieres que TypeScript ne surveille pas : le
  // JSON rendu par le modele, et la colonne `gbp_posts.cta_action_type`, un
  // `text` NU — la migration 019 n'y pose aucun CHECK, precisement pour ne pas
  // figer en base une liste que l'API peut faire evoluer. Une union a la
  // compilation est une promesse sur NOTRE code, pas une preuve sur les valeurs
  // qui lui arrivent.
  const actionType: string = cta.actionType
  const url = cta.url?.trim() ?? ''
  const known = (GBP_ALLOWED_ACTION_TYPES as readonly string[]).includes(actionType)

  if (!known) {
    findings.push({
      code: 'GBP_ACTION_UNKNOWN',
      source: 'gbp',
      message: `Type d'action « ${actionType} » hors de la liste autorisee `
        + `(${GBP_ALLOWED_ACTION_TYPES.join(', ')})`
        + (actionType === 'GET_OFFER' ? ' — GET_OFFER est deprecie par Google' : ''),
    })
  }

  if (actionType === 'CALL') {
    // Google impose que `url` reste VIDE sur un CALL. Le defaut est la presence
    // de l'adresse, pas sa forme : la controler ensuite reviendrait a expliquer
    // comment bien ecrire un champ qui doit disparaitre.
    if (url.length > 0) {
      findings.push({
        code: 'GBP_CALL_HAS_URL',
        source: 'gbp',
        message: `Un bouton CALL ne porte pas d'adresse ; « ${url} » doit etre retiree `
          + `(Google impose que le champ url reste vide)`,
      })
    }
    return findings
  }

  if (url.length === 0) {
    // Sur un type inconnu, nous ne savons PAS si une adresse est requise :
    // reclamer ce que nous ne savons pas exiger ajouterait un faux constat au
    // vrai, deja emis ci-dessus.
    if (known) {
      findings.push({
        code: 'GBP_CTA_URL_MISSING',
        source: 'gbp',
        message: `Le bouton ${actionType} n'a aucune adresse de destination`,
      })
    }
    return findings
  }

  findings.push(...checkCtaUrl(url, site))
  return findings
}

function checkCtaUrl(url: string, site: Site): GateFinding[] {
  const target = parseAbsoluteUrl(url)

  // Une adresse relative, un `mailto:`, une chaine qui n'est pas une adresse du
  // tout : le meme constat, parce que c'est la meme correction — donner une URL
  // absolue en https. Un code de plus ici serait un code que
  // `BLOCKING_GBP_CODES` ne connaitrait pas, donc un defaut qui passerait en
  // avertissement.
  if (!target || target.protocol !== 'https:') {
    return [{
      code: 'GBP_CTA_NOT_HTTPS',
      source: 'gbp',
      message: `L'adresse du bouton doit etre une URL absolue en https : « ${url} »`,
    }]
  }

  const ours = registrableDomain(site.url)

  // Site sans adresse lisible : la question « ce lien sort-il du site ? » n'a pas
  // de reponse, et refuser un post sur une question sans reponse le bloquerait
  // pour un defaut de configuration qui ne le concerne pas.
  if (!ours) return []

  const theirs = registrableDomain(target.href)
  if (theirs === ours) return []

  return [{
    code: 'GBP_CTA_FOREIGN_DOMAIN',
    source: 'gbp',
    message: `Le bouton renvoie vers « ${target.hostname} », hors du domaine du site (${ours}) : `
      + `un post de fiche envoie chez le client, pas ailleurs`,
  }]
}

function parseAbsoluteUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Les deux derniers labels d'un hote, ou `null` quand il n'y en a pas deux.
 *
 * Deux labels, et non l'hote entier : `boutique.exemple.fr` appartient au client
 * autant que `exemple.fr`, et comparer les hotes refuserait ses propres
 * sous-domaines. Le retrait d'un `www.` initial est SUBSUME par cette regle et
 * n'est donc pas ecrit une seconde fois — `www.exemple.fr` et `exemple.fr`
 * rendent tous deux `exemple.fr`.
 *
 * LIMITE ASSUMEE, faute de dependance `psl` — aucune n'est autorisee. Sous un
 * suffixe public a plusieurs labels (`exemple.co.uk`, `exemple.asso.fr`), deux
 * domaines distincts se ressemblent ici. Le defaut penche donc du cote PERMISSIF
 * : un lien sortant peut passer, aucun lien legitime du client n'est refuse. Sur
 * un produit francais en `.fr`, c'est le sens dans lequel une erreur coute le
 * moins cher.
 */
function registrableDomain(rawUrl: string): string | null {
  const parsed = parseAbsoluteUrl(rawUrl)
  if (!parsed) return null

  const labels = parsed.hostname.toLowerCase().split('.').filter(label => label.length > 0)
  if (labels.length < 2) return null

  return labels.slice(-2).join('.')
}
