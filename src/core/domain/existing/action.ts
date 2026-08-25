// ─────────────────────────────────────────────────────────────────────────────
// Editorial Action
// SEO Engine - Domain
// Ce que cette generation fait au site qui existe deja, decide AVANT le 1er token
// ─────────────────────────────────────────────────────────────────────────────
//
// Le moteur ne savait dire qu'une chose : « ecrire une page de plus ». Face a un
// sujet que le site traite deja, il ecrivait quand meme, et les deux pages se
// cannibalisaient. Nommer la decision AVANT la redaction est ce qui rend les
// deux autres reponses possibles : rafraichir la page qui existe, ou ne rien
// faire du tout. C'est aussi ce qui la rend gratuite — arbitrer apres coup
// revient a payer la page pour decouvrir qu'il ne fallait pas l'ecrire.
//
// CE MODULE NE DECLENCHE RIEN. Il rend un verdict ; c'est un humain qui clique.
// Une decision 'refresh' devient une ligne generations intent='refresh' laissee
// en statut 'generated', qui attend un clic dans un panneau nommant la page
// visee et montrant la preuve. Le moteur ne supprime jamais, ne fusionne jamais,
// ne redirige jamais : les pages perdantes d'une cannibalisation sont RAPPORTEES
// dans `evidence` et rien d'autre ne leur arrive.
//
// PURETE. Aucune IO, aucune horloge : la seule dependance temporelle du domaine
// est la fraicheur de l'inventaire, et elle est deja resolue en amont par
// freshnessOf(..., now). Reprendre un `now` ici n'aurait servi qu'a le recalculer.
// Un SEUL import hors domaine, et il est nomme : `import type
// { GscPlanningSignals }` — type-only, efface a la compilation, aucune valeur
// importee, donc aucune IO ne peut entrer par la. C'est l'unique exception a la
// regle de purete de src/core/domain/existing.

import type { GscPlanningSignals } from '@/lib/google/performance'
import { containsKeywordPhrase, normalizeForMatch } from '../text/text-utils'
import {
  compareEditorialIdentity,
  identityThresholds,
  judgeEditorialIdentity,
  type EditorialTarget,
  type IdentityBlockingCode,
  type IdentityComparison,
} from './identity'
import {
  normalizeInventoryPath,
  type InventoryEntry,
  type InventoryFreshness,
  type SiteInventory,
} from './inventory'

// ─── Le verdict ─────────────────────────────────────────────────────────────

/**
 * Jusqu'ou va un rafraichissement.
 *
 * La distinction est economique autant qu'editoriale : reecrire un title et une
 * meta description coute quelques centaines de tokens et ne touche pas au corps
 * qui ranke, reecrire le contenu remet en jeu tout ce que l'adresse a acquis.
 * Les confondre ferait payer le second prix pour le premier besoin — et surtout
 * risquerait le second dommage pour le premier probleme. 'metadata' est donc la
 * portee PREFERABLE des que les mesures ne designent pas le texte.
 */
export type RefreshScope = 'metadata' | 'content'

/**
 * La decision, sous les trois seules formes que le moteur sait executer.
 *
 * 'skip' porte ses motifs parce qu'il est le seul des trois a ne rien produire :
 * sans eux, un creneau disparu du planning ne s'explique nulle part.
 */
export type EditorialAction =
  | { kind: 'create' }
  | {
      kind: 'refresh'
      /** Le chemin normalise de la page mise a jour, tel que l'inventaire le porte. */
      targetPath: string
      /**
       * La generation qui a produit cette page, quand c'est le moteur qui l'a
       * ecrite. Absente pour une page du proprietaire, que le moteur peut
       * rafraichir sans l'avoir jamais redigee.
       */
      targetGenerationId?: string
      scope: RefreshScope
      /**
       * Ce qui a motive la mise a jour, en clair.
       *
       * Recopie tel quel dans le prompt et dans l'ecran : ces phrases viennent
       * de mesures (Search Console, position, ressemblance) et les reformuler
       * ferait perdre le seul lien entre la decision et le chiffre qui l'a
       * causee. C'est CE tableau que l'operateur lit avant de cliquer.
       */
      evidence: string[]
    }
  | { kind: 'skip'; reasons: string[] }

