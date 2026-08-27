// ─────────────────────────────────────────────────────────────────────────────
// Pre-vol de configuration — tests
// SEO Engine - Un environnement vide doit dire NON, et ne rien laisser fuir.
// ─────────────────────────────────────────────────────────────────────────────
//
// Trois faits sont verrouilles ici, et chacun protege un incident different :
//
//  1. L'environnement VIDE fait echouer TOUS les bloquants et rend
//     configIsSafeToRun false. C'est le cas de la machine fraiche, du conteneur
//     lance sans --env-file et du collegue qui vient de cloner. Un pre-vol qui
//     dirait « ok » la-dessus autoriserait le demarrage du planificateur sur une
//     instance incapable de lire sa propre base.
//
//  2. Un secret d'acces de 15 caracteres echoue. La barriere reelle
//     (proxy.ts:43-48) refuse a 15 : si le pre-vol acceptait, il declarerait
//     saine une instance qui repond 503 sur toutes ses pages.
//
//  3. AUCUN champ du rapport ne contient une valeur d'entree. Ce rapport
//     traverse HTTP au lot 3 ; une cle de service Supabase recopiee dans un
//     `why` serait la meme faute que le `select('*')` qui a mis un mot de passe
//     WordPress dans GET /api/sites (lib/db.ts:28-39).
//
// AUCUN TEST NE MUTE process.env. L'environnement est passe en parametre — c'est
// exactement ce que la signature existe pour permettre, et un test qui poserait
// process.env.OPENAI_API_KEY fuirait dans tous les fichiers executes ensuite par
// le meme worker vitest.

import { describe, expect, it } from 'vitest'
import { configIsSafeToRun, configReport, type ConfigCheck } from './preflight'

/**
 * Des valeurs qu'on reconnaitrait n'importe ou. Elles ne ressemblent a aucune
 * cle reelle EXPRES : le test de non-fuite cherche ces chaines dans le rapport
 * serialise, et une valeur banale comme 'x' se retrouverait par hasard dans un
 * mot francais.
 */
const ENV_COMPLET: Readonly<Record<string, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://zzqqvvsentinelle.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sentinelle-service-role-QQZZ-9137',
  OPENAI_API_KEY: 'sk-sentinelle-openai-QQZZ-4471',
  APP_ACCESS_SECRET: 'sentinelle-secret-QQZZ-8802',
  ANTHROPIC_API_KEY: 'sk-ant-sentinelle-QQZZ-6650',
  WORDPRESS_WEBHOOK_SECRET: 'sentinelle-webhook-QQZZ-3328',
  TZ: 'Antarctica/Troll',
}

/** Le nom des controles bloquants, tel que le rapport les nomme. */
const BLOQUANTS: readonly string[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'APP_ACCESS_SECRET',
]

/** Le nom des controles recommandes. */
const RECOMMANDES: readonly string[] = ['ANTHROPIC_API_KEY', 'WORDPRESS_WEBHOOK_SECRET', 'TZ']

function checkNomme(report: readonly ConfigCheck[], name: string): ConfigCheck {
  const found = report.find(check => check.name === name)
  if (!found) throw new Error(`Le rapport ne porte aucun controle nomme ${name}`)
  return found
}

