'use client'

import { useState, useEffect } from 'react'
import {
  Wand2,
  Globe,
  FileText,
  Sparkles,
  Save,
  Send,
  ArrowRight,
  ArrowLeft,
  Check,
  RefreshCw,
  Eye,
  Code,
  MapPin,
  Building,
  Tag,
  MapPinned,
} from 'lucide-react'
import { PageHeader, FormField } from '@/components/ui'
import { GenerationWizard, ValidationResult, Button } from '@/components/ui'

// Mock data
const MOCK_SITES = [
  {
    id: '1',
    name: 'BoxnFit - Site Principal',
    type: 'wordpress' as const,
    schemaStatus: 'extracted' as const,
    contentTypes: [
      { key: 'post', label: 'Articles', fieldCount: 15, requiredCount: 3 },
      { key: 'page', label: 'Pages', fieldCount: 12, requiredCount: 2 },
      { key: 'service', label: 'Services', fieldCount: 20, requiredCount: 4 },
    ],
  },
  {
    id: '2',
    name: 'Rénovation Pro',
    type: 'sanity' as const,
    schemaStatus: 'extracted' as const,
    contentTypes: [
      { key: 'article', label: 'Articles', fieldCount: 18, requiredCount: 4 },
      { key: 'localPage', label: 'Page Locale', fieldCount: 25, requiredCount: 5 },
      { key: 'service', label: 'Prestations', fieldCount: 22, requiredCount: 6 },
    ],
  },
]

const WIZARD_STEPS = [
  { id: 'site', title: 'Site' },
  { id: 'type', title: 'Type' },
  { id: 'context', title: 'Contexte' },
  { id: 'generate', title: 'Générer' },
  { id: 'validate', title: 'Valider' },
]

const FRENCH_DEPARTMENTS = [
  'Aube', 'Marne', 'Haute-Marne', 'Yonne', 'Seine-et-Marne',
  'Paris', 'Hauts-de-Seine', 'Seine-Saint-Denis', 'Val-de-Marne',
  'Rhône', 'Bouches-du-Rhône', 'Alpes-Maritimes', 'Var', 'Vaucluse',
]

