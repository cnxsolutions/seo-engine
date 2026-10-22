'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Modifier une campagne — les réglages, pas le plan.
//
// Jusqu'ici une campagne ne se modifiait qu'en base. Changer de modèle, de
// rythme ou désactiver une campagne demandait d'ouvrir Supabase, et le rythme
// réel du moteur dépendait d'une colonne que personne ne voyait dans l'écran.
//
// Ce formulaire écrit la campagne et RIEN D'AUTRE. Les créneaux déjà posés par
// un plan confirmé gardent leurs mots-clés et leurs dates : réécrire le
// calendrier à chaque changement de réglage effacerait un cycle en cours au
// milieu de sa production. Les nouveaux réglages s'appliquent au prochain
// cycle — et aux créneaux restants pour ce qui n'est pas planifié par créneau
// (modèle, longueur, publication). La bannière en tête le dit avant le premier
// champ, parce que c'est la seule chose qu'un opérateur pourrait supposer à
// tort.
//
// Le formulaire envoie l'ensemble des champs qu'il affiche, pas seulement ceux
// qui ont changé : la route PATCH accepte un sous-ensemble, et calculer un diff
// côté client ajouterait une mécanique pour économiser quelques octets.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, Target, Trash2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button, EmptyState, FormField, Notice, PageHeader } from '@/components/ui'
import { PAGE_TYPE_LABELS } from '@/lib/types'
import type { Campaign, PageType, PublishStatus, ScheduleFrequency } from '@/lib/types'
import { AI_MODEL_OPTIONS } from '@/lib/ai/provider'
import { CAMPAIGN_SCOPE_OPTIONS, campaignScope, targetCommunes, withoutLocalPack, type CampaignScope } from '@/lib/geo/scope'
import { DeleteCampaignDialog } from '../../DeleteCampaignDialog'

// Même ordre éditorial que /strategy/new : pilier d'abord. Les libellés viennent
// du dictionnaire partagé, pour qu'un type ne change pas de nom entre l'écran
// de création et celui de modification.
const PAGE_TYPE_ORDER: PageType[] = ['pillar', 'child', 'local_pack', 'alternative', 'comparative']

/**
 * Les huit fréquences que `ScheduleFrequency` autorise, toutes — pas les quatre
 * du formulaire de création. Une campagne passée en 'monthly' ou 'manual' depuis
 * la base doit se relire ici telle qu'elle est, et non retomber en silence sur
 * la première option du select.
 */
const FREQUENCIES: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'daily', label: 'Tous les jours' },
  { value: 'every_2_days', label: 'Tous les 2 jours' },
  { value: 'every_3_days', label: 'Tous les 3 jours' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'biweekly', label: 'Toutes les deux semaines' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'custom', label: 'Jours choisis' },
  { value: 'manual', label: 'Manuel — aucun créneau automatique' },
]

/** Lundi en tête : la semaine française. La valeur reste celle de `Date#getDay()`. */
const WEEKDAYS: Array<{ value: number; label: string; short: string }> = [
  { value: 1, label: 'Lundi', short: 'Lun' },
  { value: 2, label: 'Mardi', short: 'Mar' },
  { value: 3, label: 'Mercredi', short: 'Mer' },
  { value: 4, label: 'Jeudi', short: 'Jeu' },
  { value: 5, label: 'Vendredi', short: 'Ven' },
  { value: 6, label: 'Samedi', short: 'Sam' },
  { value: 0, label: 'Dimanche', short: 'Dim' },
]

const TARGET_LENGTHS = [800, 1200, 2000]

const PUBLISH_STATUSES: Array<{ value: PublishStatus; label: string }> = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'pending', label: 'En attente de relecture' },
  { value: 'publish', label: 'Publié' },
]

/** Bornes de `cycle_duration_days`, celles du contrat PATCH. */
const CYCLE_MIN = 7
const CYCLE_MAX = 90

// ─── État du formulaire ──────────────────────────────────────────────────────
//
// Les nombres sont tenus en chaînes : un `<input type="number">` vide ne peut
// pas être 0 sans mentir, et la conversion se fait une seule fois, à l'envoi.

interface FormState {
  business_name: string
  business_type: string
  /** National: no commune, no department, no local pack (lib/geo/scope.ts). */
  scope: CampaignScope
  department: string
  keywords: string
  communes: string
  page_types: PageType[]
  schedule_frequency: ScheduleFrequency
  schedule_days: number[]
  schedule_time: string
  ai_model: string
  target_length: string
  auto_publish: boolean
  publish_status: PublishStatus
  is_active: boolean
  cycle_duration_days: string
  cycle_auto_renew: boolean
  enable_external_links: boolean
  external_link_count: string
  enable_images: boolean
}

