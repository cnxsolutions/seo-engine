// ─────────────────────────────────────────────────────────────────────────────
// GBP Post Rotation
// SEO Engine - Domain
// « Ce post redit-il ce qui vient d'etre publie sur la fiche ? »
// ─────────────────────────────────────────────────────────────────────────────
//
// DEUX BARRIERES, ET ELLES NE SE REMPLACENT PAS.
//
// nextAngle() contraint EN AMONT : un angle deja servi dans les derniers posts
// n'est pas proposable, une page deja annoncee non plus. Cette barriere-la evite
// de PAYER une generation dont on sait deja qu'elle redira quelque chose.
//
// judgePostOriginality() refuse EN AVAL, sur le texte reellement produit. Cette
// barriere-la rattrape ce que le modele ecrit malgre la consigne — et un modele
// a qui on impose l'angle « zone » apres un post « service » retombe tres bien
// sur les memes trois phrases.
//
// Supprimer la premiere reviendrait a payer pour se faire refuser ; supprimer la
// seconde, a faire confiance a un prompt.
//
// LE CORPUS INCLUT CE QUE LE PROPRIETAIRE ECRIT LUI-MEME. Les posts source
// 'remote' — tapes a la main sur la fiche — entrent dans exactement la meme
// fenetre de comparaison que les notres. Les ignorer ferait proposer au moteur de
// redire ce que le proprietaire vient d'ecrire, ce qui est le plus mauvais post
// possible : redondant ET visiblement automatique.
//
// AUCUNE HORLOGE, AUCUN RESEAU, AUCUN EMBEDDING. Les cooldowns comptent des
// POSTS, pas des jours : sur une campagne mise en pause, un cooldown date
// libererait les angles sans qu'un seul post nouveau ait ete publie, alors que
// la fiche, elle, n'a pas bouge. Et l'indexation vectorielle des posts est
// exclue par vector_embeddings_document_type_check, dont les six valeurs
// (schema, content, taxonomy_term, seo_data, competitor, example) n'accueillent
// pas un post de fiche : le cosinus lexical du domaine suffit et ne coute rien.
//
// Domaine pur : un seul import, vers la boite a outils textuelle du domaine.

import { contentTokens, cosineSimilarityOfTokens } from '../text/text-utils'

// ─── Les angles ─────────────────────────────────────────────────────────────

/**
 * Les sept facons de parler d'une entreprise sur sa fiche sans se repeter.
 *
 * Cette union est le miroir EXACT de gbp_posts_angle_check (migration 019) :
 * une huitieme valeur ici serait refusee a l'insertion.
 */
export type GbpPostAngle =
  | 'service'
  | 'zone'
  | 'horaires'
  | 'avis'
  | 'faq'
  | 'saison'
  | 'nouvelle-page'

/**
 * L'ordre de declaration, qui est aussi l'ordre de preference a egalite.
 *
 * Il n'est pas arbitraire : il va du plus factuel (ce qu'on fait, ou, quand) au
 * plus circonstanciel (la saison, la derniere page publiee). A anciennete egale,
 * le moteur choisit donc l'angle le plus sur.
 */
export const GBP_POST_ANGLES: readonly GbpPostAngle[] = [
  'service',
  'zone',
  'horaires',
  'avis',
  'faq',
  'saison',
  'nouvelle-page',
]

// ─── Le corpus de comparaison ───────────────────────────────────────────────

/**
 * Un post deja present sur la fiche, quelle qu'en soit la main.
 *
 * ORDRE : le tableau `recent` attendu par ce module est trie du PLUS RECENT au
 * plus ancien (l'index 0 est le dernier post publie), ce que produit
 * naturellement un `order by created_at desc` — l'index gbp_posts_site_created_idx
 * existe pour cela. Ce module ne trie pas lui-meme : `publishedAt` est nul sur
 * un post 'generated' ou 'rejected', et un tri sur une colonne nullable placerait
 * les brouillons au hasard.
 *
 * `angle` est nullable parce qu'un post 'remote' n'en a pas : le proprietaire
 * n'a pas choisi dans notre liste. Il occupe malgre tout une place dans la
 * fenetre, donc il repousse nos propres posts vers le passe — c'est voulu.
 *
 * `publishedAt` n'est lu par AUCUNE regle de ce module. Il figure ici parce que
 * les vues et le journal en ont besoin sur la meme ligne, et parce qu'il rappelle
 * d'ou vient l'ordre du tableau.
 */
