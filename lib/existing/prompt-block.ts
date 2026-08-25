// ─────────────────────────────────────────────────────────────────────────────
// Bloc de prompt « conscience de l'existant »
// SEO Engine - UN bloc, la ou il y en avait deux qui se contredisaient.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce que ce module remplace, verifie dans le depot avant d'etre ecrit :
//
//   - lib/ai/page-types.ts (~696-698), bloc « ANTI-DOUBLON (CRITIQUE) » :
//     `existingSlugs.slice(0, 30)` et `existingKeywords.slice(0, 30)`.
//   - lib/ai/full-rag-context.ts (~556-570), buildAntiDuplicateBlock :
//     les MEMES listes, `slice(0, 20)`, sous un autre titre.
//
// Le meme corpus partait DEUX FOIS dans le MEME prompt, a deux troncatures
// differentes, sous deux intitules differents. Un modele qui lit trente slugs
// puis vingt slugs de la meme base n'apprend pas deux fois plus : il apprend
// qu'on ne sait pas ce qu'on lui demande, et il reste incapable de dire en quoi
// sa page differe des autres — parce qu'un slug ne porte ni titre, ni meta, ni
// promesse editoriale.
//
// Ce bloc dit donc autre chose : huit pages REELLES, avec leur adresse, leur
// titre et leur meta tels qu'ils sont en ligne, et l'ordre d'ecrire autrement.
// Huit voisins pertinents valent mieux que trente slugs pris dans l'ordre de la
// base.
//
// Et surtout, il ne demande plus de slug. L'adresse est deja reservee en base
// (lib/existing/reservation.ts) avant le premier token : le modele la RECOIT.
//
// Pur : aucune IO, aucune horloge, aucun acces base. Il se teste en comparant
// des chaines.

import type { EditorialAction } from '@/src/core/domain/existing/action'
import type {
  InventoryEntry,
  InventoryFreshness,
} from '@/src/core/domain/existing/inventory'

/**
 * Le nombre de pages voisines montrees au modele.
 *
 * Ce n'est pas une troncature de confort : c'est la limite au-dela de laquelle
 * la consigne se dilue. Les entrees arrivent DEJA classees par proximite
 * semantique — c'est le seul classement qui rende un plafond defendable, la ou
 * les trente premiers slugs de la base ne devaient leur presence qu'a leur date
 * de creation. Le bloc DIT combien de pages ont ete trouvees quand il en montre
 * moins : une limite tue est une limite qu'on cesse de discuter.
 */
export const MAX_PROMPT_NEIGHBOURS = 8

export interface AwarenessBlockInput {
  /** Deja pose sur la ligne generations. Le modele ne le choisit plus. */
  reservedSlug: string
  /** Classees par proximite decroissante par l'appelant. */
  neighbours: readonly InventoryEntry[]
  action: EditorialAction
  freshness: InventoryFreshness
}

/** Un titre et ses lignes. Le NUMERO n'est pas ici : voir l'assemblage. */
interface Section {
  title: string
  body: string[]
}

/**
 * Le bloc, en un seul morceau.
 *
 * Rendu comme une suite de sections numerotees plutot que comme un paragraphe :
 * les consignes que les modeles tiennent le mieux sont celles qu'ils peuvent
 * recompter.
 *
 * Les numeros sont donc CALCULES a l'assemblage, jamais ecrits dans les
 * sections. Deux d'entre elles sont conditionnelles — le rafraichissement et la
 * portee de la liste — et un numero fige aurait produit un bloc allant de 3 a 5
 * sur le cas le plus courant. Une liste qui saute un numero apprend au lecteur,
 * humain ou non, qu'une consigne lui a ete cachee.
 */
export function buildExistingAwarenessBlock(input: AwarenessBlockInput): string {
  const sections: Section[] = [
    slugSection(input.reservedSlug),
    neighboursSection(input.neighbours),
    distinctionSection(input.neighbours.length > 0),
  ]

  const refresh = refreshSection(input.action)
  if (refresh) sections.push(refresh)

  const scope = freshnessSection(input.freshness)
  if (scope) sections.push(scope)

  return [
    "CONSCIENCE DE L'EXISTANT (contraintes fermes)",
    ...sections.map((section, index) => [`${index + 1}. ${section.title}`, ...section.body].join('\n')),
  ].join('\n\n')
}

