// ─────────────────────────────────────────────────────────────────────────────
// Preflight API - ce que ferait le prochain tick, avant de l'autoriser
// SEO Engine - GET /api/preflight
// ─────────────────────────────────────────────────────────────────────────────
//
// Cette route n'a AUCUN ecran, aucun composant, aucun lien dans la barre
// laterale, et c'est deliberé : elle se lit en `curl` juste avant de poser
// ENABLE_SCHEDULER, derriere proxy.ts qui protege deja tout ce qui commence par
// /api. Lui donner une page, c'est se donner une page a maintenir pour un geste
// qu'on fait une fois par deploiement.
//
// ELLE NE FAIT RIEN. Aucune ecriture, aucune reclamation, aucun declenchement,
// aucun appel modele. Six lectures, dont quatre en comptage pur
// (`{ count: 'exact', head: true }`) : un pre-vol qui modifierait l'etat qu'il
// decrit serait le premier tick qu'il est cense rendre previsible.
//
// LES REGLES NE SONT PAS ICI. Ce fichier lit et rend ; summary.ts decide et
// s'explique, exactement comme app/api/workflow/route.ts et son state.ts. C'est
// summary.ts qui porte les tests, parce qu'un verdict testable derriere une
// Supabase obligatoire n'est pas un verdict teste.

import { isAnthropicModel } from '@/lib/ai/provider'
import { configReport } from '@/lib/config/preflight'
import { todayLocalDate } from '@/lib/scheduler/editorial'
import { schedulerEnabled } from '@/lib/scheduler/enabled'
import { createServiceClient } from '@/lib/supabase'
import {
  summarisePreflight,
  type PreflightCampaignRef,
  type PreflightCycleRef,
  type PreflightFacts,
} from './summary'

/**
 * Jamais cachee. Une reponse mise en cache repondrait sur l'etat de la base au
 * moment du build — donc sur zero creneau echu, zero cycle expire — pile a
 * l'instant ou l'operateur s'en sert pour decider d'ouvrir la vanne.
 */
export const dynamic = 'force-dynamic'

function rows<T>(result: { data: T[] | null; error: { message: string } | null }, table: string): T[] {
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.data ?? []
}

function count(result: { count: number | null; error: { message: string } | null }, table: string): number {
  if (result.error) throw new Error(`${table}: ${result.error.message}`)
  return result.count ?? 0
}

interface CampaignRow {
  id: string
  name: string
}

interface ClaudeCampaignRow extends CampaignRow {
  ai_model: string | null
}

/**
 * La campagne jointe, dans les DEUX formes que le typage laisse passer.
 *
 * PostgREST rend un OBJET pour une relation plusieurs-vers-un, mais le client
 * n'est pas genere a partir du schema (lib/supabase.ts:18-23 appelle
 * `createClient` sans type `Database`), alors l'inference suppose une collection
 * et type `campaign` en tableau. Declarer l'un des deux et caster l'autre
 * reviendrait a parier sur une inference qu'un jour de typage generera
 * autrement ; accepter les deux et normaliser ne coute qu'une ligne et ne se
 * casse dans aucun des deux sens.
 */
interface EmbeddedCampaign {
  id: string
  name: string
}

interface ExpiringCycleRow {
  id: string
  campaign: EmbeddedCampaign | EmbeddedCampaign[] | null
}

function embedded(campaign: ExpiringCycleRow['campaign']): EmbeddedCampaign | null {
  return Array.isArray(campaign) ? campaign[0] ?? null : campaign
}

type ReadFacts = Omit<PreflightFacts, 'config' | 'schedulerEnabled'>

