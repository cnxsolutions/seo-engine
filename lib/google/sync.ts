import { getAuthenticatedClient, listConnectedSiteIds } from './client'
import { fetchProfile, fetchReviews, fetchPhotos, fetchPosts, fetchQA, summarizeReviews } from './gbp'
import { fetchPerformance } from './gsc'
import { createServiceClient } from '@/lib/supabase'

export async function syncGbpData(siteId: string): Promise<boolean> {
  try {
    const { fetch: googleFetch, connection } = await getAuthenticatedClient(siteId)

    if (!connection.gbp_account_id || !connection.gbp_location_id) return false

    const accountId = connection.gbp_account_id
    const locationId = connection.gbp_location_id

    const [profile, reviews, photos, posts, qa] = await Promise.all([
      fetchProfile(googleFetch, accountId, locationId),
      fetchReviews(googleFetch, accountId, locationId),
      fetchPhotos(googleFetch, accountId, locationId),
      fetchPosts(googleFetch, accountId, locationId),
      fetchQA(googleFetch, accountId, locationId),
    ])

    const address = profile?.storefrontAddress
      ? {
          street: profile.storefrontAddress.addressLines?.join(', ') || '',
          city: profile.storefrontAddress.locality || '',
          postalCode: profile.storefrontAddress.postalCode || '',
          region: profile.storefrontAddress.administrativeArea || '',
          country: profile.storefrontAddress.regionCode || 'FR',
        }
      : null

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('gbp_profiles')
      .upsert({
        site_id: siteId,
        business_name: profile?.title || null,
        address,
        phone: profile?.phoneNumbers?.primaryPhone || null,
        website: profile?.websiteUri || null,
        categories: profile?.categories || null,
        hours: profile?.regularHours || null,
        reviews: reviews.slice(0, 50),
        reviews_summary: summarizeReviews(reviews),
        photos: photos.slice(0, 20).map((p: { googleUrl: string; category: string }) => ({ url: p.googleUrl, category: p.category })),
        posts: posts.slice(0, 10).map((p: { summary: string; createTime: string }) => ({ summary: p.summary, date: p.createTime })),
        qa: qa.slice(0, 20).map((q: { text: string; topAnswers?: Array<{ text: string }> }) => ({
          question: q.text,
          answer: q.topAnswers?.[0]?.text || '',
        })),
        attributes: profile?.attributes || null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'site_id' })

    return !error
  } catch {
    return false
  }
}

export async function syncGscData(siteId: string): Promise<boolean> {
  try {
    const { fetch: googleFetch, connection } = await getAuthenticatedClient(siteId)

    if (!connection.gsc_site_url) return false

    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 3) // GSC data has 3-day delay
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - 28)

    const rows = await fetchPerformance(googleFetch, connection.gsc_site_url, {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    })

    if (rows.length === 0) return true

    const supabase = createServiceClient()

    // Batch upsert in chunks of 100
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((row) => ({
        site_id: siteId,
        date: row.date,
        page_url: row.page_url,
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      }))

      await supabase
        .from('gsc_performance')
        .upsert(chunk, { onConflict: 'site_id,date,page_url,query', ignoreDuplicates: false })
    }

    return true
  } catch {
    return false
  }
}

export async function syncAllGbp(): Promise<{ synced: number; failed: number }> {
  const siteIds = await listConnectedSiteIds()
  let synced = 0
  let failed = 0

  for (const siteId of siteIds) {
    const ok = await syncGbpData(siteId)
    if (ok) synced++
    else failed++
  }

  return { synced, failed }
}

export async function syncAllGsc(): Promise<{ synced: number; failed: number }> {
  const siteIds = await listConnectedSiteIds()
  let synced = 0
  let failed = 0

  for (const siteId of siteIds) {
    const ok = await syncGscData(siteId)
    if (ok) synced++
    else failed++
  }

  return { synced, failed }
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}