// ─── L'adresse ──────────────────────────────────────────────────────────────

/**
 * L'inversion du chantier tient dans cette section.
 *
 * Le slug etait une sortie du modele, arbitree apres coup contre l'existant —
 * donc arbitree APRES avoir paye la page. Il est desormais reserve en base
 * avant le premier token, et l'index unique partiel (site_id, slug) en a
 * garanti l'unicite. Toute autre valeur ecrite ici serait ignoree par
 * l'appelant : le dire au modele evite qu'il depense son attention a
 * fabriquer une adresse qui ne sera pas lue.
 */
function slugSection(reservedSlug: string): Section {
  return {
    title: 'ADRESSE DE LA PAGE — FIXE, NON NEGOCIABLE',
    body: [
      `Le slug de cette page est deja reserve en base : ${reservedSlug}`,
      'Recopie-le tel quel dans le champ "slug". Ne le reformule pas, ne l\'allonge',
      'pas, ne lui ajoute pas la ville : elle y est deja si elle doit y etre. Toute',
      'autre valeur sera ignoree, et le contenu que tu ecris sera publie a CETTE',
      'adresse.',
    ],
  }
}

// ─── Les voisines ───────────────────────────────────────────────────────────

function neighboursSection(neighbours: readonly InventoryEntry[]): Section {
  const shown = neighbours.slice(0, MAX_PROMPT_NEIGHBOURS)

  if (shown.length === 0) {
    // Ne pas mentir par omission : une liste vide n'est pas la preuve d'un site
    // vide, et un modele a qui l'on ne dit rien suppose qu'il n'y a rien.
    return {
      title: 'PAGES DEJA EN LIGNE SUR CE SITE',
      body: [
        "Aucune page proche n'a ete trouvee dans l'inventaire. Cela ne prouve pas que",
        'le site est vide : reste general la ou tu ne sais pas.',
      ],
    }
  }

  return {
    // La troncature est ANNONCEE, avec les deux nombres. C'est la difference
    // entre un plafond assume et les `slice(0, 30)` silencieux que ce bloc
    // remplace : un lecteur du prompt doit pouvoir voir ce qu'on ne montre pas.
    title:
      neighbours.length > shown.length
        ? `PAGES DEJA EN LIGNE SUR CE SITE (les ${shown.length} plus proches, sur ${neighbours.length} trouvees)`
        : `PAGES DEJA EN LIGNE SUR CE SITE (${shown.length})`,
    body: shown.map(describeNeighbour),
  }
}

/**
 * Une page voisine, avec ce qu'elle promet DEJA au lecteur.
 *
 * Le titre et la meta sont montres tels qu'ils sont en ligne, jamais resumes :
 * c'est contre eux que la page en cours doit se distinguer, et un resume les
 * rendrait faussement differents. Ils ne sont pas non plus tronques — un titre
 * fait soixante caracteres et une meta cent soixante.
 */
function describeNeighbour(entry: InventoryEntry): string {
  // L'URL quand on l'a, le chemin sinon : une ligne d'inventaire amorcee depuis
  // une generation peut n'avoir jamais ete crawlee. Montrer une URL vide ferait
  // croire a une page inatteignable.
  const address = entry.url || entry.path

  return [
    `- ${address}`,
    `  title : ${quoteOrUnknown(entry.title)}`,
    `  meta  : ${quoteOrUnknown(entry.metaDescription)}`,
  ].join('\n')
}

/** « inconnu » plutot que des guillemets vides, qui se lisent « vide ». */
function quoteOrUnknown(value: string | null): string {
  const trimmed = (value ?? '').trim()
  return trimmed ? `« ${trimmed} »` : 'inconnu'
}

// ─── L'ordre de differer ────────────────────────────────────────────────────

/**
 * L'interdiction de deriver la meta du titre est NOMMEE.
 *
 * Sur un site mono-service multi-villes, une meta fabriquee a partir du titre
 * rend deux pages soeurs quasi identiques par construction : meme service, meme
 * phrase, seule la commune change. C'est le cas que META_NEAR_DUPLICATE attrape
 * en aval, et il vaut mieux ne pas l'ecrire que le refuser apres l'avoir paye.
 */