async function readPreflightFacts(): Promise<ReadFacts> {
  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // Date LOCALE, pas un `toISOString()`.
  //
  // L'en-tete de lib/scheduler/editorial.ts:146-154 le dit : les creneaux sont
  // des dates de CALENDRIER, posees a minuit local, et `toISOString()` repond en
  // UTC. A l'est de Greenwich cela decale le « jour J » du planificateur tous les
  // soirs — en France, une erreur d'un jour chaque soir, exactement la fenetre ou
  // les creneaux du jour devaient partir. Le pre-vol doit lire la meme horloge
  // que cron.ts:475, sinon il annonce 3 creneaux echus quand le tick en prendra 8.
  const today = todayLocalDate()

  const [
    dueSlotsResult,
    dueCampaignsResult,
    autoPublishResult,
    pendingPublishResult,
    expiringCyclesResult,
    activeCampaignsResult,
  ] = await Promise.all([
    // (a) Meme filtre que listDueEditorialSlots (lib/scheduler/editorial.ts:242).
    //
    // Sans le plafond de rattrapage : le cap de 10 par tick est ce qui ETALE la
    // depense, pas ce qui la reduit. L'operateur a besoin du total, sinon un
    // arriere de 80 creneaux se lit « 10 » et la facture arrive sur huit ticks.
    //
    // Legerement au-dessus de ce que le prochain tick prendra vraiment : les
    // creneaux d'aujourd'hui dont l'heure de publication n'est pas encore passee
    // sont comptes ici et ecartes par isSlotDueNow (cron.ts:488). Sur-compter est
    // la direction sure — la sous-estimation est ce qui fait ouvrir a l'aveugle.
    supabase
      .from('editorial_calendar')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'planned')
      .lte('scheduled_date', today),

    // (b) Meme filtre que listDueCampaigns (lib/db.ts:243-254).
    supabase
      .from('campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('next_run_at', 'is', null)
      .lte('next_run_at', now),

    // (c) L'identite, et rien d'autre. `select('*')` sur cette table est ce qui a
    // mis un mot de passe d'application WordPress et un jeton GitHub dans le
    // corps d'une reponse HTTP (lib/db.ts:28-39) ; un rapport de pre-vol est un
    // corps HTTP comme un autre.
    //
    // PAS de filtre `is_active`, et ce n'est pas un oubli : la file de
    // publication differee ne regarde jamais `is_active` (lib/db.ts:335-346).
    // Une campagne desactivee dont des pages dorment en 'generated' les publie
    // quand meme. Filtrer ici cacherait exactement ce cas-la.
    supabase.from('campaigns').select('id,name').eq('auto_publish', true).order('name'),

    // (d) Le filtre EXACT de listPendingPublishGenerations (lib/db.ts:335-346),
    // recopie condition pour condition pour qu'il n'existe pas deux versions de
    // la regle « ce qui part tout seul ». La jointure INTERNE est porteuse : elle
    // exclut les generations sans campagne, qui restent manuelles par
    // construction. `intent = 'create'` est ce qui rend vrai « un
    // rafraichissement ne part jamais seul ».
    //
    // Le `.limit(10)` de l'original n'est pas repris : c'est une taille de page,
    // pas un filtre. Le comptage doit dire la file entiere.
    supabase
      .from('generations')
      .select('id, campaign:campaigns!inner(id)', { count: 'exact', head: true })
      .eq('status', 'generated')
      .eq('intent', 'create')
      .eq('campaign.auto_publish', true)
      .not('content', 'is', null)
      .not('site_id', 'is', null),

    // (e) LE TROISIEME DEPENSIER, celui que la mesure de production n'avait pas
    // compte. Meme lecture que getCampaignsWithExpiringCycles (lib/db.ts:514-524)
    // suivie du filtre `cycle_auto_renew` que checkCycleCompletion applique
    // ensuite (lib/scheduler/cycle-manager.ts:29-31) — pousse ici dans la
    // jointure interne pour ne compter que ce qui partira vraiment.
    //
    // Chacune de ces lignes declenche un crawl de 300 pages sur le site du
    // CLIENT, une indexation vectorielle facturee, un appel modele et la
    // reecriture du calendrier. Sans reclamation et SANS plafond de rattrapage,
    // contrairement aux creneaux et aux campagnes (cron.ts:96-97) : elles partent
    // toutes au meme tick.
    supabase
      .from('cycle_plans')
      .select('id, campaign:campaigns!inner(id,name)')
      .eq('status', 'executing')
      .lte('cycle_ends_at', now)
      .eq('campaign.cycle_auto_renew', true),

    // (f) De quoi trancher ANTHROPIC_API_KEY, ce que le lot 1 ne pouvait pas
    // faire : .env.example:70 la dit « OBLIGATOIRE si une campagne utilise un
    // modele Claude », condition sur la base qu'aucune fonction pure ne peut
    // evaluer. Une cle Claude absente sur une campagne Claude brule trois
    // tentatives par creneau puis le passe en 'failed' (cron.ts:658-672).
    supabase.from('campaigns').select('id,name,ai_model').eq('is_active', true).order('name'),
  ])

  const renewingCycles: PreflightCycleRef[] = rows<ExpiringCycleRow>(expiringCyclesResult, 'cycle_plans').map(
    (cycle) => ({
      id: cycle.id,
      // La jointure interne garantit la campagne ; le repli nomme la ligne plutot
      // que de rendre « undefined » a un operateur qui doit decider.
      campaignName: embedded(cycle.campaign)?.name ?? `campagne inconnue (cycle ${cycle.id})`,
    })
  )

  // Le test « ce modele est-il un Claude ? » est celui de lib/ai/provider.ts:92,
  // pas un `like 'claude-%'` ecrit ici : c'est la fonction que le generateur
  // consulte pour choisir son fournisseur (provider.ts:119). Deux definitions du
  // meme fait, et le pre-vol finirait par rassurer sur une campagne que le
  // moteur enverrait quand meme chez Anthropic.
  const claudeCampaigns: PreflightCampaignRef[] = rows<ClaudeCampaignRow>(activeCampaignsResult, 'campaigns')
    .filter((campaign) => isAnthropicModel(campaign.ai_model ?? ''))
    .map((campaign) => ({ id: campaign.id, name: campaign.name }))

  return {
    dueSlots: count(dueSlotsResult, 'editorial_calendar'),
    dueCampaigns: count(dueCampaignsResult, 'campaigns'),
    pendingDeferredPublications: count(pendingPublishResult, 'generations'),
    autoPublishCampaigns: rows<CampaignRow>(autoPublishResult, 'campaigns').map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
    })),
    renewingCycles,
    claudeCampaigns,
  }
}

/**
 * Echouer bruyamment est LE point de cette route.
 *
 * Un pre-vol qui repond « rien a signaler » parce qu'il n'a pas pu lire est plus
 * dangereux que pas de pre-vol du tout : c'est la seule reponse que l'operateur
 * prendra pour un feu vert. Une lecture partielle ne se resume donc pas, elle se
 * signale — meme motif qu'app/api/workflow/route.ts:114-128.
 */
export async function GET() {
  try {
    const facts = await readPreflightFacts()

    return Response.json(
      summarisePreflight({
        ...facts,
        // Le rapport du lot 1, tel quel. Il ne porte que des noms de variables et
        // des booleens — jamais une valeur, jamais une longueur.
        config: configReport(),
        // L'ETAT du drapeau, pas sa valeur.
        schedulerEnabled: schedulerEnabled(),
      })
    )
  } catch (error) {
    console.error('[GET /api/preflight]', error)
    return Response.json({ error: error instanceof Error ? error.message : 'Erreur interne' }, { status: 500 })
  }
}
