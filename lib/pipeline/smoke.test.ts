// ─────────────────────────────────────────────────────────────────────────────
// End-to-end gate smoke test
// SEO Engine - Does a NORMAL French article get published?
// ─────────────────────────────────────────────────────────────────────────────
//
// Every other test in this module checks that a defect is caught. This one
// checks the opposite, and it is the one that matters most in practice: the gate
// became blocking, and a gate that refuses everything stops the product just as
// surely as no gate at all. Six rules were found rejecting 100% of generated
// pages before they were recalibrated — this test is what keeps that from
// silently coming back.
//
// The article below is deliberately real French prose rather than filler: the
// readability rule computes a Flesch score from a syllable count, and the bug it
// replaced counted vowel CHARACTERS, which made every French text score deeply
// negative. Lorem ipsum would not exercise that at all.

import { describe, expect, it } from 'vitest'
import { measureLength } from './word-count'
import { runValidationGate } from './gate'

// ─── A page as the generator produces it ────────────────────────────────────

/** Matches the fixture below (~740 measured words), comfortably above the 85% floor. */
const TARGET_WORDS = 800

const BODY = `
<h1>Dépannage plomberie à Troyes : intervention rapide et tarifs clairs</h1>

<p>Un plombier intervient à Troyes en moins de deux heures pour une fuite, une
canalisation bouchée ou une panne de chauffe-eau. Le déplacement est facturé au
tarif convenu avant l'intervention, et le devis est remis sur place avant tout
travail engagé.</p>

<h2>Quand faut-il appeler un plombier en urgence ?</h2>

<p>Certaines situations ne peuvent pas attendre le lendemain. Une fuite qui
coule en continu sous un évier, une canalisation qui refoule dans la douche ou
un chauffe-eau qui ne produit plus d'eau chaude en plein hiver relèvent de
l'urgence. Dans ces cas, couper l'arrivée d'eau au robinet général reste le
premier geste à faire avant même de téléphoner. Cela limite les dégâts sur le
sol et sur les cloisons, et cela réduit souvent le montant final de la
réparation.</p>

<p>D'autres désordres tolèrent un rendez-vous planifié. Un robinet qui goutte,
une chasse d'eau qui fuit légèrement ou un siphon encrassé peuvent être traités
dans la semaine sans risque particulier. Le fait de regrouper plusieurs petites
interventions sur un même passage permet d'ailleurs de réduire le coût du
déplacement, qui reste facturé une seule fois.</p>

<h2>Combien coûte une intervention de plomberie ?</h2>

<p>Le prix dépend de trois éléments : la nature de la panne, le temps passé et
les pièces remplacées. Un débouchage simple demande généralement moins d'une
heure de travail. Le remplacement d'un chauffe-eau, lui, occupe une matinée
entière et suppose l'évacuation de l'ancien appareil. Un devis écrit est remis
avant chaque chantier, et aucune pièce n'est commandée sans accord préalable.</p>

<p>Les interventions de nuit, le dimanche et les jours fériés font l'objet d'une
majoration. Elle est annoncée au téléphone, avant le déplacement, pour que la
décision d'intervenir immédiatement ou d'attendre le lendemain reste celle du
client. Cette transparence évite les mauvaises surprises au moment de la
facture, qui sont la première source de litige dans le métier.</p>

<h2>Quelles zones sont desservies autour de Troyes ?</h2>

<p>L'intervention couvre Troyes et sa périphérie immédiate : Saint-André-les-Vergers,
Sainte-Savine, La Chapelle-Saint-Luc, Pont-Sainte-Marie et Saint-Julien-les-Villas.
Les communes plus éloignées de l'Aube sont traitées sur rendez-vous, avec un
délai adapté à la distance. Le secteur d'intervention est volontairement
resserré : c'est ce qui permet de tenir un délai de deux heures en urgence
plutôt que de promettre une couverture départementale impossible à honorer.</p>

<h2>Comment se déroule une intervention ?</h2>

<p>Le diagnostic commence par la localisation précise du désordre. Une fuite
visible sous un meuble ne provient pas toujours de l'élément le plus proche :
l'eau suit les pentes du sol et peut apparaître à plusieurs mètres de son
origine. Cette étape conditionne la suite, car réparer au mauvais endroit
revient à repasser une seconde fois quelques jours plus tard.</p>

<p>Vient ensuite la réparation proprement dite, puis un essai en conditions
réelles. Le point réparé est mis sous pression et observé pendant plusieurs
minutes avant que le chantier soit considéré comme terminé. Les déchets et les
pièces remplacées sont évacués, et le lieu est rendu propre. Ce dernier point
paraît secondaire ; il est pourtant celui que les clients citent le plus souvent
lorsqu'ils recommandent un artisan.</p>

<h2>Entretenir sa plomberie pour éviter les urgences</h2>

<p>La majorité des dépannages en urgence auraient pu être évités par un
entretien simple. Détartrer un mitigeur une fois par an, vérifier l'état des
joints sous les éviers et purger le chauffe-eau tous les deux ans suffisent à
écarter la plupart des pannes courantes. Un groupe de sécurité qui goutte en
permanence n'est pas normal : c'est le signe d'un entartrage avancé, et son
remplacement coûte bien moins cher qu'un ballon percé.</p>

<p>Les canalisations anciennes en plomb ou en acier galvanisé méritent une
attention particulière. Elles se bouchent progressivement par accumulation de
calcaire et finissent par réduire fortement le débit. Un remplacement anticipé,
planifié hors urgence, se réalise dans de bien meilleures conditions qu'une
intervention en catastrophe un dimanche soir.</p>

<h2>Questions fréquentes</h2>

<h3>Quel est le délai d'intervention en urgence ?</h3>
<p>Deux heures en moyenne sur Troyes et les communes limitrophes, selon la
circulation et les interventions déjà engagées.</p>

<h3>Le devis est-il payant ?</h3>
<p>Le devis est gratuit et remis avant le début des travaux. Seul le
déplacement est facturé si aucune réparation n'est engagée.</p>

<h3>Intervenez-vous le week-end ?</h3>
<p>Oui, samedi, dimanche et jours fériés, avec une majoration annoncée par
téléphone avant le déplacement.</p>
`

