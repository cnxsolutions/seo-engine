// ─────────────────────────────────────────────────────────────────────────────
// Production tab — what the engine manufactured
//
// Everything here is a count of OUR OWN rows: pages attempted, refused by the
// quality gate, published, slots still ahead, and how long a run takes. Not one
// figure on this tab comes from Google — that is the other tab's job, and the
// separation is the whole point of the split.
//
// Tiles, meter, empty state and the curve are the SHARED components. The local
// copies this file used to import were written while the design system was being
// rewritten in the next room; they are gone.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldAlert,
  Timer,
  TriangleAlert,
  Wand2,
} from 'lucide-react'
import Link from 'next/link'
import { JOB_HISTORY_DAYS, type ProductionMetrics } from '@/app/api/dashboard/metrics'
import { LineChart } from '@/components/charts'
import { EmptyState, Meter, StatTile, StatusBadge } from '@/components/ui'
import { pageTypeLabel } from '@/lib/types'
import { Panel, SourceNote } from './ui-bits'
import { formatCount, formatDateTime, formatDay, formatDayLong, formatDuration } from './viz'

const JOB_TYPE_LABELS: Record<string, string> = {
  campaign: 'Génération',
  editorial_slot: 'Créneau éditorial',
  publish: 'Publication',
}

/** A curve over one or two points is decoration; below this the tab says so instead. */
const MIN_DAYS_FOR_A_CURVE = 3

