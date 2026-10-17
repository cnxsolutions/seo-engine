// ─────────────────────────────────────────────────────────────────────────────
// Mode d'exploitation du gate anti-duplicat
// SEO Engine - Un drapeau, une lecture, un fichier.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le gate anti-duplicat a ete livre en DEUX temps : d'abord il observait — il
// comparait chaque page a ce qui est en ligne, persistait son verdict dans
// generations.duplicate_verdict et l'affichait, sans retenir aucune page —
// puis la barriere devait se fermer une fois le volume mesure. Ce fichier porte
// l'interrupteur entre les deux, et rien d'autre.
//
// LE DEFAUT EST 'block' DEPUIS LE 2026-10-17, ET C'EST LE RENVERSEMENT VOULU.
// Variable absente, vide, mal orthographiee, ou porteuse d'une valeur inconnue :
// 'block'. Seule la valeur explicite 'observe' rouvre l'observation.
//
// Le defaut 'observe' protegeait d'un arret de production silencieux : une page
// refusee partait en `rejected` et attendait un humain, si bien qu'un
// deploiement qui aurait bloque par megarde aurait cesse de publier sans que
// personne ne l'ait decide. Cette crainte a recu sa reponse : une page retenue
// est desormais REGENEREE, le doublon nomme dans ses corrections
// (lib/scheduler/cron.ts, `runCampaignNow`), et seule une page qui echoue trois
// fois attend un humain. Bloquer coute une tentative, plus une page ; publier
// un quasi-doublon de ce que le site porte deja est devenu le pire des deux
// risques, et c'est donc lui que le defaut ecarte. La regle de surete s'inverse
// avec : une valeur illisible ne doit jamais rouvrir la porte aux doublons sans
// que personne ne l'ait decide.
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
 * Lit SEO_DUPLICATE_GATE. Rend 'observe' pour cette valeur et pour elle seule ;
 * tout le reste — absence comprise — rend 'block'.
 *
 * La casse et les espaces de bord sont normalises AVANT la comparaison, et ce
 * n'est pas de la tolerance decorative : `SEO_DUPLICATE_GATE=observe ` avec une
 * espace finale — ce que produit couramment une ligne de .env ou un champ de
 * panneau d'hebergeur — a ete pose par un operateur qui a decide d'observer.
 * Le lui refuser sans un mot rendrait la bascule inexplicable. La normalisation
 * ne fait jamais qu'aider a RECONNAITRE 'observe' : elle n'admet aucune autre
 * valeur, donc 'observ', 'false', '0' ou 'off' restent 'block'.
 */
export function duplicateGateMode(env: EnvSource = process.env): DuplicateGateMode {
  return env.SEO_DUPLICATE_GATE?.trim().toLowerCase() === 'observe' ? 'observe' : 'block'
}
