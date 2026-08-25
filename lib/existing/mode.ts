// ─────────────────────────────────────────────────────────────────────────────
// Mode d'exploitation du gate anti-duplicat
// SEO Engine - Un drapeau, une lecture, un fichier.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le gate anti-duplicat est livre en DEUX temps. D'abord il observe : il
// compare chaque page produite a ce qui est en ligne, il persiste son verdict
// dans generations.duplicate_verdict, il l'affiche — et il ne retient aucune
// page. Ensuite seulement, quand le rejeu (scripts/replay-duplicate-gate.ts) a
// montre sur les donnees reelles du site combien de pages seraient tombees, la
// barriere se ferme. Ce fichier porte l'interrupteur qui separe les deux temps,
// et rien d'autre.
//
// LE DEFAUT EST 'observe', ET C'EST UNE REGLE DE SURETE, PAS UNE COMMODITE.
// Variable absente, vide, mal orthographiee, ou porteuse d'une valeur inconnue :
// 'observe'. Le bug empeche est un arret de production silencieux — un
// deploiement qui oublie SEO_DUPLICATE_GATE se mettrait a refuser des pages
// sans que personne ne l'ait decide, et le fait ne se lirait que des jours plus
// tard sur un compteur de pages publiees. C'est la meme regle que le bloc catch
// de runValidationGate applique deja a ses validateurs (lib/pipeline/gate.ts,
// « a broken validator must not silently become a blanket rejection ») :
// un composant defaillant degrade, il ne rejette pas en bloc. Traiter ce
// drapeau comme un booleen a defaut ferme le retournerait exactement.
//
// L'ENVIRONNEMENT ENTRE PAR LA PORTE. `env` est un parametre avec un defaut, et
// le mode obtenu se passe ensuite en parametre a qui en depend
// (`GateInput.duplicateMode`, dont `duplicateGateMode()` n'est que la valeur par
// defaut). Un composant qui lirait process.env au fond de sa logique ne serait
// testable qu'en polluant le processus — et un test qui pollue le processus
// fuit dans le suivant. Meme patron que freshnessOf(..., now) : l'ambiant est
// donne, jamais capte.

/**
 * Ce que le gate fait de son verdict de duplicat : il l'ecrit et laisse passer,
 * ou il l'ecrit et retient la page.
 *
 * `DuplicateVerdict.mode` (src/core/domain/existing/verdict.ts) repete cette
 * union plutot que de l'importer, et c'est volontaire : le domaine ne depend pas
 * de lib/. Les deux listes sont identiques et le doivent rester — c'est le mode
 * persiste qui distingue une observation d'un blocage reel au moment de mesurer.
 */
export type DuplicateGateMode = 'observe' | 'block'

/**
 * L'environnement, reduit a ce que ce module en lit.
 *
 * PAS `NodeJS.ProcessEnv`, et le compilateur l'a tranche : Next.js augmente
 * cette interface avec un `NODE_ENV` OBLIGATOIRE, si bien que
 * `duplicateGateMode({})` ne compile pas (« Property 'NODE_ENV' is missing in
 * type '{}' »). Un test ne pourrait alors decrire un environnement sans
 * variable qu'en fabriquant un faux NODE_ENV, ou en posant un cast — deux
 * facons de rendre menteur le seul test qui compte ici. La forme structurelle
 * accepte `process.env` sans conversion et `{}` sans ceremonie.
 *
 * Non exportee : la surface publique de ce fichier est un type et une fonction.
 * Un appelant qui fabrique un environnement passe un litteral.
 */
type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * Lit SEO_DUPLICATE_GATE. Rend 'block' pour cette valeur et pour elle seule ;
 * tout le reste rend 'observe'.
 *
 * La casse et les espaces de bord sont normalises AVANT la comparaison, et ce
 * n'est pas de la tolerance decorative : `SEO_DUPLICATE_GATE=block ` avec une
 * espace finale — ce que produit couramment une ligne de .env ou un champ de
 * panneau d'hebergeur — a ete pose par un operateur qui a decide de bloquer.
 * Le lui refuser sans un mot rendrait la bascule inexplicable. La normalisation
 * ne fait jamais qu'aider a RECONNAITRE 'block' : elle n'admet aucune autre
 * valeur, donc 'blok', 'true' ou '1' restent 'observe'.
 */
export function duplicateGateMode(env: EnvSource = process.env): DuplicateGateMode {
  return env.SEO_DUPLICATE_GATE?.trim().toLowerCase() === 'block' ? 'block' : 'observe'
}