/**
 * La campagne telle que la base la rend, remise en champs. Les défauts sont
 * ceux que la route POST écrit (liens externes et images actifs, 3 liens, 2
 * images) : une colonne absente d'une vieille ligne se relit comme la base la
 * traiterait, pas comme un zéro.
 */
function fromCampaign(campaign: Campaign): FormState {
  // A campaign saved with « tous » as its commune reads back as national, and
  // the marker itself is not shown as if it were a town to edit.
  const scope = campaignScope(campaign)
  const pageTypes: PageType[] = campaign.page_types?.length ? campaign.page_types : ['child']
  return {
    business_name: campaign.business_name ?? '',
    business_type: campaign.business_type ?? '',
    scope,
    department: scope === 'national' ? '' : campaign.department ?? '',
    keywords: (campaign.keywords ?? []).join('\n'),
    communes: targetCommunes(campaign.communes).join('\n'),
    page_types: scope === 'national' ? withoutLocalPack(pageTypes, ['child']) : pageTypes,
    schedule_frequency: campaign.schedule_frequency ?? 'daily',
    schedule_days: campaign.schedule_days ?? [],
    schedule_time: campaign.schedule_time ?? '09:00',
    ai_model: campaign.ai_model ?? '',
    target_length: String(campaign.target_length || 800),
    auto_publish: Boolean(campaign.auto_publish),
    publish_status: campaign.publish_status ?? 'draft',
    is_active: campaign.is_active !== false,
    cycle_duration_days: String(campaign.cycle_duration_days || 14),
    cycle_auto_renew: Boolean(campaign.cycle_auto_renew),
    enable_external_links: campaign.enable_external_links ?? true,
    external_link_count: String(campaign.external_link_count ?? 3),
    enable_images: campaign.enable_images === true,
  }
}

/** Une entrée par ligne OU par virgule : le formulaire de création accepte les deux. */
function splitList(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

/**
 * Ce que la route refuserait de toute façon, dit AVANT l'aller-retour, dans les
 * mots du champ concerné. La route reste juge : un message d'ici n'est jamais
 * la dernière barrière.
 */
function validate(form: FormState): string | null {
  if (!form.business_name.trim()) return 'Le nom du business est requis.'
  if (!form.business_type.trim()) return 'Le type d’activité est requis.'
  if (form.scope === 'local' && splitList(form.communes).length === 0) {
    return 'Au moins une commune est requise — ou choisissez la portée nationale.'
  }
  if (form.page_types.length === 0) return 'Choisissez au moins un type de page.'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.schedule_time)) return 'L’heure doit être au format HH:MM.'
  if (form.schedule_frequency === 'custom' && form.schedule_days.length === 0) {
    return 'En rythme « Jours choisis », cochez au moins un jour de la semaine.'
  }
  const cycle = Number(form.cycle_duration_days)
  if (!Number.isInteger(cycle) || cycle < CYCLE_MIN || cycle > CYCLE_MAX) {
    return `La durée du cycle doit être comprise entre ${CYCLE_MIN} et ${CYCLE_MAX} jours.`
  }
  if (form.enable_external_links && !(Number(form.external_link_count) >= 1)) {
    return 'Indiquez au moins un lien externe par page, ou désactivez les liens externes.'
  }
  return null
}

