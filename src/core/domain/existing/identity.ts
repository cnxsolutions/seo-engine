// ─────────────────────────────────────────────────────────────────────────────
// Editorial Identity
// SEO Engine - Domain
// « Ces deux pages se ressemblent-elles dans une SERP ? »
// ─────────────────────────────────────────────────────────────────────────────
//
// Une seule question, posee sur les trois choses qu'un internaute voit avant de
// cliquer : l'adresse, le titre, la meta description. Le detecteur lexical
// (src/adapters/rag/validation/DuplicateDetector) compare des CORPS et ne connait
// ni meta ni slug — son ContentToCheck ne porte que { id, title, content }. Le
// trou se comble ICI, a cote, plutot qu'en deformant un detecteur complet et
// teste.
//
// Ce module MESURE ; il ne choisit pas ses candidats. Ecarter les entrees
// desindexees ou canonisees ailleurs appartient a l'appelant qui construit la
// liste : une politique qui filtrerait elle-meme ses entrees rendrait
// indistinguables « aucune ressemblance » et « aucune comparaison faite ».
//
// Domaine pur : aucun import vers lib/ ni src/adapters, aucune IO, aucune
// horloge. Les seuils sont EXPORTES parce que le gate, le script de rejeu et
// l'ecran doivent tous parler des memes nombres — un seuil recopie est un seuil
// qui divergera.

import { contentTokens, cosineSimilarityOfTokens, detectIntents, normalizeForMatch } from '../text/text-utils'
import { normalizeInventoryPath, type InventoryEntry } from './inventory'
import type { DuplicateCode } from './verdict'

// ─── Seuils ─────────────────────────────────────────────────────────────────

/**
 * Deux titres au-dessus de ce cosinus se disputent le meme clic.
 *
 * 0.80 et non 0.90 (le seuil du DuplicateDetector) parce que le calcul n'est pas
 * le meme : ici les tokens de ville sont RETIRES avant comparaison, donc ce qui
 * reste est deja le noyau editorial du titre. Sur ce vecteur epure, 0.80 est
 * atteint des que les titres partagent l'essentiel de leur vocabulaire utile.
 */
export const TITLE_NEAR_DUPLICATE = 0.8

/**
 * Deux meta descriptions au-dessus de ce cosinus donnent la meme promesse.
 *
 * Plus haut que le titre : une meta fait 150 caracteres, son vecteur est plus
 * riche, et deux pages soeurs d'un site mono-service PEUVENT legitimement se
 * ressembler beaucoup sans etre le meme contenu. Le cas vise est la meta REDIGEE
 * PAR LE MODELE pour deux villes voisines, pas un repli automatique : quand la
 * meta manque, le gate refuse deja la page en amont sur une anomalie bloquante
 * du champ metaDescription.
 */
export const META_NEAR_DUPLICATE = 0.85

/**
 * L'ecart retire aux seuils quand l'inventaire est TRONQUE.
 *
 * Un echantillon rend le moteur plus prudent, jamais plus confiant. Si le crawl
 * a plafonne, la page la plus ressemblante du site n'est peut-etre tout
 * simplement PAS dans ce qu'on regarde : les quelques voisins visibles doivent
 * donc etre juges plus severement, faute de quoi un inventaire partiel
 * produirait mecaniquement moins de constats qu'un inventaire complet et
 * ferait passer l'ignorance pour une absence de doublon.
 */
export const TRUNCATED_MARGIN = 0.08

/** TITLE_NEAR_DUPLICATE - TRUNCATED_MARGIN, ecrit en litteral pour rester exact. */
export const TITLE_NEAR_DUPLICATE_TRUNCATED = 0.72

/** META_NEAR_DUPLICATE - TRUNCATED_MARGIN, ecrit en litteral pour rester exact. */
export const META_NEAR_DUPLICATE_TRUNCATED = 0.77

