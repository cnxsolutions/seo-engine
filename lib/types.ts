// Database types matching supabase/schema.sql

export type SiteType = 'wordpress' | 'nextjs'
export type PublishStatus = 'publish' | 'draft' | 'pending'
export type GenerationStatus = 'pending' | 'generating' | 'generated' | 'publishing' | 'published' | 'failed' | 'rejected'
export type ArticleType = 'tutorial' | 'list' | 'case_study' | 'glossary' | 'example'
export type BacklinkType = 'thematic' | 'local' | 'directory' | 'guest_post' | 'social'
export type PageType = 'pillar' | 'child' | 'alternative' | 'comparative' | 'local_pack'

/**
 * The one French label per page type, living next to the type it indexes.
 *
 * FIVE local copies had grown apart — the calendar and the strategy list said
 * « Fille » where the dashboard said « Enfant », « Local Pack » where the
 * dashboard said « Local pack » — so the same page was named differently
 * depending on which screen the owner happened to be looking at.
 *
 * Here rather than in a route module because `lib/seo/smart-linking.ts` is a
 * server module and must not import from `app/api/…`: that would point the
 * dependency graph backwards. `lib/types.ts` already declares `PageType`, has no
 * imports at all, and is already imported by both `lib/` and `app/`.
 *
 * ARBITRATION, since a shared dictionary settles wording: 'Enfant' and
 * 'Local pack' win the two labels that actually diverged. `comparative` keeps
 * 'Comparatif' — all five copies agreed on it, and a shared home is no reason to
 * put a word on screen the product has never used.
 *
 * NOT the place for the hub-block labels of `lib/seo/smart-linking.ts`
 * (« Guide complet », « Détail »): those are rendered inside a generated page
 * for its readers, not in the dashboard for its owner. Same keys, different
 * audience, different sentence.
 */
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  pillar: 'Pilier',
  child: 'Enfant',
  alternative: 'Alternative',
  comparative: 'Comparatif',
  local_pack: 'Local pack',
}

/**
 * The lookup for the callers that hold a page type as a bare `string` — the
 * dashboard metrics DTO and the plan rows both carry one, because the column is
 * text and a row written before a new type existed is still readable.
 *
 * It returns the raw value when the key is unknown, which is what every local
 * copy did with `?? value`. Naming it here rather than repeating the `??` at
 * each call site keeps the "what do we show for a type we have never seen"
 * decision in the same file as the labels themselves.
 */
export function pageTypeLabel(value: string): string {
  return (PAGE_TYPE_LABELS as Record<string, string | undefined>)[value] ?? value
}

/**
 * Kept as a loose alias of the generation catalogue: `campaigns.ai_model` is a
 * text column, and a model added in lib/ai/provider must not require a schema
 * change to be selectable.
 */
export type AiProvider = import('@/lib/ai/provider').AiModel | (string & {})
export type ScheduleFrequency = 'manual' | 'daily' | 'every_2_days' | 'every_3_days' | 'weekly' | 'biweekly' | 'monthly' | 'custom'
export type AnalysisRunStatus = 'running' | 'completed' | 'failed'

/**
 * What a generation does to what is already online (migration 018).
 *
 * There is deliberately no new `GenerationStatus` member for a pending refresh:
 * a refresh waiting for a human is a row in `generated` carrying
 * `intent = 'refresh'`, which is why `listPendingPublishGenerations` filters on
 * this column rather than on a status.
 */
export type GenerationIntent = 'create' | 'refresh'

/**
 * The ONE union of deliberate refusals, matching `generations_refusal_kind_check`
 * (migration 018).
 *
 * Deliberate: a refusal waits for a human, a breakage retries itself. Kept as a
 * single union across the product because two of them would invent 'duplicat'
 * and 'doublon' for the same fact.
 */
export type RefusalKind = 'occupe' | 'redirection' | 'identifiants' | 'duplicat'

/**
 * Ce qu'un creneau du calendrier editorial produit (migration 019).
 *
 * UN SEUL calendrier, un discriminant. En creer un second dupliquerait la
 * reclamation de creneau, le budget de tentatives (`attempt_count`) et l'ecran
 * /calendar. Miroir exact de `editorial_calendar_artifact_kind_check`.
 */