/** L'action par defaut, nommee plutot que repetee en litteral chez ses appelants. */
export const CREATE_ACTION: EditorialAction = { kind: 'create' }

/**
 * La mention litterale exigee des qu'une decision est prise sans mesure
 * d'audience.
 *
 * Exportee, et non recopiee chez ses lecteurs : l'ecran, le prompt et le test
 * doivent pouvoir la reconnaitre sans qu'une seconde orthographe naisse. Une
 * donnee ABSENTE n'est pas une donnee a zero — le dire dans la preuve est la
 * seule facon que l'operateur sache sur quoi il tranche.
 */
export const WITHOUT_SEARCH_CONSOLE = 'sans Search Console'

/**
 * Un rafraichissement demande-t-il de rediger un corps de page ?
 *
 * Le generateur, lui, ne fait pas la difference : il produit toujours une page
 * complete. C'est l'appelant qui decide de n'en garder que les metadonnees, et
 * cette question est ce qu'il pose.
 */
export function rewritesBody(action: EditorialAction): boolean {
  if (action.kind === 'create') return true
  if (action.kind === 'refresh') return action.scope === 'content'
  return false
}

// ─── La decision ────────────────────────────────────────────────────────────

export interface ActionInputs {
  gsc: GscPlanningSignals
  inventory: SiteInventory
  /** Les communes desservies, pour que « Taxi Troyes » et « Taxi Reims » se voient. */
  cityTokens: readonly string[]
}

/**
 * RAFRAICHIR, CREER, ou NE RIEN FAIRE — dans cet ordre, et l'ordre EST la
 * politique.
 *
 *  1. Une requete du sujet est DEJA en position 5-20 sur une page du site
 *     (gsc.strikingDistance) -> refresh 'content'. Une page a portee de la
 *     premiere page se renforce ; en ouvrir une seconde lui prendrait ses
 *     propres signaux.
 *  2. Plusieurs pages du site se disputent deja cette requete (gsc.cannibalized)
 *     -> refresh du `winner`, scope 'content'. Les `losers` sont RAPPORTES dans
 *     evidence et rien de plus : aucune suppression, aucune fusion, aucune 301.
 *  3. Une page du site est vue et pas cliquee sur ce sujet (gsc.lowCtrPages)
 *     -> refresh 'metadata'. Le corps obtient deja les impressions ; c'est la
 *     promesse affichee dans la SERP qui echoue, et elle seule est reecrite.
 *  4. A defaut de mesure, l'identite editoriale : meme adresse, titre trop
 *     proche, ou meme mot-cle principal -> refresh. 'content' quand les deux
 *     pages se disputent le meme clic, 'metadata' quand seule la meta fait
 *     doublon.
 *  5. Le mot-cle du sujet figure dans gsc.blockedQueries -> skip. Simple
 *     APPARTENANCE : blockedQueriesFrom a deja applique le seuil (position <= 3
 *     et >= 30 impressions) en amont, et ni la position ni les impressions
 *     n'existent en aval — re-deriver le seuil contre une donnee absente
 *     n'aurait produit qu'une regle morte.
 *  6. Sinon -> create.
 *
 * Les regles 1 a 3 avant la 4 parce qu'une mesure d'audience bat une mesure de
 * ressemblance : la premiere dit ce que Google fait du site, la seconde ce qu'on
 * en devine. La 4 avant la 5 parce que rafraichir une page qui existe repond
 * mieux a une requete deja gagnee que de ne rien faire.
 *
 * DEUX INTERDITS ABSOLUS, appliques ici et pas ailleurs :
 *
 *  - freshness 'blind' n'autorise AUCUN 'refresh'. Proposer d'ecraser une page
 *    dont on ne connait ni le titre ni le corps est le seul geste de ce chantier
 *    qui puisse detruire quelque chose. En regime aveugle la reponse est 'create'
 *    ou 'skip'. Ce n'est PAS un cas theorique : un inventaire de cinquante jours
 *    est 'blind' tout en portant ses entrees.
 *  - gsc.available === false n'invente aucun verdict. Les regles 1 a 3 ne sont
 *    meme pas evaluees, et la decision porte WITHOUT_SEARCH_CONSOLE.
 *
 * Et une degradation intermediaire : 'stale' n'autorise le rafraichissement que
 * s'il vient d'une mesure Search Console (regles 1 a 3). Un inventaire vieux de
 * trois semaines peut decrire un titre qui a change ; une ressemblance calculee
 * dessus ne suffit pas a justifier une reecriture, une position mesuree la
 * semaine derniere si.
 */
