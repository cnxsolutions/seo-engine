'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Étape 5, onglet « Fiche Google » — composer, relire, publier un post de fiche
// ─────────────────────────────────────────────────────────────────────────────
//
// ZÉRO ÉCRAN NOUVEAU. Le chantier des posts de fiche tient dans un onglet du
// contenant existant : le patron de file de /publish (panneau, ligne, une action
// par ligne avec `busy` et son erreur locale) et le patron de lancement de
// /generate sont réemployés tels quels, jusqu'aux composants — `Panel` et
// `rowStyle` viennent de ./queue-bits, sans un pixel réécrit.
//
// L'OPÉRATEUR CHOISIT UN ANGLE, PAS UN TEXTE. Il n'y a délibérément aucun champ
// de saisie libre ici : un texte tapé à la main contournerait le contrôle
// d'intégrité factuelle de lib/publishing/gbp/gate.ts, qui refuse une note ou un
// tarif que la fiche ne porte pas. L'angle est la seule décision éditoriale
// laissée à l'humain, et elle est bornée par ce que la politique autorise.
//
// CE QUE CET ÉCRAN NE PROMET PAS. Aucune statistique par post :
// `localPosts.reportInsights` est supprimé depuis février 2023 et aucune mesure
// par post n'est disponible par cette voie. Aucune limite de format n'est écrite
// ici : `GBP_SUMMARY_MAX_CHARS` et `GBP_SUMMARY_TARGET` entrent en props depuis
// lib/publishing/gbp/format.ts, où elles portent leur mention « à confirmer
// contre l'API réelle ». Et l'accès en ÉCRITURE à l'API n'est pas encore
// accordé : le quota par défaut est de zéro requête par minute tant que
// l'« Application For Basic API Access » n'est pas approuvée
// (voir docs/gbp-acces-api.md). C'est `eligibility.blockedReason` qui le dit,
// calculé côté serveur — jamais deviné ici.
//
// LA VUE NE RECALCULE AUCUNE RÈGLE. Cooldowns d'angle et de lien, cadence,
// plafond hebdomadaire, page à annoncer : tout arrive dans `eligibility`, décidé
// par lib/gbp/posts/schedule.ts. Un second exemplaire de la politique côté
// client divergerait du premier au premier réglage de constante, et l'opérateur
// verrait proposée une option que le serveur refuserait ensuite.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CheckCircle,
  CircleQuestionMark,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  Search,
  Send,
  ShieldAlert,
  Store,
} from 'lucide-react'
import {
  Button,
  EmptyState,
  GbpPostPreview,
  Notice,
  ReasonList,
  StatTile,
  StatusBadge,
  UnknownValue,
  formatDay,
  shortenUrl,
} from '@/components/ui'
import { SiteSwitcher } from '@/components/charts'
import { GBP_SUMMARY_MAX_CHARS, GBP_SUMMARY_TARGET, type GbpActionType } from '@/lib/publishing/gbp/format'
import {
  splitReasons,
  type FeedGbpPost,
  type GbpAngle,
  type GbpEligibility,
  type GbpPostComposeResponse,
  type GbpPostCounts,
  type GbpPostErrorResponse,
  type GbpPostFeedResponse,
  type GbpPostPublishResponse,
} from '@/app/api/gbp/posts/feed-types'
import { Panel, rowStyle } from './queue-bits'

// ─── Vocabulaire ─────────────────────────────────────────────────────────────

/**
 * Les sept angles en français, écrits UNE fois.
 *
 * `Record<GbpAngle, string>` et non `Record<string, string>` : le compilateur
 * exige alors une ligne par membre de l'union, et le jour où un huitième angle
 * entre dans `gbp_posts_angle_check` ce fichier cesse de compiler. C'est tout
 * son rôle — une table élargie rendrait `undefined` à l'écran sans rien dire.
 *
 * OÙ CE DICTIONNAIRE DEVRAIT VIVRE : components/ui.tsx, aux côtés de
 * `PAGE_TYPE_LABELS` (contrat _ROLE-UX). Ce fichier n'est pas dans ce lot, et
 * recopier sept libellés dans /calendar ET ici est exactement la façon dont les
 * cinq `PAGE_TYPE_LABELS` divergents du dépôt sont nés. Le calendrier importe
 * donc cette table d'ici, en attendant qu'elle remonte dans le système de
 * design ; les deux modules sont des composants clients du même bundle.
 */
