// ─────────────────────────────────────────────────────────────────────────────
// Workflow state — where the operator stands in the five-step path
// SEO Engine - Pure rules, no database
// ─────────────────────────────────────────────────────────────────────────────
//
// The sidebar used to number five steps and say nothing else: no way to tell
// what was already done, what could be opened, or why a step led nowhere. These
// rules answer that from real rows, and they live apart from `route.ts` so they
// can be read and tested without a Supabase instance.
//
// One invariant holds the whole thing together: a step is never `blocked`
// without a `reason`. A greyed entry with no explanation is the dead end this
// file exists to remove.

export type WorkflowStepId = 'sites' | 'schema' | 'strategy' | 'generate' | 'publish'

/**
 * `done` and `blocked` are conclusions drawn from data; `available` is the rest.
 *
 * Pending work outranks past work on purpose: a step that produced pages last
 * week but has three slots waiting today reports `available`, not `done`.
 * Otherwise the sidebar would congratulate the operator while the queue grows.
 */
export type WorkflowStepState = 'done' | 'available' | 'blocked'

export interface WorkflowStep {
  id: WorkflowStepId
  /** 1-based rank, shown as the step number. Derived here so it cannot drift. */
  order: number
  state: WorkflowStepState
  /** Why the step cannot be opened. Always present when `state` is `blocked`. */
  reason?: string
  /** One line of context — what remains, or what was produced. */
  detail?: string
}

/**
 * The single thing to do next, spelled out.
 *
 * Not always one of the five steps: connecting Search Console and analysing a
 * repository are rungs of the same ladder without being sidebar entries, and
 * they are exactly where the chain broke after a site was saved.
 */
export interface WorkflowNextAction {
  label: string
  href: string
  reason: string
}

export interface WorkflowState {
  steps: WorkflowStep[]
  /** First step that can actually be opened. `null` once nothing is pending. */
  currentStepId: WorkflowStepId | null
  nextAction: WorkflowNextAction | null
}

export interface WorkflowSiteFacts {
  id: string
  name: string
  /** `wordpress` | `nextjs` — kept loose, it only picks a wording below. */
  type: string
  isActive: boolean
  /** Next.js: the repository structure has been analysed (`sites.repo_profile`). */
  hasRepoProfile: boolean
  /**
   * WordPress: the CMS schema is READABLE — credentials are on file, so
   * `/api/schema/extract/[siteId]` can list the content types on demand.
   *
   * Deliberately not "has been extracted": the extractor never persists
   * anything (see the header of app/api/schema/extract/[siteId]/route.ts — it
   * re-reads the WordPress REST API on every call). Deriving the fact from
   * `content_schemas` instead made it permanently false, so the sidebar kept
   * asking to "read the schema of X" after twenty successful reads and no
   * WordPress site could ever finish step 2.
   */
  hasCmsSchemaAccess: boolean
  googleConnected: boolean
}

export interface WorkflowFacts {
  sites: WorkflowSiteFacts[]
  campaigns: number
  /** Cycle plans past the draft stage: confirmed, executing or completed. */
  confirmedCycles: number
  draftCycles: number
  /** Editorial slots still waiting for a generation. */
  plannedSlots: number
  /** Generations sitting in `generated`, i.e. awaiting publication. */
  awaitingPublication: number
  /** Generations that produced something: generated, publishing or published. */
  produced: number
  published: number
}

const NO_ACTIVE_SITE = 'Aucun site actif : connectez un site à l’étape 1.'

/**
 * A site the engine can write for.
 *
 * Either description counts, because a site only ever has one: WordPress
 * exposes a content schema, Next.js exposes a repository profile. Demanding
 * both would leave every site permanently unfinished.
 */
