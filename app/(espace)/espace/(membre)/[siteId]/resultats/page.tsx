import type { Metadata } from 'next'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { LineChart } from '@/components/charts'
import { formatDay, formatDayLong } from '@/components/ui'
import { pagePath } from '@/src/core/domain/client-space/results'
import { RESULTS_TEXT } from '@/lib/client-space/labels'
import { readSearchResults } from '@/lib/client-space/results'
import { currentSite } from '../current-site'

export const metadata: Metadata = { title: 'Résultats Google' }

const COUNT = new Intl.NumberFormat('fr-FR')
const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })

/**
 * /espace/<site>/resultats — ESP-5: two figures against the four weeks
 * before, the daily curve, the five pages and five searches that bring the
 * most visits, and where the numbers come from. Without data, a sentence
 * that says why — never a zero that would read as « no visitor ».
 */
export default async function SiteResultsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const { site } = await currentSite(siteId)
  const view = await readSearchResults(site)

  if (view.kind !== 'results') {
    const waiting = view.kind === 'waiting'
    return (
      <section className="espace-hero" aria-labelledby="resultats-titre">
        <p className="espace-hero__eyebrow">{RESULTS_TEXT.eyebrow}</p>
        <h1 id="resultats-titre" className="espace-hero__title">{waiting ? RESULTS_TEXT.waitingTitle : RESULTS_TEXT.notLinkedTitle}</h1>
        <p className="espace-hero__text">{waiting ? RESULTS_TEXT.waitingBody : RESULTS_TEXT.notLinkedBody}</p>
      </section>
    )
  }

  const { results } = view
  return (
    <>
      <header className="espace-results__head">
        <p className="eyebrow">{RESULTS_TEXT.eyebrow}</p>
        <h1 className="espace-page-title">{RESULTS_TEXT.title(results.days)}</h1>
      </header>

      <section className="espace-figures" aria-label="Chiffres clés">
        <Figure label={RESULTS_TEXT.clicks} value={results.current.clicks} change={results.change.clicks} days={results.days} />
        <Figure label={RESULTS_TEXT.impressions} value={results.current.impressions} change={results.change.impressions} days={results.days} />
      </section>
      <p className="espace-section__lead">{RESULTS_TEXT.explain}</p>

      <section className="espace-card" aria-labelledby="courbe-titre">
        <h2 id="courbe-titre" className="espace-section__title">{RESULTS_TEXT.curveTitle}</h2>
        <LineChart
          series={[{ id: 'visites', name: 'Visites', slot: 1, points: results.daily.map((point) => ({ label: formatDay(point.day), value: point.clicks })) }]}
          height={200}
          area
          legend={false}
          directLabels={false}
          description={`${RESULTS_TEXT.clicks}, du ${formatDayLong(results.fromDay)} au ${formatDayLong(results.toDay)}`}
        />
      </section>

      <div className="espace-columns">
        <RankedList title={RESULTS_TEXT.topPages} id="top-pages" rows={results.pages.map((row) => ({ key: row.url, label: pagePath(row.url) ?? RESULTS_TEXT.homePage, clicks: row.clicks }))} />
        <RankedList title={RESULTS_TEXT.topQueries} id="top-recherches" rows={results.queries.map((row) => ({ key: row.query, label: `« ${row.query} »`, clicks: row.clicks }))} />
      </div>

      <p className="espace-source">{RESULTS_TEXT.source(formatDay(results.fromDay), formatDay(results.toDay))}</p>
    </>
  )
}

/** One figure, its change said with a glyph and a word — never the colour alone. */
function Figure({ label, value, change, days }: { label: string; value: number; change: number | null; days: number }) {
  const direction = change === null || Math.round(change * 100) === 0 ? 'flat' : change > 0 ? 'up' : 'down'
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className="espace-figure">
      <p className="espace-figure__label">{label}</p>
      <p className="espace-figure__value">{COUNT.format(value)}</p>
      <p className={`espace-figure__change espace-figure__change--${direction}`}>
        {change === null ? (
          RESULTS_TEXT.noComparison
        ) : (
          <>
            <Icon size={14} aria-hidden="true" />
            <span>{PERCENT.format(change)} {RESULTS_TEXT.versus(days)}</span>
          </>
        )}
      </p>
    </div>
  )
}

function RankedList({ title, id, rows }: { title: string; id: string; rows: Array<{ key: string; label: string; clicks: number }> }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="espace-section__title espace-section__title--spaced">{title}</h2>
      {rows.length === 0 ? (
        <p className="espace-empty">{RESULTS_TEXT.emptyList}</p>
      ) : (
        <ol className="espace-list espace-ranked">
          {rows.map((row) => (
            <li key={row.key} className="espace-row espace-ranked__row">
              <span className="espace-ranked__label">{row.label}</span>
              <span className="espace-ranked__value">{RESULTS_TEXT.visits(row.clicks)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

