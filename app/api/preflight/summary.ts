// ─────────────────────────────────────────────────────────────────────────────
// Pre-vol operationnel — ce que ferait le PROCHAIN tick
// SEO Engine - Regles pures, aucune base
// ─────────────────────────────────────────────────────────────────────────────
//
// Le lot 1 (lib/config/preflight.ts) repond a « l'environnement est-il pose ? ».
// Ce fichier repond a la question d'apres, celle que personne ne pouvait poser
// avant de deployer : « si j'ouvre la vanne maintenant, qu'est-ce qui part ? ».
// Il ne lit rien — il recoit des faits deja lus par route.ts, comme
// deriveWorkflowState (app/api/workflow/state.ts) recoit les siens — et rend
// l'objet de reponse plus un verdict en une phrase.
//
// TROIS DEPENSIERS, PAS DEUX. La mesure qui a fonde ce chantier comptait les
// creneaux editoriaux echus et les campagnes echues. Elle en oubliait un
// troisieme : checkCycleCompletion() est dans le Promise.allSettled de CHAQUE
// tick (lib/scheduler/cron.ts:197) et chaque cycle expire a renouveler declenche
// un crawl de 300 pages sur le site du CLIENT, une indexation facturee, un appel
// modele et la reecriture du calendrier (lib/scheduler/cycle-manager.ts:25-50).
// Il n'a ni reclamation ni plafond de rattrapage, contrairement aux creneaux et
// aux campagnes (MAX_CATCHUP_SLOTS_PER_RUN / MAX_CAMPAIGNS_PER_RUN,
// cron.ts:96-97). Le taire, c'est laisser l'operateur autoriser un tick dont il
// ne connait que les deux tiers.
//
// LE SILENCE EST INTERDIT ICI. Toute la valeur du pre-vol tient a ce qu'il
// nomme le danger AVANT qu'il ne parte. Un verdict qui rend « rien a signaler »
// parce qu'un fait n'a pas pu etre etabli serait pire que pas de pre-vol du
// tout : c'est pourquoi la route echoue en 500 plutot que de resumer une lecture
// partielle, et pourquoi le croisement Claude ci-dessous defaut vers « cle
// absente » quand le controle manque au rapport.

import { configIsSafeToRun, type ConfigCheck } from '@/lib/config/preflight'

/** Une campagne, reduite a ce qu'un rapport a le droit de porter. */
export interface PreflightCampaignRef {
  id: string
  name: string
}

export interface PreflightCycleRef {
  /** L'id du `cycle_plans`, pas celui de la campagne. */
  id: string
  campaignName: string
}

/**
 * Les faits que route.ts est allee lire, plus le rapport du lot 1 et l'etat du
 * drapeau de demarrage.
 *
 * Aucune valeur de variable d'environnement n'entre ici, et il n'y a pas de
 * `anthropicKeyPresent` : la presence de la cle est DEJA dans `config`, sous la
 * forme du constat ANTHROPIC_API_KEY. Le porter deux fois, c'est se donner
 * l'occasion que les deux copies divergent — et expliquer alors a l'operateur
 * un verdict qui ne correspond a aucune ligne affichee.
 */
export interface PreflightFacts {
  /** `editorial_calendar` en 'planned' dont la date locale est echue. */
  dueSlots: number
  /** Campagnes actives dont `next_run_at` est passe. */
  dueCampaigns: number
  /** Generations que la file differee publierait seules (filtre lib/db.ts:335-346). */
  pendingDeferredPublications: number
  /** Campagnes qui publient sans qu'un humain clique. */
  autoPublishCampaigns: readonly PreflightCampaignRef[]
  /** Cycles expires que le tick renouvellerait : crawl, indexation, modele. */
  renewingCycles: readonly PreflightCycleRef[]
  /** Campagnes actives dont `ai_model` designe un modele Claude. */
  claudeCampaigns: readonly PreflightCampaignRef[]
  /** Le rapport du lot 1, tel quel. */
  config: readonly ConfigCheck[]
  /** L'etat de `schedulerEnabled()` — le drapeau, jamais sa valeur. */
  schedulerEnabled: boolean
}

