// ─────────────────────────────────────────────────────────────────────────────
// Les onglets d'un site — tests de la résolution chemin → onglet
// ─────────────────────────────────────────────────────────────────────────────
//
// Un onglet allumé à tort ne plante rien : il dit à l'opérateur qu'il est
// ailleurs que là où il est, et `aria-current` le répète au lecteur d'écran.

import { describe, expect, it } from 'vitest'
import { SITE_TABS, activeSiteTab, appendSearch, siteIdFromPathname, siteTabHref } from './site-tabs'

const ID = '0f5c2a7e-1111-4222-8333-944455556666'

describe('activeSiteTab', () => {
  it('rend la vue d’ensemble sur la racine du site, barre oblique finale comprise', () => {
    expect(activeSiteTab(`/sites/${ID}`, ID)).toBe('')
    expect(activeSiteTab(`/sites/${ID}/`, ID)).toBe('')
  })

  it('rend l’onglet du premier segment, et le garde sur ses sous-pages', () => {
    expect(activeSiteTab(`/sites/${ID}/calendrier`, ID)).toBe('calendrier')
    expect(activeSiteTab(`/sites/${ID}/reglages/quoi-que-ce-soit`, ID)).toBe('reglages')
    expect(activeSiteTab(`/sites/${ID}/publication?canal=fiche`, ID)).toBe('publication')
  })

  it('range les anciennes adresses sous l’onglet qui les a recueillies', () => {
    expect(activeSiteTab(`/sites/${ID}/google/select`, ID)).toBe('reglages')
    expect(activeSiteTab(`/sites/${ID}/edit`, ID)).toBe('reglages')
    expect(activeSiteTab(`/sites/${ID}/existing`, ID)).toBe('pages')
  })

  it('n’allume rien hors du site, ni sur un segment inconnu', () => {
    expect(activeSiteTab('/sites', ID)).toBeNull()
    expect(activeSiteTab('/sites/autre-site/calendrier', ID)).toBeNull()
    expect(activeSiteTab(`/sites/${ID}x/calendrier`, ID)).toBeNull()
    expect(activeSiteTab(`/sites/${ID}/inconnu`, ID)).toBeNull()
  })
})

describe('siteIdFromPathname', () => {
  it('lit l’identifiant sous /sites/', () => {
    expect(siteIdFromPathname(`/sites/${ID}`)).toBe(ID)
    expect(siteIdFromPathname(`/sites/${ID}/performances`)).toBe(ID)
  })

  it('ne prend ni la liste, ni la création, ni un autre écran pour un site', () => {
    expect(siteIdFromPathname('/sites')).toBeNull()
    expect(siteIdFromPathname('/sites/new')).toBeNull()
    expect(siteIdFromPathname('/dashboard')).toBeNull()
  })
})

describe('siteTabHref', () => {
  it('fabrique une adresse par onglet, la vue d’ensemble sans segment', () => {
    expect(siteTabHref(ID, '')).toBe(`/sites/${ID}`)
    expect(siteTabHref(ID, 'pages')).toBe(`/sites/${ID}/pages`)
  })

  it('fait retomber chaque onglet sur lui-même', () => {
    for (const tab of SITE_TABS) {
      expect(activeSiteTab(siteTabHref(ID, tab.slug), ID)).toBe(tab.slug)
    }
  })
})

describe('appendSearch', () => {
  it('garde la requête d’une ancienne adresse, valeurs multiples comprises', () => {
    expect(appendSearch('/sites/x/reglages', { gsc: 'success', rows: '12' })).toBe('/sites/x/reglages?gsc=success&rows=12')
    expect(appendSearch('/sites/x/pages', { origin: ['crawl', 'engine'], q: undefined })).toBe('/sites/x/pages?origin=crawl&origin=engine')
  })

  it('ne laisse pas de « ? » orphelin sans requête', () => {
    expect(appendSearch('/sites/x/reglages', {})).toBe('/sites/x/reglages')
  })
})