export interface RecentPost {
  angle: GbpPostAngle | null
  summary: string
  linkedGenerationId: string | null
  publishedAt: string | null
  source: 'engine' | 'remote'
}

// ─── Seuils ─────────────────────────────────────────────────────────────────

/**
 * Cosinus au-dela duquel deux resumes disent la meme chose.
 *
 * 0.75, plus bas que les seuils de page (0.80 sur un titre, 0.85 sur une meta),
 * parce qu'un resume de fiche fait deux cents a sept cents caracteres et tourne
 * autour du meme nom d'entreprise, de la meme ville et du meme metier : le
 * vocabulaire commun obligatoire est deja enorme. A 0.90, deux posts qui ne
 * different que par leur derniere phrase passeraient.
 *
 * Ce seuil n'est PAS transposable a une page et ne doit pas etre recopie : il est
 * calibre sur un texte court, sans titre ni structure, ou la moindre phrase
 * partagee pese lourd.
 */
export const POST_SIMILARITY_BLOCK = 0.75

/**
 * Nombre de posts pendant lesquels un angle deja servi reste interdit.
 *
 * Trois, et non sept : exiger un tour complet des angles rendrait le moteur
 * incapable de publier des qu'un seul angle devient indisponible, et le report
 * serait alors la regle plutot que l'exception.
 */
export const ANGLE_COOLDOWN = 3

/**
 * Nombre de posts pendant lesquels une page deja annoncee ne peut pas l'etre a
 * nouveau.
 *
 * Plus long que le cooldown d'angle : annoncer deux fois la meme page sous deux
 * angles differents reste, pour le lecteur de la fiche, deux fois la meme
 * annonce. C'est la repetition du LIEN qui se voit, pas celle de l'angle.
 */
export const LINK_COOLDOWN = 4

/**
 * Profondeur de la fenetre de comparaison textuelle.
 *
 * Douze posts, soit environ trois mois a la cadence par defaut de sept jours.
 * Au-dela, un resume qui se ressemble n'est plus un doublon percu : personne ne
 * fait defiler un trimestre de posts sur une fiche. Comparer tout l'historique
 * ferait, lui, refuser des posts pour une ressemblance que plus aucun lecteur ne
 * peut constater.
 */
export const RECENT_POST_WINDOW = 12

// ─── Disponibilite d'un angle ───────────────────────────────────────────────

/**
 * Ce que la fiche permet REELLEMENT de dire.
 *
 * Les deux premiers champs sont obligatoires : ce sont les deux seuls signaux
 * qu'un appelant peut toujours calculer (les avis viennent de
 * gbp_profiles.reviews_summary, la page a annoncer d'une generation publiee).
 *
 * Les trois suivants sont OPTIONNELS et valent « disponible » par defaut, pour
 * une raison qui n'est pas de la complaisance : une information ABSENTE du profil
 * et une information NON LUE par l'appelant ne se distinguent pas ici. Un defaut
 * pessimiste ferait geler la rotation entiere d'un appelant qui n'a simplement
 * pas renseigne le champ. Le defaut optimiste, lui, est rattrape en aval par le
 * controle d'integrite factuelle du gate, qui refuse tout fait non present dans
 * le profil.
 *
 * Le principe est celui de l'angle 'avis' generalise : un post qui parle
 * d'horaires non declares ou d'une zone d'intervention inconnue n'est pas un
 * angle, c'est une invention — et une invention qu'on aura payee avant de la
 * faire refuser.
 */
