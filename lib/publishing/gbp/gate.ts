// ─────────────────────────────────────────────────────────────────────────────
// Le gate d'un post de fiche Google Business Profile
// SEO Engine - Publication GBP
// « Ce post part-il sur la fiche d'un client ? »
// ─────────────────────────────────────────────────────────────────────────────
//
// UN SECOND GATE PARCE QUE LES REGLES DIFFERENT, PAS PARCE QUE LE PREMIER GENE.
//
// `runPrePublishGate` / `runValidationGate` (lib/pipeline/gate.ts) mesurent une
// PAGE : une longueur contre la cible du brief, un H1, des H2, du JSON-LD, un
// score d'orchestrateur. Un post de fiche fait deux cents a sept cents
// caracteres, n'a ni titre ni structure et n'emet aucun schema. Le faire passer
// par ce gate-la le ferait refuser pour LENGTH_BELOW_TARGET, MISSING_H1 et
// MISSING_H2 — trois defauts qu'un post ne peut pas ne pas avoir.
//
// Et le contourner serait pire. `gateAlreadyRan: true` ne desactive pas trois
// regles : il supprime TOUS les garde-fous d'un coup, y compris l'anti-
// duplication qui est la raison d'etre de ce chantier. Fabriquer un
// `GeneratedPage` bidon pour satisfaire la signature reviendrait au meme, avec
// en prime un objet menteur dans les journaux.
//
// CE QUI EST PARTAGE, ET CE QUI NE L'EST PAS.
//
// Le VOCABULAIRE du verdict est partage et jamais redefini : `GateFinding`,
// `GateVerdict` et `formatBlockingReasons` viennent de lib/pipeline/gate.ts. Un
// second vocabulaire obligerait chaque lecteur — l'interface, le journal, la
// colonne error_message — a connaitre les deux. `source: 'gbp'` existe dans
// `FindingSource` pour exactement cette raison.
//
// La POLITIQUE, elle, est propre a ce canal : trois familles, listees ci-dessous,
// dont aucune n'a d'equivalent cote page.
//
// CE GATE EST PUR. Aucun reseau, aucune base, aucun modele. Les posts recents et
// le profil de la fiche lui sont APPORTES par lib/gbp/posts/run.ts, exactement
// comme lib/pipeline/gate.ts recoit ses candidats de duplication. Payer une
// lecture Supabase depuis la fonction que toute publication traverse la rendrait
// inutilisable depuis un test, un script ou un handler de route.

import {
  formatBlockingReasons,
  type GateFinding,
  type GateVerdict,
} from '@/lib/pipeline/gate'
import type { Site } from '@/lib/types'
import {
  judgePostOriginality,
  type GbpPostAngle,
  type PostDraftJudgement,
  type RecentPost,
} from '@/src/core/domain/gbp/rotation'
import { normalizeForMatch } from '@/src/core/domain/text/text-utils'
import { validateLocalPost, type LocalPostDraft } from './format'

// ─── Politique de blocage ───────────────────────────────────────────────────

/**
 * Tout ce qui, dans ce gate, retient un post.
 *
 * UNE SEULE LISTE pour les trois familles, la ou lib/pipeline/gate.ts en tient
 * quatre. Ce n'est pas une divergence de style : la-bas, chaque famille arrive
 * d'un validateur different avec sa propre echelle de gravite, et le tri doit se
 * faire source par source. Ici les trois familles sont ecrites dans ce depot,
 * chaque code est emis a un seul endroit, et une seule question se pose de
 * chacun — bloque-t-il ? Deux listes qui se partageraient treize codes, c'est un
 * code qui finit dans les deux ou dans aucune.
 *
 * GBP_SUMMARY_OFF_TARGET est le SEUL code de format volontairement absent :
 * `GBP_SUMMARY_TARGET` est une fourchette editoriale qui n'engage que nous
 * (format.ts), et refuser un post sur un reperage interne reviendrait a lui
 * donner l'autorite d'une regle de Google. Il sort en avertissement, le post
 * part.
 *
 * Les quatre codes d'originalite sont ceux de `PostRefusalCode`
 * (src/core/domain/gbp/rotation.ts), repris VERBATIM. Le domaine les rend deja
 * sous cette forme precisement pour qu'aucune couche n'ait a retrouver par
 * comparaison de chaines lequel des quatre a tire.
 */
