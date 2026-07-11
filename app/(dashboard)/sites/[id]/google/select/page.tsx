import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import { getAuthenticatedClient } from '@/lib/google/client'
import { listAllLocations } from '@/lib/google/gbp'
import { listProperties } from '@/lib/google/gsc'

export default async function GoogleSelectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: site } = await supabase.from('sites').select('*').eq('id', id).single()
  if (!site) redirect('/sites')

  const { fetch: googleFetch } = await getAuthenticatedClient(id)

  const [gbpLocations, gscProperties] = await Promise.all([
    listAllLocations(googleFetch),
    listProperties(googleFetch),
  ])

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <h1>Connecter Google Business Profile et Search Console</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Sélectionnez les ressources à connecter pour le site <strong>{site.name}</strong>
      </p>

      <form action={`/api/sites/${id}/google/select`} method="POST">
        <div style={{ marginBottom: '2rem' }}>
          <h2>Google Business Profile</h2>
          {gbpLocations.length === 0 && <p>Aucune fiche d'établissement trouvée. Vérifiez que vous êtes propriétaire ou administrateur des fiches dans Google Business Profile Manager.</p>}

          {gbpLocations.map(({ account, location }, index) => {
            const locId = location.name.split('/')[3]
            const accountId = account.name.split('/')[1]
            return (
              <label key={index} style={{ display: 'block', padding: '0.75rem', border: '1px solid #ddd', marginBottom: '0.5rem', borderRadius: '4px' }}>
                <input type="radio" name="gbp_location" value={locId} />
                <input type="hidden" name={`gbp_account_${locId}`} value={accountId} />
                <span style={{ marginLeft: '0.5rem' }}>{location.title}</span>
                {location.websiteUri && <span style={{ color: '#666', marginLeft: '0.5rem' }}>({location.websiteUri})</span>}
                <span style={{ color: '#999', marginLeft: '0.5rem', fontSize: '0.875rem' }}>via {account.accountName}</span>
              </label>
            )
          })}
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <h2>Search Console</h2>
          {gscProperties.length === 0 && <p>Aucune propriété Search Console trouvée.</p>}
          {gscProperties.map((prop) => (
            <label key={prop.siteUrl} style={{ display: 'block', padding: '0.75rem', border: '1px solid #ddd', marginBottom: '0.5rem', borderRadius: '4px' }}>
              <input type="radio" name="gsc_site" value={prop.siteUrl} />
              <span style={{ marginLeft: '0.5rem' }}>{prop.siteUrl}</span>
              <span style={{ color: '#666', marginLeft: '0.5rem' }}>({prop.permissionLevel})</span>
            </label>
          ))}
        </div>

        <button type="submit" style={{ padding: '0.75rem 1.5rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Enregistrer la sélection
        </button>
      </form>
    </div>
  )
}