/**
 * Plancher de titre au-dessus duquel une intention partagee suffit a AVERTIR.
 *
 * Ne se durcit pas sur un inventaire tronque : la cannibalisation n'est qu'un
 * avertissement, elle ne retient aucune page, et un avertissement plus sensible
 * sur un echantillon n'apporterait que du bruit a l'operateur.
 */
export const CANNIBALIZATION_TITLE_FLOOR = 0.6

/** Les deux seuils qui BLOQUENT, a l'etat de connaissance du moment. */
export interface IdentityThresholds {
  title: number
  meta: number
}

/**
 * Le durcissement, expose comme une fonction pure plutot que disperse dans le
 * juge : c'est la seule facon de le tester pour lui-meme, et d'empecher qu'un
 * second appelant en reecrive une variante.
 */
export function identityThresholds(truncated: boolean): IdentityThresholds {
  return truncated
    ? { title: TITLE_NEAR_DUPLICATE_TRUNCATED, meta: META_NEAR_DUPLICATE_TRUNCATED }
    : { title: TITLE_NEAR_DUPLICATE, meta: META_NEAR_DUPLICATE }
}

// ─── Ce qu'on compare ───────────────────────────────────────────────────────

/**
 * La page qu'on s'apprete a ecrire, reduite a ce qui apparait dans une SERP.
 *
 * `body` est optionnel : au moment de decider d'ecrire, il n'existe pas encore.
 * Son absence n'empeche pas la comparaison, elle la rend PARTIELLE — et le dit.
 */
export interface EditorialTarget {
  path: string
  title: string
  metaDescription: string
  focusKeyword: string
  body?: string
}

/** Le resultat mesure d'une confrontation, sans jugement. */
export interface IdentityComparison {
  entryPath: string
  entryUrl: string
  /** Meme adresse, apres normalizeInventoryPath des deux cotes. */
  pathCollision: boolean
  /** Cosinus des titres, VILLES RETIREES. 0..1. */
  titleSimilarity: number
  /** Cosinus des metas seules, jamais derivees du titre. 0..1. */
  metaSimilarity: number
  sameFocusKeyword: boolean
  /** Intentions de recherche communes, triees pour rester comparables. */
  sharedIntents: string[]
  /**
   * Vrai des qu'un des deux cotes n'a pas ete vu en entier. Un score BAS ne
   * prouve alors rien : on n'a pas compare les memes quantites de texte.
   */
  comparisonIsPartial: boolean
}

/**
 * Combien de caracteres de corps servent a deviner l'intention.
 *
 * Meme fenetre que le DuplicateDetector : l'intention d'une page se declare dans
 * son chapeau, et lire 20 000 caracteres pour la trouver ferait dire « oui » a
 * toutes les intentions sur toutes les pages longues.
 */
const INTENT_SAMPLE_CHARS = 800

/**
 * Confronte une page a ecrire a une page qui existe.
 *
 * `cityTokens` accepte aussi bien ['troyes', 'sainte', 'savine'] que
 * ['Troyes', 'Sainte-Savine'] : chaque valeur est normalisee puis eclatee en
 * mots. Un appelant qui devrait pre-decouper ses villes finirait par le faire a
 * moitie.
 */
export function compareEditorialIdentity(
  target: EditorialTarget,
  entry: InventoryEntry,
  cityTokens: readonly string[],
): IdentityComparison {
  const cities = cityTokenSet(cityTokens)

  return {
    entryPath: entry.path,
    entryUrl: entry.url,
    pathCollision: normalizeInventoryPath(target.path) === normalizeInventoryPath(entry.path),
    titleSimilarity: titleSimilarityOf(target.title, entry.title ?? '', cities),
    // Les metas ne sont PAS epurees de leurs villes : sur 150 caracteres, un
    // token de ville pese quelques pourcents du vecteur, la ou il pese la moitie
    // d'un titre de deux mots. Le retrait est un correctif cible, pas un reflexe.
    metaSimilarity: cosineSimilarityOfTokens(
      contentTokens(target.metaDescription),
      contentTokens(entry.metaDescription ?? ''),
    ),
    sameFocusKeyword: sameKeyword(target.focusKeyword, entry.focusKeyword),
    sharedIntents: sharedIntentsOf(target, entry),
    // Une ligne 'engine' amorcee par la migration 018 n'a pas de corps du tout,
    // et le crawler plafonne le sien : les deux portent bodyIsExcerpt.
    comparisonIsPartial: entry.bodyIsExcerpt || !target.body || target.body.length === 0,
  }
}

