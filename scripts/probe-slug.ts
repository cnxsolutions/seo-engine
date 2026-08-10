import { buildPageSlug } from '../lib/seo/slug'

const CAS = [
  { label: 'la page publiee', proposed: 'taxi-aube-communes-desservies-reservations', city: 'Troyes' },
  { label: 'requete seule', focusKeyword: 'taxi conventionné CPAM Troyes', city: 'Troyes' },
  { label: 'titre seul', title: 'Comment réserver un taxi à la gare de Troyes ?', city: 'Troyes' },
  { label: 'deja long', proposed: 'reservation-taxi-conventionne-cpam-transport-assis-professionnalise-longue-distance', city: 'Sainte-Savine' },
]

const ANCIEN = '/taxi-aube-communes-desservies-reservations-child-service-professionnel-troyes-guide'
console.log(`avant : ${ANCIEN}  (${ANCIEN.length - 1} car., ${ANCIEN.slice(1).split('-').length} mots)\n`)

for (const { label, ...input } of CAS) {
  const slug = buildPageSlug(input)
  console.log(`${label.padEnd(18)} /${slug}`)
  console.log(`${''.padEnd(18)} ${slug.length} car., ${slug.split('-').length} mots\n`)
}
