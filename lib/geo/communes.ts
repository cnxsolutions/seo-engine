// Communes of the Aube (10) department + surrounding communes
// Data for local SEO page generation targeting

export interface Commune {
  name: string
  slug: string
  postalCode: string
  department: string
  departmentCode: string
  population?: number
  lat?: number
  lng?: number
}

export const COMMUNES_AUBE: Commune[] = [
  { name: "Troyes", slug: "troyes", postalCode: "10000", department: "Aube", departmentCode: "10", population: 60000, lat: 48.2973, lng: 4.0744 },
  { name: "Saint-André-les-Vergers", slug: "saint-andre-les-vergers", postalCode: "10120", department: "Aube", departmentCode: "10", population: 11000 },
  { name: "La Chapelle-Saint-Luc", slug: "la-chapelle-saint-luc", postalCode: "10600", department: "Aube", departmentCode: "10", population: 14000 },
  { name: "Sainte-Savine", slug: "sainte-savine", postalCode: "10300", department: "Aube", departmentCode: "10", population: 10000 },
  { name: "Barberey-Saint-Sulpice", slug: "barberey-saint-sulpice", postalCode: "10600", department: "Aube", departmentCode: "10" },
  { name: "Saint-Julien-les-Villas", slug: "saint-julien-les-villas", postalCode: "10000", department: "Aube", departmentCode: "10" },
  { name: "Pont-Sainte-Marie", slug: "pont-sainte-marie", postalCode: "10150", department: "Aube", departmentCode: "10" },
  { name: "Rosières-près-Troyes", slug: "rosieres-pres-troyes", postalCode: "10430", department: "Aube", departmentCode: "10" },
  { name: "Creney-près-Troyes", slug: "creney-pres-troyes", postalCode: "10150", department: "Aube", departmentCode: "10" },
  { name: "Villemoyenne", slug: "villemoyenne", postalCode: "10260", department: "Aube", departmentCode: "10" },
  { name: "Bar-sur-Aube", slug: "bar-sur-aube", postalCode: "10200", department: "Aube", departmentCode: "10", population: 5000 },
  { name: "Romilly-sur-Seine", slug: "romilly-sur-seine", postalCode: "10100", department: "Aube", departmentCode: "10", population: 13000 },
  { name: "Nogent-sur-Seine", slug: "nogent-sur-seine", postalCode: "10400", department: "Aube", departmentCode: "10", population: 5500 },
  { name: "Arcis-sur-Aube", slug: "arcis-sur-aube", postalCode: "10700", department: "Aube", departmentCode: "10" },
  { name: "Estissac", slug: "estissac", postalCode: "10190", department: "Aube", departmentCode: "10" },
  { name: "Méry-sur-Seine", slug: "mery-sur-seine", postalCode: "10170", department: "Aube", departmentCode: "10" },
  { name: "Bouilly", slug: "bouilly", postalCode: "10320", department: "Aube", departmentCode: "10" },
  { name: "Lusigny-sur-Barse", slug: "lusigny-sur-barse", postalCode: "10270", department: "Aube", departmentCode: "10" },
  { name: "Piney", slug: "piney", postalCode: "10220", department: "Aube", departmentCode: "10" },
  { name: "Chaource", slug: "chaource", postalCode: "10210", department: "Aube", departmentCode: "10" },
]

export function getCommuneBySlug(slug: string): Commune | undefined {
  return COMMUNES_AUBE.find(c => c.slug === slug)
}

export function getCommunesByDepartment(departmentCode: string): Commune[] {
  return COMMUNES_AUBE.filter(c => c.departmentCode === departmentCode)
}

// Convert commune name to URL slug
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
