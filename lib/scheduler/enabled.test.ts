// ─────────────────────────────────────────────────────────────────────────────
// Interrupteur de demarrage du planificateur — tests
// SEO Engine - Le defaut ne doit JAMAIS allumer.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un seul fait est verrouille ici, mais c'est celui qui decide si le moteur
// depense de l'argent et ecrit sur les sites de clients reels : seule la valeur
// exacte 'true' arme le planificateur. Toute autre — absente, vide, mal
// orthographiee, ou booleenne dans un autre dialecte — laisse le cron eteint.
// Le bug empeche est un demarrage que personne n'a decide, dont le premier tick
// publie seul chez un client.
//
// LA TABLE DE VERITE EST EXHAUSTIVE ET ELLE EST LE TEST. Un garde-fou sans table
// de verite se fait « ameliorer » au premier refactor par quelqu'un qui trouve
// naturel d'accepter '1' — et ce quelqu'un ne saura jamais qu'il vient de rendre
// une faute de frappe indistinguable d'un accord.
//
// AUCUN TEST NE MUTE process.env POUR SA VALEUR. L'environnement est passe en
// parametre, ce qui est precisement ce que la signature existe pour permettre :
// un test qui poserait process.env.ENABLE_SCHEDULER fuirait dans tous les
// fichiers executes apres lui par le meme worker vitest — et ce qui fuirait ici,
// c'est le drapeau qui autorise la publication autonome.

import { describe, expect, it } from 'vitest'
import { schedulerEnabled } from './enabled'

/**
 * Tout ce qui doit laisser le planificateur ETEINT.
 *
 * 'yes', '1', 'on' et 'True1' y figurent expressement : un implementeur qui
 * lirait ce drapeau avec un parseur booleen large les accepterait tous, et
 * 'ture' — la faute de frappe la plus courante sur ce mot — deviendrait alors la
 * seule protection restante. 'false' y figure aussi, evidemment, mais c'est le
 * cas le moins interessant : personne ne se trompe en ecrivant 'false'.
 */
const VALEURS_ETEINT: readonly string[] = [
  '',
  ' ',
  '   ',
  '\t\n',
  'false',
  'FALSE',
  'ture',
  'true1',
  'True1',
  'truthy',
  'yes',
  'y',
  '1',
  'on',
  'enabled',
  'enable',
  'oui',
  'null',
  'undefined',
  '0',
  'true,false',
  'no',
]

/**
 * Tout ce qui doit ALLUMER. Une espace de bord ou une majuscule vient d'une
 * ligne de .env ou d'un panneau d'hebergeur, pas d'une hesitation : l'operateur
 * a decide d'ouvrir la vanne. Lui repondre « eteint » sans un mot donnerait un
 * moteur muet qu'on ne diagnostique qu'en constatant, des heures plus tard, que
 * rien n'a ete produit.
 */
const VALEURS_ALLUME: readonly string[] = [
  'true',
  'TRUE',
  'True',
  ' true ',
  ' true',
  'true ',
  '  TRUE  ',
  '\ttrue\n',
]

describe('schedulerEnabled', () => {
  // ─── Le defaut, qui n'allume rien ──────────────────────────────────────────

  it('rend false quand la variable est absente', () => {
    // Le cas du premier demarrage : machine fraiche, conteneur sans --env-file,
    // depot fraichement clone. Rien ne doit partir chez un client.
    expect(schedulerEnabled({})).toBe(false)
  })

  it('rend false quand la variable est explicitement undefined', () => {
    // Ce que rend reellement process.env pour une cle jamais posee : la lecture
    // ne doit pas jeter sur l'acces a `.trim()` d'un undefined, sans quoi le
    // garde-fou casserait register() au lieu de le refuser proprement.
    expect(schedulerEnabled({ ENABLE_SCHEDULER: undefined })).toBe(false)
  })

  it.each(VALEURS_ETEINT)('rend false sur la valeur %j', value => {
    expect(schedulerEnabled({ ENABLE_SCHEDULER: value })).toBe(false)
  })

  it('ignore toute autre variable de l environnement', () => {
    // Un environnement de production complet ne doit pas suffire a allumer :
    // seule ENABLE_SCHEDULER decide. Le bug empeche est un drapeau qu'on croit
    // implicite « puisque tout le reste est configure ».
    expect(
      schedulerEnabled({
        NODE_ENV: 'production',
        SCHEDULER: 'true',
        ENABLE_CRON: 'true',
        NEXT_RUNTIME: 'nodejs',
      }),
    ).toBe(false)
  })

  // ─── La seule valeur qui arme le planificateur ─────────────────────────────

  it('rend true sur la valeur exacte', () => {
    expect(schedulerEnabled({ ENABLE_SCHEDULER: 'true' })).toBe(true)
  })

  it.each(VALEURS_ALLUME)(
    'rend true sur la valeur %j : la casse et les espaces de bord ne changent pas le verdict',
    value => {
      expect(schedulerEnabled({ ENABLE_SCHEDULER: value })).toBe(true)
    },
  )

  // ─── Le sens du drapeau, verrouille dans les deux directions ───────────────

  it('n allume que pour true : aucune autre valeur de la table ne passe', () => {
    // Formulee en negatif pour attraper l'inverse du bug precedent : un jour ou
    // quelqu'un remplacerait la comparaison par un `!== 'false'`, tous les
    // VALEURS_ETEINT allumeraient d'un coup, y compris l'environnement vide.
    const allumes = VALEURS_ETEINT.filter(value => schedulerEnabled({ ENABLE_SCHEDULER: value }))
    expect(allumes).toEqual([])
  })

  // ─── La lecture ambiante, qui reste un defaut de parametre ─────────────────

  it('lit process.env quand aucun environnement n est donne', () => {
    // On compare deux appels plutot que d'affirmer false : affirmer false ferait
    // echouer la suite chez l'operateur qui a justement pose ENABLE_SCHEDULER
    // dans son shell pour verifier la bascule. Ce qui est verrouille, c'est que
    // le defaut du parametre EST process.env — le jour ou quelqu'un le remplace
    // par un objet fige, ceci casse.
    expect(schedulerEnabled()).toBe(schedulerEnabled(process.env))
  })
})