export function decideEditorialAction(
  target: EditorialTarget,
  inputs: ActionInputs,
): EditorialAction {
  const { gsc, inventory, cityTokens } = inputs
  const allowance = refreshAllowance(inventory.freshness)

  // Les cibles LEGITIMES, une fois pour toutes les regles. Une page desindexee
  // ou canonisee ailleurs n'en est pas une : la premiere a ete retiree de
  // l'index pour une raison qu'on ignore, la seconde renvoie deja son autorite
  // a une autre adresse, et depenser des tokens dessus n'obtiendrait rien.
  // Elles restent dans takenPaths — leur URL est occupee, la reservation de
  // slug s'en charge ; c'est de RAFRAICHISSEMENT qu'elles sont exclues.
  const byPath = refreshTargetsByPath(inventory.entries)
  const notes = contextNotes(gsc, inventory)

  if (allowance !== 'none' && gsc.available) {
    const measured =
      strikingDistanceRefresh(target, gsc, byPath, notes) ??
      cannibalizationRefresh(target, gsc, byPath, notes) ??
      lowCtrRefresh(target, gsc, byPath, notes)
    if (measured) return measured
  }

  if (allowance === 'all') {
    const resembling = identityRefresh(target, byPath, cityTokens, inventory.truncated, notes)
    if (resembling) return resembling
  }

  if (isBlockedQuery(target.focusKeyword, gsc.blockedQueries)) {
    return {
      kind: 'skip',
      reasons: [
        `« ${target.focusKeyword} » figure parmi les requetes que Search Console interdit d'ouvrir : le site la gagne deja, ou plusieurs de ses pages se la disputent.`,
        "Une page de plus sur cette requete prendrait ses signaux a celle qui la porte : renforcer l'existante est le seul gain disponible.",
        ...notes,
      ],
    }
  }

  // Rien ne s'oppose a une page de plus. Une collision d'adresse laissee ici par
  // un inventaire aveugle ou vieux n'est pas perdue pour autant : la reservation
  // de slug puis le gate de duplicat la voient tous les deux en aval, et eux ne
  // dependent pas de la fraicheur du crawl.
  return { kind: 'create' }
}

// ─── Ce que la fraicheur autorise ───────────────────────────────────────────

type RefreshAllowance = 'all' | 'gsc-only' | 'none'

function refreshAllowance(freshness: InventoryFreshness): RefreshAllowance {
  if (freshness.state === 'blind') return 'none'
  return freshness.state === 'stale' ? 'gsc-only' : 'all'
}

// ─── Regle 1 — la page a portee de la premiere page ─────────────────────────

function strikingDistanceRefresh(
  target: EditorialTarget,
  gsc: GscPlanningSignals,
  byPath: ReadonlyMap<string, InventoryEntry>,
  notes: readonly string[],
): RefreshAction | null {
  for (const opportunity of gsc.strikingDistance) {
    // Le test de SUJET n'est pas decoratif : sans lui, la premiere opportunite
    // du site ferait rafraichir une page sans rapport avec ce qu'on allait
    // ecrire. Une regle qui designe une cible au hasard est precisement le
    // scenario que ce module existe pour rendre impossible.
    if (!sameSubject(opportunity.query, target.focusKeyword)) continue

    const entry = byPath.get(pathOfPageUrl(opportunity.pageUrl))
    if (!entry) continue

    return refreshOn(
      entry,
      'content',
      [
        `Search Console : « ${opportunity.query} » est deja en position ${oneDecimal(opportunity.position)} sur ${addressOf(entry)}, avec ${opportunity.impressions} impression(s) et ${opportunity.clicks} clic(s).`,
        "Une page a portee de la premiere page se renforce. En ouvrir une seconde sur la meme requete lui prendrait les signaux qu'elle a mis des mois a acquerir.",
      ],
      notes,
    )
  }

  return null
}

