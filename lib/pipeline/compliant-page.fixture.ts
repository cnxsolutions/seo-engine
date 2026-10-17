// ─────────────────────────────────────────────────────────────────────────────
// A page that passes the whole gate — test fixture
// SEO Engine - Post-generation pipeline
// ─────────────────────────────────────────────────────────────────────────────
//
// Shared by seo-audit.test.ts and gate.test.ts. Since 2026-10-17 the gate audits
// every SEO and GEO concept (seo-audit.ts), so a fixture made of one repeated
// filler sentence no longer describes a publishable page: it is stuffed, it
// repeats its paragraphs, it has no FAQ, no list, no direct answer. This one is
// what the generator is asked to produce, written by hand, and it is the base
// every test mutates ONE aspect of — so a red test names the rule it broke, not
// the twelve the fixture happened to break as well.
//
// Not a test file (no `.test.ts`), never imported by application code.

export const COMPLIANT = {
  pageType: 'child',
  title: 'Plombier à Troyes : dépannage rapide et devis clair',
  metaDescription:
    'Plombier à Troyes pour fuites, canalisations bouchées et chauffe-eau en panne. Diagnostic sur place, devis écrit gratuit avant travaux.',
  focusKeyword: 'plombier Troyes',
  slug: 'plombier-troyes',
  city: 'Troyes',
  businessName: 'Dupont Plomberie',
  siteUrl: 'https://dupont-plomberie.fr',
  requiredEntities: ['Sainte-Savine', 'Saint-André-les-Vergers', 'chauffe-eau'],
} as const

export const COMPLIANT_DIRECT_ANSWER =
  "Dupont Plomberie est un plombier à Troyes qui intervient sur les fuites, les canalisations bouchées et les "
  + "chauffe-eau en panne dans toute l'agglomération. Le diagnostic est réalisé sur place, puis un devis écrit "
  + 'est remis avant le début des travaux, sans engagement et sans frais cachés.'

export const COMPLIANT_FAQ = [
  {
    q: 'Intervenez-vous le week-end à Troyes ?',
    a: "Oui, une astreinte couvre le samedi et le dimanche pour les fuites et les dégâts des eaux sur l'agglomération troyenne.",
  },
  {
    q: 'Le devis est-il gratuit ?',
    a: 'Oui, le devis est gratuit et remis par écrit avant le début des travaux.',
  },
  {
    q: 'Quels quartiers sont desservis ?',
    a: 'Le centre de Troyes, Sainte-Savine, Saint-André-les-Vergers et La Chapelle-Saint-Luc sont couverts sans supplément.',
  },
] as const

export const COMPLIANT_SCHEMAS = {
  // No telephone and no address: the fixture is valid for a campaign WITHOUT a
  // Google Business Profile, the strictest case for INVENTED_NAP.
  localBusiness: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Plumber',
    name: 'Dupont Plomberie',
    url: 'https://dupont-plomberie.fr',
    areaServed: 'Troyes',
  }),
  faqPage: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: COMPLIANT_FAQ.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }),
  breadcrumb: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://dupont-plomberie.fr/' },
      { '@type': 'ListItem', position: 2, name: 'Plombier à Troyes', item: 'https://dupont-plomberie.fr/plombier-troyes' },
    ],
  }),
  article: JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Plombier à Troyes : dépannage rapide et devis clair',
    author: { '@type': 'Organization', name: 'Dupont Plomberie' },
    publisher: { '@type': 'Organization', name: 'Dupont Plomberie' },
    datePublished: '2026-10-17',
    dateModified: '2026-10-17',
    inLanguage: 'fr-FR',
  }),
}

/** ~470 measured words. */
export const COMPLIANT_HTML = [
  '<h1>Plombier à Troyes : dépannage rapide et devis clair</h1>',
  `<p class="reponse-directe">${COMPLIANT_DIRECT_ANSWER}</p>`,
  '<h2>Comment reconnaître une fuite avant les dégâts ?</h2>',
  "<p>Une fuite sous l'évier se signale souvent par une trace d'humidité dans le meuble bas, bien avant que l'eau "
    + "n'atteigne le sol. Le joint du siphon se desserre avec le temps, et un simple resserrage suffit dans la "
    + "majorité des cas. Lorsque la fuite persiste, la bague d'étanchéité doit être remplacée.</p>",
  '<p>Quelques signes doivent alerter sans attendre :</p>',
  '<ul>',
  "<li>une facture d'eau qui augmente sans raison apparente ;</li>",
  '<li>un compteur qui tourne alors que tous les robinets sont fermés ;</li>',
  '<li>une odeur de moisi ou une peinture qui cloque au bas d’un mur.</li>',
  '</ul>',
  '<h2>Combien coûte un dépannage de plomberie à Troyes ?</h2>',
  '<p>Le prix dépend de la nature de la panne, du temps passé et des pièces remplacées. Un '
    + '<a href="/debouchage-canalisation-troyes">débouchage de canalisation</a> demande généralement moins '
    + "d'une heure de travail, alors que le remplacement d'un chauffe-eau occupe une matinée entière. Le devis "
    + "écrit précise chaque poste avant l'intervention, et aucune pièce n'est commandée sans accord préalable.</p>",
  '<h2>Entretenir son installation pour éviter les urgences</h2>',
  "<p>Le calcaire reste la première cause d'usure des installations dans l'Aube. Il se dépose sur les résistances "
    + 'du chauffe-eau, réduit le débit des mousseurs et finit par bloquer les robinets thermostatiques. Un '
    + 'détartrage annuel prolonge la durée de vie des appareils et limite la consommation électrique du ballon.</p>',
  '<p>Le groupe de sécurité du chauffe-eau mérite la même attention. S’il goutte en permanence, il est '
    + 'probablement entartré et ne protège plus la cuve contre la surpression : son '
    + '<a href="/remplacement-chauffe-eau-troyes">remplacement</a> coûte bien moins cher qu’un ballon percé.</p>',
  '<h2>Questions fréquentes</h2>',
  ...COMPLIANT_FAQ.flatMap(item => [`<h3>${item.q}</h3>`, `<p>${item.a}</p>`]),
  '<p>Pour un sinistre, les démarches officielles sont détaillées sur la page '
    + '<a href="https://www.service-public.fr/particuliers/vosdroits/F2061" target="_blank" rel="noopener noreferrer">'
    + 'dégât des eaux de service-public.fr</a>, et Dupont Plomberie se déplace pour le constat technique.</p>',
  '<p class="page-auteur">Publié par Dupont Plomberie — mis à jour le <time datetime="2026-10-17">2026-10-17</time></p>',
].join('\n')