// ─── Le jugement ────────────────────────────────────────────────────────────

/** Les trois codes de duplicat que l'identite editoriale sait produire. */
export type IdentityBlockingCode = Extract<
  DuplicateCode,
  'TITLE_NEAR_DUPLICATE' | 'META_NEAR_DUPLICATE' | 'SLUG_COLLISION'
>

export interface IdentityBlocking {
  code: IdentityBlockingCode
  comparison: IdentityComparison
}

export interface IdentityWarning {
  code: Extract<DuplicateCode, 'CANNIBALIZATION'>
  comparison: IdentityComparison
}

/**
 * Ce que les mesures autoriseraient a faire.
 *
 * « Autoriseraient » : ce verdict ne bloque rien par lui-meme. C'est le gate,
 * et lui seul, qui decide si `blocking` retient la page ou se contente de
 * l'observer. Tant que l'exploitation est en mode observation, ce tableau sert
 * a MESURER le volume reel de quasi-doublons du site avant qu'une barriere ne
 * se ferme dessus.
 */
export interface IdentityVerdict {
  blocking: IdentityBlocking[]
  warnings: IdentityWarning[]
}

/**
 * Juge un lot de comparaisons.
 *
 * `truncated` vient de SiteInventory.truncated et durcit les deux seuils
 * bloquants. `intent` distingue les deux seules choses qu'on puisse faire a une
 * adresse : en prendre une nouvelle, ou reecrire celle qu'on occupe deja.
 */
export function judgeEditorialIdentity(
  comparisons: readonly IdentityComparison[],
  opts: { intent: 'create' | 'refresh'; truncated: boolean },
): IdentityVerdict {
  const thresholds = identityThresholds(opts.truncated)
  const blocking: IdentityBlocking[] = []
  const warnings: IdentityWarning[] = []

  for (const comparison of comparisons) {
    // Un rafraichissement compare la NOUVELLE version de la page a l'ANCIENNE,
    // qui vit a la meme adresse. Bloquer sur cette ressemblance interdirait tout
    // rafraichissement, puisqu'une mise a jour reussie ressemble par
    // construction a ce qu'elle remplace : la ligne est ignoree en entier, pas
    // seulement son SLUG_COLLISION.
    if (opts.intent === 'refresh' && comparison.pathCollision) continue

    const before = blocking.length

    // Pousses dans l'ordre de gravite de DUPLICATE_CODES, pour que le premier
    // element soit deja le plus grave meme sans passer par summarizeVerdict().
    if (comparison.titleSimilarity >= thresholds.title) {
      blocking.push({ code: 'TITLE_NEAR_DUPLICATE', comparison })
    }
    if (comparison.metaSimilarity >= thresholds.meta) {
      blocking.push({ code: 'META_NEAR_DUPLICATE', comparison })
    }
    if (comparison.pathCollision) {
      blocking.push({ code: 'SLUG_COLLISION', comparison })
    }

    // Averti seulement si rien de plus grave n'a ete dit sur cette meme page :
    // afficher « cannibalisation » sous un « meme titre » ne renseigne personne.
    if (blocking.length === before && cannibalizes(comparison)) {
      warnings.push({ code: 'CANNIBALIZATION', comparison })
    }
  }

  return { blocking, warnings }
}