export interface AngleAvailability {
  /** La fiche porte-t-elle de vrais avis ? Faux interdit l'angle 'avis'. */
  hasRealReviews: boolean
  /** Existe-t-il une page publiee qu'aucun post recent n'annonce ? */
  hasUnlinkedPublishedPage: boolean
  /** Horaires declares sur la fiche. Absent = suppose disponible. */
  hasDeclaredHours?: boolean
  /** Zone d'intervention connue. Absent = suppose disponible. */
  hasServiceArea?: boolean
  /** Services ou categories nommes. Absent = suppose disponible. */
  hasNamedServices?: boolean
}

/** Pourquoi un angle n'est pas proposable, en une valeur stable et affichable. */
export type AngleUnavailability =
  | 'angle-en-cooldown'
  | 'aucun-avis-reel'
  | 'aucune-page-a-annoncer'
  | 'aucun-horaire-declare'
  | 'aucune-zone-declaree'
  | 'aucun-service-declare'

/** L'etat d'un angle, avec son motif quand il est ferme. */
export interface AngleOption {
  angle: GbpPostAngle
  available: boolean
  /** Nul si et seulement si `available` est vrai. */
  reason: AngleUnavailability | null
}

/**
 * L'etat des sept angles, dans l'ordre de GBP_POST_ANGLES.
 *
 * Expose parce que l'ecran de composition doit griser un angle AVEC son motif :
 * une option absente est un cul-de-sac, et un motif recalcule cote vue serait un
 * second exemplaire de cette politique, condamne a diverger du premier.
 */
export function describeAngles(
  recent: readonly RecentPost[],
  availability: AngleAvailability,
): readonly AngleOption[] {
  const onCooldown = anglesInCooldown(recent)

  return GBP_POST_ANGLES.map(angle => {
    const reason = unavailabilityOf(angle, availability, onCooldown)
    return { angle, available: reason === null, reason }
  })
}

/**
 * L'angle a servir maintenant, ou null.
 *
 * Parmi les angles ouverts, le MOINS RECEMMENT servi gagne ; a egalite — et donc
 * pour un angle jamais servi — l'ordre de GBP_POST_ANGLES tranche. La rotation
 * est ainsi entierement determinee par l'historique : deux appels sur le meme
 * historique rendent le meme angle, ce qui rend la politique rejouable et
 * testable sans horloge ni aleatoire.
 *
 * null veut dire REPORTER. Ce n'est pas une erreur : c'est le seul resultat
 * honnete quand tout ce qu'on saurait dire vient d'etre dit. Un creneau reporte
 * ne coute rien ; un post redondant, lui, s'affiche sur la fiche d'un client.
 *
 * Avec les valeurs actuelles (sept angles, cooldown de trois, cinq exclusions
 * conditionnelles au maximum), ce null demande qu'une fiche soit tres pauvre en
 * matiere ET que les derniers posts aient consomme le peu qui restait. La branche
 * n'est pas decorative pour autant : les constantes sont reglables, et un
 * appelant qui la traiterait comme impossible publierait un angle interdit le
 * jour ou elle se declenche.
 */
export function nextAngle(
  recent: readonly RecentPost[],
  availability: AngleAvailability,
): GbpPostAngle | null {
  const lastUse = lastUseIndexes(recent)
  let best: GbpPostAngle | null = null
  let bestAge = -1

  for (const option of describeAngles(recent, availability)) {
    if (!option.available) continue

    // Jamais servi = infiniment ancien. Number.MAX_SAFE_INTEGER plutot que
    // Infinity : la valeur ne sert qu'a comparer, et rester dans les entiers
    // evite qu'une comparaison de deux Infinity depende de l'ordre d'iteration.
    const age = lastUse.get(option.angle) ?? Number.MAX_SAFE_INTEGER

    if (age > bestAge) {
      best = option.angle
      bestAge = age
    }
  }

  return best
}

/**
 * Les pages annoncees trop recemment pour l'etre a nouveau.
 *
 * Exposee parce que la selection de la page a annoncer se fait AVANT la
 * generation, chez l'appelant, et qu'elle a besoin exactement de cet ensemble.
 * Sans cet export il en existerait une seconde version, ecrite ailleurs, avec sa
 * propre idee de LINK_COOLDOWN.
 */