export const BLOCKING_GBP_CODES = [
  // Format — ce que l'API refusera, ou ce que le client ne veut pas voir.
  'GBP_SUMMARY_EMPTY',
  'GBP_SUMMARY_TOO_LONG',
  'GBP_PHONE_IN_SUMMARY',
  'GBP_ACTION_UNKNOWN',
  'GBP_CALL_HAS_URL',
  'GBP_CTA_URL_MISSING',
  'GBP_CTA_NOT_HTTPS',
  'GBP_CTA_FOREIGN_DOMAIN',
  // Originalite — PostRefusalCode, mot pour mot.
  'GBP_NO_LINK',
  'GBP_ANGLE_COOLDOWN',
  'GBP_LINK_COOLDOWN',
  'GBP_DUPLICATE_SUMMARY',
  // Integrite factuelle.
  'GBP_UNSUPPORTED_CLAIM',
] as const

// ─── Entree ─────────────────────────────────────────────────────────────────

/**
 * Le profil de la fiche, reduit a ce que ce gate peut interroger.
 *
 * `reviews_summary` est typee `unknown` a dessein : c'est une colonne `jsonb`
 * (db/000_baseline.sql:435) et rien, en base, ne garantit sa forme. Elle est lue
 * par `readReviewsSummary` ci-dessous, qui rend `null` sur tout ce qui ne
 * ressemble pas a la sortie de `summarizeReviews`.
 *
 * `categories` et `hours` figurent au contrat parce que l'appelant transporte la
 * ligne gbp_profiles entiere et qu'un second objet, taille pour ce gate, serait
 * une projection de plus a maintenir. AUCUNE regle de cette version ne les lit,
 * et c'est dit plutot que sous-entendu : il n'existe pas de motif TEXTUEL
 * deterministe qui trahisse une invention d'horaire ou de categorie. « Ouvert le
 * dimanche » est une phrase ordinaire ; « 4,8/5 » est une mesure. Le jour ou une
 * regle d'horaires existera, elle se posera ici — pas dans une expression
 * reguliere devinee aujourd'hui.
 */
export interface GbpProfileFacts {
  reviews_summary?: unknown
  categories?: unknown
  hours?: unknown
}

export interface GbpPostGateInput {
  draft: LocalPostDraft
  angle: GbpPostAngle
  /** Nul est une valeur legitime en entree : c'est GBP_NO_LINK qui la refuse. */
  linkedGenerationId: string | null
  site: Site
  /** Trie du PLUS RECENT au plus ancien — contrat d'ordre de rotation.ts. */
  recentPosts: readonly RecentPost[]
  /**
   * Null quand la fiche n'a jamais ete synchronisee.
   *
   * Ce n'est PAS un motif de refus en soi — un post qui n'affirme aucun fait
   * chiffre passe sans profil. C'est un motif de refus pour les posts qui en
   * affirment un : sans profil, aucune note, aucun prix, aucune citation n'a de
   * source, et publier une affirmation invérifiable sous l'identite du client est
   * exactement ce que ce gate existe pour empecher.
   */
  gbpProfile: GbpProfileFacts | null
}

// ─── Le gate ────────────────────────────────────────────────────────────────

/**
 * Les trois familles, agregees en un verdict.
 *
 * `async` sans `await` a l'interieur, et c'est volontaire : la signature doit
 * rester celle d'un gate (`Promise<GateVerdict>`, comme `runValidationGate`)
 * pour que le jour ou une famille aura besoin d'une lecture, aucun appelant ne
 * change. Le prix est nul, la rupture evitee ne l'est pas.
 *
 * Ne jette jamais. Un profil malforme est un constat, pas une exception.
 */
