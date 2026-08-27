// ─────────────────────────────────────────────────────────────────────────────
// Pre-vol de configuration
// SEO Engine - Ce que l'environnement rend possible, avant qu'un tick ne parte.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier repond a une seule question, et il y repond SANS RIEN TOUCHER :
// avec l'environnement tel qu'il est, est-ce que demarrer le planificateur peut
// produire autre chose que du degat ou du vide ? Aucune E/S, aucun Supabase,
// aucun reseau, aucune horloge. Une fonction pure prend un objet et rend une
// liste de constats. Ce qui demande la base — croiser campaigns.ai_model avec la
// presence d'ANTHROPIC_API_KEY, compter les creneaux echus — appartient a la
// route qui lit deja la base, pas ici : un module de configuration qui ouvre une
// connexion devient un module qui echoue au demarrage pour une raison sans
// rapport avec la configuration.
//
// L'ENVIRONNEMENT ENTRE PAR LA PORTE. `env` est un parametre avec un defaut,
// jamais capte au fond de la logique. Meme patron que duplicateGateMode
// (lib/existing/mode.ts:25-31) : un composant qui lirait process.env au creux de
// son code ne serait testable qu'en polluant le processus, et un test qui pollue
// le processus fuit dans le suivant.
//
// CE RAPPORT NE PORTE JAMAIS UNE VALEUR. Que des noms de variables, des
// booleens et des phrases ecrites ici en dur. Il est destine a traverser HTTP au
// lot 3, et SITE_SAFE_COLUMNS (lib/db.ts:28-39) rappelle ce que coute une valeur
// echappee dans une reponse : c'est un `select('*')` qui a mis un mot de passe
// d'application WordPress et un jeton d'ecriture GitHub dans le corps de
// GET /api/sites. Une cle de service Supabase dans un rapport de pre-vol serait
// la meme faute, en pire. La longueur elle-meme ne sort pas : elle sert a
// trancher `ok`, elle n'est pas rendue.

/**
 * Un controle et son verdict.
 *
 * `level` separe deux natures de constat, et la separation est la seule chose
 * qui rend le rapport actionnable :
 *  - 'bloquant' : sans cette variable, demarrer le planificateur ne peut RIEN
 *    produire de bon — soit rien du tout, soit du degat. `configIsSafeToRun`
 *    rend false.
 *  - 'recommande' : le moteur tourne, mais une capacite manque et son absence se
 *    lira ailleurs, plus tard, sous une autre forme.
 *
 * `why` nomme le bug empeche, pas la variable : « OPENAI_API_KEY absente » ne
 * dit rien a l'operateur de 3h du matin, « chaque creneau brule une tentative
 * puis passe failed » lui dit quoi faire.
 */
export interface ConfigCheck {
  name: string
  level: 'bloquant' | 'recommande'
  ok: boolean
  why: string
}

/**
 * L'environnement, reduit a ce que ce module en lit.
 *
 * PAS `NodeJS.ProcessEnv`, et le compilateur l'a deja tranche ailleurs : Next.js
 * augmente cette interface avec un `NODE_ENV` OBLIGATOIRE, si bien que
 * `configReport({})` ne compilerait plus (« Property 'NODE_ENV' is missing in
 * type '{}' »). Le seul test qui compte ici est justement celui de
 * l'environnement VIDE — celui de la machine fraiche, du conteneur sans
 * `--env-file`, du collegue qui vient de cloner. Le decrire ne doit pas exiger
 * de fabriquer un faux NODE_ENV ni de poser un cast : deux facons de rendre
 * menteur le test qui protege le premier demarrage. La forme structurelle
 * accepte `process.env` sans conversion et `{}` sans ceremonie.
 *
 * Non exportee : la surface publique de ce fichier est un type de constat et
 * deux fonctions. Un appelant qui fabrique un environnement passe un litteral.
 */