export function linksInCooldown(recent: readonly RecentPost[]): ReadonlySet<string> {
  const links = new Set<string>()
  for (const post of recent.slice(0, LINK_COOLDOWN)) {
    if (post.linkedGenerationId) links.add(post.linkedGenerationId)
  }
  return links
}

// ─── Le jugement d'un brouillon ─────────────────────────────────────────────

/**
 * Les quatre motifs de refus, dans la forme exacte que le gate pousse dans
 * GateFinding.code.
 *
 * Des phrases francaises ici obligeraient le gate a retrouver par comparaison de
 * chaines lequel des quatre a tire, et une reformulation casserait ce filtrage
 * en silence. La redaction destinee a l'operateur appartient a la couche qui
 * affiche, pas au domaine qui decide.
 */
export type PostRefusalCode =
  | 'GBP_NO_LINK'
  | 'GBP_ANGLE_COOLDOWN'
  | 'GBP_LINK_COOLDOWN'
  | 'GBP_DUPLICATE_SUMMARY'

/** Le verdict rendu sur un brouillon, mesure comprise. */
export interface PostDraftJudgement {
  ok: boolean
  reasons: PostRefusalCode[]
  /**
   * Le cosinus le plus eleve rencontre dans la fenetre, TOUJOURS renseigne, y
   * compris quand le brouillon passe. C'est ce nombre que l'ecran affiche a cote
   * du seuil : « 0.31 pour un seuil de 0.75 » informe, « accepte » n'informe pas.
   */
  worstSimilarity: number
  /** Le resume du post le plus proche, quand il en existe un de non vide. */
  againstSummary?: string
}

/**
 * Refuse un brouillon qui redit un post recent.
 *
 * Compare a TOUTE la fenetre, toutes origines confondues : un post ecrit a la
 * main par le proprietaire bloque le notre exactement comme l'un des notres.
 *
 * Les quatre controles sont independants et cumulables — un brouillon peut etre
 * a la fois sans lien et en cooldown d'angle, et l'operateur a besoin de voir les
 * deux d'un coup plutot que de decouvrir le second apres avoir corrige le
 * premier.
 */
export function judgePostOriginality(
  draft: { summary: string; angle: GbpPostAngle; linkedGenerationId: string | null },
  recent: readonly RecentPost[],
): PostDraftJudgement {
  const reasons: PostRefusalCode[] = []
  const window = recent.slice(0, RECENT_POST_WINDOW)

  // 1. Le maillage post -> page est une PRECONDITION. La base l'exige des le
  //    statut 'generated' (gbp_posts_engine_needs_link) : un brouillon sans lien
  //    ne serait de toute facon pas inserable, autant le dire ici avec un motif.
  if (!draft.linkedGenerationId) reasons.push('GBP_NO_LINK')

  // 2. Les deux cooldowns, reverifies en aval. nextAngle les a deja appliques en
  //    amont, mais l'angle peut aussi venir d'une suggestion d'operateur, et un
  //    post a pu etre publie entre la composition et la verification.
  if (anglesInCooldown(recent).has(draft.angle)) reasons.push('GBP_ANGLE_COOLDOWN')

  if (draft.linkedGenerationId && linksInCooldown(recent).has(draft.linkedGenerationId)) {
    reasons.push('GBP_LINK_COOLDOWN')
  }

  // 3. La ressemblance, mesuree meme quand le reste refuse deja : le score part
  //    vers l'ecran, et ne pas le calculer sur un post par ailleurs refuse
  //    priverait l'operateur de la seule mesure du texte qu'il vient de lire.
  const draftTokens = contentTokens(draft.summary)
  let worstSimilarity = 0
  let againstSummary: string | undefined

  for (const post of window) {
    const similarity = cosineSimilarityOfTokens(draftTokens, contentTokens(post.summary))
    if (similarity > worstSimilarity) {
      worstSimilarity = similarity
      againstSummary = post.summary
    }
  }

  if (worstSimilarity >= POST_SIMILARITY_BLOCK) reasons.push('GBP_DUPLICATE_SUMMARY')

  const judgement: PostDraftJudgement = {
    ok: reasons.length === 0,
    reasons,
    worstSimilarity,
  }
  if (againstSummary !== undefined) judgement.againstSummary = againstSummary

  return judgement
}