// ─── Regle 2 — les pages qui se disputent deja la requete ───────────────────

function cannibalizationRefresh(
  target: EditorialTarget,
  gsc: GscPlanningSignals,
  byPath: ReadonlyMap<string, InventoryEntry>,
  notes: readonly string[],
): RefreshAction | null {
  for (const conflict of gsc.cannibalized) {
    if (!sameSubject(conflict.query, target.focusKeyword)) continue

    const winner = byPath.get(pathOfPageUrl(conflict.winner))
    if (!winner) continue

    const evidence = [
      `Search Console : ${conflict.pages.length} pages du site se disputent deja « ${conflict.query} » (${conflict.impressions} impression(s), ${conflict.clicks} clic(s)).`,
      `La mieux placee est ${addressOf(winner)} : c'est sur elle que le sujet se consolide.`,
    ]

    if (conflict.losers.length > 0) {
      // Les perdantes sont NOMMEES et RIEN d'autre. Le moteur ne les supprime
      // pas, ne les fusionne pas, ne les redirige pas : il les montre a
      // l'operateur, qui reste seul a pouvoir en decider.
      evidence.push(
        `Pages qui perdent leurs signaux sur cette requete : ${conflict.losers.join(', ')}.`,
        'Elles sont laissees INTACTES : aucune suppression, aucune fusion, aucune redirection.',
      )
    }

    return refreshOn(winner, 'content', evidence, notes)
  }

  return null
}

// ─── Regle 3 — la page vue et pas cliquee ───────────────────────────────────

function lowCtrRefresh(
  target: EditorialTarget,
  gsc: GscPlanningSignals,
  byPath: ReadonlyMap<string, InventoryEntry>,
  notes: readonly string[],
): RefreshAction | null {
  for (const page of gsc.lowCtrPages) {
    if (!sameSubject(page.topQuery, target.focusKeyword)) continue

    const entry = byPath.get(pathOfPageUrl(page.pageUrl))
    if (!entry) continue

    return refreshOn(
      entry,
      'metadata',
      [
        `Search Console : ${addressOf(entry)} a ete vue ${page.impressions} fois pour ${page.clicks} clic(s) sur « ${page.topQuery} » (CTR ${percent(page.ctr)}, position ${oneDecimal(page.position)}).`,
        "La page est trouvee et ignoree : c'est la promesse affichee dans les resultats qui echoue, pas le contenu.",
        'Portee limitee aux metadonnees : le corps, qui obtient deja ces impressions, reste intact.',
      ],
      notes,
    )
  }

  return null
}

// ─── Regle 4 — l'identite editoriale, a defaut de mesure ────────────────────

interface IdentityMatch {
  entry: InventoryEntry
  comparison: IdentityComparison
  codes: ReadonlySet<IdentityBlockingCode>
}

/**
 * La seule regle qui n'a besoin d'aucune mesure d'audience — donc la seule qui
 * puisse encore parler quand Search Console se tait.
 *
 * Elle ne refait AUCUNE comparaison : compareEditorialIdentity mesure,
 * judgeEditorialIdentity juge, et le durcissement des seuils sur un inventaire
 * tronque lui est deja connu. Le juge est interroge avec intent 'create', et
 * c'est delibere : il ignore la collision d'adresse quand on lui annonce un
 * rafraichissement, or cette collision est justement le signal le plus fort
 * dont cette regle dispose. On lui demande « cette page serait-elle un doublon
 * si on l'ecrivait ? » — la question exacte a laquelle la regle repond.
 */
