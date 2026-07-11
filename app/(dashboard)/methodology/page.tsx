'use client'

import { BookOpen, Layers, Link2, Globe, MapPin, Zap, CalendarDays, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui'

const SECTIONS = [
  {
    id: 'cluster',
    icon: Layers,
    color: '#5347ce',
    title: 'Stratégie Pilier / Fille',
    subtitle: 'La base de toute autorité topique',
    content: `Un cluster thématique = 1 page pilier exhaustive + plusieurs pages filles spécialisées.
La page pilier couvre un sujet large (ex: "Plombier Troyes") et link vers chaque page fille.
Chaque page fille approfondit un sous-sujet (ex: "Dépannage fuite Troyes") et link retour vers le pilier.`,
    schema: `
┌─────────────────────────────────┐
│         PAGE PILIER             │
│   "Plombier Troyes"            │
│   (2000+ mots, exhaustive)     │
└───────┬──────┬──────┬──────────┘
        │      │      │
   ┌────▼──┐ ┌▼────┐ ┌▼────────┐
   │ Fille │ │Fille│ │  Fille   │
   │Fuite  │ │Chauf│ │Débouchage│
   └───────┘ └─────┘ └──────────┘

Chaque flèche = un lien interne bidirectionnel`,
    impact: 'Google comprend que vous faites autorité sur le sujet entier, pas juste un mot-clé isolé.',
  },
  {
    id: 'types',
    icon: BookOpen,
    color: '#887cfd',
    title: 'Types de pages SEO',
    subtitle: '5 formats qui captent des intentions différentes',
    content: `Chaque type de page cible une intention de recherche différente :`,
    list: [
      { label: 'Pilier', desc: 'Contenu exhaustif qui fait autorité. Cible les requêtes larges. 2000+ mots.', example: '"Plombier Troyes : guide complet"' },
      { label: 'Fille', desc: 'Sous-aspect d\'un pilier. Cible la longue traîne. 800+ mots.', example: '"Réparation fuite d\'eau Troyes"' },
      { label: 'Alternative', desc: 'Capte les gens qui cherchent des alternatives à un concurrent.', example: '"Alternative à [Concurrent] à Troyes"' },
      { label: 'Comparative', desc: 'Compare solutions. Forte intention d\'achat.', example: '"[Vous] vs [Concurrent] : comparatif"' },
      { label: 'Local Pack', desc: 'Optimisé pour Google Maps. NAP, horaires, zones desservies.', example: '"Plombier près de moi Troyes"' },
    ],
    impact: 'Couvrir toutes les intentions = capter le trafic à chaque étape du parcours client.',
  },
  {
    id: 'internal',
    icon: Link2,
    color: '#4896fe',
    title: 'Maillage interne',
    subtitle: 'Comment les liens entre vos pages boostent tout le site',
    content: `Le maillage interne distribue le "jus SEO" (autorité) entre vos pages.
Plus une page reçoit de liens internes, plus Google la considère importante.`,
    schema: `
RÈGLES D'OR :
• Pilier → link vers TOUTES ses filles (hub)
• Fille → link retour vers son pilier
• Fille → link vers 2-3 pages sœurs
• Utiliser des ancres descriptives (pas "cliquez ici")
• Varier les textes d'ancrage

RÉSULTAT :
Pilier reçoit le plus de liens = rank sur les requêtes compétitives
Filles reçoivent du jus du pilier = rankent sur la longue traîne`,
    impact: 'Un maillage bien fait peut doubler le trafic organique sans créer de nouveau contenu.',
  },
  {
    id: 'external',
    icon: Globe,
    color: '#16c8c7',
    title: 'Maillage externe',
    subtitle: 'Pourquoi linker vers d\'autres sites vous aide',
    content: `Contre-intuitif mais vrai : linker vers des sources d'autorité (sites .gouv, Wikipedia, études) améliore votre crédibilité aux yeux de Google.`,
    schema: `
BONNES PRATIQUES :
• 2-3 liens externes par page vers des sources fiables
• Cibler des domaines à forte autorité (DA > 50)
• Liens en "noopener noreferrer" + target="_blank"
• L'ancre doit être descriptive et naturelle

POURQUOI ÇA MARCHE :
Google utilise vos liens sortants pour comprendre
votre contexte thématique. Un plombier qui link vers
des normes NF et des sites de la mairie = signal de confiance.`,
    impact: 'Les pages avec des liens externes pertinents rankent en moyenne 15% mieux.',
  },
  {
    id: 'local',
    icon: MapPin,
    color: '#f5a623',
    title: 'Local Pack (Google Maps)',
    subtitle: 'Apparaître dans le "3-pack" local',
    content: `Le Local Pack = les 3 résultats avec carte qui apparaissent pour les recherches locales ("plombier près de moi").
Pour y apparaître, vos pages doivent envoyer des signaux locaux forts.`,
    schema: `
SIGNAUX REQUIS :
✓ NAP cohérent (Nom, Adresse, Téléphone)
✓ Schema.org LocalBusiness détaillé
✓ Mentions de quartiers, rues, repères locaux
✓ Horaires d'ouverture
✓ Zones desservies explicites
✓ Avis clients / preuves sociales
✓ Google Business Profile lié

L'APP GÉNÈRE AUTOMATIQUEMENT :
• Schema LocalBusiness complet
• Mentions de communes/quartiers
• NAP dans le contenu + schema`,
    impact: 'Le local pack capte 44% des clics sur les requêtes locales. C\'est le ROI le plus rapide.',
  },
  {
    id: 'indexing',
    icon: Zap,
    color: '#5347ce',
    title: 'Indexation rapide',
    subtitle: 'Être vu par Google en heures, pas en semaines',
    content: `Publier une page ne suffit pas — il faut que Google la découvre. Par défaut, ça peut prendre 2-4 semaines.
Avec IndexNow et le ping sitemap, vos pages sont indexées en quelques heures.`,
    schema: `
PUBLICATION ──→ IndexNow (Bing/Yandex) : 2-6h
            ──→ Google Ping sitemap : 12-24h
            ──→ Google Indexing API : 1-4h (si configuré)

L'APP FAIT AUTOMATIQUEMENT :
1. Met à jour le sitemap.xml
2. Ping IndexNow avec l'URL publiée
3. Notifie Google du changement sitemap
4. (Optionnel) Appelle Google Indexing API`,
    impact: 'Indexation en heures au lieu de semaines = vos pages commencent à ranker immédiatement.',
  },
  {
    id: 'calendar',
    icon: CalendarDays,
    color: '#887cfd',
    title: 'Régularité éditoriale',
    subtitle: 'Pourquoi publier régulièrement est critique',
    content: `Google favorise les sites qui publient régulièrement. Un site qui publie tous les 2 jours sera crawlé plus souvent qu'un site qui publie une fois par mois.`,
    schema: `
RECOMMANDATIONS :
• Semaines 1-2 : Publier 10-15 pages (cluster initial)
• Ensuite : 1 page tous les 2-3 jours
• Alterner les types (pilier → filles → comparative)
• Ne jamais avoir de "trou" de plus de 7 jours

ROTATION IDÉALE :
Jour 1 : Page Pilier
Jour 3 : Page Fille #1
Jour 5 : Page Fille #2
Jour 7 : Page Local Pack
Jour 9 : Page Comparative/Alternative
→ Recommencer`,
    impact: 'Les sites avec une cadence régulière voient leur budget de crawl augmenter de 300% en 3 mois.',
  },
]

export default function MethodologyPage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader
        icon={BookOpen}
        iconColor="#5347ce"
        badge="Méthodologie"
        title="Comment fonctionne le SEO Engine"
        subtitle="Comprendre chaque technique pour maximiser vos résultats"
      />

      {/* Flow overview */}
      <div className="glass-card" style={{ marginBottom: '2rem', padding: '1.5rem 2rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Votre workflow en 5 étapes
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['Analyser le site', 'Définir la stratégie', 'Générer le contenu', 'Publier + Indexer', 'Suivre les résultats'].map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '0.5rem 1rem', borderRadius: 8,
                background: i === 0 ? 'var(--accent)' : 'var(--accent-lighter)',
                color: i === 0 ? 'white' : 'var(--accent)',
                fontWeight: 600, fontSize: '0.8rem',
              }}>
                {i + 1}. {step}
              </span>
              {i < 4 && <ArrowRight size={14} color="var(--text-muted)" />}
            </div>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <div key={section.id} className="glass-card" id={section.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{
                  width: 44, height: 44, minWidth: 44, borderRadius: 10,
                  background: `${section.color}12`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={22} color={section.color} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 2 }}>{section.title}</h2>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{section.subtitle}</p>
                </div>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-line', marginBottom: '1rem' }}>
                {section.content}
              </p>

              {section.list && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  {section.list.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--bg-primary)', borderRadius: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color: section.color, minWidth: 90 }}>{item.label}</span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {item.desc}
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{item.example}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {section.schema && (
                <pre style={{
                  background: '#1a1632', color: '#e2e0f0', padding: '1rem 1.25rem',
                  borderRadius: 8, fontSize: '0.75rem', lineHeight: 1.6,
                  overflow: 'auto', marginBottom: '1rem', fontFamily: 'monospace',
                }}>
                  {section.schema.trim()}
                </pre>
              )}

              <div style={{
                padding: '0.75rem 1rem', borderRadius: 8,
                background: `${section.color}08`, borderLeft: `3px solid ${section.color}`,
                fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 500,
              }}>
                💡 <strong>Impact :</strong> {section.impact}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