export default function SchemaGeneratePage() {
  const [currentStep, setCurrentStep] = useState(0)
  const [sites] = useState(MOCK_SITES)

  // Form state
  const [form, setForm] = useState({
    siteId: '',
    contentType: '',
    businessType: '',
    businessName: '',
    targetCity: '',
    department: 'Aube',
    keywords: '',
    targetWordCount: 800,
    tone: 'professional' as 'professional' | 'friendly' | 'technical' | 'casual',
  })

  const [generating, setGenerating] = useState(false)
  const [generatedContent, setGeneratedContent] = useState<any>(null)
  const [validation, setValidation] = useState<any>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Get selected site and content type
  const selectedSite = sites.find(s => s.id === form.siteId)
  const contentTypes = selectedSite?.contentTypes || []
  const selectedContentType = contentTypes.find(ct => ct.key === form.contentType)

  const canGoNext = () => {
    switch (currentStep) {
      case 0: return !!form.siteId
      case 1: return !!form.contentType
      case 2: return !!form.businessType && !!form.businessName && !!form.targetCity && !!form.keywords
      case 3: return !!generatedContent
      default: return true
    }
  }

  const handleNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1)
    }
  }

  const generateContent = async () => {
    setGenerating(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Mock generated content
    const mockContent = {
      type: form.contentType,
      fields: {
        title: `${form.businessType} ${form.targetCity} | ${form.businessName}`,
        slug: `${form.businessType.toLowerCase().replace(/\s+/g, '-')}-${form.targetCity.toLowerCase().replace(/\s+/g, '-')}`,
        content: `
          <h2>Bienvenue chez ${form.businessName}</h2>
          <p>Vous cherchez un ${form.businessType} de qualité à ${form.targetCity} ? Notre entreprise vous propose des services professionnels adaptés à vos besoins.</p>

          <h2>Nos services</h2>
          <p>Avec plusieurs années d'expérience dans le domaine du ${form.businessType}, nous accompagnons nos clients dans tous leurs projets.</p>

          <h2>Questions fréquentes</h2>
          <p><strong>Quels sont vos délais ?</strong></p>
          <p>Nous intervenons généralement sous 48 à 72 heures pour toute demande à ${form.targetCity}.</p>

          <h2>Contactez-nous</h2>
          <p>Pour toute question ou pour demander un devis gratuit, n'hésitez pas à nous contacter !</p>
        `.trim(),
        excerpt: `Découvrez notre service de ${form.businessType} à ${form.targetCity}. ${form.businessName} vous accompagne dans tous vos projets.`,
      },
      seo: {
        rank_math_title: `${form.businessType} ${form.targetCity} | ${form.businessName} - Expert local`,
        rank_math_description: `Vous cherchez un ${form.businessType} à ${form.targetCity} ? ${form.businessName} vous propose des services de qualité. Devis gratuit.`,
        rank_math_focus_keyword: `${form.businessType} ${form.targetCity}`,
        rank_math_additional_keywords: `${form.businessType} ${form.department}, entreprise ${form.businessType} ${form.targetCity}`,
      },
      metadata: {
        estimatedWordCount: 650,
        readingTimeMinutes: 4,
      },
    }

    setGeneratedContent(mockContent)

    setValidation({
      isValid: true,
      errors: [],
      warnings: [
        { field: 'seo.title', message: 'Le title SEO est légèrement long (68 caractères, recommandé: ≤60)' },
      ],
    })

    setGenerating(false)
    setCurrentStep(4)
  }

  const saveDraft = async () => {
    alert('Brouillon sauvegardé !')
  }

  const publishContent = async () => {
    alert('Contenu publié avec succès !')
  }

  return (
    <div>
      <PageHeader
        icon={Wand2}
        iconColor="#8b5cf6"
        badge="Production"
        title="Génération Schema-Aware"
        subtitle="Générez du contenu optimisé basé sur le schéma de vos sites WordPress ou Sanity."
      />

      {/* Wizard Progress */}
      <GenerationWizard
        steps={WIZARD_STEPS.map((step, i) => ({
          id: step.id,
          title: step.title,
          description: '',
          icon: <span>{i + 1}</span>,
        }))}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
      >
        {/* Step 0: Site Selection */}
        {currentStep === 0 && (
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Sélectionner le site cible
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {sites.map(site => (
                <button
                  key={site.id}
                  onClick={() => setForm(prev => ({ ...prev, siteId: site.id, contentType: '' }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem 1.25rem',
                    borderRadius: 10,
                    border: `2px solid ${form.siteId === site.id ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.siteId === site.id ? 'var(--accent-lighter)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: site.type === 'wordpress' ? 'rgba(33, 117, 155, 0.15)' : 'rgba(255, 107, 107, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {site.type === 'wordpress' ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="#21759b">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2z"/>
                      </svg>
                    ) : (
                      <span style={{ fontSize: '1.5rem' }}>🔥</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{site.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {site.contentTypes.length} types de contenu • Schéma {site.schemaStatus === 'extracted' ? '✓ Extrait' : 'non extrait'}
                    </div>
                  </div>
                  {form.siteId === site.id && <Check size={20} color="var(--accent)" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Content Type */}
        {currentStep === 1 && selectedSite && (
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Choisir le type de contenu pour <span style={{ color: 'var(--accent)' }}>{selectedSite.name}</span>
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {contentTypes.map(ct => (
                <button
                  key={ct.key}
                  onClick={() => setForm(prev => ({ ...prev, contentType: ct.key }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1rem 1.25rem',
                    borderRadius: 10,
                    border: `2px solid ${form.contentType === ct.key ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.contentType === ct.key ? 'var(--accent-lighter)' : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <FileText size={20} color="var(--text-muted)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ct.label}</div>
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ct.key}</code>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 4,
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#818cf8',
                    }}>
                      {ct.fieldCount} champs
                    </span>
                    {ct.requiredCount > 0 && (
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 4,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                      }}>
                        {ct.requiredCount} requis
                      </span>
                    )}
                  </div>
                  {form.contentType === ct.key && <Check size={20} color="var(--accent)" />}
                </button>
              ))}
            </div>

            <button onClick={handleBack} className="btn-ghost" style={{ marginTop: '1.5rem' }}>
              <ArrowLeft size={16} /> Retour
            </button>
          </div>
        )}

        {/* Step 2: Context */}
        {currentStep === 2 && (
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Définir le contexte métier
            </h3>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '1.5rem',
            }}>
              <FormField label="Type d'activité">
                <div style={{ position: 'relative' }}>
                  <Building size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={form.businessType} onChange={(e) => setForm(prev => ({ ...prev, businessType: e.target.value }))} className="input" placeholder="Restaurant, Plombier..." style={{ paddingLeft: '2.5rem' }} />
                </div>
              </FormField>

              <FormField label="Nom de l'entreprise">
                <div style={{ position: 'relative' }}>
                  <Tag size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={form.businessName} onChange={(e) => setForm(prev => ({ ...prev, businessName: e.target.value }))} className="input" placeholder="BoxnFit, Au Petit Village..." style={{ paddingLeft: '2.5rem' }} />
                </div>
              </FormField>

              <FormField label="Ville cible">
                <div style={{ position: 'relative' }}>
                  <MapPin size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={form.targetCity} onChange={(e) => setForm(prev => ({ ...prev, targetCity: e.target.value }))} className="input" placeholder="Troyes, Paris, Lyon..." style={{ paddingLeft: '2.5rem' }} />
                </div>
              </FormField>

              <FormField label="Département">
                <select value={form.department} onChange={(e) => setForm(prev => ({ ...prev, department: e.target.value }))} className="input">
                  {FRENCH_DEPARTMENTS.map(dept => <option key={dept} value={dept}>{dept}</option>)}
                </select>
              </FormField>

              <div style={{ gridColumn: '1 / -1' }}>
                <FormField label="Mots-clés cibles" hint="Séparés par des virgules">
                  <input type="text" value={form.keywords} onChange={(e) => setForm(prev => ({ ...prev, keywords: e.target.value }))} className="input" placeholder="restaurant Troyes, cuisine française..." />
                </FormField>
              </div>

              <FormField label="Nombre de mots cible">
                <input type="number" value={form.targetWordCount} onChange={(e) => setForm(prev => ({ ...prev, targetWordCount: parseInt(e.target.value) || 800 }))} className="input" min={300} max={2000} step={100} />
              </FormField>

              <FormField label="Ton">
                <select value={form.tone} onChange={(e) => setForm(prev => ({ ...prev, tone: e.target.value as any }))} className="input">
                  <option value="professional">Professionnel</option>
                  <option value="friendly">Chaleureux</option>
                  <option value="technical">Technique</option>
                  <option value="casual">Décontracté</option>
                </select>
              </FormField>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
              <button onClick={handleBack} className="btn-ghost"><ArrowLeft size={16} /> Retour</button>
              <button onClick={() => setCurrentStep(3)} className="btn-primary" disabled={!form.businessType || !form.businessName || !form.targetCity || !form.keywords}>
                Continuer <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Generate */}
        {currentStep === 3 && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'rgba(139, 92, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}>
              {generating ? (
                <div className="spinner" style={{ width: 40, height: 40 }} />
              ) : (
                <Sparkles size={40} color="#8b5cf6" />
              )}
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
              {generating ? 'Génération en cours...' : 'Prêt à générer'}
            </h3>

            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              {generating ? 'Le RAG élabore du contenu optimisé...' : 'Cliquez pour lancer la génération.'}
            </p>

            {/* Summary */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              {[
                { label: 'Site', value: selectedSite?.name },
                { label: 'Type', value: selectedContentType?.label },
                { label: 'Ville', value: form.targetCity },
                { label: 'Mots', value: `${form.targetWordCount}+` },
              ].map(item => (
                <span key={item.label} style={{ padding: '0.25rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{item.label}: </span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.value}</span>
                </span>
              ))}
            </div>

            {!generating && (
              <button onClick={generateContent} className="btn-primary" style={{ padding: '0.75rem 2rem' }}>
                <Wand2 size={18} /> Générer le contenu
              </button>
            )}

            <button onClick={handleBack} className="btn-ghost" style={{ marginTop: '1rem', display: 'block', margin: '1rem auto 0' }}>
              <ArrowLeft size={16} /> Retour
            </button>
          </div>
        )}

        {/* Step 4: Validate */}
        {currentStep === 4 && generatedContent && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Contenu généré</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setShowPreview(false)} className={!showPreview ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: '0.8rem' }}>
                  <Code size={14} /> JSON
                </button>
                <button onClick={() => setShowPreview(true)} className={showPreview ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: '0.8rem' }}>
                  <Eye size={14} /> Aperçu
                </button>
              </div>
            </div>

            <ValidationResult isValid={validation?.isValid} errors={validation?.errors} warnings={validation?.warnings} />

            {showPreview ? (
              <div className="glass-card" style={{ marginTop: '1rem', maxHeight: 400, overflow: 'auto' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{generatedContent.fields.title}</h4>
                <code style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '0.15rem 0.4rem', borderRadius: 4 }}>
                  /{generatedContent.fields.slug}
                </code>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: '1rem' }} dangerouslySetInnerHTML={{ __html: generatedContent.fields.content }} />
              </div>
            ) : (
              <pre className="glass-card" style={{ marginTop: '1rem', maxHeight: 400, overflow: 'auto', fontSize: '0.75rem', padding: '1rem' }}>
                {JSON.stringify(generatedContent, null, 2)}
              </pre>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={handleBack} className="btn-ghost"><ArrowLeft size={16} /> Retour</button>
                <button onClick={generateContent} className="btn-ghost"><RefreshCw size={16} /> Régénérer</button>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={saveDraft} className="btn-secondary"><Save size={16} /> Sauvegarder</button>
                <button onClick={publishContent} className="btn-primary"><Send size={16} /> Publier</button>
              </div>
            </div>
          </div>
        )}
      </GenerationWizard>
    </div>
  )
}
