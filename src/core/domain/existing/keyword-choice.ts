// ─────────────────────────────────────────────────────────────────────────────
// Quel sujet ecrire, quand personne ne l'a dit
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE MODULE EXISTE.
//
// Le slug est desormais RESERVE avant le premier token — c'est ce qui rend une
// collision impossible. Mais cela deplace une charge : au moment de la
// reservation, la page n'est pas ecrite, donc le seul materiau disponible pour
// nommer l'adresse est le mot-cle vise.
//
// Sur le chemin PLANIFIE, le brief fournit ce mot-cle et il est precis. Sur les
// deux autres chemins — `runDueCampaigns` et un lancement manuel — il n'y a pas
// de brief, et la chaine de repli tombait sur `${business_type} ${city}` :
// litteralement le terme le plus generique du site, celui que vise sa page
// d'accueil.
//
// Constate en production : une generation manuelle sur une campagne de taxi a
// Troyes a produit le slug « taxi-troyes », et le gate anti-duplicat a
// immediatement signale une cannibalisation contre une page deja publiee. Le
// moteur avait raison de le signaler ; il avait tort de le proposer.
//
// Avant la reservation de slug, le modele ecrivait la page PUIS la nommait, ce
// qui masquait le probleme : il compensait un mot-cle vague par un titre precis.
// Ce module rend cette precision au moment ou elle est desormais requise.
//
// LE PRINCIPE. On ne fabrique aucun sujet. On CHOISIT, parmi les mots-cles que
// le proprietaire a lui-meme declares sur sa campagne, celui que l'inventaire
// couvre le moins. Rien n'est invente : si tous sont couverts, on le dit.

import { normalizeForMatch, contentTokens } from '../text/text-utils'
import type { InventoryEntry, SiteInventory } from './inventory'

/** Ce que la selection a trouve, et ce qu'elle a du concéder. */
export interface KeywordChoice {
  keyword: string
  /**
   * Comment il a ete obtenu.
   *
   * 'libre'    — aucun contenu en ligne ne vise ce mot-cle.
   * 'moins-couvert' — tous sont couverts ; celui-ci l'est le moins.
   * 'repli'    — la campagne ne declare aucun mot-cle exploitable, on retombe
   *              sur le terme generique. C'est un AVEU, pas un choix.
   */
  origin: 'libre' | 'moins-couvert' | 'repli'
  /** Les chemins de l'inventaire qui visent deja ce mot-cle. Vide si 'libre'. */
  coveredBy: string[]
}

/**
 * Le mot-cle de la campagne que l'inventaire couvre le moins.
 *
 * `fallback` n'est utilise que si `keywords` ne porte rien d'exploitable : il
 * vaut mieux une page generique qu'aucune page, mais l'appelant doit pouvoir
 * savoir qu'on en est la — d'ou `origin: 'repli'`.
 *
 * Pure : aucune IO, aucune horloge. L'ordre de `keywords` est respecté a
 * couverture egale, parce que c'est l'ordre dans lequel le proprietaire les a
 * ecrits et qu'il porte sa propre priorite.
 */
export function pickLeastCoveredKeyword(
  keywords: readonly string[],
  inventory: SiteInventory,
  fallback: string,
): KeywordChoice {
  const candidates = keywords.map(k => k.trim()).filter(Boolean)
  if (candidates.length === 0) {
    return { keyword: fallback, origin: 'repli', coveredBy: [] }
  }

  let best: KeywordChoice | null = null

  for (const keyword of candidates) {
    const coveredBy = entriesCovering(keyword, inventory.entries)

    // Le premier mot-cle libre gagne immediatement : chercher plus loin
    // reviendrait a preferer un sujet plus bas dans la liste du proprietaire
    // sans aucune raison de le faire.
    if (coveredBy.length === 0) return { keyword, origin: 'libre', coveredBy: [] }

    if (best === null || coveredBy.length < best.coveredBy.length) {
      best = { keyword, origin: 'moins-couvert', coveredBy }
    }
  }

  return best ?? { keyword: fallback, origin: 'repli', coveredBy: [] }
}

/**
 * Les pages en ligne qui visent deja ce mot-cle.
 *
 * Deux facons de le viser, et la seconde compte autant que la premiere :
 * porter le mot-cle en `focus_keyword`, ou porter TOUS ses mots signifiants
 * dans son titre. Une page intitulee « Taxi Troyes : tarifs » couvre « taxi
 * troyes » meme si sa colonne focus_keyword est vide — et elle l'est souvent,
 * sur les pages que le proprietaire a ecrites lui-meme.
 *
 * Les entrees desindexees ou canonisees ailleurs ne comptent pas : elles
 * n'occupent aucune place dans l'index, donc elles ne couvrent rien.
 */
function entriesCovering(keyword: string, entries: readonly InventoryEntry[]): string[] {
  const wanted = contentTokens(normalizeForMatch(keyword))
  if (wanted.length === 0) return []

  const covering: string[] = []

  for (const entry of entries) {
    if (entry.noindex) continue
    if (entry.canonicalPath && entry.canonicalPath !== entry.path) continue

    const focus = normalizeForMatch(entry.focusKeyword ?? '')
    if (focus && focus === normalizeForMatch(keyword)) {
      covering.push(entry.path)
      continue
    }

    const titleTokens = new Set(contentTokens(normalizeForMatch(entry.title ?? '')))
    if (titleTokens.size > 0 && wanted.every(token => titleTokens.has(token))) {
      covering.push(entry.path)
    }
  }

  return covering
}