/**
 * Ce que le prochain tick ferait, chiffre.
 *
 * `spends` et `publishesAlone` sont deux dangers DIFFERENTS et sont separes
 * pour cela : depenser des tokens se rattrape sur une facture, publier seul chez
 * un client ne se rattrape pas.
 */
export interface PreflightNextTick {
  dueSlots: number
  dueCampaigns: number
  pendingDeferredPublications: number
  autoPublishCampaigns: readonly PreflightCampaignRef[]
  renewingCycles: readonly PreflightCycleRef[]
  /** Generation, crawl, indexation ou appel modele : de l'argent part. */
  spends: boolean
  /** Du contenu part sur le site d'un client sans qu'un humain l'ait valide. */
  publishesAlone: boolean
}

/**
 * Le verdict, du plus grave au plus rassurant.
 *
 * 'planificateur-allume' n'etait pas dans la liste initiale des trois etats, et
 * il y est parce que les trois ne couvraient pas tout : un operateur qui lit ce
 * pre-vol avec ENABLE_SCHEDULER deja pose n'est pas « pret a ouvrir », la vanne
 * est ouverte et le tick suivant part dans moins de 15 minutes. Rendre « pret a
 * ouvrir » dans ce cas serait exactement le mensonge que ce fichier existe pour
 * empecher.
 */
export type PreflightVerdict =
  | 'configuration-incomplete'
  | 'planificateur-allume'
  | 'planificateur-eteint'
  | 'pret-a-ouvrir'

export interface PreflightSummary {
  verdict: PreflightVerdict
  /** Le verdict en une phrase, lisible tel quel dans un terminal. */
  phrase: string
  schedulerEnabled: boolean
  /** Aucun constat bloquant en echec, croisement Claude compris. */
  configurationOk: boolean
  /** Le rapport du lot 1, avec ANTHROPIC_API_KEY tranchee sur les campagnes reelles. */
  configuration: readonly ConfigCheck[]
  nextTick: PreflightNextTick
  /** Ce que l'ouverture declencherait, en clair, une phrase par danger. */
  warnings: readonly string[]
}

/** Le nom du constat que le croisement avec la base vient trancher. */
const ANTHROPIC_CHECK_NAME = 'ANTHROPIC_API_KEY'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
}

/** « a », « a et b », « a, b et c ». */
function enumerate(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`
}

function names(refs: readonly { name: string }[]): string {
  return enumerate(refs.map((ref) => `« ${ref.name} »`))
}

/**
 * ANTHROPIC_API_KEY tranchee, ce que le lot 1 ne pouvait pas faire.
 *
 * .env.example:70 la dit « OBLIGATOIRE si une campagne utilise un modele
 * Claude » : c'est une condition sur la BASE, qu'une fonction pure lisant
 * l'environnement ne peut pas evaluer. Le lot 1 la classe donc 'recommande' et
 * laisse le croisement ici, ou les campagnes sont connues.
 *
 * Le constat est PROMU 'bloquant' des qu'une campagne active ecrit en Claude, et
 * la promotion vaut meme si la cle est presente : ce qui est bloquant pour cette
 * installation le reste quand il est satisfait, sinon la liste des choses a ne
 * jamais perdre se relit differemment a chaque deploiement.
 *
 * Constat absent du rapport => `ok: false`. C'est la direction sure : le seul
 * effet est de refuser d'ouvrir devant des campagnes Claude, ce qui coute une
 * verification a l'operateur. L'inverse le laisserait ouvrir sur une cle qu'on
 * n'a pas verifiee, et bruler trois tentatives par creneau (cron.ts:658-672).
 */
function crossCheckAnthropic(
  config: readonly ConfigCheck[],
  claudeCampaigns: readonly PreflightCampaignRef[]
): ConfigCheck[] {
  if (claudeCampaigns.length === 0) return [...config]

  const existing = config.find((check) => check.name === ANTHROPIC_CHECK_NAME)
  const decided: ConfigCheck = {
    name: ANTHROPIC_CHECK_NAME,
    level: 'bloquant',
    ok: existing?.ok ?? false,
    why:
      `${plural(claudeCampaigns.length, 'campagne active écrit', 'campagnes actives écrivent')} ` +
      `avec un modèle Claude (${names(claudeCampaigns)}) : sans cette clé, chacune lève à l'intérieur ` +
      `du créneau DÉJÀ réclamé, la tentative est comptée, le créneau relâché, et au troisième tick il ` +
      `passe en failed. Trois quarts d'heure suffisent à détruire leur calendrier sans qu'une seule ` +
      `page soit produite.`,
  }

  return existing
    ? config.map((check) => (check.name === ANTHROPIC_CHECK_NAME ? decided : check))
    : [...config, decided]
}