describe('configReport', () => {
  // ─── L'environnement vide, qui doit tout refuser ───────────────────────────

  it('fait echouer TOUS les bloquants sur un environnement vide', () => {
    const report = configReport({})
    const echecs = report.filter(check => check.level === 'bloquant' && !check.ok).map(c => c.name)

    expect(echecs).toEqual([...BLOQUANTS])
  })

  it('fait echouer aussi les recommandes sur un environnement vide', () => {
    const report = configReport({})

    for (const name of RECOMMANDES) {
      expect(checkNomme(report, name).ok).toBe(false)
    }
  })

  it('accepte un objet vide sans ceremonie de typage', () => {
    // Le fait teste est la SIGNATURE : `configReport({})` doit compiler. Avec
    // NodeJS.ProcessEnv en parametre, Next.js exigerait ici un NODE_ENV et cette
    // ligne ne passerait pas tsc — c'est la raison d'etre du type structurel.
    expect(configReport({})).toHaveLength(BLOQUANTS.length + RECOMMANDES.length)
  })

  // ─── L'environnement complet, qui doit tout accepter ───────────────────────

  it('rend tous les controles ok sur un environnement complet', () => {
    const report = configReport(ENV_COMPLET)

    for (const check of report) {
      expect(check.ok).toBe(true)
    }
  })

  // ─── Vide, blanc, absent : le meme verdict ─────────────────────────────────

  it.each([...BLOQUANTS, ...RECOMMANDES])(
    'traite une valeur vide de %s comme une variable absente',
    name => {
      const report = configReport({ ...ENV_COMPLET, [name]: '' })
      expect(checkNomme(report, name).ok).toBe(false)
    },
  )

  it.each([...BLOQUANTS.filter(n => n !== 'APP_ACCESS_SECRET'), ...RECOMMANDES])(
    'traite une valeur d espaces de %s comme une variable absente',
    name => {
      // Une ligne `.env` terminee par une espace apres le `=` passe le `!value`
      // de requireEnv (lib/supabase.ts:3-9) puis casse plus loin, avec un message
      // qui ne nomme plus la variable. Le pre-vol la declare absente ici.
      const report = configReport({ ...ENV_COMPLET, [name]: '   ' })
      expect(checkNomme(report, name).ok).toBe(false)
    },
  )

  it('traite une valeur explicitement undefined comme une variable absente', () => {
    // Ce que rend reellement process.env pour une cle jamais posee : la lecture
    // ne doit pas jeter sur l'acces a `.trim()` d'un undefined.
    const report = configReport({ ...ENV_COMPLET, OPENAI_API_KEY: undefined })
    expect(checkNomme(report, 'OPENAI_API_KEY').ok).toBe(false)
  })

  // ─── Le secret d'acces et sa longueur ──────────────────────────────────────

  it('refuse un APP_ACCESS_SECRET de 15 caracteres', () => {
    const secret = 'a'.repeat(15)
    expect(secret).toHaveLength(15)

    const report = configReport({ ...ENV_COMPLET, APP_ACCESS_SECRET: secret })
    expect(checkNomme(report, 'APP_ACCESS_SECRET').ok).toBe(false)
    expect(configIsSafeToRun(report)).toBe(false)
  })

  it('accepte un APP_ACCESS_SECRET de 16 caracteres, la limite exacte de proxy.ts', () => {
    // 15 refuse et 16 accepte encadrent la valeur : si quelqu'un deplace le seuil
    // sans toucher proxy.ts:31, l'un des deux tests tombe. C'est le seul lien
    // executable entre les deux fichiers, la constante etant volontairement
    // recopiee plutot qu'importee.
    const report = configReport({ ...ENV_COMPLET, APP_ACCESS_SECRET: 'a'.repeat(16) })
    expect(checkNomme(report, 'APP_ACCESS_SECRET').ok).toBe(true)
  })

  it('mesure le secret sur la valeur brute, comme la barriere', () => {
    // 16 caracteres dont des espaces de bord : proxy.ts n'applique aucun trim
    // avant de comparer a MIN_SECRET_LENGTH, donc il LAISSE PASSER. Un pre-vol
    // qui trimerait refuserait ici et enverrait l'operateur regenerer un secret
    // qui fonctionne deja.
    const report = configReport({ ...ENV_COMPLET, APP_ACCESS_SECRET: ` ${'a'.repeat(14)} ` })
    expect(checkNomme(report, 'APP_ACCESS_SECRET').ok).toBe(true)
  })

  // ─── Ce que le rapport n'a pas le droit de porter ──────────────────────────

  it('ne recopie AUCUNE valeur d entree, dans aucun champ', () => {
    const serialise = JSON.stringify(configReport(ENV_COMPLET))

    for (const valeur of Object.values(ENV_COMPLET)) {
      expect(serialise).not.toContain(valeur)
    }
  })

  it('ne laisse pas non plus filtrer un fragment de valeur', () => {
    // Le marqueur commun a toutes les sentinelles. Un jour ou quelqu'un
    // « ameliorerait » un `why` avec un extrait tronque du genre
    // `value.slice(0, 6)`, l'assertion sur la valeur entiere passerait encore ;
    // celle-ci non.
    const serialise = JSON.stringify(configReport(ENV_COMPLET))
    expect(serialise).not.toContain('QQZZ')
    expect(serialise).not.toContain('sentinelle')
    expect(serialise).not.toContain('Antarctica')
  })

  it('ne porte pas non plus la longueur du secret', () => {
    // Une longueur est une valeur : elle reduit l'espace de recherche de qui
    // lirait la reponse HTTP. Deux secrets de longueurs differentes doivent
    // produire le meme rapport.
    const court = JSON.stringify(configReport({ ...ENV_COMPLET, APP_ACCESS_SECRET: 'a'.repeat(16) }))
    const long = JSON.stringify(configReport({ ...ENV_COMPLET, APP_ACCESS_SECRET: 'b'.repeat(64) }))

    expect(court).toBe(long)
  })

  // ─── La forme du rapport ───────────────────────────────────────────────────

  it('nomme chaque controle une seule fois', () => {
    const noms = configReport({}).map(check => check.name)
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('place les bloquants avant les recommandes', () => {
    // L'ordre est stable pour qu'un affichage n'ait rien a trier : le premier
    // ecran que lit l'operateur est celui de ce qui l'empeche de demarrer.
    const levels = configReport({}).map(check => check.level)
    expect(levels).toEqual([
      ...BLOQUANTS.map(() => 'bloquant'),
      ...RECOMMANDES.map(() => 'recommande'),
    ])
  })

  it('donne a chaque controle un why qui dit quelque chose', () => {
    for (const check of configReport({})) {
      expect(check.why.length).toBeGreaterThan(40)
    }
  })

  it('lit process.env quand aucun environnement n est donne', () => {
    // On compare deux appels plutot que d'affirmer un verdict : affirmer
    // « tout en echec » ferait echouer la suite sur la machine d'un operateur
    // dont le shell porte deja les vraies variables. Ce qui est verrouille,
    // c'est que le defaut du parametre EST process.env.
    expect(configReport()).toEqual(configReport(process.env))
  })
})

describe('configIsSafeToRun', () => {
  it('rend false sur un environnement vide', () => {
    expect(configIsSafeToRun(configReport({}))).toBe(false)
  })

  it('rend true sur un environnement complet', () => {
    expect(configIsSafeToRun(configReport(ENV_COMPLET))).toBe(true)
  })

  it.each(BLOQUANTS)('rend false des que le seul bloquant %s manque', name => {
    const report = configReport({ ...ENV_COMPLET, [name]: '' })

    expect(configIsSafeToRun(report)).toBe(false)
    // Et il est bien le seul en echec : sinon ce test passerait pour la mauvaise
    // raison le jour ou ENV_COMPLET cesserait d'etre complet.
    expect(report.filter(check => !check.ok).map(c => c.name)).toEqual([name])
  })

  it.each(RECOMMANDES)('rend true meme si le recommande %s manque', name => {
    // C'est la distinction que porte tout ce fichier : « il manque une
    // capacite » n'est pas « demarrer serait nuisible ». Traiter un recommande
    // comme bloquant rendrait le pre-vol inutilisable — personne ne demarre
    // jamais avec sept variables sur sept, et un garde-fou qu'on contourne
    // toujours finit retire.
    const report = configReport({ ...ENV_COMPLET, [name]: '' })

    expect(checkNomme(report, name).ok).toBe(false)
    expect(configIsSafeToRun(report)).toBe(true)
  })

  it('rend true sur un rapport vide', () => {
    // Cas de bord explicite : `every` sur un tableau vide rend true. Ce n'est pas
    // un oubli, c'est le seul comportement coherent — un rapport sans controle
    // n'a rien constate de bloquant. La decision de demarrer, elle, ne repose
    // jamais sur ce booleen seul : elle croise ENABLE_SCHEDULER.
    expect(configIsSafeToRun([])).toBe(true)
  })
})