// ─── Interne ────────────────────────────────────────────────────────────────

/**
 * LE correctif de ce module.
 *
 * Sur les titres reels d'un generateur une-page-par-ville, « Taxi Troyes » et
 * « Taxi Sainte-Savine » ont un cosinus de tokens bruts d'environ 0,41 : aucun
 * seuil raisonnable ne peut se declencher dessus, et la regle de cannibalisation
 * du DuplicateDetector (title >= 0.9) est litteralement inatteignable sur le
 * mode d'echec REEL du produit. Retirer les tokens de ville des DEUX cotes
 * laisse « Taxi » contre « Taxi » : identiques, ce qui est exactement le fait a
 * detecter.
 */
function withoutCities(tokens: string[], cities: ReadonlySet<string>): string[] {
  return cities.size === 0 ? tokens : tokens.filter(token => !cities.has(token))
}

function cityTokenSet(cityTokens: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>()
  for (const raw of cityTokens) {
    for (const token of normalizeForMatch(raw).split(' ')) {
      if (token) set.add(token)
    }
  }
  return set
}

function titleSimilarityOf(
  targetTitle: string,
  entryTitle: string,
  cities: ReadonlySet<string>,
): number {
  const rawTarget = contentTokens(targetTitle)
  const rawEntry = contentTokens(entryTitle)
  const strippedTarget = withoutCities(rawTarget, cities)
  const strippedEntry = withoutCities(rawEntry, cities)

  // Deux titres entierement faits de noms de villes — « Troyes » contre
  // « Sainte-Savine » — se videraient tous les deux, et le cosinus de deux
  // vecteurs vides vaut 0 : deux titres IDENTIQUES passeraient alors pour
  // differents. Quand le retrait n'a plus rien laisse a mesurer, on retombe sur
  // les titres bruts.
  if (strippedTarget.length === 0 && strippedEntry.length === 0) {
    return cosineSimilarityOfTokens(rawTarget, rawEntry)
  }

  return cosineSimilarityOfTokens(strippedTarget, strippedEntry)
}

/**
 * Deux mots-cles vides ne sont pas « le meme mot-cle ». Une entree d'inventaire
 * sans focus_keyword aurait sinon partage son sujet avec tout ce qui passe.
 */
function sameKeyword(targetKeyword: string, entryKeyword: string | null): boolean {
  const left = normalizeForMatch(targetKeyword)
  if (!left) return false
  return left === normalizeForMatch(entryKeyword ?? '')
}

function sharedIntentsOf(target: EditorialTarget, entry: InventoryEntry): string[] {
  const targetIntents = detectIntents(intentText(target.title, target.metaDescription, target.body))
  const entryIntents = detectIntents(
    intentText(entry.title ?? '', entry.metaDescription ?? '', entry.body),
  )

  // Trie : ce tableau part vers un jsonb persiste et vers un ecran, ou un ordre
  // dependant de l'ordre d'insertion ferait diverger deux verdicts identiques.
  return [...targetIntents].filter(name => entryIntents.has(name)).sort()
}

/** detectIntents EXIGE une entree normalisee : ses motifs sont sans accent. */
function intentText(title: string, metaDescription: string, body?: string): string {
  return normalizeForMatch(`${title} ${metaDescription} ${(body ?? '').slice(0, INTENT_SAMPLE_CHARS)}`)
}

/**
 * Deux pages se cannibalisent quand elles courent apres le meme clic : soit
 * elles declarent le meme mot-cle, soit elles servent la meme intention avec des
 * titres deja proches. Rien de tout cela ne retient une page — c'est au plan
 * editorial de trancher, pas au gate.
 */
function cannibalizes(comparison: IdentityComparison): boolean {
  if (comparison.sameFocusKeyword) return true
  return (
    comparison.sharedIntents.length > 0 &&
    comparison.titleSimilarity >= CANNIBALIZATION_TITLE_FLOOR
  )
}