export type ArtifactKind = 'page' | 'gbp_post'

/**
 * Les huit statuts d'un post de fiche, miroir de `gbp_posts_status_check`
 * (migration 019).
 *
 * CE N'EST PAS `GenerationStatus`, et la ressemblance est un piege : cette union
 * porte 'incertain', que `generations_status_check` n'autorise pas
 * (db/000_baseline.sql:759). Les fusionner ferait passer un doute d'ecriture
 * pour un statut de page et rendrait inserable dans `generations` une valeur que
 * la base y refuse.
 *
 * 'incertain' = le POST distant n'a ni abouti ni echoue franchement. Un
 * `POST localPosts` n'est pas idempotent : ni un succes, ni un echec, et JAMAIS
 * a rejouer a l'aveugle.
 */
export type GbpPostStatus =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'publishing'
  | 'published'
  | 'rejected'
  | 'failed'
  | 'incertain'

/** Qui a ecrit le post : le moteur, ou le proprietaire a la main sur sa fiche. */
export type GbpPostSource = 'engine' | 'remote'

/**
 * Les quatre motifs qu'autorise `gbp_posts_refusal_check` (migration 019).
 *
 * DISTINCTE de `RefusalKind` ci-dessus, et il faut le dire plutot que le
 * sous-entendre : les deux unions se recoupent sur 'identifiants' et 'duplicat'
 * seulement. 'occupe' et 'redirection' n'ont aucun sens pour un post de fiche —
 * un post ne remplace aucune page — et 'quota' et 'format' n'existent pas cote
 * page. Une union commune obligerait chaque CHECK a accepter les motifs de
 * l'autre canal.
 *
 * `lib/publishing/gbp/record.ts` porte aujourd'hui un jumeau structurel de cette
 * union (`GbpRefusalKind`), local a ce module. Les deux disent exactement la
 * meme chose ; la declaration de reference est ici, parce que c'est ce fichier
 * qui possede les types de LIGNE. Elle n'est pas importee la-bas pour ne pas
 * creer un cycle `lib/types` → `record` → `outcome` → `lib/types`.
 */
export type GbpPostRefusalKind = 'duplicat' | 'identifiants' | 'quota' | 'format'

export interface Site {
  id: string
  name: string
  type: SiteType
  url: string
  wp_username?: string
  wp_app_password?: string
  wp_page_template?: string
  github_repo?: string
  github_token?: string
  /**
   * Branch generated pages are committed to. NULL/absent means the repository
   * default branch — production on most setups, with no review step.
   */
  github_branch?: string
  /**
   * Merge `github_branch` into the repository default branch after publishing.
   *
   * Off by default: turning it on means a generated page reaches production
   * without anyone reading it. On, because otherwise the branch is a dead end —
   * the host deploys the default branch and the page is never visible.
   */
  auto_promote?: boolean
  /**
   * Last schema read from the client's CMS.
   *
   * Kept because reading it is several authenticated round-trips to their
   * production site — the same reason `repo_profile` is kept for Next.js.
   */
  cms_schema?: unknown
  cms_schema_read_at?: string | null
  github_mdx_path?: string
  repo_profile?: unknown
  is_active: boolean
  created_at: string
  updated_at: string
  google_connected?: boolean
  /** Last successful vector indexing run for this site (migration 009). */
  last_indexed_at?: string | null
}