export async function runGbpPostGate(input: GbpPostGateInput): Promise<GateVerdict> {
  const startedAt = Date.now()
  const findings: GateFinding[] = []

  // ─── 1. FORMAT ────────────────────────────────────────────────────────
  // Delegue entierement. Les contraintes de l'API et la fourchette editoriale
  // vivent dans format.ts, seul endroit ou elles soient inscrites, et les
  // reecrire ici garantirait qu'elles derivent au premier 400 recu.
  findings.push(...validateLocalPost(input.draft, input.site))

  // ─── 2. ORIGINALITE ───────────────────────────────────────────────────
  // Delegue au domaine. Les seuils (POST_SIMILARITY_BLOCK, ANGLE_COOLDOWN,
  // LINK_COOLDOWN, RECENT_POST_WINDOW) ne sont pas recopies : le domaine les
  // applique, ce module ne fait que traduire ses codes en phrases.
  const judgement = judgePostOriginality(
    {
      summary: input.draft.summary,
      angle: input.angle,
      linkedGenerationId: input.linkedGenerationId,
    },
    input.recentPosts,
  )
  findings.push(...originalityFindings(judgement))

  // ─── 3. INTEGRITE FACTUELLE ───────────────────────────────────────────
  findings.push(...checkFactualIntegrity(input.draft.summary, input.gbpProfile))

  const blocking: GateFinding[] = []
  const warnings: GateFinding[] = []
  for (const finding of findings) {
    if ((BLOCKING_GBP_CODES as readonly string[]).includes(finding.code)) blocking.push(finding)
    else warnings.push(finding)
  }

  return {
    publishable: blocking.length === 0,
    blocking,
    warnings,
    // `score` et `grade` restent ABSENTS. Ils valent une note sur cent rendue
    // par ValidationPipelineOrchestrator pour une page, et il n'y a rien a en
    // faire ici : un 100 fabrique afficherait une pastille verte qui ne mesure
    // rien. Un champ vide est honnete, un champ invente ne l'est pas.
    durationMs: Date.now() - startedAt,
  }
}

/**
 * Le refus, redige pour `gbp_posts.error_message`.
 *
 * Une seule mise en forme des motifs dans tout le produit : `formatBlockingReasons`
 * est celle de lib/pipeline/gate.ts, et elle sert ici sans etre reecrite. Un
 * operateur qui lit la liste des publications refusees voit la meme forme
 * `CODE: phrase` qu'il s'agisse d'une page ou d'un post.
 */
export function gbpRefusalMessage(verdict: GateVerdict): string {
  return formatBlockingReasons(verdict.blocking).join(' | ')
}

// ─── Originalite : du code du domaine a la phrase de l'operateur ────────────

/**
 * Ce que chaque code d'originalite veut dire, une fois.
 *
 * La mesure (`worstSimilarity`) et le texte compare (`againstSummary`) ne sont
 * ajoutes qu'au constat de duplication : les coller sous « aucune page a
 * annoncer » melerait deux faits sans rapport.
 */
function originalityFindings(judgement: PostDraftJudgement): GateFinding[] {
  return judgement.reasons.map((code): GateFinding => {
    switch (code) {
      case 'GBP_NO_LINK':
        return {
          code,
          source: 'gbp',
          message:
            'Ce post n\'annonce aucune page du site : un post de fiche qui ne renvoie nulle part '
            + 'ne fait pas venir un visiteur, et la base l\'interdit des le statut generated',
        }
      case 'GBP_ANGLE_COOLDOWN':
        return {
          code,
          source: 'gbp',
          message:
            'L\'angle de ce post a deja ete servi dans les derniers posts de la fiche : '
            + 'le publier redirait ce qui vient d\'etre dit',
        }
      case 'GBP_LINK_COOLDOWN':
        return {
          code,
          source: 'gbp',
          message:
            'La page annoncee vient de l\'etre par un post recent : deux annonces de la meme '
            + 'page sous deux angles restent, pour le lecteur de la fiche, deux fois la meme annonce',
        }
      case 'GBP_DUPLICATE_SUMMARY':
        return {
          code,
          source: 'gbp',
          message:
            `Resume trop proche d'un post recent (${judgement.worstSimilarity.toFixed(2)})`
            + (judgement.againstSummary ? ` : « ${excerpt(judgement.againstSummary)} »` : ''),
        }
    }
  })
}

// ─── Integrite factuelle ────────────────────────────────────────────────────
//
// LE CONTROLE QUI EMPECHE LE MODELE D'INVENTER « note 4,8/5 » SUR UNE FICHE QUI
// N'A PAS D'AVIS.
//
// L'interdiction d'inventer un avis vaut au moins autant sur une fiche que sur
// une page : `BLOCKING_JSON_LD_CODES` refuse deja un `aggregateRating` sans
// `Review` et un avis auto-decerne, parce que c'est une violation des regles de
// Google. Un post de fiche va plus loin — il s'affiche sous l'identite du client,
// a cote de ses vrais avis, et il ne se corrige pas une fois publie.
//
// TROIS MOTIFS DETERMINISTES, ET SEULEMENT TROIS. Pas d'appel a un modele pour
// juger un modele : un chiffre qui ressemble a une note, un montant en euros, un
// passage entre guillemets. Une affirmation vague (« un service reconnu ») n'est
// pas captee, et c'est assume : la capter demanderait de juger le sens, donc un
// second modele, donc une seconde source d'invention.

