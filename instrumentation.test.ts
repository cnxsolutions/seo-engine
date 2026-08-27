// ─────────────────────────────────────────────────────────────────────────────
// Le hook de demarrage — tests du CABLAGE, pas de la decision
// SEO Engine - Ce qui empeche vraiment le planificateur de partir.
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE FICHIER EXISTE, ALORS QUE schedulerEnabled EST DEJA TESTE A FOND.
// lib/scheduler/enabled.test.ts prouve que la FONCTION rend false sans la
// variable. Il ne prouve pas que quelqu'un l'APPELLE. La preuve a ete faite en
// retirant les neuf lignes du garde de instrumentation.ts : la suite entiere
// restait verte, 986 tests sur 52 fichiers, pendant que le planificateur
// demarrait sans condition. Un garde-fou dont la suppression ne rougit nulle
// part ne protege rien — il documente une intention.
//
// C'est le cablage qui tient la sureté, et c'est donc le cablage qu'on verrouille
// ici : que la porte du drapeau existe, qu'elle soit AVANT le pre-vol, et
// qu'aucun des trois chemins de refus n'atteigne initScheduler.
//
// LE GRAPHE DU PLANIFICATEUR N'EST JAMAIS CHARGE. `vi.mock` avec fabrique
// remplace le module : node-cron, les constructeurs de contexte RAG et le
// magasin vectoriel ne sont pas evalues par ces tests. C'est ce qui rend
// register() testable sans monter la moitie de l'application — l'import
// dynamique qu'on croyait etre l'obstacle est en fait ce qui rend l'interception
// possible.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { initSchedulerMock } = vi.hoisted(() => ({ initSchedulerMock: vi.fn() }))

vi.mock('@/lib/scheduler/cron', () => ({ initScheduler: initSchedulerMock }))

import { register } from './instrumentation'

/**
 * Un environnement de production complet : les quatre controles bloquants de
 * lib/config/preflight.ts sont satisfaits, drapeau compris. Chaque test part de
 * la et RETIRE ce qu'il veut mettre en defaut — on teste ainsi l'absence d'une
 * seule chose a la fois, jamais un environnement vide dont on ne saurait pas
 * laquelle des quatre causes a bloque.
 */
const ENV_COMPLET: Readonly<Record<string, string>> = {
  NEXT_RUNTIME: 'nodejs',
  ENABLE_SCHEDULER: 'true',
  NEXT_PUBLIC_SUPABASE_URL: 'https://verif-instrumentation.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-verif-instrumentation',
  OPENAI_API_KEY: 'sk-verif-instrumentation-openai',
  APP_ACCESS_SECRET: 'secret-de-plus-de-seize-caracteres',
}

/**
 * process.env est remplace ENTIEREMENT, pas complete.
 *
 * register() lit `process.env` directement — c'est sa nature, il est le point ou
 * l'environnement entre dans l'application. Un test qui se contenterait de POSER
 * des variables laisserait celles de la machine en place : sur un poste qui
 * detient un vrai .env, `ENABLE_SCHEDULER` absente du cas de test serait quand
 * meme presente et le test « sans le drapeau, rien ne demarre » passerait au
 * vert pour la mauvaise raison, ou rougirait chez le seul developpeur qui a la
 * variable. On vide donc, puis on pose exactement le cas voulu.
 *
 * Le snapshot est restaure apres CHAQUE test. Vitest execute les fichiers dans
 * des workers separes et les tests d'un fichier en sequence : personne d'autre
 * ne lit process.env pendant ces quelques millisecondes.
 */
const ENV_SNAPSHOT: Readonly<Record<string, string | undefined>> = { ...process.env }

function poserEnv(vars: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, vars)
}

/** ENV_COMPLET prive des cles nommees. */
function envSauf(...omises: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(ENV_COMPLET).filter(([key]) => !omises.includes(key)),
  )
}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  initSchedulerMock.mockClear()
  // Les journaux sont ETOUFFES autant que captures : sans ca, la sortie de la
  // suite se remplit de refus attendus et le vrai bruit devient illisible.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, ENV_SNAPSHOT)
})

/**
 * Aplatit les appels d'un espion en une seule chaine.
 *
 * `args` est annote explicitement : `ReturnType<typeof vi.spyOn>` est le type
 * generique non instancie, donc `mock.calls` y est un tableau non contraint et
 * tsc en mode strict refuse le parametre implicite. On annote plutot que de
 * caster — l'annotation dit ce qu'on lit vraiment, un cast dirait qu'on sait
 * mieux.
 */
function journalDe(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
}

/** Tout ce que console.log a recu. */
function journalInfo(): string {
  return journalDe(logSpy)
}

/** Tout ce que console.error a recu. */
function journalErreur(): string {
  return journalDe(errorSpy)
}