/**
 * Une phrase par danger, dans l'ordre ou l'operateur doit les traiter.
 *
 * Les cycles a renouveler sont nommes par campagne parce qu'ils sont le seul des
 * trois travaux a n'avoir AUCUN plafond : les creneaux et les campagnes sont
 * capes a 10 par tick, un renouvellement part pour chaque cycle expire, tous a
 * la fois, contre les serveurs de production des clients.
 */
function buildWarnings(tick: PreflightNextTick): string[] {
  const warnings: string[] = []

  if (tick.dueSlots > 0) {
    warnings.push(
      `${plural(tick.dueSlots, 'créneau éditorial échu part', 'créneaux éditoriaux échus partent')} ` +
        `en génération réelle, par lots de 10 par tick (MAX_CATCHUP_SLOTS_PER_RUN).`
    )
  }

  if (tick.dueCampaigns > 0) {
    warnings.push(
      `${plural(tick.dueCampaigns, 'campagne active est échue', 'campagnes actives sont échues')} ` +
        `et ${tick.dueCampaigns > 1 ? 'seront exécutées' : 'sera exécutée'} par lots de 10 par tick ` +
        `(MAX_CAMPAIGNS_PER_RUN).`
    )
  }

  if (tick.renewingCycles.length > 0) {
    warnings.push(
      `${plural(tick.renewingCycles.length, 'cycle expiré est renouvelé', 'cycles expirés sont renouvelés')} ` +
        `d'un coup et SANS plafond (${names(tick.renewingCycles.map((cycle) => ({ name: cycle.campaignName })))}) : ` +
        `chacun re-crawle jusqu'à 300 pages du site du client, refacture une indexation vectorielle, ` +
        `appelle le modèle et réécrit le calendrier éditorial.`
    )
  }

  if (tick.pendingDeferredPublications > 0) {
    warnings.push(
      `${plural(tick.pendingDeferredPublications, 'page déjà générée part', 'pages déjà générées partent')} ` +
        `seules sur le site du client par la file différée, sans qu'un humain clique.`
    )
  }

  // Signale meme quand rien n'est echu : la campagne reste armee, et la seule
  // facon de fermer cette vanne n'est PAS a l'ecran — aucune route n'ecrit
  // auto_publish apres la creation.
  if (tick.autoPublishCampaigns.length > 0) {
    warnings.push(
      `${plural(tick.autoPublishCampaigns.length, 'campagne porte', 'campagnes portent')} ` +
        `auto_publish = true (${names(tick.autoPublishCampaigns)}) : toute page qu'${
          tick.autoPublishCampaigns.length > 1 ? 'elles génèrent part seule' : 'elle génère part seule'
        } sur le site du client. Aucun écran ne coupe cette vanne — c'est un UPDATE SQL sur ` +
        `campaigns.auto_publish, honoré par les deux chemins de publication.`
    )
  }

  return warnings
}

function describeTick(tick: PreflightNextTick): string {
  const parts: string[] = []

  if (tick.dueSlots > 0) {
    parts.push(plural(tick.dueSlots, 'génération de créneau échu', 'générations de créneaux échus'))
  }
  if (tick.dueCampaigns > 0) {
    parts.push(plural(tick.dueCampaigns, 'campagne échue', 'campagnes échues'))
  }
  if (tick.renewingCycles.length > 0) {
    parts.push(
      plural(tick.renewingCycles.length, 'renouvellement de cycle', 'renouvellements de cycle') +
        ' (crawl du site client, indexation, modèle)'
    )
  }
  if (tick.pendingDeferredPublications > 0) {
    parts.push(plural(tick.pendingDeferredPublications, 'publication autonome', 'publications autonomes'))
  }

  return parts.length > 0 ? enumerate(parts) : 'rien'
}

