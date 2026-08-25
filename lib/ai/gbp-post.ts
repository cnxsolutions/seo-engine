// ─────────────────────────────────────────────────────────────────────────────
// La redaction d'un post de fiche Google Business Profile
// SEO Engine - IA
// ─────────────────────────────────────────────────────────────────────────────
//
// LE MODELE REDIGE, IL NE PLANIFIE PAS. C'est la seule idee de ce fichier, et
// elle a deux consequences qui expliquent toutes les autres.
//
//  · L'ANGLE est une ENTREE. Il est arrete par `nextAngle`
//    (src/core/domain/gbp/rotation.ts) contre l'historique reel de la fiche,
//    AVANT le premier jeton. Laisser le modele le choisir rendrait la rotation
//    invérifiable : deux appels sur le meme historique pourraient rendre deux
//    angles differents, et aucun cooldown ne serait opposable.
//
//  · LA PAGE A LIER est une ENTREE, et son adresse aussi. `ctaUrl` n'est JAMAIS
//    demandee au modele : elle est recopiee depuis `linkedGeneration.published_url`.
//    Une URL redigee par un modele est une URL devinee — ce que
//    FACTUAL_INTEGRITY_RULES interdit explicitement — et elle serait de toute
//    facon refusee en aval par GBP_CTA_NOT_HTTPS ou GBP_CTA_FOREIGN_DOMAIN,
//    apres avoir ete payee.
//
// UNE SEULE PORTE VERS LES MODELES : `generateJson` (lib/ai/provider.ts). Elle
// tient le choix entre OpenAI et Anthropic, les parametres que chaque famille
// refuse, et la traduction d'une reponse tronquee en erreur nommee. Un client SDK
// appele directement ici serait un second endroit ou corriger tout cela.
//
// LES GARDE-FOUS EDITORIAUX SONT REUTILISES, PAS REECRITS. `FACTUAL_INTEGRITY_RULES`
// est le bloc que toutes les generations du produit portent deja ; les bornes de
// longueur et la liste des boutons viennent de `lib/publishing/gbp/format.ts`,
// seul endroit ou elles soient inscrites. Le prompt les INJECTE : les recopier
// ferait diverger la consigne donnee au modele de la regle qui juge sa sortie —
// c'est-a-dire produirait des posts refuses pour avoir obei.
//
// CE PROMPT N'EST PAS UN GATE. Tout ce qu'il demande est reverifie par
// `runGbpPostGate` sur le texte reellement produit : un modele a qui l'on
// interdit d'inventer une note en invente quand meme, et c'est precisement pour
// cela que le controle d'integrite factuelle existe en aval.

import { FACTUAL_INTEGRITY_RULES, parseAiJsonObject } from './openai'
import { DEFAULT_GENERATION_MODEL, generateJson } from './provider'
import type { GoogleContext } from '@/lib/google/context'
import {
  GBP_ALLOWED_ACTION_TYPES,
  GBP_SUMMARY_TARGET,
  type GbpActionType,
} from '@/lib/publishing/gbp/format'
import type { Campaign, Site } from '@/lib/types'
import type { GbpPostAngle } from '@/src/core/domain/gbp/rotation'

// ─── Contrat ────────────────────────────────────────────────────────────────

/**
 * La page que ce post annonce.
 *
 * `published_url` est OBLIGATOIRE et non nullable : un post qui n'envoie nulle
 * part ne fait venir personne, et `gbp_posts_engine_needs_link` refuse la ligne
 * des le statut 'generated'. L'appelant a donc deja choisi une generation
 * publiee — il n'y a rien a redecider ici.
 */
export interface GbpPostLinkTarget {
  id: string
  title: string
  published_url: string
}

export interface GenerateGbpPostInput {
  site: Site
  campaign: Campaign
  /**
   * Les faits de la fiche, tels que `getGoogleContext` les lit
   * (lib/google/context.ts).
   *
   * C'est le SEUL reservoir de chiffres autorise. Le prompt n'y ajoute rien :
   * ce que ce contexte ne porte pas n'existe pas pour le modele.
   */
  gbpContext: GoogleContext
  /** Arrete par la rotation, jamais par le modele. */
  angle: GbpPostAngle
  linkedGeneration: GbpPostLinkTarget
  /**
   * Les resumes des posts recents, toutes origines confondues.
   *
   * CONTRAINTE DE VARIETE EN AMONT, pas un filtre : elle evite de payer une
   * generation dont on sait deja qu'elle redira quelque chose.
   * `judgePostOriginality` reste le filet EN AVAL, sur le texte reellement
   * produit.
   */
  recentSummaries: readonly string[]
}

