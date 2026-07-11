import { COMMUNES_AUBE } from '@/lib/geo/communes'

export interface GeoScope {
  scopeType: 'department'
  scopeValue: string
  communes: string[]
}

export function getDefaultGeoScope(): GeoScope {
  return {
    scopeType: 'department',
    scopeValue: 'Aube',
    communes: COMMUNES_AUBE.map((commune) => commune.name),
  }
}

export function normalizeCommunes(communes?: string[], department?: string) {
  if (Array.isArray(communes) && communes.length > 0) return communes
  if (department === 'Aube' || !department) return getDefaultGeoScope().communes
  return []
}