describe('register — la porte du drapeau', () => {
  // ─── CRITERE (b) : sans la variable, le planificateur NE DEMARRE PAS ───────
  //
  // C'est LE test dont la suppression du garde doit faire rougir la suite. Il
  // est ecrit sur initScheduler et non sur un journal : ce qui compte n'est pas
  // ce que le produit dit, c'est ce qu'il fait.

  it('ne demarre PAS le planificateur quand ENABLE_SCHEDULER est absente', async () => {
    poserEnv(envSauf('ENABLE_SCHEDULER'))

    await register()

    expect(initSchedulerMock).not.toHaveBeenCalled()
  })

  it('nomme la variable et dit comment allumer, plutot que de refuser en silence', async () => {
    poserEnv(envSauf('ENABLE_SCHEDULER'))

    await register()

    // Un refus qu'on ne sait pas defaire est un refus qu'on contourne au mauvais
    // endroit : la ligne doit porter le nom exact a poser et ou verifier.
    expect(journalInfo()).toContain('ENABLE_SCHEDULER')
    expect(journalInfo()).toContain('/api/preflight')
  })

  it('refuse en console.log, PAS en console.error, quand seul le drapeau manque', async () => {
    poserEnv(envSauf('ENABLE_SCHEDULER'))

    await register()

    // Le developpeur qui lance `npm run dev` n'a rien fait de mal. Crier une
    // erreur sur son ecran a chaque redemarrage lui apprend a ignorer les
    // erreurs de demarrage, et le jour ou l'une compte elle passe dans le bruit.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  // ─── CRITERE (d) : vide, mal orthographie, approchant -> ETAT SUR ──────────

  it.each([
    ['chaine vide', ''],
    ['espaces seuls', '   '],
    ['false', 'false'],
    ['faute de frappe', 'ture'],
    ['suffixe', 'true1'],
    ['yes', 'yes'],
    ['1', '1'],
    ['on', 'on'],
    ['oui', 'oui'],
    ['enabled', 'enabled'],
  ])('ne demarre PAS le planificateur sur ENABLE_SCHEDULER=%s', async (_nom, valeur) => {
    poserEnv({ ...ENV_COMPLET, ENABLE_SCHEDULER: valeur })

    await register()

    expect(initSchedulerMock).not.toHaveBeenCalled()
  })

  // ─── CRITERE (c) : a la valeur active, le planificateur demarre ────────────

  it('demarre le planificateur quand ENABLE_SCHEDULER vaut "true"', async () => {
    poserEnv(ENV_COMPLET)

    await register()

    expect(initSchedulerMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['majuscules', 'TRUE'],
    ['capitale', 'True'],
    ['espaces de bord', ' true '],
  ])('demarre aussi sur ENABLE_SCHEDULER=%s (normalisation)', async (_nom, valeur) => {
    poserEnv({ ...ENV_COMPLET, ENABLE_SCHEDULER: valeur })

    await register()

    // Une espace finale est ce que produit couramment une ligne de .env ou un
    // champ de panneau d'hebergeur. L'operateur a decide d'allumer.
    expect(initSchedulerMock).toHaveBeenCalledTimes(1)
  })
})

describe('register — la porte du runtime', () => {
  it.each([['edge'], [undefined]])(
    'ne charge rien hors du runtime Node (NEXT_RUNTIME=%s)',
    async runtime => {
      const env = envSauf('NEXT_RUNTIME')
      if (runtime !== undefined) env.NEXT_RUNTIME = runtime
      poserEnv(env)

      await register()

      // Le drapeau est pourtant a 'true' et la configuration est complete : c'est
      // bien le runtime qui a arrete, et il arrete AVANT tout journal.
      expect(initSchedulerMock).not.toHaveBeenCalled()
      expect(logSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    },
  )
})

describe('register — la porte du pre-vol', () => {
  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL'],
    ['SUPABASE_SERVICE_ROLE_KEY'],
    ['OPENAI_API_KEY'],
    ['APP_ACCESS_SECRET'],
  ])('ne demarre PAS quand le bloquant %s manque, drapeau allume', async manquante => {
    poserEnv(envSauf(manquante))

    await register()

    expect(initSchedulerMock).not.toHaveBeenCalled()
  })

  it('nomme le controle bloquant en echec, pas seulement « configuration invalide »', async () => {
    poserEnv(envSauf('OPENAI_API_KEY'))

    await register()

    // Sans le nom, l'operateur doit relire le code pour savoir quoi poser.
    expect(journalErreur()).toContain('OPENAI_API_KEY')
  })

  it('refuse un APP_ACCESS_SECRET trop court, comme la barriere reelle', async () => {
    poserEnv({ ...ENV_COMPLET, APP_ACCESS_SECRET: 'quinze-caract' + 'ee' })

    await register()

    expect(initSchedulerMock).not.toHaveBeenCalled()
  })

  // ─── L'ORDRE DES DEUX PORTES, VERROUILLE ──────────────────────────────────

  it('ne dit RIEN de la configuration quand le drapeau est eteint', async () => {
    // Drapeau absent ET configuration ruinee. L'ordre voulu par l'architecte
    // veut qu'on refuse sur le drapeau sans jamais evaluer le pre-vol : un seul
    // console.log, aucun console.error, aucun nom de variable manquante.
    // Inverser les deux portes ferait rougir ce test — c'est sa raison d'etre.
    poserEnv({ NEXT_RUNTIME: 'nodejs' })

    await register()

    expect(initSchedulerMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(journalInfo()).not.toContain('OPENAI_API_KEY')
    expect(journalInfo()).not.toContain('SUPABASE')
  })
})

describe('register — ne leve jamais', () => {
  it('avale une exception du planificateur et laisse le serveur web debout', async () => {
    poserEnv(ENV_COMPLET)
    initSchedulerMock.mockImplementationOnce(() => {
      throw new Error('node-cron a refuse de demarrer')
    })

    // Une exception qui remonte d'ici emporte le serveur web, donc l'operateur
    // perd /api/preflight — son seul outil de diagnostic — au moment precis ou
    // il en a besoin. L'etat le moins dangereux est « web allume, cron eteint ».
    await expect(register()).resolves.toBeUndefined()
    expect(journalErreur()).toContain('node-cron a refuse de demarrer')
  })
})