export interface GeneratedGbpPost {
  summary: string
  ctaActionType: GbpActionType
  /** Recopiee de `linkedGeneration.published_url`. Jamais redigee par le modele. */
  ctaUrl: string
  /** Le modele reellement employe, pour `gbp_posts.ai_model`. */
  model: string
}

// ─── Reglages ───────────────────────────────────────────────────────────────

/**
 * Budget de sortie.
 *
 * Un resume tient dans la fourchette editoriale (200-700 caracteres), soit
 * quelques centaines de jetons au plus. Le millier restant couvre l'enveloppe
 * JSON et une reponse un peu bavarde : sous cette valeur, une phrase de trop
 * ferait echouer la generation entiere sur une troncature, pour economiser une
 * fraction de centime.
 */
const MAX_OUTPUT_TOKENS = 1200

/**
 * Les boutons qu'un post du moteur peut porter.
 *
 * CALL est retire de la liste PROPOSEE, et c'est une consequence mecanique de
 * l'architecture : Google impose que `url` reste VIDE sur un CALL, or ce post
 * porte TOUJOURS l'adresse de la page qu'il annonce. Un CALL choisi ici
 * produirait `GBP_CALL_HAS_URL` a coup sur.
 *
 * Derive de `GBP_ALLOWED_ACTION_TYPES` par filtrage, jamais recopie : le jour ou
 * la liste autorisee change dans format.ts, celle-ci suit sans qu'on y pense.
 */
const OFFERED_ACTION_TYPES: readonly GbpActionType[] =
  GBP_ALLOWED_ACTION_TYPES.filter(type => type !== 'CALL')

/**
 * Le bouton retenu quand le modele n'en propose pas un que nous reconnaissions.
 *
 * LEARN_MORE, parce que c'est litteralement ce que fait ce post : il renvoie
 * vers une page a lire. Ce repli n'est PAS une complaisance envers le modele —
 * un libelle de bouton n'est pas un fait, il n'engage ni le client ni la verite
 * de la fiche, et il n'existe aucun libelle « je ne sais pas » a afficher. La
 * seule alternative serait de refuser un post par ailleurs correct pour un
 * champ que nous savons remplir nous-memes.
 */
const FALLBACK_ACTION_TYPE: GbpActionType = 'LEARN_MORE'

/**
 * Ce que chaque angle demande d'ecrire.
 *
 * ICI ET PAS DANS LE DOMAINE : `src/core/domain/gbp/rotation.ts` decide QUEL
 * angle servir, ce qui est une politique rejouable et testable sans modele.
 * Comment le rediger est une consigne d'ecriture, elle n'a rien a faire dans une
 * fonction pure — et elle changera bien plus souvent que la rotation.
 */
const ANGLE_BRIEFS: Record<GbpPostAngle, string> = {
  service: "Presente UNE prestation precise de l'entreprise : en quoi elle consiste, "
    + 'dans quelles situations on y fait appel, comment elle se deroule. Pas de catalogue, un seul service.',
  zone: "Parle du secteur d'intervention : les communes desservies, ce que la proximite change "
    + "concretement pour un client (delai d'arrivee, connaissance du terrain).",
  horaires: "Parle de la disponibilite : quand l'entreprise est joignable, ce qui se passe en dehors "
    + 'de ces creneaux. N\'ecris AUCUN horaire qui ne figure pas dans les faits fournis.',
  avis: "Parle de ce que les clients retiennent, en t'appuyant EXCLUSIVEMENT sur les avis fournis. "
    + "Sans avis fourni, tu ne peux pas traiter cet angle : ecris un texte qui n'affirme rien de chiffre.",
  faq: 'Reponds a UNE question que les clients posent reellement dans ce metier. La question, puis la '
    + 'reponse, en langage direct.',
  saison: 'Relie le service a la periode de l\'annee : ce qui change en ce moment pour les clients de ce '
    + 'metier. Aucune date precise, aucun evenement invente.',
  'nouvelle-page': "Annonce le nouveau contenu publie sur le site : de quoi il parle, a qui il sert, "
    + 'ce qu\'on y trouve. C\'est une annonce, pas un resume exhaustif.',
}

// ─── Generation ─────────────────────────────────────────────────────────────