/** Le corps du PATCH, dans les noms de colonnes que la route attend. */
function toPayload(form: FormState) {
  const national = form.scope === 'national'
  return {
    business_name: form.business_name.trim(),
    business_type: form.business_type.trim(),
    scope: form.scope,
    // The route ignores both for a national campaign; not sending them keeps a
    // stale department from being validated for nothing. A blank department is
    // left out too: the route refuses one, and a campaign switched back from
    // national arrives here with none.
    ...(national ? {} : {
      communes: splitList(form.communes),
      ...(form.department.trim() ? { department: form.department.trim() } : {}),
    }),
    keywords: splitList(form.keywords),
    page_types: national ? withoutLocalPack(form.page_types, ['child']) : form.page_types,
    schedule_frequency: form.schedule_frequency,
    // Les jours ne portent un sens qu'en rythme « Jours choisis » : les envoyer
    // avec un autre rythme laisserait en base une liste que rien ne lit.
    schedule_days: form.schedule_frequency === 'custom' ? [...form.schedule_days].sort((a, b) => a - b) : [],
    schedule_time: form.schedule_time,
    ai_model: form.ai_model,
    target_length: Number(form.target_length),
    auto_publish: form.auto_publish,
    publish_status: form.publish_status,
    is_active: form.is_active,
    cycle_duration_days: Number(form.cycle_duration_days),
    cycle_auto_renew: form.cycle_auto_renew,
    enable_external_links: form.enable_external_links,
    external_link_count: Number(form.external_link_count),
    enable_images: form.enable_images,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EditCampaignPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Le formulaire est atteint depuis l'onglet Stratégie d'un site : retour,
  // annulation, enregistrement et suppression y ramènent. Tant que la campagne
  // n'est pas lue, le sélecteur de site /strategy tient lieu de repli.
  const backHref = campaign?.site_id ? `/sites/${campaign.site_id}/strategie` : '/strategy'

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.campaign) throw new Error(data.error || `Erreur ${res.status}`)
      const loaded = data.campaign as Campaign
      setCampaign(loaded)
      setForm(fromCampaign(loaded))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Campagne illisible')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  /** Un seul gestionnaire pour les champs texte, select et cases à cocher nommés. */
  const handle = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = event.target
    const value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value
    setForm((prev) => (prev ? { ...prev, [target.name]: value } : prev))
  }

  /** Turning national drops local pack: the route would refuse it, and rightly. */
  const chooseScope = (scope: CampaignScope) => {
    setForm((prev) => (prev
      ? { ...prev, scope, page_types: scope === 'national' ? withoutLocalPack(prev.page_types, ['child']) : prev.page_types }
      : prev))
  }

  const togglePageType = (type: PageType) => {
    setForm((prev) => {
      if (!prev) return prev
      const active = prev.page_types.includes(type)
      return { ...prev, page_types: active ? prev.page_types.filter((item) => item !== type) : [...prev.page_types, type] }
    })
  }

  const toggleWeekday = (day: number) => {
    setForm((prev) => {
      if (!prev) return prev
      const active = prev.schedule_days.includes(day)
      return { ...prev, schedule_days: active ? prev.schedule_days.filter((item) => item !== day) : [...prev.schedule_days, day] }
    })
  }

  const submit = async () => {
    if (!form) return
    const problem = validate(form)
    if (problem) {
      setError(problem)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Enregistrement refusé (erreur ${res.status})`)
        return
      }
      // `refresh()` après `push()` : la liste est un composant client qui lit
      // /api/campaigns à son montage, mais une navigation retour vers une page
      // déjà visitée peut la servir depuis le cache du routeur.
      router.push(backHref)
      router.refresh()
    } catch {
      setError('Impossible de joindre le serveur')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader
        icon={Target}
        badge="Stratégie"
        title="Modifier la campagne"
        subtitle={campaign ? campaign.name : 'Lecture de la campagne…'}
        meta={campaign?.site ? <span>Site : {campaign.site.name}</span> : undefined}
        backHref={backHref}
      />

      {loadError && (
        <EmptyState
          variant="error"
          title="Campagne illisible"
          description={loadError}
          action={{ label: 'Réessayer', onClick: () => load() }}
          secondaryAction={{ label: 'Retour aux stratégies', href: backHref }}
        />
      )}

      {!loadError && (!campaign || !form) && (
        <div className="glass-card" style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-12)' }}>
          <Loader2 size={22} className="animate-spin" color="var(--ink-faint)" />
          <span className="meta">Chargement de la campagne…</span>
        </div>
      )}

      {campaign && form && (
        <>
          <Notice
            tone="info"
            title="Ce que ces réglages changent"
            body="Les créneaux déjà planifiés gardent leurs mots-clés et dates ; les changements s’appliquent au prochain cycle."
          />

          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {/* ── Activité ── */}
            <section className="panel">
              <div className="panel__header"><h2 className="card-title">Activité</h2></div>
              <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
                  <FormField label="Nom du business" required htmlFor="business-name">
                    <input id="business-name" name="business_name" value={form.business_name} onChange={handle} className="input" />
                  </FormField>
                  <FormField label="Type d’activité" required htmlFor="business-type">
                    <input id="business-type" name="business_type" value={form.business_type} onChange={handle} className="input" placeholder="plombier, coach, avocat…" />
                  </FormField>
                  {form.scope === 'local' && (
                    <FormField label="Département" htmlFor="department">
                      <input id="department" name="department" value={form.department} onChange={handle} className="input" />
                    </FormField>
                  )}
                </div>

                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label">Portée</legend>
                  <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
                    {CAMPAIGN_SCOPE_OPTIONS.map((option) => (
                      <label key={option.value} htmlFor={`scope-${option.value}`} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
                        <input id={`scope-${option.value}`} type="radio" name="scope" value={option.value} checked={form.scope === option.value} onChange={() => chooseScope(option.value)} style={{ marginTop: 3 }} />
                        <span>
                          {option.label}
                          <span className="meta" style={{ display: 'block' }}>{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
                  {form.scope === 'local' && (
                    <FormField label="Communes ou zones" required htmlFor="communes" hint="une par ligne">
                      <textarea id="communes" name="communes" value={form.communes} onChange={handle} className="input" rows={6} style={{ resize: 'vertical' }} />
                    </FormField>
                  )}
                  <FormField label="Mots-clés de base" htmlFor="keywords" hint="un par ligne">
                    <textarea id="keywords" name="keywords" value={form.keywords} onChange={handle} className="input" rows={6} style={{ resize: 'vertical' }} />
                  </FormField>
                </div>

                {/* Un groupe de cases, pas des boutons bascule : une case dit
                    son état à un lecteur d'écran sans attribut supplémentaire. */}
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="field-label">Types de pages</legend>
                  <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                    {PAGE_TYPE_ORDER.map((type) => {
                      const unavailable = type === 'local_pack' && form.scope === 'national'
                      return (
                        <CheckLabel
                          key={type}
                          id={`page-type-${type}`}
                          checked={form.page_types.includes(type)}
                          onChange={() => togglePageType(type)}
                          disabled={unavailable}
                          hint={unavailable ? 'Réservé aux campagnes locales' : undefined}
                        >
                          {PAGE_TYPE_LABELS[type]}
                        </CheckLabel>
                      )
                    })}
                  </div>
                </fieldset>
              </div>
            </section>

            {/* ── Rythme ── */}
            <section className="panel">
              <div className="panel__header"><h2 className="card-title">Rythme</h2></div>
              <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
                  <FormField label="Fréquence" htmlFor="schedule-frequency">
                    <select id="schedule-frequency" name="schedule_frequency" value={form.schedule_frequency} onChange={handle} className="input">
                      {FREQUENCIES.map((frequency) => <option key={frequency.value} value={frequency.value}>{frequency.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Heure de génération" htmlFor="schedule-time" hint="HH:MM">
                    <input id="schedule-time" name="schedule_time" type="time" value={form.schedule_time} onChange={handle} className="input" />
                  </FormField>
                  <FormField label="Durée du cycle" htmlFor="cycle-duration" hint={`${CYCLE_MIN} à ${CYCLE_MAX} jours`}>
                    <input id="cycle-duration" name="cycle_duration_days" type="number" min={CYCLE_MIN} max={CYCLE_MAX} value={form.cycle_duration_days} onChange={handle} className="input" />
                  </FormField>
                </div>

                {form.schedule_frequency === 'custom' && (
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="field-label">Jours de génération</legend>
                    <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                      {WEEKDAYS.map((day) => (
                        <CheckLabel key={day.value} id={`weekday-${day.value}`} checked={form.schedule_days.includes(day.value)} onChange={() => toggleWeekday(day.value)} title={day.label}>
                          {day.short}
                        </CheckLabel>
                      ))}
                    </div>
                  </fieldset>
                )}

                <CheckLabel id="cycle-auto-renew" name="cycle_auto_renew" checked={form.cycle_auto_renew} onChange={handle}
                  hint="À la fin d’un cycle, le moteur en planifie un nouveau sans attendre une confirmation.">
                  Renouveler le cycle automatiquement
                </CheckLabel>
              </div>
            </section>

            {/* ── Rédaction ── */}
            <section className="panel">
              <div className="panel__header"><h2 className="card-title">Rédaction</h2></div>
              <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
                  <FormField label="Modèle IA" htmlFor="ai-model">
                    <select id="ai-model" name="ai_model" value={form.ai_model} onChange={handle} className="input">
                      {/* Un modèle retiré du catalogue mais encore en base reste
                          sélectionné, nommé tel quel : le select ne doit pas
                          réécrire la campagne sur le premier modèle venu. */}
                      {!AI_MODEL_OPTIONS.some((option) => option.value === form.ai_model) && (
                        <option value={form.ai_model}>{form.ai_model || '(aucun)'} — hors catalogue</option>
                      )}
                      {AI_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Longueur cible" htmlFor="target-length">
                    <select id="target-length" name="target_length" value={form.target_length} onChange={handle} className="input">
                      {!TARGET_LENGTHS.includes(Number(form.target_length)) && (
                        <option value={form.target_length}>{form.target_length} mots (valeur actuelle)</option>
                      )}
                      {TARGET_LENGTHS.map((length) => <option key={length} value={String(length)}>{length} mots</option>)}
                    </select>
                  </FormField>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
                  <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                    <CheckLabel id="enable-external-links" name="enable_external_links" checked={form.enable_external_links} onChange={handle}>
                      Insérer des liens externes
                    </CheckLabel>
                    {form.enable_external_links && (
                      <FormField label="Liens externes par page" htmlFor="external-link-count">
                        <input id="external-link-count" name="external_link_count" type="number" min={1} max={10} value={form.external_link_count} onChange={handle} className="input" style={{ maxWidth: 140 }} />
                      </FormField>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                    <CheckLabel
                      id="enable-images"
                      name="enable_images"
                      checked={form.enable_images}
                      onChange={handle}
                      hint="Une photo réaliste générée à la publication, sans texte. Modifiable brief par brief dans la Stratégie."
                    >
                      Photo IA en tête de chaque page
                    </CheckLabel>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Publication ── */}
            <section className="panel">
              <div className="panel__header"><h2 className="card-title">Publication</h2></div>
              <div className="panel__body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <FormField label="Statut à la publication" htmlFor="publish-status">
                  <select id="publish-status" name="publish_status" value={form.publish_status} onChange={handle} className="input" style={{ maxWidth: 320 }}>
                    {PUBLISH_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </FormField>

                <CheckLabel id="auto-publish" name="auto_publish" checked={form.auto_publish} onChange={handle}
                  hint="Les pages sont mises en ligne le jour prévu, sans relecture : elles atteignent le site du client telles que le modèle les a écrites.">
                  Publier automatiquement le jour prévu
                </CheckLabel>
                {form.auto_publish && (
                  <Notice
                    inline
                    tone="warning"
                    title="Publication sans relecture"
                    body="Chaque page générée part sur le site du client dès sa production. Décochez pour relire les pages dans l’onglet Publication du site avant leur mise en ligne."
                  />
                )}

                <CheckLabel id="is-active" name="is_active" checked={form.is_active} onChange={handle}
                  hint="Désactivée, ses créneaux ne tournent plus : rien n’est généré ni publié tant qu’elle n’est pas réactivée.">
                  Campagne active
                </CheckLabel>
              </div>

              <div className="panel__footer" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                {error && <Notice inline tone="critical" title="Modifications non enregistrées" body={error} />}
                <div style={{ flex: 1 }} />
                <Button variant="ghost" href={backHref} disabled={saving}>Annuler</Button>
                <Button icon={Save} loading={saving} onClick={submit}>Enregistrer les modifications</Button>
              </div>
            </section>

            {/* ── Zone de danger ── */}
            <section className="panel" style={{ borderColor: 'var(--status-critical)' }}>
              <div className="panel__header">
                <h2 className="card-title" style={{ color: 'var(--status-critical-text)' }}>Supprimer cette campagne</h2>
              </div>
              <div className="panel__body" style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
                <p className="meta" style={{ margin: 0, flex: 1, minWidth: 260 }}>
                  Supprime le plan de cycle et le calendrier éditorial. Les pages déjà générées ou publiées sont
                  conservées. Une confirmation est demandée.
                </p>
                <Button variant="danger" icon={Trash2} onClick={() => setConfirmingDelete(true)} disabled={saving}>
                  Supprimer la campagne
                </Button>
              </div>
            </section>
          </div>

          {confirmingDelete && (
            <DeleteCampaignDialog
              campaign={campaign}
              onClose={() => setConfirmingDelete(false)}
              onDeleted={() => {
                router.push(backHref)
                router.refresh()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── Case à cocher avec étiquette ────────────────────────────────────────────

/**
 * Une case, son texte, et l'explication qui va avec — l'étiquette entoure la
 * case, donc cliquer le texte coche. Le `hint` est relié par `aria-describedby`
 * pour qu'un lecteur d'écran lise la conséquence, pas seulement l'intitulé.
 */
function CheckLabel({
  id, name, checked, onChange, hint, title, disabled = false, children,
}: {
  id: string
  name?: string
  checked: boolean
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  hint?: string
  title?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div>
      <label htmlFor={id} title={title} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 'var(--fs-sm)', color: disabled ? 'var(--ink-secondary)' : 'var(--ink-primary)' }}>
        <input id={id} name={name} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} aria-describedby={hintId} style={{ marginTop: 3 }} />
        <span>{children}</span>
      </label>
      {hint && <p id={hintId} className="meta" style={{ margin: 'var(--space-1) 0 0 calc(13px + var(--space-2))' }}>{hint}</p>}
    </div>
  )
}