export function ProductionTab({ metrics, scopeLabel }: { metrics: ProductionMetrics; scopeLabel: string }) {
  const { counts, window } = metrics
  const period = `${formatDayLong(window.start)} → ${formatDayLong(window.end)} (${window.days} jours)`

  const nothingAtAll = !metrics.hasHistory && metrics.plannedSlots === 0 && metrics.runs.length === 0

  return (
    <div>
      <SourceNote
        source="tables generations, editorial_calendar et job_executions du moteur"
        period={period}
        note={<>Scope : {scopeLabel}</>}
      />

      {metrics.unreadable.length > 0 && (
        <div
          className="panel"
          style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}
        >
          <TriangleAlert size={16} color="var(--status-critical)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-secondary)', margin: 0 }}>
            Impossible de lire {metrics.unreadable.join(', ')}. Les compteurs qui en dépendent sont incomplets — ils ne
            valent pas zéro.
          </p>
        </div>
      )}

      {nothingAtAll ? (
        <EmptyState
          icon={Wand2}
          variant="no-data"
          title="Le moteur n'a encore rien produit"
          description="Aucune génération, aucun créneau planifié pour ce scope. Lancez une analyse de site pour obtenir un plan de contenu, puis planifiez un cycle."
          action={{ label: 'Analyser un site', href: '/strategy/new' }}
        />
      ) : (
        <>
          <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
            <StatTile
              icon={CalendarClock}
              label="Créneaux à venir"
              value={metrics.plannedSlots}
              hint="Slots planifiés, pas encore générés"
            />
            <StatTile
              icon={FileText}
              label="Pages générées"
              value={counts.produced}
              hint={`${formatCount(counts.attempted)} tentative${counts.attempted > 1 ? 's' : ''} · ${formatCount(metrics.allTime.produced)} depuis le début`}
            />
            <StatTile
              icon={ShieldAlert}
              label="Rejetées par le gate"
              value={counts.rejected}
              hint="Refusées avant publication par le contrôle qualité"
            />
            <StatTile
              icon={CheckCircle2}
              label="Pages publiées"
              value={counts.published}
              hint={`${formatCount(metrics.allTime.published)} en ligne depuis le début`}
            />
          </div>

          <div className="kpi-row" style={{ marginBottom: 'var(--space-6)' }}>
            <div className="stat-card">
              <Meter
                label="Taux d'échec technique"
                // Counted, not a percentage handed in: the meter shows failures
                // against attempts, so an empty period reads 0/0 rather than a
                // flattering 0 %.
                value={counts.failed}
                max={Math.max(counts.attempted, 1)}
                valueLabel={
                  metrics.failureRate === null
                    ? '—'
                    : `${formatCount(counts.failed)} / ${formatCount(counts.attempted)}`
                }
                tone="auto"
                thresholds={{ warning: 0.1, critical: 0.25 }}
              />
              <p className="meta" style={{ marginTop: 'var(--space-2)' }}>
                {metrics.failureRate === null
                  ? 'Aucune tentative sur la période — pas de taux à calculer.'
                  : `${formatCount(counts.failed)} échec${counts.failed > 1 ? 's' : ''} sur ${formatCount(counts.attempted)} tentative${counts.attempted > 1 ? 's' : ''}.`}
              </p>
            </div>
            <StatTile
              icon={Timer}
              label="Durée moyenne de génération"
              value={formatDuration(metrics.averageGenerationMs)}
              hint={`Exécutions réussies, sur les ${JOB_HISTORY_DAYS} derniers jours conservés`}
            />
            <StatTile
              icon={Loader2}
              label="En cours"
              value={counts.inProgress}
              hint="Générations démarrées et pas encore conclues"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-6)' }}>
            <Panel title="Rythme de production" subtitle="Pages générées par jour" icon={FileText}>
              {metrics.activeDays >= MIN_DAYS_FOR_A_CURVE ? (
                <LineChart
                  series={[
                    {
                      id: 'produced',
                      name: 'Pages générées',
                      slot: 1,
                      points: metrics.perDay.map((day) => ({ label: formatDay(day.date), value: day.produced })),
                    },
                  ]}
                  area
                  height={190}
                  emptyMessage="Aucun point sur la période."
                />
              ) : (
                <p className="meta" style={{ margin: 0, lineHeight: 'var(--lh-normal)' }}>
                  {metrics.activeDays === 0
                    ? 'Aucune génération sur la période — rien à tracer.'
                    : `Production sur ${metrics.activeDays} jour${metrics.activeDays > 1 ? 's' : ''} seulement : une courbe donnerait une fausse impression de tendance. Le compteur ci-dessus dit tout.`}
                </p>
              )}
            </Panel>

            <Panel
              title="Prochains créneaux"
              subtitle="Calendrier éditorial — ce que le moteur produira ensuite"
              icon={CalendarClock}
              action={<Link href="/calendar" className="btn-link">Calendrier</Link>}
            >
              {metrics.upcomingSlots.length === 0 ? (
                <p className="meta" style={{ margin: 0, lineHeight: 'var(--lh-normal)' }}>
                  Aucun créneau planifié devant nous. Le moteur ne produira rien tant qu&apos;un cycle n&apos;est pas
                  confirmé.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                  {metrics.upcomingSlots.map((slot) => (
                    <li
                      key={slot.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-2) 0',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <span
                        className="num"
                        style={{
                          fontSize: 'var(--fs-xs)',
                          fontWeight: 600,
                          color: 'var(--ink-secondary)',
                          minWidth: 92,
                        }}
                      >
                        {formatDayLong(slot.scheduledDate)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="truncate" style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--ink-primary)' }}>
                          {slot.targetKeyword}
                        </span>
                        <span className="meta">
                          {pageTypeLabel(slot.pageType)}
                          {slot.targetCity ? ` · ${slot.targetCity}` : ''}
                          {slot.attemptCount > 0 ? ` · ${slot.attemptCount} tentative(s)` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: 'var(--space-6)',
              marginTop: 'var(--space-6)',
            }}
          >
            <Panel
              title="Exécutions du moteur"
              subtitle={`Historique conservé ${JOB_HISTORY_DAYS} jours seulement, quelle que soit la période choisie. Une exécution de créneau déclenche aussi une exécution de génération : les familles ne s'additionnent pas.`}
              icon={Timer}
            >
              {metrics.runs.length === 0 ? (
                <p className="meta" style={{ margin: 0 }}>Aucune exécution enregistrée sur la période.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                    {metrics.runStats.map((family) => (
                      <span key={family.jobType} className="chip">
                        <strong style={{ color: 'var(--ink-primary)' }}>
                          {JOB_TYPE_LABELS[family.jobType] ?? family.jobType}
                        </strong>{' '}
                        {family.total} exéc. · {family.failed} échec{family.failed > 1 ? 's' : ''}
                        {family.averageMs !== null ? ` · ${formatDuration(family.averageMs)}` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="scroll-x">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Quand</th>
                          <th scope="col">Job</th>
                          <th scope="col">État</th>
                          <th scope="col" className="cell-num">Durée</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.runs.map((run, index) => (
                          <tr key={`${run.executedAt}-${index}`}>
                            <td className="cell-num" style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>
                              {formatDateTime(run.executedAt)}
                            </td>
                            <td>{JOB_TYPE_LABELS[run.jobType] ?? run.jobType}</td>
                            <td>
                              <StatusBadge status={run.status} />
                              {run.errorMessage && (
                                <div className="meta" style={{ marginTop: 3, maxWidth: 320 }}>{run.errorMessage}</div>
                              )}
                            </td>
                            <td className="cell-num" style={{ whiteSpace: 'nowrap' }}>{formatDuration(run.durationMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Dernières pages produites" subtitle="Table generations" icon={FileText}>
              {metrics.recent.length === 0 ? (
                <p className="meta" style={{ margin: 0 }}>Aucune page produite sur la période.</p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                  {metrics.recent.map((generation) => (
                    <li
                      key={generation.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-2) 0',
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          className="truncate"
                          style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--ink-primary)' }}
                        >
                          {generation.title || 'Sans titre'}
                        </span>
                        <span className="meta">
                          {pageTypeLabel(generation.pageType)}
                          {generation.city ? ` · ${generation.city}` : ''} · {formatDateTime(generation.createdAt)}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <StatusBadge status={generation.status} />
                        {generation.publishedUrl && (
                          <a href={generation.publishedUrl} target="_blank" rel="noopener noreferrer" className="btn-link">
                            Voir ↗
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