// ─── Empreinte ──────────────────────────────────────────────────────────────

/**
 * Empreinte stable d'un resume, pour retrouver un post sans relire tout le
 * corpus.
 *
 * Ce qu'elle fait : donner la MEME valeur a deux resumes faits des memes mots
 * utiles, quel qu'en soit l'ordre, la casse ou l'accentuation. C'est ce qui
 * permet d'apparier, apres un timeout, un post 'incertain' avec celui que l'API
 * a peut-etre cree — le seul cas ou cette empreinte decide de quelque chose.
 *
 * Ce qu'elle ne fait PAS : juger un doublon. Trente-deux bits ne prouvent pas
 * une egalite, et deux resumes differents peuvent la partager. L'anti-duplication
 * reste le cosinus de judgePostOriginality ; l'empreinte n'est qu'une clef
 * d'index.
 *
 * djb2 sur des operations entieres 32 bits, sans dependance : `hash * 33`
 * depasserait 2^32 et perdrait des bits dans le flottant, la forme decalee ne le
 * peut pas.
 */
export function fingerprintSummary(summary: string): string {
  // contentTokens applique deja normalizeForMatch, puis retire les mots outils :
  // deux resumes qui ne different que par leurs « pour » et leurs « dans »
  // partagent volontairement la meme empreinte.
  const joined = contentTokens(summary).sort().join(' ')

  let hash = 5381
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash) ^ joined.charCodeAt(i)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── Interne ────────────────────────────────────────────────────────────────

/** Les angles servis dans les ANGLE_COOLDOWN derniers posts, toutes origines. */
function anglesInCooldown(recent: readonly RecentPost[]): ReadonlySet<GbpPostAngle> {
  const angles = new Set<GbpPostAngle>()
  for (const post of recent.slice(0, ANGLE_COOLDOWN)) {
    if (post.angle) angles.add(post.angle)
  }
  return angles
}

/**
 * Distance, en nombre de posts, depuis le dernier emploi de chaque angle.
 *
 * Seule la PREMIERE occurrence rencontree compte, puisque le tableau est trie du
 * plus recent au plus ancien : c'est la plus recente.
 */
function lastUseIndexes(recent: readonly RecentPost[]): ReadonlyMap<GbpPostAngle, number> {
  const indexes = new Map<GbpPostAngle, number>()
  recent.forEach((post, index) => {
    if (post.angle && !indexes.has(post.angle)) indexes.set(post.angle, index)
  })
  return indexes
}

/** Le motif de fermeture d'un angle, ou null s'il est ouvert. */
function unavailabilityOf(
  angle: GbpPostAngle,
  availability: AngleAvailability,
  onCooldown: ReadonlySet<GbpPostAngle>,
): AngleUnavailability | null {
  // Le cooldown passe en premier : c'est le motif qui se leve tout seul, et le
  // dire d'abord evite d'annoncer « aucun avis reel » a propos d'un angle qui
  // serait de toute facon ferme demain matin.
  if (onCooldown.has(angle)) return 'angle-en-cooldown'

  switch (angle) {
    case 'avis':
      return availability.hasRealReviews ? null : 'aucun-avis-reel'
    case 'nouvelle-page':
      return availability.hasUnlinkedPublishedPage ? null : 'aucune-page-a-annoncer'
    case 'horaires':
      return availability.hasDeclaredHours === false ? 'aucun-horaire-declare' : null
    case 'zone':
      return availability.hasServiceArea === false ? 'aucune-zone-declaree' : null
    case 'service':
      return availability.hasNamedServices === false ? 'aucun-service-declare' : null
    // 'faq' et 'saison' ne citent aucun fait du profil : une question frequente
    // et un rappel de periode se redigent avec ce que l'entreprise est deja.
    case 'faq':
    case 'saison':
      return null
  }
}