const SCHEMA_LOCAL_BUSINESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Plumber',
  name: 'Plomberie Exemple',
  areaServed: 'Troyes',
  telephone: '+33325000000',
})

const SCHEMA_FAQ = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: "Quel est le délai d'intervention en urgence ?",
      acceptedAnswer: { '@type': 'Answer', text: 'Deux heures en moyenne sur Troyes.' },
    },
  ],
})

const SCHEMA_BREADCRUMB = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://exemple.fr/' },
  ],
})

function gateInput(overrides: Partial<Parameters<typeof runValidationGate>[0]> = {}) {
  const html = (overrides.html as string) ?? BODY

  return {
    pageType: 'local_pack',
    title: 'Dépannage plomberie à Troyes : intervention rapide et tarifs clairs',
    metaDescription:
      "Plombier à Troyes : intervention en moins de deux heures pour fuite, canalisation bouchée ou chauffe-eau. Devis gratuit avant travaux, tarifs annoncés.",
    focusKeyword: 'dépannage plomberie troyes',
    html,
    url: 'https://exemple.fr/depannage-plomberie-troyes',
    schemaLocalBusiness: SCHEMA_LOCAL_BUSINESS,
    schemaFaqPage: SCHEMA_FAQ,
    schemaBreadcrumb: SCHEMA_BREADCRUMB,
    measurement: measureLength({ html, target: TARGET_WORDS }),
    deadInternalLinks: 0,
    anomalies: [],
    ...overrides,
  }
}

// ─── The test that matters ──────────────────────────────────────────────────

describe('gate — a normal French article', () => {
  it('is long enough to be judged at all', () => {
    // Guards the fixture itself: if an edit shortened the article below target,
    // the publish assertion below would fail for the wrong reason.
    const measurement = measureLength({ html: BODY, target: TARGET_WORDS })
    expect(measurement.measured).toBeGreaterThanOrEqual(TARGET_WORDS * 0.85)
    expect(measurement.meetsTarget).toBe(true)
  })

  it('IS PUBLISHED — the gate does not block ordinary French prose', async () => {
    const verdict = await runValidationGate(gateInput())

    // On failure, name the rules that blocked: a bare `false` here would send
    // the next reader digging through five validators.
    expect(
      verdict.publishable,
      `Bloqué par : ${verdict.blocking.map((f) => `${f.code} (${f.source})`).join(', ') || 'aucun'}`
    ).toBe(true)
    expect(verdict.blocking).toHaveLength(0)
  })

  it('warns about an incomplete LocalBusiness instead of refusing the page', async () => {
    // The fixture's LocalBusiness carries no `address`, on purpose: that is the
    // normal output for a campaign whose postal address was never supplied, and
    // the generator prompt explicitly forbids inventing one. Blocking here would
    // make the gate and the generator contradict each other, and no page would
    // ever be published for such a campaign.
    const verdict = await runValidationGate(gateInput())

    expect(verdict.blocking.some((f) => f.code.startsWith('JSON_LD_'))).toBe(false)
    expect(verdict.warnings.some((f) => f.code === 'JSON_LD_MISSING_REQUIRED_PROPERTY')).toBe(true)
  })

  it('runs the real validators rather than degrading to structural checks alone', async () => {
    // `degraded` is set when the orchestrator threw and only the structural
    // checks ran. A green suite in that state would prove nothing about the
    // quality and SEO rules.
    const verdict = await runValidationGate(gateInput())
    expect(verdict.degraded).toBeUndefined()
  })
})

// ─── And the symmetric danger: it must still block ──────────────────────────

describe('gate — genuinely defective pages', () => {
  it('blocks a page half the ordered length', async () => {
    const html = BODY.slice(0, Math.floor(BODY.length / 3))
    const verdict = await runValidationGate(
      gateInput({ html, measurement: measureLength({ html, target: TARGET_WORDS }) })
    )

    expect(verdict.publishable).toBe(false)
    expect(verdict.blocking.some((f) => f.source === 'length' || f.code.includes('WORD_COUNT'))).toBe(true)
  })

  it('blocks a page with no H1', async () => {
    const html = BODY.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
    const verdict = await runValidationGate(
      gateInput({ html, measurement: measureLength({ html, target: TARGET_WORDS }) })
    )

    expect(verdict.publishable).toBe(false)
    expect(verdict.blocking.some((f) => f.source === 'structure')).toBe(true)
  })

  it('blocks a page whose JSON-LD does not parse', async () => {
    const verdict = await runValidationGate(gateInput({ schemaLocalBusiness: '{ "@type": Plumber, }' }))

    expect(verdict.publishable).toBe(false)
    expect(verdict.blocking.some((f) => f.source === 'structure')).toBe(true)
  })

  it('blocks a page with no title', async () => {
    const verdict = await runValidationGate(gateInput({ title: '' }))
    expect(verdict.publishable).toBe(false)
  })
})