type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * La longueur minimale du secret d'acces.
 *
 * VOLONTAIREMENT RECOPIEE, PAS IMPORTEE. La meme valeur vit dans proxy.ts:31 et
 * les deux DOIVENT rester identiques — un pre-vol qui declare l'instance saine
 * pendant que la barriere repond 503 est pire qu'aucun pre-vol. Mais proxy.ts
 * est un fichier racine reserve de Next 16 : il est compile pour son propre
 * runtime, avec son propre `export const config`, et l'importer depuis lib/ le
 * tirerait comme module applicatif ordinaire dans le graphe de demarrage
 * d'instrumentation.ts et dans celui d'une route. Un fichier de plate-forme ne
 * s'importe pas ; on paie ici une duplication de quatre caracteres pour ne pas
 * payer un graphe de modules melange.
 *
 * Si cette valeur change, changer proxy.ts:31 dans le meme commit.
 */
const MIN_SECRET_LENGTH = 16

/**
 * Vrai quand la variable porte autre chose que du vide.
 *
 * Une chaine d'espaces compte comme ABSENTE, et c'est la regle sure : une ligne
 * `NEXT_PUBLIC_SUPABASE_URL= ` passe le `!value` de requireEnv
 * (lib/supabase.ts:3-9) puis casse plus loin, dans le client Supabase, avec un
 * message qui ne nomme plus la variable. Autant le dire ici.
 */
function isSet(value: string | undefined): boolean {
  return (value ?? '').trim().length > 0
}

/**
 * L'etat de la configuration, un constat par variable, dans un ordre stable
 * (bloquants d'abord) pour qu'un affichage n'ait rien a trier.
 *
 * Cette fonction ne sait rien du planificateur ni de la base : elle ne dit pas
 * « on peut demarrer », elle dit « voila ce qui est pose et voila ce que chaque
 * absence casse ». La decision de demarrer appartient a l'appelant, qui croise
 * ce rapport avec le drapeau ENABLE_SCHEDULER.
 */