/**
 * Redige un post de fiche pour un angle et une page imposes.
 *
 * JETTE, contrairement aux couches de publication : ici rien n'a encore ete
 * ecrit nulle part, et une reponse de modele inexploitable est exactement le cas
 * que `AiOutputError` nomme depuis lib/ai/openai.ts. L'appelant
 * (lib/gbp/posts/run.ts) la traduit en creneau reporte — le seul endroit qui
 * sache ce qu'un echec de generation coute.
 */
export async function generateGbpPost(input: GenerateGbpPostInput): Promise<GeneratedGbpPost> {
  const model = input.campaign.ai_model || DEFAULT_GENERATION_MODEL

  const raw = await generateJson({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(input),
    model,
    maxTokens: MAX_OUTPUT_TOKENS,
  })

  const parsed = parseAiJsonObject<{ summary?: unknown; ctaActionType?: unknown }>(
    raw,
    'post de fiche Google Business Profile',
  )

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''

  return {
    summary,
    ctaActionType: readActionType(parsed.ctaActionType),
    // L'adresse vient de l'entree, jamais de la sortie. Voir l'en-tete.
    ctaUrl: input.linkedGeneration.published_url,
    model,
  }
}

/**
 * Le type d'action, lu sans rien supposer de la reponse du modele.
 *
 * Le parametre est `unknown` parce que c'est ce qu'il est : du JSON produit par
 * un modele, qui peut rendre un nombre, un tableau, ou 'get_offer' en minuscules.
 * La comparaison se fait en majuscules pour ne pas refuser une valeur juste
 * ecrite autrement.
 */
function readActionType(raw: unknown): GbpActionType {
  if (typeof raw !== 'string') return FALLBACK_ACTION_TYPE

  const candidate = raw.trim().toUpperCase()
  const known = OFFERED_ACTION_TYPES.find(type => type === candidate)
  return known ?? FALLBACK_ACTION_TYPE
}

// ─── Les prompts ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    "Tu rediges un post pour la fiche d'etablissement Google d'une entreprise francaise, "
      + 'et tu reponds en JSON.',
    '',
    'CE QU\'EST UN POST DE FICHE :',
    "- Il s'affiche sur la fiche Google de l'entreprise, sous l'identite du proprietaire, "
      + 'a cote de ses vrais avis et de ses vraies coordonnees.',
    '- Il ne se corrige pas une fois publie.',
    '- Il est lu par un habitant qui cherche ce service maintenant, pas par un lecteur d\'article.',
    '',
    FACTUAL_INTEGRITY_RULES,
    '',
    'CONSIGNES DE FORME (elles s\'ajoutent aux regles ci-dessus, elles ne les remplacent pas) :',
    `- Longueur du resume : entre ${GBP_SUMMARY_TARGET.min} et ${GBP_SUMMARY_TARGET.max} caracteres. `
      + 'Compte-les avant de repondre.',
    '- TEXTE BRUT uniquement : aucune balise HTML, aucun markdown, aucun titre, aucune liste a puces, '
      + 'aucun mot-diese.',
    '- AUCUN NUMERO DE TELEPHONE dans le texte : la fiche porte deja le sien, maintenu a jour, '
      + 'et un post publie ne se corrige pas quand ce numero change.',
    '- AUCUN MONTANT, aucun tarif, aucun prix, meme approximatif : la fiche ne porte aucune donnee '
      + 'de prix, donc tout montant serait invente.',
    '- AUCUNE NOTE ni nombre d\'avis autre que ceux figurant dans les faits fournis.',
    '- Aucun passage entre guillemets qui ne soit pas un extrait litteral d\'un avis fourni.',
    '- Pas de lien ni d\'URL dans le texte : le bouton porte l\'adresse, et lui seul.',
    '- Francais courant, phrases courtes, vouvoiement, aucune formule de vente creuse.',
  ].join('\n')
}

