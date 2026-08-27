/**
 * Next.js instrumentation hook.
 *
 * Next compiles this file for BOTH the Node.js and the Edge runtime. The
 * `NEXT_RUNTIME` check below only runs at request time, so a top-level
 * `import { initScheduler } from '@/lib/scheduler/cron'` would still pull the
 * whole scheduler graph — node-cron, the RAG context builders, the vector store
 * and its `node:crypto` dependency — into the Edge bundle, where none of it can
 * load.
 *
 * The dynamic import keeps that graph out of the Edge bundle entirely: it is
 * only resolved once we know we are on the Node.js runtime.
 */

// ─── L'ORDRE DES CONTROLES, ET POURQUOI IL EST CELUI-LA ──────────────────────
//
// Trois portes, dans cet ordre exact : runtime, puis DRAPEAU, puis pre-vol.
//
// Le drapeau passe AVANT le pre-vol de configuration, et c'est deliberement
// l'inverse de ce qu'on ecrirait spontanement. Le developpeur qui lance
// `npm run dev` avec un .env.local partiel et sans ENABLE_SCHEDULER n'a jamais
// voulu de planificateur : lui deverser a chaque redemarrage un mur de
// console.error sur des variables « bloquantes » dont il n'a aucun besoin lui
// apprend, en trois jours, a ne plus lire les erreurs de demarrage — et le jour
// ou l'une d'elles compte vraiment, elle passe dans le bruit. Un pre-vol ne sert
// qu'a celui qui a DEMANDE a demarrer. Refuser d'abord, expliquer ensuite.
//
// Consequence a assumer : quand le drapeau est eteint, on ne dit RIEN de l'etat
// de la configuration. C'est voulu. La route de pre-vol (/api/preflight) existe
// pour ca et se consulte a volonte, sans redemarrer quoi que ce soit.
//
// Le pre-vol, lui, passe avant l'import dynamique du planificateur : refuser
// APRES avoir charge node-cron et le magasin vectoriel ne coute pas que du
// temps, ca fait executer le module de haut niveau de tout ce graphe pour rien.

import { configIsSafeToRun, configReport } from '@/lib/config/preflight'
import { schedulerEnabled } from '@/lib/scheduler/enabled'

export async function register() {
  // REGISTER NE DOIT JAMAIS LEVER. Next appelle ce hook au demarrage du
  // process : une exception qui remonte d'ici emporte le serveur web avec elle.
  // Or l'etat le moins dangereux n'est pas « tout eteint », c'est « web allume,
  // cron eteint » — c'est exactement la surface dont l'operateur a besoin pour
  // lire /api/preflight, corriger son environnement et redemarrer. Un serveur
  // qui refuse de se lever le prive de son seul outil de diagnostic au moment
  // precis ou il en a besoin. Tout ce qui suit est donc encadre, y compris
  // l'import dynamique : un module du graphe du planificateur qui jetterait a
  // l'evaluation (une cle lue au niveau module, un fichier absent) ne doit pas
  // faire plus de degat qu'un cron non demarre.
  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return

    // Porte 1 : le drapeau. Absent, vide ou mal orthographie, on ne demarre pas.
    // UNE seule ligne, qui nomme la variable et dit comment allumer : un refus
    // qu'on ne sait pas defaire est un refus qu'on contourne au mauvais endroit.
    if (!schedulerEnabled()) {
      console.log(
        '[instrumentation] Planificateur ETEINT : ENABLE_SCHEDULER absente ou differente de "true". ' +
          'Aucune generation, aucune publication, aucun crawl ne partira. ' +
          'Pour allumer : poser ENABLE_SCHEDULER=true dans l environnement, puis redemarrer. ' +
          'Avant d allumer, lire GET /api/preflight — le premier tick agit dans les 15 minutes.',
      )
      return
    }

    // Porte 2 : le pre-vol. L'operateur a demande a demarrer ; on lui dit
    // maintenant, en nommant chaque controle, ce qui l'en empeche.
    const report = configReport(process.env)
    if (!configIsSafeToRun(report)) {
      const echecs = report.filter(check => check.level === 'bloquant' && !check.ok)

      console.error(
        '[instrumentation] Planificateur NON DEMARRE : ENABLE_SCHEDULER est a "true" mais ' +
          `${echecs.length} controle(s) bloquant(s) echouent. Le serveur web reste allume : ` +
          'corriger l environnement puis redemarrer.',
      )
      // Une ligne par controle, avec son nom ET le bug qu'il empeche. Un journal
      // qui dirait seulement « configuration invalide » obligerait l operateur a
      // relire le code pour savoir quoi poser.
      for (const echec of echecs) {
        console.error(`[instrumentation]   - ${echec.name} : ${echec.why}`)
      }
      return
    }

    // Les deux portes sont franchies : et seulement maintenant on tire le graphe
    // du planificateur. `initScheduler` porte son propre garde (le booleen de
    // module `schedulerStarted`, lib/scheduler/cron.ts:168-173) qui protege
    // d'autre chose — un double appel dans le MEME process. Les deux gardes ne
    // se remplacent pas : celui-ci decide si le cron doit exister, celui-la
    // empeche qu'il existe deux fois.
    const { initScheduler } = await import('@/lib/scheduler/cron')
    initScheduler()
  } catch (error) {
    console.error(
      '[instrumentation] Demarrage du planificateur abandonne sur exception. ' +
        'Le serveur web reste allume, le cron est eteint.',
      error,
    )
  }
}