export const GBP_ANGLE_LABELS: Record<GbpAngle, string> = {
  service: 'Une prestation',
  zone: 'Une zone desservie',
  horaires: 'Les horaires',
  avis: 'Un avis client',
  faq: 'Une question fréquente',
  saison: 'Un moment de l’année',
  'nouvelle-page': 'Une nouvelle page',
}

/**
 * L'angle d'un post, tel qu'on l'affiche — jamais la valeur brute de la colonne.
 *
 * `null` n'est PAS une donnée manquante : la colonne est nullable par
 * construction (`gbp_posts_engine_needs_angle`) et un post écrit à la main par
 * le propriétaire n'a choisi dans aucune de nos listes. Le dire vaut mieux que
 * le tiret cadratin, qui se lit « on a perdu quelque chose ».
 */
export function angleLabel(value: string | null): string {
  if (!value) return 'Sans angle'
  return (GBP_ANGLE_LABELS as Record<string, string | undefined>)[value] ?? value
}

/**
 * Le libellé du bouton d'appel à l'action, tel que Google l'affichera.
 *
 * Indexé par `GbpActionType`, l'union de `GBP_ALLOWED_ACTION_TYPES` : la LISTE
 * appartient à lib/publishing/gbp/format.ts et n'est pas recopiée — seuls les
 * mots français le sont, et ils sont à l'interface. `GET_OFFER` est absent
 * partout : Google l'a déprécié.
 */
const CTA_LABELS: Record<GbpActionType, string> = {
  BOOK: 'Réserver',
  ORDER: 'Commander',
  SHOP: 'Voir la boutique',
  LEARN_MORE: 'En savoir plus',
  SIGN_UP: 'S’inscrire',
  CALL: 'Appeler',
}

function ctaLabel(actionType: string): string {
  return (CTA_LABELS as Record<string, string | undefined>)[actionType] ?? actionType
}

/**
 * Les quatre motifs de `gbp_posts_refusal_check`, traduits pour un humain.
 *
 * `Record<string, …>` ici, et c'est délibéré : la colonne est un `text` nu côté
 * base et une valeur inconnue doit rester affichable plutôt que de vider la
 * ligne. Le repli rend la valeur brute, jamais `undefined`.
 */
const REFUSAL_LABELS: Record<string, { title: string; help: string }> = {
  duplicat: {
    title: 'Post refusé — trop proche d’un post récent',
    help:
      'Le moteur l’a comparé aux douze derniers posts de la fiche, y compris ceux que vous avez '
      + 'écrits vous-même.',
  },
  identifiants: {
    title: 'Post refusé — la connexion Google n’autorise pas l’écriture sur la fiche',
    help: 'Reconnectez le compte en acceptant la gestion de la fiche d’établissement.',
  },
  quota: {
    title: 'Post non parti — Google n’accepte aucune écriture sur cette fiche pour l’instant',
    help: 'Ce n’est pas une panne du moteur : c’est un quota à demander.',
  },
  format: {
    title: 'Post refusé — Google a rejeté le format',
    help: 'La réponse de Google est reproduite telle quelle ci-dessous.',
  },
}

function refusalTitle(kind: string | null, status: FeedGbpPost['status']): string {
  if (kind && REFUSAL_LABELS[kind]) return REFUSAL_LABELS[kind].title
  if (kind) return `Post refusé — motif enregistré : ${kind}`
  return status === 'rejected' ? 'Post refusé par le contrôle qualité' : 'La publication n’a pas abouti'
}

// ─── État initial ────────────────────────────────────────────────────────────

/**
 * Huit compteurs INCONNUS, pas huit zéros.
 *
 * Avant la première réponse, personne n'a compté. Poser 0 afficherait « aucun
 * refus » sur un écran qui n'a encore rien lu — la façon la moins chère de
 * mentir dans un tableau de bord, et celle qui fait cesser d'aller voir.
 */
const UNKNOWN_COUNTS: GbpPostCounts = {
  pending: null,
  generating: null,
  generated: null,
  publishing: null,
  published: null,
  rejected: null,
  failed: null,
  incertain: null,
  total: null,
}