function buildPhrase(
  verdict: PreflightVerdict,
  failing: readonly ConfigCheck[],
  tick: PreflightNextTick,
  schedulerEnabled: boolean,
  hasWarnings: boolean
): string {
  if (verdict === 'configuration-incomplete') {
    // Le drapeau pose ne suffit pas : instrumentation.ts refuse de demarrer le
    // planificateur quand un bloquant echoue. Le dire evite a l'operateur de
    // conclure que la variable ne marche pas.
    const suffix = schedulerEnabled
      ? ' ENABLE_SCHEDULER a beau être posé, le planificateur ne démarrera pas tant que ces points ne sont pas corrigés.'
      : ' Ne rien ouvrir avant correction.'

    return `Configuration incomplète : ${enumerate(failing.map((check) => check.name))} ${
      failing.length > 1 ? 'manquent ou sont invalides' : 'manque ou est invalide'
    }.${suffix}`
  }

  if (verdict === 'planificateur-allume') {
    return `Planificateur ALLUMÉ : configuration complète, et le prochain tick — dans moins de 15 minutes — déclenche ${describeTick(
      tick
    )}.`
  }

  if (verdict === 'planificateur-eteint') {
    return `Configuration complète, planificateur éteint : l'allumer déclencherait ${describeTick(tick)}.`
  }

  // « Prêt » porte sur LE PROCHAIN TICK, et la phrase ne promet rien de plus :
  // une campagne auto_publish qui n'est pas encore échue ne publie rien au tick
  // suivant, mais elle reste armée pour celui d'après. Le renvoi explicite aux
  // avertissements est là pour ça — un verdict rassurant est exactement ce qu'on
  // lit sans dérouler le reste de la réponse.
  const base =
    'Prêt à ouvrir : configuration complète, planificateur éteint, et le prochain tick ne dépenserait rien et ne publierait rien seul.'

  return hasWarnings ? `${base} Lire les avertissements avant d'ouvrir : tout n'y est pas éteint pour autant.` : base
}

/**
 * Le pre-vol, en une passe.
 *
 * L'ordre des verdicts est un ordre de GRAVITE, pas un arbre de commodite. Une
 * configuration incomplete passe devant l'etat du drapeau parce qu'elle rend le
 * drapeau sans effet ; le planificateur allume passe devant tout le reste parce
 * que c'est le seul etat ou le tick decrit n'est plus une hypothese.
 */
export function summarisePreflight(facts: PreflightFacts): PreflightSummary {
  const configuration = crossCheckAnthropic(facts.config, facts.claudeCampaigns)
  const configurationOk = configIsSafeToRun(configuration)

  const spends =
    facts.dueSlots > 0 || facts.dueCampaigns > 0 || facts.renewingCycles.length > 0

  // Une campagne auto_publish + du travail echu = de la publication autonome.
  //
  // Volontairement PESSIMISTE : on ne sait pas ici a quelle campagne appartient
  // chaque creneau echu, et supposer que ce n'est pas une campagne auto_publish
  // serait supposer la version rassurante d'un fait qu'on n'a pas etabli. La
  // publication en ligne part directement apres la generation (cron.ts:1629),
  // sans repasser par la file differee.
  const publishesAlone =
    facts.pendingDeferredPublications > 0 || (facts.autoPublishCampaigns.length > 0 && spends)

  const nextTick: PreflightNextTick = {
    dueSlots: facts.dueSlots,
    dueCampaigns: facts.dueCampaigns,
    pendingDeferredPublications: facts.pendingDeferredPublications,
    autoPublishCampaigns: facts.autoPublishCampaigns,
    renewingCycles: facts.renewingCycles,
    spends,
    publishesAlone,
  }

  const failing = configuration.filter((check) => check.level === 'bloquant' && !check.ok)
  const warnings = buildWarnings(nextTick)

  const verdict: PreflightVerdict = !configurationOk
    ? 'configuration-incomplete'
    : facts.schedulerEnabled
      ? 'planificateur-allume'
      : spends || publishesAlone
        ? 'planificateur-eteint'
        : 'pret-a-ouvrir'

  return {
    verdict,
    phrase: buildPhrase(verdict, failing, nextTick, facts.schedulerEnabled, warnings.length > 0),
    schedulerEnabled: facts.schedulerEnabled,
    configurationOk,
    configuration,
    nextTick,
    warnings,
  }
}