function identityRefresh(
  target: EditorialTarget,
  byPath: ReadonlyMap<string, InventoryEntry>,
  cityTokens: readonly string[],
  truncated: boolean,
  notes: readonly string[],
): RefreshAction | null {
  const entries = [...byPath.values()]
  if (entries.length === 0) return null

  const comparisons = entries.map(entry => compareEditorialIdentity(target, entry, cityTokens))
  const verdict = judgeEditorialIdentity(comparisons, { intent: 'create', truncated })

  // Indexe par chemin, unique par construction : l'index UNIQUE (site_id, path)
  // de site_pages interdit deux entrees pour la meme adresse.
  const codesByPath = new Map<string, Set<IdentityBlockingCode>>()
  for (const blocking of verdict.blocking) {
    const codes = codesByPath.get(blocking.comparison.entryPath) ?? new Set<IdentityBlockingCode>()
    codes.add(blocking.code)
    codesByPath.set(blocking.comparison.entryPath, codes)
  }

  const matches: IdentityMatch[] = []
  for (const [index, comparison] of comparisons.entries()) {
    const codes = codesByPath.get(comparison.entryPath) ?? new Set<IdentityBlockingCode>()
    // sameFocusKeyword est lu sur la mesure et non dans les avertissements du
    // juge : celui-ci n'emet CANNIBALIZATION que si rien de plus grave n'a ete
    // dit sur la meme page, et il l'emet aussi sur une simple intention
    // partagee, que la regle 4 ne retient pas.
    if (codes.size === 0 && !comparison.sameFocusKeyword) continue
    matches.push({ entry: entries[index], comparison, codes })
  }

  if (matches.length === 0) return null

  // Trie plutot que « la premiere trouvee » : ce verdict est persiste et affiche,
  // et deux executions sur le meme inventaire doivent designer la meme page.
  matches.sort(byDecreasingStrength)
  const best = matches[0]

  return refreshOn(
    best.entry,
    identityScope(best),
    identityEvidence(target, best, truncated),
    notes,
  )
}

/**
 * Ce que la ressemblance justifie de reecrire.
 *
 * Une meta description qui fait doublon est un probleme de meta description :
 * les deux pages promettent la meme chose dans la SERP alors que leurs corps
 * different. Reecrire le texte couterait cher pour reparer une phrase — et
 * remettrait en jeu un corps que rien n'accuse.
 */
function identityScope(match: IdentityMatch): RefreshScope {
  if (match.comparison.pathCollision) return 'content'
  if (match.comparison.sameFocusKeyword) return 'content'
  return match.codes.has('TITLE_NEAR_DUPLICATE') ? 'content' : 'metadata'
}

function identityEvidence(
  target: EditorialTarget,
  match: IdentityMatch,
  truncated: boolean,
): string[] {
  const { comparison, entry, codes } = match
  const thresholds = identityThresholds(truncated)
  const evidence: string[] = []

  if (comparison.pathCollision) {
    evidence.push(`L'adresse ${entry.path} est deja occupee par une page en ligne : ${addressOf(entry)}.`)
  }
  if (comparison.sameFocusKeyword) {
    evidence.push(`Meme mot-cle principal que ${addressOf(entry)} : « ${target.focusKeyword} ».`)
  }
  if (codes.has('TITLE_NEAR_DUPLICATE')) {
    evidence.push(
      `Titre proche a ${score(comparison.titleSimilarity)} de ${quoteOrPath(entry)} (seuil ${score(thresholds.title)}, noms de communes retires).`,
    )
  }
  if (codes.has('META_NEAR_DUPLICATE')) {
    evidence.push(
      `Meta description proche a ${score(comparison.metaSimilarity)} de celle de ${addressOf(entry)} (seuil ${score(thresholds.meta)}).`,
    )
  }
  if (comparison.comparisonIsPartial) {
    // L'asymetrie est AVOUEE : sans cette ligne, un operateur lisant « 0.82 »
    // croirait avoir compare deux pages entieres.
    evidence.push(
      `Comparaison partielle : ${entry.path} n'a ete vue qu'en extrait, un score bas ne prouverait donc rien.`,
    )
  }

  evidence.push(
    identityScope(match) === 'content'
      ? "Mettre a jour cette page plutot que d'en ajouter une seconde sur le meme sujet."
      : 'Seuls le titre et la meta description sont reecrits : le corps de la page, lui, ne fait pas doublon.',
  )

  return evidence
}

