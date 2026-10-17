'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Le plan du cycle, lisible : une liste de briefs et un panneau de détail
//
// Le plan vivait dans un tableau de neuf colonnes avec un champ dans chaque
// cellule : le titre y était coupé au vingt-cinquième caractère, l'adresse
// tronquée, et la colonne « Requête » sortait de l'écran. Un brief que
// l'opérateur ne peut pas LIRE est un brief qu'il ne corrige pas — et c'est à
// cette étape, avant le premier jeton, que la correction coûte zéro.
//
// Une ligne par brief, le titre et l'adresse en entier ; le brief ouvert se lit
// et se corrige dans le panneau de droite (en dessous de la liste sur un
// téléphone). Les deux écrans qui montrent un plan — le parcours de création
// et l'onglet Stratégie d'un site — partagent ce composant : seule la façon de
// juger une adresse leur est propre, et ils la passent en `verdictFor`.
//
// LES MISES À JOUR N'EXISTENT PLUS. Le moteur ne planifie plus la mise à jour
// de pages existantes (décision du propriétaire, 17/10/2026). Un ancien plan
// relu depuis la base peut encore porter des lignes 'refresh' : elles restent
// affichées — les taire ferait disparaître des créneaux que l'opérateur a vus —
// mais grisées et marquées « Mise à jour (ancien plan) — ne sera pas produite ».
// Aucun texte ne les présente plus comme une option.
//
// AUCUNE LOGIQUE DE VERDICT ICI. Le composant ne sait pas ce qu'est une adresse
// libre : l'écran de création le déduit de l'inventaire, la modale le relit du
// verdict que le planificateur a enregistré. Le composant affiche, il ne juge
// pas — deux jugements rendus à deux endroits divergeraient.
// ─────────────────────────────────────────────────────────────────────────────

import { useId, type ReactNode } from 'react'
import { CircleCheck, Save, X } from 'lucide-react'
import { Button, FieldError, FormField, StatusBadge, formatDayLong, formatMetric, formatWeekday, formatDay } from '@/components/ui'
import { pageTypeLabel, type PlanItemBrief } from '@/lib/types'

/** Une couleur et un mot, jamais la couleur seule. */
export type VerdictTone = 'good' | 'info' | 'warning' | 'critical' | 'muted'

/**
 * Ce qu'un écran sait dire d'une adresse proposée.
 *
 * `inline` suit l'adresse dans la liste (« adresse libre ») ; `detail` est la
 * phrase entière sous le champ, celle qui dit ce que la donnée PROUVE.
 * `blocking` marque le champ invalide : c'est l'écran qui décide ce qui
 * interdit de lancer le cycle, pas la liste.
 */
export interface AddressVerdict {
  tone: VerdictTone
  inline: string
  detail: ReactNode
  blocking?: boolean
}

export type PlanActionKind = 'create' | 'refresh' | 'skip'

/** `item.action?.kind ?? 'create'` — un plan antérieur aux verdicts ne porte rien. */
export function planActionKind(item: PlanItemBrief): PlanActionKind {
  return item.action?.kind ?? 'create'
}

/** Ce qu'une ancienne ligne de mise à jour devient, dit en une fois. */
const LEGACY_REFRESH_NOTE = 'ne sera pas produite'

/** Les trois champs qu'un humain retape à cette étape, et pas un de plus. */
export type PlanBriefPatch = Partial<Pick<PlanItemBrief, 'proposed_title' | 'proposed_slug' | 'target_keyword'>>