export interface Campaign {
  id: string
  site_id: string
  name: string
  business_type: string
  business_name: string
  keywords: string[]
  department?: string
  communes: string[]
  frequency_hours: number
  schedule_frequency?: ScheduleFrequency
  schedule_days?: number[]
  schedule_time?: string
  ai_model: string
  page_types?: PageType[]
  publish_status: PublishStatus
  auto_publish: boolean
  target_length: number
  system_prompt?: string
  enable_external_links?: boolean
  external_link_count?: number
  enable_images?: boolean
  image_per_page?: number
  is_active: boolean
  last_run_at?: string
  next_run_at?: string
  cycle_duration_days?: number
  current_cycle_id?: string
  cycle_auto_renew?: boolean
  last_crawl_at?: string
  /**
   * Cette campagne a-t-elle le droit d'ecrire sur la fiche etablissement du
   * client (migration 019) ?
   *
   * OPT-IN STRICT : `NOT NULL DEFAULT false` en base, donc aucune campagne
   * existante ne se met a publier sur une fiche sans decision explicite du
   * proprietaire, et un refus « les posts de fiche sont desactives » est le cas
   * NORMAL, pas une panne.
   *
   * Optionnel ici, comme la paire ci-dessous, parce que la colonne a un defaut :
   * un createur de campagne qui ne decide rien n'ecrit pas la colonne, et
   * `CreateCampaignPayload` continue de compiler sans qu'aucune route ait a
   * transporter une valeur qu'elle n'a pas choisie.
   */
  gbp_posts_enabled?: boolean
  /**
   * Jours entre deux posts de fiche. `DEFAULT 7`, borne a [3, 30] par
   * `campaigns_gbp_cadence_check`.
   *
   * Le plancher de trois jours est un GARDE-FOU, pas un reglage : le quota
   * reellement accorde au projet Google Cloud est inconnu depuis le depot — le
   * defaut documente est de zero requete par minute tant que l'acces de base
   * n'est pas accorde (docs/gbp-acces-api.md).
   */
  gbp_post_cadence_days?: number
  created_at: string
  updated_at: string
  site?: Site
}

export interface Generation {
  id: string
  campaign_id?: string
  site_id?: string
  city: string
  slug?: string
  title?: string
  meta_description?: string
  focus_keyword?: string
  content?: string
  page_type?: PageType
  parent_generation_id?: string
  internal_links_to?: string[]
  external_links?: ExternalLink[]
  image_alts?: string[]
  /**
   * The complete page object returned by the generator, stored verbatim.
   *
   * The scalar columns above (title, content, slug…) cannot carry the JSON-LD
   * schemas, the FAQ items or the internal links, so any publishing path that
   * rebuilds a page from them alone silently ships a page stripped of its
   * structured data and internal linking. Persisting the payload lets the
   * deferred publishing job republish exactly what was generated.
   *
   * Nullable: rows created before this column existed fall back to the
   * reconstruction path in the publisher.
   */
  page_payload?: import('@/lib/ai/openai').GeneratedPage
  status: GenerationStatus
  published_url?: string
  published_page_id?: number
  /** How the connector produced the page. Free string, read by humans. */
  publish_mode?: string | null
  /** Whether a visitor could reach it at publication time. Gates indexing. */
  publish_live?: boolean | null
  /** What the connector had to say that was not an error. */
  publish_notes?: string[] | null
  /**
   * Why the engine declined, when it declined on purpose.
   *
   * NULL on a breakage. A breakage retries itself; a refusal waits for a human,
   * and until this column existed the two were the same row in the same status.
   */
  refusal_kind?: RefusalKind | null
  /**
   * Create a page, or refresh one that is already online (migration 018).
   *
   * Optional here and NOT NULL DEFAULT 'create' in the database: every row
   * written before 018 carries 'create', so an absent value never means unknown.
   */
  intent?: GenerationIntent
  /**
   * The path this generation updates. NOT NULL whenever `intent = 'refresh'`,
   * enforced by `generations_refresh_needs_target`.
   *
   * That CHECK is evaluated on every write, so setting `intent` and this column
   * in two separate updates fails the first one: they travel together.
   */
  refresh_target_path?: string | null
  /** The generation that produced the page being refreshed, when the engine wrote it. */
  refresh_target_generation_id?: string | null
  /**
   * What the refresh intends to change, as the planner decided it.
   *
   * `unknown` rather than a shape: nothing reads it back yet, and inventing an
   * interface for a column with no reader is how a contract starts drifting from
   * what is actually stored.
   */
  refresh_plan?: unknown
  /**
   * The duplicate verdict that was reached on this page, kept as evidence.
   *
   * Written even when nothing blocked: the trace that the check RAN is what
   * distinguishes "no duplicate" from "no check". Declared with an inline import
   * so `DuplicateVerdict` keeps exactly one home, like `page_payload` above.
   */
  duplicate_verdict?: import('@/src/core/domain/existing/verdict').DuplicateVerdict | null
  ai_model: string
  tokens_used?: number
  error_message?: string
  scheduled_for?: string
  /**
   * When the page actually went online (migration 010).
   *
   * Distinct from `updated_at`, which moves on every write: the J+30 performance
   * measurement joins a page to the Search Console rows of the 30 days that
   * FOLLOWED its publication, so using `updated_at` silently re-dates a page
   * every time anything touches its row.
   */
  published_at?: string | null
  created_at: string
  updated_at: string
  campaign?: Campaign
  site?: Site
}