/**
 * L'adresse d'abord, le mot-cle ensuite, le titre en dernier.
 *
 * Une collision de chemin est un FAIT, la ressemblance de titre une mesure : le
 * fait passe devant. Les egalites se tranchent sur le chemin pour que l'ordre ne
 * depende jamais de celui de l'inventaire.
 */
function byDecreasingStrength(a: IdentityMatch, b: IdentityMatch): number {
  const byRank = strengthOf(b) - strengthOf(a)
  if (byRank !== 0) return byRank

  const bySimilarity = b.comparison.titleSimilarity - a.comparison.titleSimilarity
  if (bySimilarity !== 0) return bySimilarity

  if (a.comparison.entryPath === b.comparison.entryPath) return 0
  return a.comparison.entryPath < b.comparison.entryPath ? -1 : 1
}

function strengthOf(match: IdentityMatch): number {
  if (match.comparison.pathCollision) return 3
  if (match.comparison.sameFocusKeyword) return 2
  return match.codes.has('TITLE_NEAR_DUPLICATE') ? 1 : 0
}

// ─── Regle 5 — la requete qu'on n'ouvre pas ─────────────────────────────────

/**
 * Appartenance STRICTE apres normalizeForMatch des deux cotes.
 *
 * Stricte, et pas un test de phrase : « taxi troyes » gagnee n'interdit pas
 * « taxi troyes gare », qui est un autre sujet et une autre page. Elargir cette
 * comparaison ferait taire le moteur sur toute une famille de requetes que
 * Search Console n'a jamais nommees.
 *
 * blockedQueries arrive deja en minuscules mais NON desaccentue : les deux cotes
 * repassent par normalizeForMatch, faute de quoi « plomberie a Troyes » ne
 * retrouverait jamais « plomberie à Troyes ».
 */
function isBlockedQuery(focusKeyword: string, blockedQueries: readonly string[]): boolean {
  const needle = normalizeForMatch(focusKeyword)
  if (!needle) return false
  return blockedQueries.some(query => normalizeForMatch(query) === needle)
}

// ─── Le contexte d'une decision ─────────────────────────────────────────────

/**
 * Ce qu'il faut savoir de la QUALITE des donnees sur lesquelles on vient de
 * trancher. Ces lignes accompagnent aussi bien un 'refresh' qu'un 'skip' : les
 * deux engagent l'operateur, et les deux meritent de dire sur quoi ils reposent.
 */
function contextNotes(gsc: GscPlanningSignals, inventory: SiteInventory): string[] {
  const notes: string[] = []

  if (!gsc.available) {
    notes.push(
      `Decide ${WITHOUT_SEARCH_CONSOLE} : aucune mesure d'audience n'etait disponible, la decision repose sur la seule identite editoriale. L'absence de donnee ne vaut pas absence de cannibalisation.`,
    )
  }

  if (inventory.freshness.state === 'stale') {
    notes.push(
      inventory.freshness.ageDays === null
        ? "Inventaire d'age inconnu : la page visee a pu changer depuis la derniere analyse."
        : `Inventaire vieux de ${inventory.freshness.ageDays} jour(s) : la page visee a pu changer depuis la derniere analyse.`,
    )
  }

  if (inventory.truncated) {
    notes.push(
      "Inventaire tronque : le crawl a plafonne, les seuils de ressemblance ont ete durcis en consequence et la page la plus proche du site n'a peut-etre pas ete regardee.",
    )
  }

  return notes
}

// ─── Fabrique du verdict ────────────────────────────────────────────────────

type RefreshAction = Extract<EditorialAction, { kind: 'refresh' }>