/**
 * Une note sur cinq : « 4,8/5 », « 5 / 5 ».
 *
 * Elargi au chiffre ENTIER par rapport a la forme initialement proposee, qui
 * exigeait une decimale avant la barre : « 5/5 » est precisement l'invention la
 * plus probable sur une fiche qui n'a aucun avis, et une expression qui reclame
 * un chiffre apres la virgule la laisserait passer sans un mot.
 */
const RATING_CLAIM = /(\d+(?:[.,]\d+)?)\s*\/\s*5/g

/**
 * Un montant en euros : « 25 € », « a partir de 25 euros ».
 *
 * Insensible a la casse pour « Euros ». Le symbole et le mot, rien d'autre :
 * « EUR » appartient au vocabulaire bancaire, pas a celui d'un post de fiche, et
 * l'ajouter ferait capter des references de virement.
 */
const PRICE_CLAIM = /(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/gi

/**
 * Un passage entre guillemets, francais ou droits.
 *
 * QUINZE CARACTERES AU MINIMUM, et ce plancher est ce qui separe une citation
 * d'une mise en relief. « conventionne », « gare », « VSL » sont des mots mis en
 * valeur, pas des avis clients ; les refuser ferait de ce controle une regle de
 * typographie. Un avis reel, lui, fait une phrase.
 */
const QUOTED_CLAIM = /[«"“]\s*([^»"”]{15,})\s*[»"”]/g

/** `reviews_summary` telle que `summarizeReviews` la produit (lib/google/gbp.ts:106-125). */
interface ReviewsSummary {
  averageRating: number
  totalCount: number
  recentPositive: readonly string[]
}

function checkFactualIntegrity(summary: string, profile: GbpProfileFacts | null): GateFinding[] {
  const reviews = readReviewsSummary(profile?.reviews_summary)

  return [
    ...checkRatings(summary, reviews),
    ...checkPrices(summary),
    ...checkQuotations(summary, reviews),
  ]
}

/**
 * Une note citee doit etre CELLE de la fiche.
 *
 * Deux defauts distincts sous un meme code, parce que la correction est la meme
 * — retirer la note ou ecrire la vraie — et parce qu'un code que
 * `BLOCKING_GBP_CODES` ne connaitrait pas serait un defaut degrade en
 * avertissement au moment du tri.
 */
function checkRatings(summary: string, reviews: ReviewsSummary | null): GateFinding[] {
  const findings: GateFinding[] = []

  for (const match of summary.matchAll(RATING_CLAIM)) {
    const claimed = toDecimal(match[1])
    if (claimed === null) continue

    if (!reviews || reviews.totalCount === 0 || reviews.averageRating <= 0) {
      findings.push({
        code: 'GBP_UNSUPPORTED_CLAIM',
        source: 'gbp',
        message:
          `Le resume annonce une note de ${match[0]} alors que la fiche ne porte aucun avis `
          + `connu du moteur : c'est une affirmation fausse publiee sous l'identite du client`,
      })
      continue
    }

    // Arrondi au dixieme des DEUX cotes : `summarizeReviews` stocke deja
    // `Math.round(average * 10) / 10`, et comparer 4.8 a 4.7999 refuserait un
    // post exact pour une difference que personne ne peut ecrire.
    if (round1(claimed) !== round1(reviews.averageRating)) {
      findings.push({
        code: 'GBP_UNSUPPORTED_CLAIM',
        source: 'gbp',
        message:
          `Le resume annonce une note de ${match[0]} alors que la fiche en porte `
          + `${round1(reviews.averageRating)} sur ${reviews.totalCount} avis`,
      })
    }
  }

  return findings
}

/**
 * Un prix n'a AUCUNE source dans ce depot, donc aucun prix ne passe.
 *
 * `gbp_profiles` porte business_name, address, phone, website, categories, hours,
 * reviews, reviews_summary, photos, posts, qa et attributes
 * (db/000_baseline.sql:425-443) : pas une colonne de tarif, et le readMask de
 * `fetchProfile` n'en demande aucune. Un montant dans un resume est donc, par
 * construction, invente ou recopie d'ailleurs — et un tarif faux publie sur la
 * fiche d'un client francais l'expose au-dela du referencement.
 *
 * La regle est severe et le restera tant qu'une source de prix n'existe pas.
 * C'est le bon sens de l'erreur : un post sans prix se publie, un prix faux ne
 * se retire pas.
 */
function checkPrices(summary: string): GateFinding[] {
  return [...summary.matchAll(PRICE_CLAIM)].map((match): GateFinding => ({
    code: 'GBP_UNSUPPORTED_CLAIM',
    source: 'gbp',
    message:
      `Le resume annonce un tarif (${match[0].trim()}) qu'aucune donnee de la fiche ne peut `
      + `confirmer : gbp_profiles ne porte aucun prix, et un tarif publie ne se corrige pas`,
  }))
}

/**
 * Un passage entre guillemets doit se retrouver dans un avis reel.
 *
 * `recent_positive` est tronque a cent caracteres par `summarizeReviews`, donc la
 * comparaison accepte les DEUX sens d'inclusion : la citation contient l'avis
 * tronque, ou l'avis contient la citation. Comparer par egalite ne reconnaitrait
 * jamais un avis long.
 *
 * Normalisee par `normalizeForMatch`, la seule normalisation du produit : casse,
 * accents et ponctuation ne doivent pas faire passer pour une invention un avis
 * recopie a l'apostrophe pres.
 */
function checkQuotations(summary: string, reviews: ReviewsSummary | null): GateFinding[] {
  const findings: GateFinding[] = []
  const known = (reviews?.recentPositive ?? [])
    .map(normalizeForMatch)
    .filter(text => text.length > 0)

  for (const match of summary.matchAll(QUOTED_CLAIM)) {
    const quoted = normalizeForMatch(match[1])
    if (quoted.length === 0) continue

    const supported = known.some(text => text.includes(quoted) || quoted.includes(text))
    if (supported) continue

    findings.push({
      code: 'GBP_UNSUPPORTED_CLAIM',
      source: 'gbp',
      message:
        `Le resume cite « ${excerpt(match[1])} » : aucun avis de la fiche ne contient ce passage, `
        + `et un temoignage fabrique engage le client bien au-dela du referencement`,
    })
  }

  return findings
}

// ─── Lecture defensive du profil ────────────────────────────────────────────

/**
 * `reviews_summary` lue sans rien supposer.
 *
 * La colonne est un `jsonb` : elle a pu etre ecrite par une version anterieure de
 * `summarizeReviews`, par une synchronisation partielle, ou pas du tout. Un
 * `as ReviewsSummary` ferait passer `undefined.totalCount` pour une donnee et
 * ferait jeter le gate — c'est-a-dire echouer une publication a cause de la forme
 * d'une colonne de cache.
 *
 * Rend `null` des qu'un des trois champs manque : « je ne sais pas » et « aucun
 * avis » conduisent ici a la meme decision, refuser la note citee, et les
 * distinguer donnerait a une lecture ratee le pouvoir d'autoriser une invention.
 */
function readReviewsSummary(raw: unknown): ReviewsSummary | null {
  if (typeof raw !== 'object' || raw === null) return null

  const record = raw as Record<string, unknown>
  const averageRating = record.average_rating
  const totalCount = record.total_count
  const recentPositive = record.recent_positive

  if (typeof averageRating !== 'number' || !Number.isFinite(averageRating)) return null
  if (typeof totalCount !== 'number' || !Number.isFinite(totalCount)) return null

  return {
    averageRating,
    totalCount,
    // Un tableau absent est un tableau vide, pas un motif de rejet de toute la
    // ligne : la note reste exploitable meme quand aucun avis n'a de commentaire.
    recentPositive: Array.isArray(recentPositive)
      ? recentPositive.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

/** « 4,8 » et « 4.8 » sont le meme nombre ; tout le reste n'en est pas un. */
function toDecimal(raw: string): number | null {
  const value = Number(raw.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Assez pour reconnaitre le texte, pas assez pour noyer le constat. */
function excerpt(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat
}