function buildUserPrompt(input: GenerateGbpPostInput): string {
  const { site, campaign, angle, linkedGeneration, recentSummaries } = input

  const sections: string[] = [
    `ENTREPRISE : ${campaign.business_name} — ${campaign.business_type}`,
    `SITE : ${site.url}`,
    '',
    'FAITS DISPONIBLES (la SEULE source de chiffres, de notes et de citations autorisee ;',
    'tout ce qui n\'y figure pas n\'existe pas pour ce post) :',
    describeFacts(input.gbpContext, campaign),
    '',
    `ANGLE IMPOSE : ${angle}`,
    ANGLE_BRIEFS[angle],
    '',
    'PAGE A ANNONCER (le bouton y renvoie ; son adresse est deja fixee, ne la rediges pas) :',
    `- Titre : ${linkedGeneration.title}`,
    `- Adresse : ${linkedGeneration.published_url}`,
  ]

  if (recentSummaries.length > 0) {
    sections.push(
      '',
      'DEJA PUBLIE SUR CETTE FICHE — n\'en redis AUCUN, ni sur le fond ni dans la formulation :',
      ...recentSummaries.map((summary, index) => `${index + 1}. ${flatten(summary)}`),
    )
  }

  sections.push(
    '',
    'REPONDS PAR CET OBJET JSON, ET RIEN D\'AUTRE :',
    '{',
    `  "summary": "le texte du post, ${GBP_SUMMARY_TARGET.min} a ${GBP_SUMMARY_TARGET.max} caracteres",`,
    `  "ctaActionType": "l'un de : ${OFFERED_ACTION_TYPES.join(', ')}"`,
    '}',
  )

  return sections.join('\n')
}

/**
 * Les faits de la fiche, ecrits ligne par ligne — et rien d'autre.
 *
 * DEUX REGLES, ET ELLES SE TIENNENT.
 *
 *  1. UN CHAMP VIDE N'EST PAS LISTE. Ecrire « Note moyenne : 0 » ou
 *     « Horaires : » offre au modele un chiffre a reprendre et une rubrique a
 *     remplir. `getGoogleContext` remplit ces champs de zeros et de chaines
 *     vides quand la fiche n'a rien (lib/google/context.ts:48-57) : c'est ici
 *     qu'un defaut technique cesse de ressembler a une donnee.
 *
 *  2. AUCUN CHAMP N'EST INVENTE. Le contexte ne porte ni categories
 *     structurees, ni themes d'avis, ni Q&A, ni posts : `GoogleContext.gbp` a
 *     exactement huit champs et ce bloc n'en connait pas un de plus.
 *     `GoogleContextBuilder` (src/adapters/rag/context) en promet davantage et
 *     les code a vide — le lire ici ferait passer des tableaux vides pour un
 *     silence de la fiche.
 *
 * `communes` et `department` viennent de la CAMPAGNE, pas de la fiche : ce sont
 * des faits declares par le proprietaire au moment ou il a cree sa campagne, et
 * ils sont la seule source de zone d'intervention du produit — sans eux l'angle
 * 'zone' n'aurait rien a dire de vrai.
 *
 * `gsc` n'est PAS repris : les requetes Search Console decrivent ce que des
 * internautes ont tape, pas ce que l'entreprise fait. Les donner comme « faits »
 * inviterait a ecrire un post sur un service que l'entreprise ne rend pas.
 */
function describeFacts(context: GoogleContext, campaign: Campaign): string {
  const lines: string[] = []
  const gbp = context.gbp

  if (gbp?.businessName) lines.push(`- Nom sur la fiche : ${gbp.businessName}`)
  if (gbp?.address) lines.push(`- Adresse : ${gbp.address}`)
  if (gbp?.hours) lines.push(`- Horaires declares : ${gbp.hours}`)
  if (gbp?.services.length) lines.push(`- Services declares : ${gbp.services.join(', ')}`)

  // La note n'est citee que si elle repose sur au moins un avis. Les deux
  // conditions ensemble, parce que `getGoogleContext` rend 0/0 sur une fiche
  // jamais synchronisee comme sur une fiche sans avis, et qu'une note de 0
  // recopiee dans un post serait pire qu'une note absente.
  if (gbp && gbp.reviewCount > 0 && gbp.averageRating > 0) {
    lines.push(`- Note de la fiche : ${gbp.averageRating} sur ${gbp.reviewCount} avis`)
  }

  if (gbp?.topReviews.length) {
    lines.push('- Avis reels (seuls extraits citables, entre guillemets, mot pour mot) :')
    lines.push(...gbp.topReviews.map(review => `  · ${flatten(review)}`))
  }

  if (campaign.communes.length) lines.push(`- Communes desservies : ${campaign.communes.join(', ')}`)
  if (campaign.department) lines.push(`- Departement : ${campaign.department}`)

  // Le dire franchement plutot que rendre un bloc vide : « aucun fait » est une
  // consigne, un bloc vide est une invitation a combler.
  return lines.length > 0
    ? lines.join('\n')
    : "- Aucun fait verifiable n'est disponible pour cette fiche. N'ecris donc AUCUN chiffre, "
      + 'AUCUNE note, AUCUNE citation et AUCUN horaire.'
}

/** Un resume recent, ramene a une ligne : sa mise en page n'apprend rien au modele. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