export interface ExternalLink {
  url: string
  anchor: string
  domain: string
  relevance: string
}

export interface EditorialSlot {
  id: string
  campaign_id: string
  generation_id?: string
  plan_item_id?: string
  scheduled_date: string
  /**
   * Nature de l'artefact planifie (migration 019). Absent des lignes ecrites
   * avant elle, ou la colonne vaut 'page' par defaut.
   *
   * Optionnel plutot qu'obligatoire pour que `generateEditorialCalendar`
   * (lib/scheduler/editorial.ts) et les autres ecrivains continuent d'omettre la
   * colonne : `NOT NULL DEFAULT 'page'` decide pour eux, et la valeur qu'ils
   * n'ecrivent pas est exactement celle qu'ils voulaient.
   */
  artifact_kind?: ArtifactKind
  /** Le post produit par ce creneau, quand `artifact_kind` vaut 'gbp_post'. */
  gbp_post_id?: string | null
  /**
   * NULLABLE DEPUIS LA MIGRATION 019, et ce n'est pas un elargissement de
   * confort : `editorial_calendar_page_type_check` EXIGE desormais `page_type`
   * NULL sur un creneau 'gbp_post' et non nul sur un creneau 'page'. Un post de
   * fiche n'a pas de type de page, et lui en faire porter un serait mentir en
   * base pour satisfaire un type.
   *
   * Lecteurs corriges avec cette nullabilite, nommes plutot que decouverts au
   * build : `lib/scheduler/cron.ts` (construction de l'override) et
   * `app/(dashboard)/calendar/page.tsx` (`pageTypeLabel`).
   */
  page_type: PageType | null
  /** NULL sur un creneau 'gbp_post' ; obligatoire sur un creneau 'page'
   * (`editorial_calendar_target_keyword_check`). */
  target_keyword: string | null
  target_city?: string
  /**
   * `failed` is terminal on purpose: the scheduler only ever picks up `planned`
   * slots, so a slot that exhausted its retries must not sit in `generating`
   * forever. The reaper hands stale `generating` slots back to `planned`;
   * `failed` means the run really did not work and needs a human decision.
   */
  status: 'planned' | 'generating' | 'generated' | 'published' | 'skipped' | 'failed'
  error_message?: string
  /**
   * Attempts already spent on this slot, incremented when it is claimed.
   *
   * The scheduler retries a slot across ticks rather than inside one: a
   * generation cannot be cancelled, so retrying it a few seconds after a timeout
   * simply runs two of them at once. This counter is what bounds those
   * across-tick retries.
   */
  attempt_count?: number
  created_at: string
  updated_at: string
  campaign?: Campaign
  generation?: Generation
}

/**
 * The slice of a generation the editorial calendar shows: enough to say what
 * came out of a slot and why it failed, without shipping the full HTML page.
 */
export interface CalendarSlotGeneration {
  id: string
  title?: string | null
  slug?: string | null
  status?: GenerationStatus | null
  published_url?: string | null
  error_message?: string | null
  updated_at?: string | null
}