export function configReport(env: EnvSource = process.env): ConfigCheck[] {
  return [
    // ─── Bloquants ───────────────────────────────────────────────────────────
    //
    // Les deux variables Supabase portent le MEME bug empeche, et ce n'est pas
    // celui qu'on croit. Sans elles, le tick ne detruit rien : la chaine
    // d'appels le prouve. runDueEditorialSlots appelle listDueEditorialSlots
    // (lib/scheduler/cron.ts:479) sans catch ; cet appel passe par
    // createServiceClient (lib/supabase.ts:18-23) qui leve AVANT toute lecture
    // de creneau ; la rejection est absorbee par le Promise.allSettled de
    // cron.ts:193-198 ; claimEditorialSlot n'est jamais atteint, aucun
    // attempt_count n'est incremente. Le danger n'est donc pas la destruction,
    // c'est le NON-EVENEMENT qui se journalise comme un succes, quart d'heure
    // apres quart d'heure.
    {
      name: 'NEXT_PUBLIC_SUPABASE_URL',
      level: 'bloquant',
      ok: isSet(env.NEXT_PUBLIC_SUPABASE_URL),
      why:
        "Sans elle, le client de service leve avant la premiere lecture et chaque tick du planificateur " +
        "se termine sans avoir rien lu ni rien ecrit — aucun creneau reclame, aucun compteur de tentative " +
        "touche, et un journal de fin de tick identique a celui d'un tick reussi. Le bug empeche est un " +
        "moteur qui a l'air de tourner et ne produit rien pendant des jours.",
    },
    {
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      level: 'bloquant',
      ok: isSet(env.SUPABASE_SERVICE_ROLE_KEY),
      why:
        "Meme defaut que l'URL, et elle seule ouvre l'ecriture cote serveur : sans elle le planificateur " +
        "ne peut ni reclamer un creneau ni enregistrer une generation. Le tick echoue entierement, en " +
        "silence, et se journalise comme termine.",
    },
    {
      // Celle-ci, et pas les precedentes, DETRUIT un calendrier.
      //
      // getOpenAiClient (lib/ai/openai.ts:7-10) leve A L'INTERIEUR du creneau
      // deja reclame : attempt_count monte, releaseEditorialSlot rend le creneau
      // et au troisieme passage le creneau est 'failed'. Trois quarts d'heure
      // suffisent a bruler le budget de tentatives de chaque creneau echu.
      //
      // Obligatoire MEME sur une installation 100 % Claude : les embeddings
      // text-embedding-3-small du magasin vectoriel passent par cette cle quel
      // que soit le modele de redaction (.env.example:52-67).
      name: 'OPENAI_API_KEY',
      level: 'bloquant',
      ok: isSet(env.OPENAI_API_KEY),
      why:
        "Sans elle la generation leve a l'interieur du creneau DEJA reclame : la tentative est comptee, le " +
        "creneau est relache, et au troisieme tick il passe en failed. En 45 minutes le calendrier editorial " +
        "est detruit sans qu'aucune page ait ete produite. Elle reste obligatoire sur une installation " +
        "100 % Claude : les embeddings du magasin vectoriel passent par cette cle quel que soit le modele " +
        "de redaction.",
    },
    {
      // Presente ET assez longue : proxy.ts:43-48 applique EXACTEMENT ce test
      // avant de repondre. La longueur est mesuree sur la valeur BRUTE, sans
      // trim, parce que c'est ce que fait la barriere : trimer ici ferait dire
      // « configuration saine » a un pre-vol devant une instance qui repond 503.
      name: 'APP_ACCESS_SECRET',
      level: 'bloquant',
      ok: (env.APP_ACCESS_SECRET ?? '').length >= MIN_SECRET_LENGTH,
      why:
        "Absente ou plus courte que le minimum, la barriere d'acces repond 503 sur TOUTE l'interface — " +
        "pendant que le planificateur, lui, continue de generer et de publier chez les clients. " +
        "L'operateur voit une application morte et un moteur qui travaille, et le healthcheck du " +
        "conteneur passe au vert dans les deux cas.",
    },

    // ─── Recommandes ─────────────────────────────────────────────────────────
    {
      // Ce controle ne peut PAS etre bloquant, et la raison est structurelle :
      // savoir si cette cle est requise demande de lire campaigns.ai_model, donc
      // la base. Une fonction pure ne peut pas le savoir. Le croisement appartient
      // a la route de pre-vol, qui lit deja les campagnes.
      name: 'ANTHROPIC_API_KEY',
      level: 'recommande',
      ok: isSet(env.ANTHROPIC_API_KEY),
      why:
        "Obligatoire des qu'une campagne utilise un modele Claude : sans elle, ces campagnes echouent a " +
        "l'interieur du creneau reclame, exactement comme une cle OpenAI manquante. Impossible a trancher " +
        "sans lire campaigns.ai_model, donc signalee ici et croisee avec les campagnes reelles par la " +
        "route de pre-vol. Les campagnes en gpt-* ne sont pas concernees.",
    },
    {
      name: 'WORDPRESS_WEBHOOK_SECRET',
      level: 'recommande',
      ok: isSet(env.WORDPRESS_WEBHOOK_SECRET),
      why:
        "Sans elle le webhook repond 503 et aucun statut de publication ne remonte : les pages partent " +
        "bien sur les sites WordPress, mais le moteur ne le sait pas et les affiche comme non publiees. " +
        "Le bug empeche est une republication decidee sur un etat faux.",
    },
    {
      // docker-compose.yml:61 la pose deja ; ce controle sert donc surtout HORS
      // Docker — poste de developpement, `docker run` sans --env-file, PaaS.
      name: 'TZ',
      level: 'recommande',
      ok: isSet(env.TZ),
      why:
        "node-cron planifie sur l'heure LOCALE du process : absente, un hote en UTC decale toutes les " +
        "expressions cron et fait basculer le « jour J » du calendrier editorial au mauvais moment, donc " +
        "les generations partent le mauvais jour. Le deploiement Docker la pose deja ; ce constat vise " +
        "les executions hors conteneur.",
    },
  ]
}

/**
 * Vrai quand aucun controle bloquant n'est en echec.
 *
 * Prend le rapport en parametre plutot que de le refabriquer : l'appelant
 * AFFICHE ce rapport en meme temps qu'il decide, et deux lectures separees de
 * l'environnement pourraient un jour diverger — on expliquerait alors a
 * l'operateur un refus qui ne correspond a aucune ligne affichee.
 *
 * Les 'recommande' n'entrent pas dans le verdict, meme en echec : c'est ce qui
 * distingue « il manque une capacite » de « demarrer serait nuisible ».
 */
export function configIsSafeToRun(report: readonly ConfigCheck[]): boolean {
  return report.every(check => check.level !== 'bloquant' || check.ok)
}
