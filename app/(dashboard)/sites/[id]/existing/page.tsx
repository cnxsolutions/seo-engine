import { redirect } from 'next/navigation'
import { appendSearch } from '@/components/site-tabs'

/**
 * Ancienne adresse de l'inventaire des pages d'un site, devenu l'onglet
 * « Pages » (../pages/page.tsx). La requête (filtre, origine, page) suit :
 * un lien partagé sur une vue filtrée retombe sur la même vue.
 */
export default async function SiteExistingRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  redirect(appendSearch(`/sites/${id}/pages`, await searchParams))
}