function isDescribed(site: WorkflowSiteFacts) {
  return site.hasRepoProfile || site.hasCmsSchemaAccess
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`
}

function blocked(id: WorkflowStepId, order: number, reason: string): WorkflowStep {
  return { id, order, state: 'blocked', reason }
}

export function deriveWorkflowState(facts: WorkflowFacts): WorkflowState {
  const activeSites = facts.sites.filter((site) => site.isActive)
  const undescribed = activeSites.filter((site) => !isDescribed(site))
  const withoutGoogle = activeSites.filter((site) => !site.googleConnected)

  const steps: WorkflowStep[] = [
    sitesStep(facts, activeSites),
    schemaStep(activeSites, undescribed),
    strategyStep(facts, activeSites),
    generateStep(facts, activeSites),
    publishStep(facts, activeSites),
  ]

  // The highlighted step is the first one that can be OPENED, never a blocked
  // one: pointing at a door that does not open is the previous behaviour.
  const currentStepId = steps.find((step) => step.state === 'available')?.id ?? null

  return {
    steps,
    currentStepId,
    nextAction: pickNextAction(facts, steps, undescribed, withoutGoogle),
  }
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function sitesStep(facts: WorkflowFacts, activeSites: WorkflowSiteFacts[]): WorkflowStep {
  if (activeSites.length > 0) {
    return { id: 'sites', order: 1, state: 'done', detail: plural(activeSites.length, 'site actif', 'sites actifs') }
  }

  return {
    id: 'sites',
    order: 1,
    state: 'available',
    detail: facts.sites.length > 0 ? 'Tous vos sites sont désactivés' : 'Aucun site connecté',
  }
}

function schemaStep(activeSites: WorkflowSiteFacts[], undescribed: WorkflowSiteFacts[]): WorkflowStep {
  if (activeSites.length === 0) return blocked('schema', 2, NO_ACTIVE_SITE)

  if (undescribed.length === 0) {
    return { id: 'schema', order: 2, state: 'done', detail: 'Structure connue pour tous les sites' }
  }

  return {
    id: 'schema',
    order: 2,
    state: 'available',
    detail: plural(undescribed.length, 'site à décrire', 'sites à décrire'),
  }
}

function strategyStep(facts: WorkflowFacts, activeSites: WorkflowSiteFacts[]): WorkflowStep {
  if (activeSites.length === 0) return blocked('strategy', 3, NO_ACTIVE_SITE)

  if (facts.confirmedCycles > 0) {
    return { id: 'strategy', order: 3, state: 'done', detail: plural(facts.campaigns, 'campagne', 'campagnes') }
  }

  const detail = facts.campaigns === 0
    ? 'Aucune campagne'
    : facts.draftCycles > 0
      ? 'Plan de cycle à confirmer'
      : 'Aucun cycle lancé'

  return { id: 'strategy', order: 3, state: 'available', detail }
}

function generateStep(facts: WorkflowFacts, activeSites: WorkflowSiteFacts[]): WorkflowStep {
  if (activeSites.length === 0) return blocked('generate', 4, NO_ACTIVE_SITE)

  if (facts.plannedSlots > 0) {
    return {
      id: 'generate',
      order: 4,
      state: 'available',
      detail: plural(facts.plannedSlots, 'créneau planifié', 'créneaux planifiés'),
    }
  }

  if (facts.produced > 0) {
    return { id: 'generate', order: 4, state: 'done', detail: plural(facts.produced, 'page générée', 'pages générées') }
  }

  return blocked('generate', 4, facts.confirmedCycles > 0
    ? 'Aucun créneau planifié : le cycle en cours n’a plus rien à générer.'
    : 'Aucun créneau planifié : confirmez un plan de cycle à l’étape 3.')
}

function publishStep(facts: WorkflowFacts, activeSites: WorkflowSiteFacts[]): WorkflowStep {
  if (activeSites.length === 0) return blocked('publish', 5, NO_ACTIVE_SITE)

  if (facts.awaitingPublication > 0) {
    return {
      id: 'publish',
      order: 5,
      state: 'available',
      detail: plural(facts.awaitingPublication, 'page prête', 'pages prêtes'),
    }
  }

  if (facts.published > 0) {
    return { id: 'publish', order: 5, state: 'done', detail: plural(facts.published, 'page publiée', 'pages publiées') }
  }

  return blocked('publish', 5, 'Aucune page en attente : générez des pages à l’étape 4.')
}

// ─── Next action ─────────────────────────────────────────────────────────────

/**
 * The chain the founder loses right after saving a site.
 *
 * Order matters: describe the site (analyse the repository, read the CMS
 * schema), plug Search Console in, then write a strategy. The two middle rungs
 * are not sidebar entries, which is precisely why nothing ever pointed at them.
 */
function pickNextAction(
  facts: WorkflowFacts,
  steps: WorkflowStep[],
  undescribed: WorkflowSiteFacts[],
  withoutGoogle: WorkflowSiteFacts[]
): WorkflowNextAction | null {
  const stateOf = (id: WorkflowStepId) => steps.find((step) => step.id === id)?.state

  if (stateOf('sites') !== 'done') {
    return facts.sites.length > 0
      ? {
        label: 'Réactiver un site',
        href: '/sites',
        reason: 'Vos sites sont enregistrés mais désactivés : rien ne peut être publié.',
      }
      : {
        label: 'Connecter un site',
        href: '/sites/new',
        reason: 'Rien ne peut être généré ni publié tant qu’aucun site n’est connecté.',
      }
  }

  const [firstUndescribed] = undescribed
  if (firstUndescribed) {
    return firstUndescribed.type === 'wordpress'
      ? {
        label: `Lire le schéma de ${firstUndescribed.name}`,
        href: '/schema',
        reason: 'Les types de contenu et les champs WordPress cadrent la génération.',
      }
      : {
        label: `Analyser le dépôt de ${firstUndescribed.name}`,
        href: '/sites',
        reason: 'Le profil du dépôt dit où écrire les pages et sous quel format.',
      }
  }

  const [firstWithoutGoogle] = withoutGoogle
  if (firstWithoutGoogle) {
    return {
      label: `Connecter Google à ${firstWithoutGoogle.name}`,
      href: '/sites',
      reason: 'Sans Search Console, aucune position ni impression ne remonte.',
    }
  }

  if (stateOf('strategy') !== 'done') {
    return facts.campaigns === 0
      ? {
        label: 'Créer une stratégie',
        href: '/strategy/new',
        reason: 'Une campagne fixe les mots-clés, les communes et le rythme de publication.',
      }
      : {
        label: 'Ouvrir le plan de cycle',
        href: '/strategy',
        reason: facts.draftCycles > 0
          ? 'Un plan attend votre confirmation pour lancer le cycle.'
          : 'Vos campagnes n’ont aucun cycle lancé.',
      }
  }

  if (stateOf('generate') === 'available') {
    return {
      label: 'Générer les pages planifiées',
      href: '/generate',
      reason: `${plural(facts.plannedSlots, 'créneau attend', 'créneaux attendent')} une génération.`,
    }
  }

  if (stateOf('publish') === 'available') {
    return {
      label: 'Publier les pages prêtes',
      href: '/publish',
      reason: `${plural(facts.awaitingPublication, 'page générée attend', 'pages générées attendent')} une publication.`,
    }
  }

  return null
}
