import { Settings, Key, Globe, Bot, Bell } from 'lucide-react'
import { PageHeader, FormField } from '@/components/ui'

const SECTION = ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => (
  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
    <div style={{ fontWeight: 700, fontSize: '0.875rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
      {title}
    </div>
    {children}
  </div>
)

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader
        icon={Settings}
        iconColor="#94a3b8"
        badge="Paramètres"
        title="Configuration"
        subtitle="Gérez vos clés API et préférences de génération."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* OpenAI */}
        <SECTION title={<><Bot size={14} style={{ display: 'inline', marginRight: 6 }} />OpenAI</>}>
          <FormField label="Clé API OpenAI" hint="Stockée dans .env.local – ne s'affiche jamais">
            <input
              className="input"
              type="password"
              defaultValue="sk-••••••••••••••••••••••••••••••••"
              readOnly
              style={{ fontFamily: 'monospace', opacity: 0.6 }}
            />
          </FormField>
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: 8,
            fontSize: '0.8rem',
            color: '#10b981'
          }}>
            ✅ OpenAI GPT-4o connecté · Pour changer la clé, éditez <code style={{ background: 'rgba(16,185,129,0.15)', padding: '0 4px', borderRadius: 3 }}>.env.local</code>
          </div>
        </SECTION>

        {/* Génération */}
        <SECTION title={<><Key size={14} style={{ display: 'inline', marginRight: 6 }} />Génération par défaut</>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <FormField label="Modèle IA par défaut">
              <select className="input" defaultValue="gpt-4o">
                <option value="gpt-4o">GPT-4o (recommandé)</option>
                <option value="gpt-4o-mini">GPT-4o Mini (rapide)</option>
              </select>
            </FormField>
            <FormField label="Longueur par défaut">
              <select className="input" defaultValue="600">
                <option value="400">400 mots</option>
                <option value="600">600 mots</option>
                <option value="900">900 mots</option>
              </select>
            </FormField>
          </div>
          <FormField label="Département par défaut">
            <input className="input" defaultValue="Aube" placeholder="Aube" />
          </FormField>
        </SECTION>

        {/* Notifications */}
        <SECTION title={<><Bell size={14} style={{ display: 'inline', marginRight: 6 }} />Notifications</>}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            Les notifications par email seront disponibles après connexion à Supabase. Configurez <code>.env.local</code> avec vos clés Supabase pour activer cette fonctionnalité.
          </div>
        </SECTION>

        {/* Deploy info */}
        <SECTION title={<><Globe size={14} style={{ display: 'inline', marginRight: 6 }} />Déploiement</>}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            <div>🔧 <strong>Mode local</strong> · <code style={{ color: '#6366f1' }}>http://localhost:3000</code></div>
            <div>☁️ Pour déployer sur Vercel : <code>npx vercel</code> à la racine du projet</div>
            <div>🔑 N&apos;oubliez pas de configurer vos variables d&apos;environnement dans le dashboard Vercel</div>
          </div>
        </SECTION>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary" style={{ minWidth: 160, justifyContent: 'center' }}>
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  )
}