/** L'historique est une histoire, pas une file : les vingt derniers suffisent. */
const PUBLISHED_SHOWN = 20

/** Le scrutin ne tourne QUE tant qu'une ligne est réellement en vol. */
const POLL_MS = 15_000

interface RowError {
  message: string
  reasons: string[]
  /** `true` = le post existe peut-être sur la fiche. Interdiction de rejouer. */
  written: boolean
}

type ComposeOutcome =
  | { ok: true; post: FeedGbpPost; notes: string[] }
  | { ok: false; message: string; reasons: string[]; refusalKind: string | null; post: FeedGbpPost | null }

// ─── L'onglet ────────────────────────────────────────────────────────────────

export function GbpTab({ initialSiteId }: { initialSiteId: string | null }) {
  const [posts, setPosts] = useState<FeedGbpPost[]>([])
  const [counts, setCounts] = useState<GbpPostCounts>(UNKNOWN_COUNTS)
  const [eligibility, setEligibility] = useState<GbpEligibility | null>(null)
  const [sites, setSites] = useState<GbpPostFeedResponse['sites']>([])
  const [campaigns, setCampaigns] = useState<GbpPostFeedResponse['campaigns']>([])
  const [siteId, setSiteId] = useState<string | null>(initialSiteId)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, RowError>>({})

  const [campaignId, setCampaignId] = useState('')
  const [angle, setAngle] = useState('')
  const [composing, setComposing] = useState(false)
  const [compose, setCompose] = useState<ComposeOutcome | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (siteId) params.set('site_id', siteId)

    try {
      const res = await fetch(`/api/gbp/posts?${params.toString()}`)
      const data: GbpPostFeedResponse & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lecture impossible')

      setPosts(data.posts ?? [])
      setCounts(data.counts ?? UNKNOWN_COUNTS)
      setEligibility(data.eligibility ?? null)
      setSites(data.sites ?? [])
      setCampaigns(data.campaigns ?? [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  /**
   * L'onglet choisit le site, parce que `SiteSwitcher` ne le fait pas.
   *
   * `allLabel={null}` retire seulement la ligne « Tous les sites » : le composant
   * AFFICHE alors la première option quand `value` est nul, mais ne la
   * sélectionne pas. Sans cette initialisation, `eligibility` resterait nulle —
   * la route la refuse sans `site_id`, une éligibilité agrégée sur plusieurs
   * fiches ne voulant rien dire — et l'écran entier paraîtrait cassé.
   */
  useEffect(() => {
    if (siteId === null && sites.length > 0) setSiteId(sites[0].id)
  }, [siteId, sites])

  // Le scrutin, à la règle de /generate : il ne tourne que tant qu'une ligne est
  // en vol, et il s'arrête de lui-même. Un compteur INCONNU (`null`) ne le
  // déclenche pas : on ne rappelle pas une route toutes les quinze secondes sur
  // la foi d'un chiffre qu'on n'a pas pu établir.
  const inFlight = (counts.generating ?? 0) + (counts.publishing ?? 0)
  useEffect(() => {
    if (inFlight <= 0) return
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [inFlight, load])

  const siteCampaigns = useMemo(
    () => campaigns.filter((c) => (!siteId || c.site_id === siteId) && c.gbp_posts_enabled),
    [campaigns, siteId]
  )

  // La campagne sélectionnée doit toujours exister dans la liste visible : un
  // changement de site laisserait sinon un identifiant fantôme dans le corps du
  // POST, et le serveur répondrait 404 sur un choix que l'écran affiche encore.
  useEffect(() => {
    if (campaignId && !siteCampaigns.some((c) => c.id === campaignId)) setCampaignId('')
  }, [campaignId, siteCampaigns])

  const siteName = useMemo(
    () => sites.find((s) => s.id === siteId)?.name ?? 'Votre établissement',
    [sites, siteId]
  )

  const queue = posts.filter((p) => p.status === 'generated' || p.status === 'publishing')
  const uncertain = posts.filter((p) => p.status === 'incertain')
  const refused = posts.filter((p) => p.status === 'rejected' || p.status === 'failed')
  const published = posts.filter((p) => p.status === 'published').slice(0, PUBLISHED_SHOWN)

  const clearError = (id: string) =>
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  /**
   * Composer un post : écrire un brouillon et le passer au contrôle.
   *
   * Ce clic ne publie RIEN. Le libellé du bouton dit ce qu'il fait, parce qu'un
   * « Publier » ici enverrait sur la fiche d'un client un texte que personne n'a
   * lu.
   */
  const composePost = async () => {
    if (!campaignId) return
    setComposing(true)
    setCompose(null)

    try {
      const res = await fetch('/api/gbp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, ...(angle ? { angle } : {}) }),
      })
      // `Partial` des deux formes, et non leur intersection : une réponse porte
      // l'une OU l'autre, et un type qui promettrait les deux ferait lire
      // `data.error` comme une chaîne présente sur un succès. La garde
      // ci-dessous est donc exigée par le type, pas ajoutée par prudence.
      const data: Partial<GbpPostComposeResponse> & Partial<GbpPostErrorResponse> = await res.json()

      if (res.ok && data.success && data.post) {
        setCompose({ ok: true, post: data.post, notes: data.notes ?? [] })
      } else {
        setCompose({
          ok: false,
          message: data.error || 'Composition impossible',
          reasons: data.rejected?.reasons ?? [],
          refusalKind: data.rejected?.refusal_kind ?? data.refusal_kind ?? null,
          post: data.post ?? null,
        })
      }
    } catch (error) {
      setCompose({
        ok: false,
        message: error instanceof Error ? error.message : 'Erreur réseau',
        reasons: [],
        refusalKind: null,
        post: null,
      })
    } finally {
      setComposing(false)
      load()
    }
  }

  /**
   * Pousser une ligne sur la fiche — et, sur une ligne 'incertain', LEVER LE
   * DOUTE.
   *
   * Un seul appel dessert les deux gestes, et ce n'est pas un raccourci : le
   * premier acte de `runGbpPostNow` est la relecture de la fiche avec appariement
   * par empreinte de résumé, jamais un rejeu. La ligne incertaine n'est JAMAIS
   * renvoyée — un `POST localPosts` n'est pas idempotent et l'API n'accepte
   * aucune clef d'idempotence — et rien d'autre ne part tant qu'un doute
   * subsiste. C'est la seule action du produit capable de trancher, ce pourquoi
   * la route ne refuse pas 'incertain'.
   */
  const publishPost = async (id: string) => {
    setBusyId(id)
    clearError(id)

    try {
      const res = await fetch('/api/gbp/posts/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id }),
      })
      const data: Partial<GbpPostPublishResponse> & Partial<GbpPostErrorResponse> = await res.json()

      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [id]: {
            message: data.error || 'Publication impossible',
            reasons: data.rejected?.reasons ?? [],
            written: data.written === true,
          },
        }))
      }
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [id]: {
          message: error instanceof Error ? error.message : 'Erreur réseau',
          reasons: [],
          // Une requête partie sans réponse ne prouve pas qu'elle n'a rien écrit.
          written: true,
        },
      }))
    } finally {
      setBusyId(null)
      load()
    }
  }

  const linkTarget = eligibility?.nextLinkTarget ?? null
  const composeBlocked =
    !campaignId || !linkTarget || Boolean(eligibility?.blockedReason) || eligibility?.credentialsReady === false

  return (
    <div>
      <div className="toolbar">
        <SiteSwitcher
          sites={sites}
          value={siteId}
          onChange={(next) => setSiteId(next)}
          allLabel={null}
        />
      </div>

      <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="À publier" value={countValue(counts.generated)} icon={Clock} />
        <StatTile label="En ligne" value={countValue(counts.published)} icon={CheckCircle} />
        <StatTile label="Refusés" value={countValue(counts.rejected)} icon={ShieldAlert} />
        <StatTile
          label="Écriture incertaine"
          value={countValue(counts.incertain)}
          icon={CircleQuestionMark}
          emphasis={(counts.incertain ?? 0) > 0}
          hint="Ni un succès, ni un échec : le seul état qui demande un regard humain."
        />
        <StatTile
          label="Posts cette semaine"
          value={
            eligibility
              ? `${eligibility.postsThisIsoWeek} / ${eligibility.weeklyCap}`
              : <UnknownValue why="La politique de publication n’a pas pu être lue pour ce site." />
          }
          icon={Send}
          hint={eligibility ? `Cadence : un post tous les ${eligibility.cadenceDays} jours` : undefined}
        />
      </div>

      {loadError ? (
        <div className="panel">
          <div className="panel__body">
            <EmptyState
              bare
              variant="error"
              title="File des posts illisible"
              description={loadError}
              action={{ label: 'Recharger la file', onClick: load }}
            />
          </div>
        </div>
      ) : loading ? (
        <div className="panel">
          <div className="panel__body" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
            <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
          </div>
        </div>
      ) : (
        <>
          <ComposePanel
            siteId={siteId}
            siteName={siteName}
            campaigns={siteCampaigns}
            campaignId={campaignId}
            onCampaignChange={setCampaignId}
            angle={angle}
            onAngleChange={setAngle}
            eligibility={eligibility}
            blocked={composeBlocked}
            running={composing}
            outcome={compose}
            onCompose={composePost}
          />

          <Panel
            title="File d’attente"
            count={queue.length}
            hint="Ces posts sont écrits et acceptés par le contrôle. Rien ne part sans votre clic."
          >
            {queue.length === 0 ? (
              <div className="panel__body">
                <EmptyState
                  bare
                  icon={Store}
                  title="Aucun post n’attend une publication"
                  description="Composez un post ci-dessus, ou attendez le prochain créneau planifié de la campagne."
                />
              </div>
            ) : (
              <div className="panel__body--flush">
                {queue.map((post, index) => (
                  <QueueRow
                    key={post.id}
                    post={post}
                    siteName={siteName}
                    last={index === queue.length - 1}
                    busy={busyId === post.id}
                    disabled={busyId !== null}
                    error={errors[post.id]}
                    onPublish={() => publishPost(post.id)}
                  />
                ))}
              </div>
            )}
          </Panel>

          {uncertain.length > 0 && (
            <Panel
              title="Écriture incertaine"
              count={uncertain.length}
              hint="Le moteur n’a pas su si Google avait enregistré ces posts. Rien n’est réécrit à l’aveugle : la prochaine tentative commence par relire la fiche."
            >
              <div className="panel__body--flush">
                {uncertain.map((post, index) => (
                  <UncertainRow
                    key={post.id}
                    post={post}
                    last={index === uncertain.length - 1}
                    busy={busyId === post.id}
                    disabled={busyId !== null}
                    error={errors[post.id]}
                    onVerify={() => publishPost(post.id)}
                  />
                ))}
              </div>
            </Panel>
          )}

          {refused.length > 0 && (
            <Panel
              title="Refusés"
              count={refused.length}
              hint="Ces posts ont été écrits et payés : ils ne sont pas partis, et voici pourquoi."
            >
              <div className="panel__body--flush">
                {refused.map((post, index) => (
                  <RefusedRow key={post.id} post={post} siteId={siteId} last={index === refused.length - 1} />
                ))}
              </div>
            </Panel>
          )}

          {published.length > 0 && (
            <Panel title="Sur la fiche" count={counts.published ?? published.length}>
              <div className="panel__body--flush">
                {published.map((post, index) => (
                  <PublishedRow key={post.id} post={post} last={index === published.length - 1} />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

/** Un compteur qu'on n'a pas pu établir se dit, il ne s'affiche pas en zéro. */
function countValue(value: number | null): ReactNode {
  return value ?? <UnknownValue why="Le comptage n’a pas pu être établi pour ce statut." />
}

// ─── Composer ────────────────────────────────────────────────────────────────

function ComposePanel({
  siteId,
  siteName,
  campaigns,
  campaignId,
  onCampaignChange,
  angle,
  onAngleChange,
  eligibility,
  blocked,
  running,
  outcome,
  onCompose,
}: {
  siteId: string | null
  siteName: string
  campaigns: GbpPostFeedResponse['campaigns']
  campaignId: string
  onCampaignChange: (id: string) => void
  angle: string
  onAngleChange: (angle: string) => void
  eligibility: GbpEligibility | null
  blocked: boolean
  running: boolean
  outcome: ComposeOutcome | null
  onCompose: () => void
}) {
  const linkTarget = eligibility?.nextLinkTarget ?? null

  return (
    <div className="panel" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="panel__header">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">Composer un post</h2>
          <p className="meta" style={{ marginTop: 2 }}>
            Vous choisissez l’angle ; le moteur écrit le texte à partir de ce que la fiche déclare, et rien d’autre.
          </p>
        </div>
      </div>

      <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {eligibility?.credentialsReady === false && (
          <Notice
            inline
            tone="critical"
            title="Fiche Google non reliée"
            body="Compte, fiche ou autorisation d’écriture manquants. Aucun post ne peut partir tant que les trois ne sont pas réunis."
            action={siteId ? { label: 'Voir la connexion Google', href: `/sites/${siteId}/google` } : undefined}
          />
        )}

        {eligibility?.blockedReason && (
          <Notice inline tone="warning" title="Rien ne peut partir maintenant" body={eligibility.blockedReason} />
        )}

        {campaigns.length === 0 ? (
          <EmptyState
            bare
            icon={Store}
            title="Aucune campagne ne publie sur la fiche"
            description="Les posts de fiche sont désactivés par défaut : aucune campagne existante ne se met à publier sur la fiche d’un client sans une décision explicite."
          />
        ) : (
          <>
            <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <span className="field-label">Campagne</span>
                <select className="input" value={campaignId} onChange={(e) => onCampaignChange(e.target.value)}>
                  <option value="">Choisir une campagne…</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                  ))}
                </select>
              </label>

              <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <span className="field-label">Angle</span>
                {/* Les angles fermés restent VISIBLES, grisés, avec leur motif en
                    infobulle. Les retirer laisserait l'opérateur devant une liste
                    qui rétrécit sans qu'il sache ni quoi corriger ni s'il doit
                    attendre. Le motif vient de la politique, jamais d'ici. */}
                <select className="input" value={angle} onChange={(e) => onAngleChange(e.target.value)}>
                  <option value="">Laisser le moteur choisir</option>
                  {(eligibility?.anglesAvailable ?? []).map((value) => (
                    <option key={value} value={value}>{GBP_ANGLE_LABELS[value]}</option>
                  ))}
                  {(eligibility?.anglesBlocked ?? []).map(({ angle: value, reason }) => (
                    <option key={value} value={value} disabled title={reason}>
                      {GBP_ANGLE_LABELS[value]} — {reason}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* La page annoncée est une PRÉCONDITION, pas un bonus : la contrainte
                `gbp_posts_engine_needs_link` l'exige dès le statut 'generated'.
                Elle est donc affichée en lecture seule — la politique la choisit,
                l'opérateur la constate. */}
            {linkTarget ? (
              <div className="inset" style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <span className="field-label">Page annoncée par ce post</span>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', fontWeight: 600 }}>
                  {linkTarget.title ?? linkTarget.slug ?? 'Page sans titre'}
                </span>
                {linkTarget.published_url && (
                  <a
                    href={linkTarget.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-link"
                    style={{ justifySelf: 'start' }}
                  >
                    {shortenUrl(linkTarget.published_url)} <ExternalLink size={12} />
                  </a>
                )}
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-secondary)' }}>
                  Ce post pointera vers cette page. Le maillage post → page est une précondition, pas un bonus.
                </span>
              </div>
            ) : (
              <Notice
                inline
                tone="warning"
                title="Aucune page à annoncer"
                body="Les derniers posts couvrent déjà toutes les pages publiées récentes. Publiez une page, ou attendez que la rotation en libère une."
              />
            )}

            <div>
              <Button icon={Play} loading={running} disabled={blocked} onClick={onCompose}>
                Composer et vérifier
              </Button>
            </div>

            {outcome && <ComposeOutcomeBlock outcome={outcome} siteName={siteName} siteId={siteId} />}
          </>
        )}
      </div>
    </div>
  )
}

function ComposeOutcomeBlock({
  outcome,
  siteName,
  siteId,
}: {
  outcome: ComposeOutcome
  siteName: string
  siteId: string | null
}) {
  if (outcome.ok) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Notice
          inline
          tone="good"
          title="Post composé — il attend votre publication"
          body="Le contrôle l’a accepté. Relisez-le ci-dessous : c’est exactement le texte qui partira sur la fiche."
        />
        <PostPreview post={outcome.post} businessName={siteName} />
        {outcome.notes.length > 0 && (
          <ReasonList tone="info" title="À savoir sur ce post" reasons={outcome.notes} />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <ReasonList title={outcome.message} reasons={outcome.reasons} />
      {outcome.refusalKind === 'identifiants' && siteId && (
        <Notice
          inline
          tone="warning"
          title="La connexion Google n’autorise pas l’écriture sur la fiche"
          body={REFUSAL_LABELS.identifiants.help}
          action={{ label: 'Voir la connexion Google', href: `/sites/${siteId}/google` }}
        />
      )}
      {outcome.post && <PostPreview post={outcome.post} businessName={siteName} />}
    </div>
  )
}

// ─── Lignes ──────────────────────────────────────────────────────────────────

/**
 * L'aperçu : ce que Google affichera, sans rien y ajouter.
 *
 * Les deux limites entrent en props depuis format.ts et ne sont écrites ni ici
 * ni dans le système de design — elles portent la mention « à confirmer contre
 * l'API réelle » et seront corrigées par le premier 400 rencontré.
 */
function PostPreview({ post, businessName }: { post: FeedGbpPost; businessName: string }) {
  return (
    <GbpPostPreview
      businessName={businessName}
      summary={post.summary}
      maxChars={GBP_SUMMARY_MAX_CHARS}
      target={GBP_SUMMARY_TARGET}
      cta={
        post.cta_action_type
          ? {
            actionType: post.cta_action_type,
            label: ctaLabel(post.cta_action_type),
            url: post.cta_url ?? undefined,
          }
          : undefined
      }
    />
  )
}

/** Le résumé COMPLET, jamais tronqué : c'est tout l'objet à relire avant de publier. */
function FullSummary({ summary }: { summary: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 'var(--fs-sm)',
        color: 'var(--ink-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 'var(--lh-normal)',
      }}
    >
      {summary}
    </p>
  )
}

function AngleChip({ post }: { post: FeedGbpPost }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span className="chip">{angleLabel(post.angle)}</span>
      {post.source === 'remote' && <span className="chip">écrit à la main</span>}
    </span>
  )
}

function LinkedPage({ post }: { post: FeedGbpPost }) {
  const target = post.linked_generation
  if (!target) return null

  const label = target.title ?? target.slug ?? 'Page liée'
  return target.published_url ? (
    <a href={target.published_url} target="_blank" rel="noopener noreferrer" className="btn-link">
      {label} <ExternalLink size={12} />
    </a>
  ) : (
    <span className="meta">{label} — pas encore en ligne</span>
  )
}

function Cta({ post }: { post: FeedGbpPost }) {
  if (!post.cta_action_type) return null
  return (
    <span className="meta" style={{ display: 'inline-flex', gap: 'var(--space-1)', minWidth: 0 }}>
      {ctaLabel(post.cta_action_type)}
      {post.cta_url && <span className="mono truncate" style={{ maxWidth: 260 }}>{post.cta_url}</span>}
    </span>
  )
}

function QueueRow({
  post,
  siteName,
  last,
  busy,
  disabled,
  error,
  onPublish,
}: {
  post: FeedGbpPost
  siteName: string
  last: boolean
  busy: boolean
  disabled: boolean
  error?: RowError
  onPublish: () => void
}) {
  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <AngleChip post={post} />
        <StatusBadge status={post.status} />
        {post.scheduled_for && <span className="meta">créneau du {formatDay(post.scheduled_for)}</span>}
        <span style={{ flex: 1 }} />
        <Button
          variant="secondary"
          size="sm"
          icon={Send}
          loading={busy}
          disabled={disabled || post.status === 'publishing'}
          onClick={onPublish}
        >
          Publier sur la fiche
        </Button>
      </div>

      <FullSummary summary={post.summary} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <LinkedPage post={post} />
        <Cta post={post} />
      </div>

      <details>
        <summary className="meta" style={{ cursor: 'pointer' }}>Voir l’aperçu de la fiche</summary>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <PostPreview post={post} businessName={siteName} />
        </div>
      </details>

      {error && <RowErrorBlock error={error} />}
    </div>
  )
}

/**
 * Le panneau du doute — UNE seule action, et ce n'est jamais « republier ».
 *
 * Un `POST localPosts` n'est pas idempotent et l'API n'accepte aucune clef
 * d'idempotence : un second envoi ne corrigerait rien, il ajouterait un post
 * visible par les prospects du client. Le bouton déclenche donc une RELECTURE de
 * la fiche, avec appariement par empreinte de résumé — la seule opération qui
 * puisse trancher.
 */
function UncertainRow({
  post,
  last,
  busy,
  disabled,
  error,
  onVerify,
}: {
  post: FeedGbpPost
  last: boolean
  busy: boolean
  disabled: boolean
  error?: RowError
  onVerify: () => void
}) {
  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <AngleChip post={post} />
        <StatusBadge status={post.status} label="État inconnu" />
        <span className="meta">tentative du {formatDay(post.updated_at)}</span>
      </div>

      <FullSummary summary={post.summary} />

      <div className="inset" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-warning-text)' }}>
          Le moteur ne sait pas si ce post a été publié
        </strong>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', lineHeight: 1.55 }}>
          L’envoi a été tenté et la fiche n’a ni confirmé ni refusé. Le post a peut-être été créé. Rien ne sera
          renvoyé tant que ce doute n’est pas levé : la vérification relit les posts de la fiche et les compare à
          celui-ci.
        </p>
        {/* La réponse de Google, VERBATIM. Le corps d'un 400 est persisté tel quel
            précisément pour être lu ici : c'est la seule preuve que ce dépôt
            puisse obtenir contre les mentions « à confirmer contre l'API réelle »
            de format.ts, et la reformuler suffirait à la rendre inutilisable. */}
        {post.error_message && (
          <div className="scroll-x">
            <pre
              className="mono"
              style={{
                margin: 0,
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {post.error_message}
            </pre>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" icon={Search} loading={busy} disabled={disabled} onClick={onVerify}>
          Vérifier maintenant
        </Button>
        {post.remote_search_url && (
          <a href={post.remote_search_url} target="_blank" rel="noopener noreferrer" className="btn-link">
            Ouvrir la fiche sur Google <ExternalLink size={12} />
          </a>
        )}
      </div>

      {error && <RowErrorBlock error={error} />}
    </div>
  )
}

function RefusedRow({ post, siteId, last }: { post: FeedGbpPost; siteId: string | null; last: boolean }) {
  const reasons = splitReasons(post.error_message)
  const kind = post.refusal_kind
  const help = kind ? REFUSAL_LABELS[kind]?.help : undefined

  return (
    <div style={rowStyle(last, true)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <AngleChip post={post} />
        <StatusBadge status={post.status} />
        <span className="meta">{formatDay(post.updated_at)}</span>
      </div>

      <FullSummary summary={post.summary} />

      <ReasonList title={refusalTitle(kind, post.status)} reasons={reasons} />

      {help && <p className="meta" style={{ margin: 0 }}>{help}</p>}

      {kind === 'identifiants' && siteId && (
        <a href={`/sites/${siteId}/google`} className="btn-link">Voir la connexion Google</a>
      )}
    </div>
  )
}

function PublishedRow({ post, last }: { post: FeedGbpPost; last: boolean }) {
  const when = post.published_at ?? post.updated_at

  return (
    <div style={rowStyle(last, false)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <span className="meta" style={{ minWidth: 56 }}>{formatDay(when)}</span>
        <AngleChip post={post} />
        <span className="truncate" style={{ flex: 1, minWidth: 180, fontSize: 'var(--fs-sm)' }} title={post.summary}>
          {post.summary}
        </span>
        {post.remote_state && post.remote_state !== 'LIVE' && (
          <span className="chip">état Google : {post.remote_state}</span>
        )}
        <LinkedPage post={post} />
        {post.remote_search_url && (
          <a href={post.remote_search_url} target="_blank" rel="noopener noreferrer" className="btn-link">
            Voir sur Google <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * L'échec d'une action de ligne.
 *
 * `written === true` ne veut pas dire « échec » : il veut dire « le post existe
 * peut-être ». La conduite qui en découle est d'aller REGARDER la fiche, jamais
 * de recliquer — c'est pourquoi ce bloc ne porte aucun bouton.
 */
function RowErrorBlock({ error }: { error: RowError }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <ReasonList title={error.message} reasons={error.reasons} />
      {error.written && (
        <Notice
          inline
          tone="warning"
          title="Ne relancez pas"
          body="Le post existe peut-être déjà sur la fiche. Ouvrez la fiche pour vérifier : un second envoi publierait un doublon visible par vos prospects."
        />
      )}
    </div>
  )
}
