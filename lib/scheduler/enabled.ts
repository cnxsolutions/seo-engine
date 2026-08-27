// ─────────────────────────────────────────────────────────────────────────────
// Interrupteur de demarrage du planificateur
// SEO Engine - Un drapeau, une lecture, un fichier.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier porte la seule chose qui separe « le serveur web est allume » de
// « le moteur redige, publie chez des clients reels et re-crawle leurs
// serveurs ». Rien d'autre.
//
// LE DEFAUT EST LE REFUS, ET C'EST UNE REGLE DE SURETE. Variable absente, vide,
// mal orthographiee, ou porteuse d'une valeur inconnue : pas de planificateur.
// Le bug empeche est un demarrage que personne n'a decide. Sans ce drapeau,
// tout process Node qui charge instrumentation.ts arme
// `cron.schedule('*/15 * * * *')` (lib/scheduler/cron.ts:186) et, dans le quart
// d'heure, le premier tick fait TROIS choses irreversibles chez autrui : il
// lance les generations des creneaux echus (tokens depenses), il laisse partir
// SEULES les pages des campagnes portant auto_publish sur le site du client
// (cron.ts:1629 et la file differee de lib/db.ts:335-346), et il re-crawle
// jusqu'a 300 pages des sites clients pour renouveler les cycles echus
// (lib/scheduler/cycle-manager.ts:62-66). Le meme fichier est charge par
// `npm run dev` : un poste de developpement qui detient le .env de production
// lance la production. Aucun de ces trois effets ne se defait.
//
// LE SENS EST INVERSE DE lib/existing/mode.ts:58-74, ET LA FORME EST LA MEME.
// La-bas, le defaut LAISSE TRAVAILLER le composant ('observe') parce qu'un
// composant qui mesure et laisse passer ne coute rien a personne : le degat y
// serait un arret de production silencieux. Ici le defaut ARRETE, parce que ce
// composant-ci ne mesure pas — il depense de l'argent et il ecrit sur les sites
// de clients. Entre « le moteur n'a pas tourne cette nuit » et « le moteur a
// publie seul chez un client », seule la premiere se rattrape le matin. Meme
// patron de lecture, verdict par defaut oppose, pour la meme raison de fond :
// l'etat par defaut doit etre le moins dangereux, pas le plus utile.
//
// L'ENVIRONNEMENT ENTRE PAR LA PORTE. `env` est un parametre avec un defaut, et
// le booleen obtenu se passe ensuite a qui en depend. Un composant qui lirait
// process.env au fond de sa logique ne serait testable qu'en polluant le
// processus — et un test qui pollue le processus fuit dans le suivant.

/**
 * L'environnement, reduit a ce que ce module en lit.
 *
 * PAS `NodeJS.ProcessEnv`, et le compilateur l'a deja tranche en
 * lib/existing/mode.ts:44-57 : Next.js augmente cette interface avec un
 * `NODE_ENV` OBLIGATOIRE, si bien que `schedulerEnabled({})` ne compilerait pas
 * (« Property 'NODE_ENV' is missing in type '{}' »). Or l'environnement VIDE est
 * exactement le cas qui compte ici — la machine fraiche, le conteneur sans
 * `--env-file`, le collegue qui vient de cloner. Le decrire ne doit exiger ni
 * faux NODE_ENV ni cast : deux facons de rendre menteur le seul test qui protege
 * le premier demarrage. La forme structurelle accepte `process.env` sans
 * conversion et `{}` sans ceremonie.
 *
 * Non exportee : la surface publique de ce fichier est une fonction. Un appelant
 * qui fabrique un environnement passe un litteral. Meme type structurel qu'en
 * lib/config/preflight.ts, volontairement redeclare : deux modules de
 * configuration independants ne doivent pas se tenir par un import juste pour
 * partager six mots de type.
 */
type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * Lit ENABLE_SCHEDULER. Rend true pour la valeur 'true' et pour elle seule ;
 * tout le reste rend false.
 *
 * PAS de lecture booleenne large, et c'est le coeur de la regle : 'yes', '1',
 * 'on', 'ture' rendent false. Une valeur approchante n'est pas une decision
 * lisible — elle est le plus souvent un copier-coller depuis un autre produit ou
 * une faute de frappe, et interpreter une faute de frappe comme un accord, c'est
 * armer la publication autonome sur une hesitation. L'operateur qui voulait
 * vraiment ouvrir n'a qu'un mot a corriger ; le deploiement qui a derape n'a
 * rien envoye chez personne.
 *
 * La casse et les espaces de bord sont normalises AVANT la comparaison, et ce
 * n'est pas de la tolerance decorative : `ENABLE_SCHEDULER=true ` avec une
 * espace finale — ce que produit couramment une ligne de .env ou un champ de
 * panneau d'hebergeur — a ete pose par un operateur qui a decide d'allumer. Lui
 * repondre « eteint » sans un mot rendrait le refus inexplicable, et c'est un
 * refus qu'on ne diagnostique qu'en constatant, des heures plus tard, que rien
 * n'a ete produit. La normalisation ne fait jamais qu'aider a RECONNAITRE
 * 'true' : elle n'admet aucune autre valeur.
 */
export function schedulerEnabled(env: EnvSource = process.env): boolean {
  return env.ENABLE_SCHEDULER?.trim().toLowerCase() === 'true'
}
