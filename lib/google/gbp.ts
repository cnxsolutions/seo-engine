import type { GoogleFetch } from './client'

const GBP_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const GBP_API_V4 = 'https://mybusiness.googleapis.com/v4'

export interface GbpAccount {
  name: string
  accountName: string
  type: string
}

export interface GbpLocation {
  name: string
  title: string
  storefrontAddress?: {
    addressLines: string[]
    locality: string
    postalCode: string
    regionCode: string
  }
  phoneNumbers?: { primaryPhone?: string }
  websiteUri?: string
}

export interface GbpReview {
  reviewer: { displayName: string }
  starRating: string
  comment: string
  createTime: string
  reviewReply?: { comment: string }
}

export async function listAccounts(googleFetch: GoogleFetch): Promise<GbpAccount[]> {
  const res = await googleFetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')
  if (!res.ok) {
    const text = await res.text()
    console.error('GBP listAccounts error:', res.status, text)
    return []
  }
  const data = await res.json()
  return (data as { accounts?: GbpAccount[] }).accounts || []
}

export async function listAllLocations(googleFetch: GoogleFetch): Promise<Array<{ account: GbpAccount; location: GbpLocation }>> {
  const accounts = await listAccounts(googleFetch)
  const results: Array<{ account: GbpAccount; location: GbpLocation }> = []

  for (const account of accounts) {
    const accountId = account.name.split('/')[1]
    const locations = await listLocations(googleFetch, accountId)
    for (const location of locations) {
      results.push({ account, location })
    }
  }

  return results
}

export async function listLocations(googleFetch: GoogleFetch, accountId: string): Promise<GbpLocation[]> {
  const res = await googleFetch(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri`)
  if (!res.ok) {
    const text = await res.text()
    console.error('GBP listLocations error:', res.status, text)
    return []
  }
  const data = await res.json()
  return (data as { locations?: GbpLocation[] }).locations || []
}

export async function fetchProfile(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(
    `${GBP_API}/accounts/${accountId}/locations/${locationId}?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,profile`
  )
  if (!res.ok) return null
  return res.json()
}

export async function fetchReviews(googleFetch: GoogleFetch, accountId: string, locationId: string): Promise<GbpReview[]> {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/reviews?pageSize=50`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { reviews?: GbpReview[] }).reviews || []
}

export async function fetchPhotos(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/media`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { mediaItems?: Array<{ mediaFormat: string; googleUrl: string; category: string }> }).mediaItems || []
}

export async function fetchPosts(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/localPosts`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { localPosts?: Array<{ summary: string; callToAction?: { url: string }; createTime: string }> }).localPosts || []
}

export async function fetchQA(googleFetch: GoogleFetch, accountId: string, locationId: string) {
  const res = await googleFetch(`${GBP_API_V4}/accounts/${accountId}/locations/${locationId}/questions`)
  if (!res.ok) return []
  const data = await res.json()
  return (data as { questions?: Array<{ text: string; topAnswers?: Array<{ text: string }> }> }).questions || []
}

export function summarizeReviews(reviews: GbpReview[]) {
  if (!reviews.length) return { average_rating: 0, total_count: 0, recent_positive: [] }

  const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
  const ratings = reviews.map((r) => ratingMap[r.starRating] || 0).filter(Boolean)
  const average = ratings.reduce((a, b) => a + b, 0) / ratings.length

  const positiveReviews = reviews
    .filter((r) => (ratingMap[r.starRating] || 0) >= 4 && r.comment)
    .slice(0, 10)
    .map((r) => r.comment.slice(0, 100))

  return {
    average_rating: Math.round(average * 10) / 10,
    total_count: reviews.length,
    recent_positive: positiveReviews,
  }
}