/**
 * A slot as `GET /api/calendar` serialises it.
 *
 * Shared by the route and the page on purpose: both used to redeclare it, with
 * `status` widened to `string` while `EditorialSlot['status']` was gaining its
 * `failed` member. Now that the member exists, one declaration keeps the two
 * ends from drifting again — a status the API can return but the page cannot
 * name is exactly how `failed` stayed invisible in the first place.
 */
export type CalendarSlot = Omit<EditorialSlot, 'generation'> & {
  generation?: CalendarSlotGeneration | null
}

/**
 * Une ligne de `gbp_posts` (migration 019), colonne pour colonne.
 *
 * DEUX ROLES DANS UNE SEULE TABLE, et `source` les separe. Les lignes 'engine'
 * sont le JOURNAL de nos ecritures sur la fiche ; les lignes 'remote' sont le
 * MIROIR des posts que le proprietaire a tapes lui-meme, ramenes par la
 * synchronisation. Les seconds entrent dans le meme corpus d'anti-duplication
 * que les premiers : les ignorer ferait proposer au moteur de redire ce que le
 * proprietaire vient d'ecrire.
 *
 * Ni `topic_type` ni `scheduled_for` : le premier est une CONSTANTE
 * (`GBP_TOPIC_TYPE`, lib/publishing/gbp/format.ts) et un CHECK a une seule
 * valeur ne transporte aucune information ; le second dupliquerait
 * `editorial_calendar.scheduled_date`, joignable par `calendar_slot_id`.
 */