export interface PlanBriefListProps {
  items: PlanItemBrief[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /**
   * Le verdict d'adresse d'un brief à créer, ou `null` quand l'écran n'en a
   * aucun — un plan relu depuis la base, par exemple, n'affiche RIEN plutôt
   * qu'un verdict inventé. Les anciennes lignes de mise à jour et les briefs
   * écartés ne passent pas par ici : leur adresse n'est pas à juger.
   */
  verdictFor: (item: PlanItemBrief) => AddressVerdict | null
  /** Une annotation sous la requête visée — le badge « mesuré » de la modale. */
  keywordNote?: (item: PlanItemBrief) => ReactNode
  /** Titre, adresse et requête modifiables ; `onChange` est alors requis. */
  editable?: boolean
  onChange?: (id: string, patch: PlanBriefPatch) => void
  /** « Enregistrer » dans le panneau : conserve le plan sans lancer le cycle. */
  onSave?: () => void | Promise<void>
  saving?: boolean
}

/**
 * L'identité d'une ligne pour la sélection.
 *
 * Les plans écrits par le moteur portent toujours un id ; un plan ancien relu
 * depuis la base peut en manquer, et deux lignes sans id se confondraient. Le
 * rang sert alors de repli — ce n'est qu'une clé d'affichage, elle ne remonte
 * jamais dans `onChange`, que seuls les écrans éditables appellent et dont les
 * briefs ont tous un id.
 */
function keyOf(item: PlanItemBrief, index: number): string {
  return item.id || `#${index}`
}

function displayPath(slug: string): string {
  return `/${slug.replace(/^\/+/, '')}`
}

export function PlanBriefList({
  items, selectedId, onSelect, verdictFor, keywordNote, editable = false, onChange, onSave, saving = false,
}: PlanBriefListProps) {
  // Trié par date, comme le calendrier qu'il deviendra : l'ordre du planificateur
  // est déjà chronologique, mais une ligne retouchée ne doit pas le défaire.
  const ordered = items
    .map((item, index) => ({ item, key: keyOf(item, index) }))
    .sort((a, b) => a.item.scheduled_date.localeCompare(b.item.scheduled_date))

  const selected = ordered.find((row) => row.key === selectedId) ?? null

  return (
    <div className="plan-brief-layout">
      <section className="plan-brief-list" aria-label="Briefs du cycle">
        <div className="plan-brief-list__head">
          <span className="eyebrow">Un brief par ligne — ouvrir pour lire{editable ? ' et corriger' : ''}</span>
          <span className="meta">Trié par date</span>
        </div>

        {ordered.length === 0 ? (
          <p className="meta" style={{ margin: 0 }}>Ce plan ne contient aucun brief.</p>
        ) : (
          <ul className="plan-brief-list__rows">
            {ordered.map(({ item, key }) => (
              <li key={key}>
                <BriefRow
                  item={item}
                  selected={key === selectedId}
                  verdict={planActionKind(item) === 'create' ? verdictFor(item) : null}
                  onOpen={() => onSelect(key)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <BriefDetail
        row={selected}
        verdict={selected && planActionKind(selected.item) === 'create' ? verdictFor(selected.item) : null}
        keywordNote={keywordNote}
        editable={editable}
        onChange={onChange}
        onClose={() => onSelect(null)}
        onSave={onSave}
        saving={saving}
      />
    </div>
  )
}

// ─── La ligne ────────────────────────────────────────────────────────────────

/**
 * Ce que ce brief fait au site qui existe déjà.
 *
 * `StatusBadge` porte déjà 'create' dans le vocabulaire partagé — on le lit, on
 * n'écrit pas un second dictionnaire ici. Une ligne 'refresh' ne vient que d'un
 * ancien plan : son badge le dit, en gris, et ne reprend PAS le « Mise à jour »
 * bleu du vocabulaire partagé, qui la ferait lire comme une action à venir. Un
 * plan antérieur aux verdicts n'en porte aucun : il s'affiche en « Nouvelle
 * page », ce qu'il était, sans qu'on lui invente une décision rétroactive.
 */
export function ActionBadge({ kind }: { kind: PlanActionKind }) {
  if (kind === 'skip') return <span className="badge badge-muted">Écarté</span>
  if (kind === 'refresh') return <span className="badge badge-muted">Mise à jour (ancien plan)</span>
  return <StatusBadge status={kind} />
}

function BriefRow({
  item, selected, verdict, onOpen,
}: {
  item: PlanItemBrief
  selected: boolean
  verdict: AddressVerdict | null
  onOpen: () => void
}) {
  const action = item.action
  const kind = planActionKind(item)
  // Une ancienne mise à jour se grise comme un sujet écarté : ni l'une ni
  // l'autre ne produira de page.
  const skipped = kind !== 'create'

  return (
    // Un vrai bouton, pas une div cliquable : il se tabule, s'active au clavier,
    // et `aria-current` dit au lecteur d'écran laquelle des lignes est ouverte.
    <button
      type="button"
      className={`plan-brief${skipped ? ' plan-brief--skipped' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
    >
      <span className="plan-brief__date">
        <span className="plan-brief__day">{formatDay(item.scheduled_date)}</span>
        <span className="meta">{formatWeekday(item.scheduled_date)}</span>
      </span>

      <span className="plan-brief__body">
        <span className="plan-brief__tags">
          <ActionBadge kind={kind} />
          {!skipped && <span className="chip">{pageTypeLabel(item.page_type)}</span>}
          <span className="meta">
            {action?.kind === 'skip'
              ? action.reasons[0] ?? 'Aucun motif enregistré.'
              : action?.kind === 'refresh'
                ? `page existante · ${LEGACY_REFRESH_NOTE}`
                : `${item.search_intent || '—'} · ${formatMetric(item.estimated_word_count, 'number')} mots`}
          </span>
        </span>

        <span className="plan-brief__title">{item.proposed_title || 'Sans titre'}</span>

        {action?.kind === 'skip' ? (
          <span className="plan-brief__slug">Aucune page ne sera produite.</span>
        ) : action?.kind === 'refresh' ? (
          <span className="plan-brief__slug mono">
            {action.targetPath}
            <span className="plan-brief__verdict verdict--muted"> · {LEGACY_REFRESH_NOTE}</span>
          </span>
        ) : (
          <span className="plan-brief__slug mono">
            {displayPath(item.proposed_slug)}
            {verdict && <span className={`plan-brief__verdict verdict--${verdict.tone}`}> · {verdict.inline}</span>}
          </span>
        )}
      </span>

      <span className="plan-brief__open" aria-hidden="true">{selected ? 'Ouvert' : 'Ouvrir ›'}</span>
    </button>
  )
}

// ─── Le panneau ──────────────────────────────────────────────────────────────

/**
 * Le verdict sous le champ : la phrase entière, avec son glyphe quand il est
 * bon. Un verdict critique passe par `FieldError`, la même ligne rouge que tous
 * les champs du dépôt — le rouge n'est jamais le seul porteur du message.
 */
function VerdictLine({ verdict }: { verdict: AddressVerdict }) {
  if (verdict.tone === 'critical') return <FieldError>{verdict.detail}</FieldError>
  return (
    <p className={`meta verdict--${verdict.tone}`} style={{ margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
      {verdict.tone === 'good' && <CircleCheck size={11} aria-hidden="true" />}
      {verdict.detail}
    </p>
  )
}

/** Un intitulé et sa valeur en lecture seule — le même étiquetage que les champs. */
function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="plan-brief-detail__value">{children}</div>
    </div>
  )
}

function BulletList({ lines }: { lines: string[] }) {
  return (
    <ul className="plan-brief-detail__list">
      {lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
    </ul>
  )
}

function BriefDetail({
  row, verdict, keywordNote, editable, onChange, onClose, onSave, saving,
}: {
  row: { item: PlanItemBrief; key: string } | null
  verdict: AddressVerdict | null
  keywordNote?: (item: PlanItemBrief) => ReactNode
  editable: boolean
  onChange?: (id: string, patch: PlanBriefPatch) => void
  onClose: () => void
  onSave?: () => void | Promise<void>
  saving: boolean
}) {
  const uid = useId()
  const headingId = `${uid}-heading`
  const titleId = `${uid}-title`
  const slugId = `${uid}-slug`
  const slugHintId = `${uid}-slug-hint`
  const keywordId = `${uid}-keyword`

  if (!row) {
    return (
      <aside className="plan-brief-detail" aria-label="Détail du brief">
        <p className="meta" style={{ margin: 0 }}>
          Ouvrez un brief dans la liste pour le lire en entier{editable ? ' et le corriger' : ''}.
        </p>
      </aside>
    )
  }

  const { item } = row
  const action = item.action
  const kind = planActionKind(item)
  // Seule une page à créer se corrige : un sujet écarté ou une ancienne mise à
  // jour ne produiront rien, il n'y a rien à retaper. Une adresse ne se choisit
  // que pour une page qui n'existe pas.
  const canEdit = editable && kind === 'create' && onChange !== undefined
  const patch = (next: PlanBriefPatch) => onChange?.(item.id, next)

  return (
    <aside className="plan-brief-detail" aria-labelledby={headingId}>
      <div className="plan-brief-detail__head">
        <span className="eyebrow" id={headingId}>Brief du {formatDayLong(item.scheduled_date)}</span>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Fermer le détail">
          <X size={15} />
        </button>
      </div>

      <div className="plan-brief__tags">
        <ActionBadge kind={kind} />
        {kind === 'create' && <span className="chip">{pageTypeLabel(item.page_type)}</span>}
        {kind === 'create' && (
          <span className="meta">{item.search_intent || '—'} · {formatMetric(item.estimated_word_count, 'number')} mots</span>
        )}
      </div>

      {canEdit ? (
        <FormField label="Titre" htmlFor={titleId}>
          <input
            id={titleId}
            className="input"
            value={item.proposed_title}
            onChange={(event) => patch({ proposed_title: event.target.value })}
          />
        </FormField>
      ) : (
        <ReadField label="Titre">
          <span className={kind !== 'create' ? 'plan-brief-detail__struck' : undefined}>{item.proposed_title || 'Sans titre'}</span>
        </ReadField>
      )}

      {action?.kind === 'skip' ? (
        <ReadField label="Pourquoi ce sujet est écarté">
          {action.reasons.length > 0 ? <BulletList lines={action.reasons} /> : <span className="meta">Aucun motif enregistré.</span>}
          <p className="meta" style={{ margin: 'var(--space-2) 0 0' }}>Aucune page ne sera produite pour ce créneau.</p>
        </ReadField>
      ) : action?.kind === 'refresh' ? (
        <>
          <ReadField label="Page existante visée">
            <span className="mono">{action.targetPath}</span>
            <p className="meta" style={{ margin: 'var(--space-2) 0 0' }}>
              Mise à jour (ancien plan) — ne sera pas produite : le moteur ne met plus à jour les pages existantes.
              Aucune page ne sera écrite pour ce créneau, et cette page restera telle qu’elle est.
            </p>
          </ReadField>
          {/* Les phrases du domaine, RECOPIÉES TELLES QUELLES : elles portent
              les chiffres qui avaient décidé, et les reformuler couperait le
              seul lien entre l'ancienne décision et sa mesure. */}
          <ReadField label="Ce qui motivait cette ligne">
            {action.evidence.length > 0 ? <BulletList lines={action.evidence} /> : <span className="meta">Aucun motif enregistré.</span>}
          </ReadField>
        </>
      ) : canEdit ? (
        <FormField label="Adresse" htmlFor={slugId}>
          <input
            id={slugId}
            className="input mono"
            value={item.proposed_slug}
            onChange={(event) => patch({ proposed_slug: event.target.value })}
            aria-invalid={verdict?.blocking || undefined}
            aria-describedby={verdict ? slugHintId : undefined}
          />
          {verdict && <div id={slugHintId}><VerdictLine verdict={verdict} /></div>}
        </FormField>
      ) : (
        <ReadField label="Adresse">
          <span className="mono">{displayPath(item.proposed_slug)}</span>
          {verdict && <VerdictLine verdict={verdict} />}
        </ReadField>
      )}

      {canEdit ? (
        <FormField label="Requête visée" htmlFor={keywordId}>
          <input
            id={keywordId}
            className="input"
            value={item.target_keyword}
            onChange={(event) => patch({ target_keyword: event.target.value })}
          />
          <KeywordMeta item={item} note={keywordNote?.(item)} />
        </FormField>
      ) : (
        <ReadField label="Requête visée">
          {item.target_keyword || '—'}
          <KeywordMeta item={item} note={keywordNote?.(item)} />
        </ReadField>
      )}

      {kind === 'create' && (
        <>
          <ReadField label="Plan de la page">
            {item.outline.length > 0 ? (
              <ol className="plan-brief-detail__list">
                {item.outline.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
              </ol>
            ) : (
              <span className="meta">Aucune trame proposée.</span>
            )}
          </ReadField>

          <ReadField label="Ce que la page doit citer">
            {item.required_entities.length > 0
              ? item.required_entities.join(', ')
              : <span className="meta">Rien d’imposé.</span>}
          </ReadField>

          {item.rationale && (
            <ReadField label="Pourquoi ce brief">{item.rationale}</ReadField>
          )}

          {item.competitor_insights.length > 0 && (
            <ReadField label="Vu chez les concurrents">
              <BulletList lines={item.competitor_insights} />
            </ReadField>
          )}
        </>
      )}

      {canEdit && onSave && (
        <div className="plan-brief-detail__actions">
          <Button icon={Save} loading={saving} onClick={() => { void onSave() }}>Enregistrer</Button>
          <span className="meta">
            Les corrections sont reprises dans la liste au fil de la frappe ; enregistrer les conserve sans lancer le cycle.
          </span>
        </div>
      )}
    </aside>
  )
}

/** La commune visée et, quand l'écran en a une, la preuve Search Console. */
function KeywordMeta({ item, note }: { item: PlanItemBrief; note: ReactNode }) {
  if (!item.target_city && !note) return null
  return (
    <p className="meta" style={{ margin: 'var(--space-1) 0 0', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {item.target_city && <span>{item.target_city}</span>}
      {note}
    </p>
  )
}