function distinctionSection(hasNeighbours: boolean): Section {
  const lines: string[] = []

  if (hasNeighbours) {
    lines.push(
      "- Le title doit etre distinct de CHACUN des titres listes ci-dessus : pas la",
      '  meme promesse avec un autre nom de commune.',
      '- La metaDescription doit etre distincte de CHACUNE des metas listees.',
      "- L'angle de la page doit etre distinct : si une page voisine traite deja le",
      '  sujet, prends la question que ces pages ne traitent pas.',
    )
  }

  lines.push(
    "- La metaDescription est REDIGEE, jamais derivee du title. Ne la fabrique pas",
    "  en collant le titre, le nom de l'entreprise et la ville : deux pages soeurs",
    '  produisent alors la meme phrase a un mot pres.',
  )

  return { title: 'CE QUE TU DOIS ECRIRE DE DIFFERENT', body: lines }
}

// ─── Le rafraichissement ────────────────────────────────────────────────────

/**
 * Rien pour 'create', et rien non plus pour 'skip'.
 *
 * Une decision 'skip' n'arrive pas jusqu'au generateur : la page n'est pas
 * ecrite du tout. Si elle y arrivait malgre tout, ce bloc se tait plutot que
 * d'inventer une consigne — un prompt qui parle d'une page qu'on a decide de
 * ne pas ecrire est une contradiction que le modele resoudra tout seul, et
 * probablement mal.
 */
function refreshSection(action: EditorialAction): Section | null {
  if (action.kind !== 'refresh') return null

  const lines = [
    `Cette page n'est pas nouvelle : elle met a jour ${action.targetPath}.`,
    action.scope === 'metadata'
      ? "Portee : METADONNEES. Le title et la metaDescription sont a reecrire ; le corps de la page reste celui qui est en ligne."
      : "Portee : CONTENU. Le corps de la page est a reecrire, en conservant la promesse que l'adresse tient deja aupres de ses lecteurs.",
  ]

  if (action.evidence.length > 0) {
    lines.push('Ce qui a motive cette mise a jour :')
    // Les preuves sont recopiees telles quelles : elles viennent de Search
    // Console et nommer un chiffre approximatif serait pire que se taire.
    lines.push(...action.evidence.map((reason: string) => `- ${reason}`))
  }

  return { title: "MISE A JOUR D'UNE PAGE EXISTANTE", body: lines }
}

// ─── Ce que cette liste ne couvre pas ───────────────────────────────────────

/**
 * Quand la vue de l'existant est partielle, le bloc le DIT.
 *
 * Un modele a qui l'on presente huit pages sans reserve conclut qu'il connait
 * le site. Nommer la degradation ne bloque rien — 'blind' n'est jamais un motif
 * de refus — mais elle change ce qu'on peut raisonnablement affirmer dans une
 * page.
 */
function freshnessSection(freshness: InventoryFreshness): Section | null {
  if (freshness.state === 'fresh') return null

  const prudence =
    "Reste prudent : n'affirme pas que le site ne traite pas encore un sujet, et ne " +
    "renvoie pas vers une page dont l'existence n'est pas listee ci-dessus."

  const constat =
    freshness.state === 'stale'
      ? `${sinceWhen(freshness)} : des pages publiees depuis peuvent manquer.`
      : freshness.blindReason === 'jamais-analyse'
        ? "Ce site n'a jamais ete analyse : la liste ci-dessus ne dit rien de ce qui est reellement en ligne."
        : freshness.blindReason === 'aucune-page-trouvee'
          ? "La derniere analyse n'a rapporte aucune page : la liste ci-dessus ne dit rien de ce qui est reellement en ligne."
          : `${sinceWhen(freshness)} : la liste ci-dessus decrit un site qui a pu changer entierement depuis.`

  return { title: 'PORTEE DE CETTE LISTE', body: [constat, prudence] }
}

/** Un age en jours quand on l'a, sinon une phrase qui ne fait pas semblant. */
function sinceWhen(freshness: InventoryFreshness): string {
  return freshness.ageDays === null
    ? "La date de la derniere analyse du site est inconnue"
    : `La derniere analyse du site date de ${freshness.ageDays} jour(s)`
}