export interface GbpPost {
  id: string
  site_id: string
  campaign_id: string | null
  calendar_slot_id: string | null
  /**
   * La page annoncee. NOT NULL des le statut 'generated' sur un post 'engine'
   * (`gbp_posts_engine_needs_link`) : le maillage post → page est une contrainte
   * de base, pas une intention. 'rejected' et 'failed' en sont exemptes, sinon
   * la trace d'un refus « aucune page a annoncer » serait elle-meme refusee.
   */
  linked_generation_id: string | null
  source: GbpPostSource
  /**
   * NULL sur un post 'remote' — le proprietaire n'a pas choisi dans notre liste
   * (`gbp_posts_engine_needs_angle`). Importe depuis le domaine plutot que
   * redeclare : une seconde union des memes sept valeurs finirait par diverger
   * de `gbp_posts_angle_check`, qu'elle est censee refleter.
   */
  angle: import('@/src/core/domain/gbp/rotation').GbpPostAngle | null
  summary: string
  /**
   * Empreinte des mots utiles du resume (`fingerprintSummary`).
   *
   * CLEF D'INDEX, PAS PREUVE DE DOUBLON : elle sert a apparier une ligne
   * 'incertain' avec le post que l'API a peut-etre cree. Trente-deux bits ne
   * prouvent pas une egalite ; l'anti-duplication reste le cosinus.
   */
  summary_fingerprint: string
  language_code: string
  /**
   * `text` NU en base : la migration 019 n'y pose aucun CHECK, pour ne pas figer
   * une liste que Google peut faire evoluer. La liste autorisee est une decision
   * de `lib/publishing/gbp/format.ts`, verifiee AVANT l'ecriture.
   */
  cta_action_type: string | null
  cta_url: string | null
  status: GbpPostStatus
  refusal_kind: GbpPostRefusalKind | null
  error_message: string | null
  /**
   * `accounts/{a}/locations/{l}/localPosts/{id}` — L'ANCRE D'IDEMPOTENCE, portee
   * par l'index unique partiel `gbp_posts_remote_name_key (site_id, remote_name)`.
   * Sans elle, un delai depasse suivi d'une reprise cree un SECOND post sur la
   * fiche du client, visible par ses prospects.
   */
  remote_name: string | null
  remote_search_url: string | null
  /** `LocalPost.state` tel que Google le rend : LIVE, PROCESSING, REJECTED… */
  remote_state: string | null
  ai_model: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Ce qu'il faut fournir pour ouvrir une ligne.
 *
 * `source`, `language_code` et `status` restent optionnels : la base leur donne
 * un defaut ('engine', 'fr', 'pending'), et les omettre laisse ce defaut decider
 * plutot que de le recopier a chaque site d'ecriture.
 */
export type CreateGbpPostPayload =
  Omit<GbpPost, 'id' | 'created_at' | 'updated_at' | 'source' | 'language_code' | 'status'>
  & Partial<Pick<GbpPost, 'source' | 'language_code' | 'status'>>

export interface Article {
  id: string
  campaign_id?: string
  site_id?: string
  pillar_page_slug?: string
  article_type: ArticleType
  title: string
  slug: string
  content: string
  status: PublishStatus
  published_url?: string
  created_at: string
  updated_at: string
}

export interface Backlink {
  id: string
  site_id: string
  source_url: string
  anchor_text?: string
  link_type: BacklinkType
  domain_authority?: number
  is_verified: boolean
  obtained_at?: string
  created_at: string
}

export interface SitePage {
  id: string
  site_id: string
  url: string
  path: string
  title?: string
  meta_description?: string
  h1?: string
  h2s: string[]
  word_count: number
  focus_keyword?: string
  keywords: string[]
  internal_links: string[]
  external_links: string[]
  has_schema: boolean
  schema_types: string[]
  has_faq: boolean
  has_local_business: boolean
  geo_signals: string[]
  /**
   * Readable body text captured by the crawler (migration 009).
   *
   * This is what the vector index embeds. Without it a document is built from
   * the title and headings alone, which describes what a page is called rather
   * than what it says.
   */
  content_excerpt?: string | null
  /**
   * The canonical this page declares, as a path (migration 018).
   *
   * A page that canonicalises elsewhere occupies its URL without being the page
   * Google indexes; the inventory needs to say so rather than treat it as a
   * plain competitor.
   */
  canonical_path?: string | null
  /** `<meta name="robots" content="noindex">` seen at crawl time. */
  robots_noindex?: boolean
  /**
   * Who put this row here: the crawler, or a publication by the engine.
   *
   * OPTIONAL, like the three fields around it, so a writer that does not know
   * the answer omits the key: `CreateSitePagePayload` inherits them optional and
   * the PostgREST upsert then never emits those columns, leaving whatever the
   * previous writer put there. That is the only reason a crawl path can be
   * migrated one at a time instead of all at once.
   */
  origin?: 'crawl' | 'engine'
  /** The generation that published this page, when the engine published it. */
  generation_id?: string | null
  crawled_at: string
  created_at: string
  updated_at: string
}

export type CreateSitePagePayload = Omit<SitePage, 'id' | 'created_at' | 'updated_at'>

export type CyclePlanStatus = 'draft' | 'confirmed' | 'executing' | 'completed' | 'cancelled'

/**
 * Ce que la resolution d'adresse a REELLEMENT pu prouver, pour une page a creer.
 *
 * Trois etats et pas deux : 'free' promet qu'aucune page du site n'occupe cette
 * URL, et cette promesse ne peut pas etre tenue sur un inventaire aveugle. Sans
 * 'unverified', l'ecran afficherait le meme « adresse libre » pour une
 * verification faite et pour une verification impossible — c'est-a-dire qu'il
 * ferait passer une ignorance pour une garantie.
 *
 * Aucun statut 'collision' ici : un sujet dont l'adresse ne se libere pas ne
 * devient pas une page a creer, il devient un item 'skip' portant son motif.
 */
export type SlugResolutionDto =
  | { status: 'free' }
  | { status: 'disambiguated'; from: string; token: string }
  | { status: 'unverified'; reason: string }

/**
 * Ce qu'un brief fait au site qui existe deja, decide AVANT le premier jeton.
 *
 * Les branches 'refresh' et 'skip' sont celles du domaine, reprises TELLES
 * QUELLES : le verdict est rendu par decideEditorialAction, et le redeclarer ici
 * ferait exister deux formes de la meme decision, dont l'une derivera. Seule la
 * branche 'create' est enrichie, de la seule chose que le domaine ne pouvait pas
 * savoir — l'adresse retenue et comment elle a ete obtenue.
 *
 * Un plan deja en base ne porte PAS ce champ : les vues lisent
 * `item.action?.kind ?? 'create'` et rangent les briefs anciens dans les
 * nouvelles pages. Un plan relu n'invente aucun verdict.
 */
export type PlanItemAction =
  | { kind: 'create'; slug: SlugResolutionDto }
  | Exclude<import('@/src/core/domain/existing/action').EditorialAction, { kind: 'create' }>

export interface PlanItemBrief {
  id: string
  scheduled_date: string
  page_type: PageType
  priority: 'high' | 'medium' | 'low'
  target_city: string
  target_keyword: string
  secondary_keywords: string[]
  search_intent: string
  proposed_title: string
  proposed_slug: string
  page_goal: string
  outline: string[]
  seo_rules: string[]
  required_entities: string[]
  internal_link_targets: string[]
  competitor_insights: string[]
  estimated_word_count: number
  rationale: string
  /** Ce que ce brief fait a l'existant. Absent des plans ecrits avant ce lot. */
  action?: PlanItemAction
  /**
   * La PROJECTION de `action` sous les noms de colonnes de la migration 018.
   *
   * Ces trois champs ne sont ecrits que sur un item 'refresh', et jamais
   * ailleurs qu'a l'endroit unique qui construit `action` : ils existent pour
   * que le planificateur de cycle recopie une intention dans `generations` sans
   * avoir a connaitre l'union du domaine. `action` reste la source ; en cas de
   * doute, c'est elle qu'il faut lire.
   */
  refresh_target_path?: string
  refresh_target_generation_id?: string
  refresh_scope?: import('@/src/core/domain/existing/action').RefreshScope
}

export type PlanPreviewItem = PlanItemBrief

export interface CyclePlan {
  id: string
  campaign_id: string
  cycle_number: number
  status: CyclePlanStatus
  cycle_duration_days: number
  cycle_started_at?: string
  cycle_ends_at?: string
  plan_data: PlanPreviewItem[]
  total_pages: number
  total_estimated_words: number
  crawl_completed_at?: string
  created_at: string
  updated_at: string
}

export type CreateCyclePlanPayload = Omit<CyclePlan, 'id' | 'created_at' | 'updated_at'>

export interface AnalysisRunData {
  site: {
    url: string
    pagesFound: number
    pagesCrawled: number
    topKeywords: string[]
    pages: Array<{
      path: string
      title: string
      h1: string
      wordCount: number
      keywords: string[]
      hasFaq: boolean
      hasSchema: boolean
      geoSignals: string[]
    }>
  }
  competitors: Array<{
    url: string
    pagesFound: number
    pagesCrawled: number
    topKeywords: string[]
    pages: AnalysisRunData['site']['pages']
    strengths: string[]
    errors?: string[]
  }>
  gapAnalysis: {
    missingKeywords: string[]
    contentPatterns: string[]
    localOpportunities: string[]
    technicalGaps: string[]
    suggestedAngles: string[]
  }
}

export interface AnalysisRun {
  id: string
  site_id?: string
  status: AnalysisRunStatus
  input: {
    siteUrl: string
    businessType?: string
    businessName?: string
    targetCities?: string[]
    competitorUrls: string[]
  }
  analysis_data: AnalysisRunData
  error_message?: string
  created_at: string
  updated_at: string
  site?: Site
}

export type CreateSitePayload = Omit<Site, 'id' | 'created_at' | 'updated_at'>
export type CreateCampaignPayload = Omit<Campaign, 'id' | 'created_at' | 'updated_at' | 'last_run_at' | 'next_run_at' | 'site'>
export type CreateGenerationPayload = Omit<Generation, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'site'>
export type CreateArticlePayload = Omit<Article, 'id' | 'created_at' | 'updated_at'>
export type CreateBacklinkPayload = Omit<Backlink, 'id' | 'created_at'>
export type CreateEditorialSlotPayload = Omit<EditorialSlot, 'id' | 'created_at' | 'updated_at' | 'campaign' | 'generation'>
export type CreateAnalysisRunPayload = Omit<AnalysisRun, 'id' | 'created_at' | 'updated_at' | 'site'>