function refreshOn(
  entry: InventoryEntry,
  scope: RefreshScope,
  evidence: readonly string[],
  notes: readonly string[],
): RefreshAction {
  const action: RefreshAction = {
    kind: 'refresh',
    targetPath: entry.path,
    scope,
    evidence: [...evidence, ...notes],
  }

  // Absent, et non `undefined` explicite : une page du proprietaire n'a pas de
  // generation, et lui en inventer une ferait chercher une ligne qui n'existe pas.
  if (entry.generationId) action.targetGenerationId = entry.generationId

  return action
}

// ─── Interne ────────────────────────────────────────────────────────────────

/**
 * Les entrees qu'un rafraichissement peut viser, indexees par chemin normalise.
 *
 * UN index pour les quatre regles : les trois premieres y resolvent une URL
 * Search Console, la quatrieme y prend ses candidats a comparer. Filtrer a un
 * seul endroit est ce qui garantit qu'une page desindexee ne devienne pas une
 * cible par la porte d'a cote.
 */
function refreshTargetsByPath(
  entries: readonly InventoryEntry[],
): ReadonlyMap<string, InventoryEntry> {
  const byPath = new Map<string, InventoryEntry>()

  for (const entry of entries) {
    if (!isRefreshTarget(entry)) continue
    const path = normalizeInventoryPath(entry.path)
    if (!path) continue
    if (!byPath.has(path)) byPath.set(path, entry)
  }

  return byPath
}

/**
 * Une page desindexee ou canonisee ailleurs n'est pas une cible.
 *
 * La premiere a ete retiree de l'index pour une raison que l'inventaire ne
 * connait pas — mentions legales, page de remerciement, doublon assume — et la
 * reecrire ne la ferait pas remonter. La seconde declare elle-meme que
 * l'original est ailleurs : y depenser des tokens revient a rediger pour une
 * adresse qui renvoie son autorite a une autre.
 */
function isRefreshTarget(entry: InventoryEntry): boolean {
  if (entry.noindex) return false

  const canonical = normalizeInventoryPath(entry.canonicalPath)
  if (!canonical) return true
  return canonical === normalizeInventoryPath(entry.path)
}

/**
 * Le chemin d'une URL Search Console, sous la forme de l'inventaire.
 *
 * `new URL` echoue sur un chemin relatif — c'est un cas normal, pas une erreur :
 * gsc_performance stocke des URL absolues, mais un appelant de test ou une ligne
 * ancienne peuvent porter '/taxi-troyes'. Les deux formes doivent tomber sur la
 * meme chaine, sinon la regle ne resout jamais sa cible et se tait sans le dire.
 */
function pathOfPageUrl(pageUrl: string): string {
  const raw = (pageUrl ?? '').trim()
  if (!raw) return ''

  try {
    return normalizeInventoryPath(new URL(raw).pathname)
  } catch {
    return normalizeInventoryPath(raw)
  }
}

/**
 * Deux libelles designent-ils le meme sujet ?
 *
 * Egalite d'abord, puis inclusion de phrase DANS LES DEUX SENS : « taxi troyes »
 * et « taxi troyes aeroport » parlent de la meme chose a l'echelle d'une page,
 * et exiger l'egalite stricte ferait manquer la quasi-totalite des requetes
 * reelles, qui sont plus longues que le mot-cle qu'on cible.
 */
function sameSubject(query: string, focusKeyword: string): boolean {
  const left = normalizeForMatch(query)
  const right = normalizeForMatch(focusKeyword)
  if (!left || !right) return false
  if (left === right) return true
  return containsKeywordPhrase(left, right) || containsKeywordPhrase(right, left)
}

/** L'URL quand on l'a, le chemin sinon : une entree amorcee n'a jamais ete crawlee. */
function addressOf(entry: InventoryEntry): string {
  return entry.url || entry.path
}

/** Le titre en ligne quand il est connu, l'adresse sinon. */
function quoteOrPath(entry: InventoryEntry): string {
  const title = (entry.title ?? '').trim()
  return title ? `« ${title} »` : addressOf(entry)
}

/** Deux decimales : un score de similarite se lit, il ne se calcule pas a l'ecran. */
function score(value: number): string {
  return value.toFixed(2)
}

function oneDecimal(value: number): string {
  return value.toFixed(1)
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)} %`
}
