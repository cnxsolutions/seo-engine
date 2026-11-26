import { describe, expect, it } from 'vitest'
import { CLIENT_SITE_COLUMNS, toClientSiteDto, type ClientSiteRow } from './dto'

describe('ce qu un client recoit d un site', () => {
  it('ne selectionne aucune colonne secrete', () => {
    expect(CLIENT_SITE_COLUMNS.split(',')).toEqual(['id', 'name', 'url'])
  })

  it('ne recopie que les champs nommes, meme si la ligne en porte davantage', () => {
    const row = { id: 's1', name: 'Plomberie Martin', url: 'https://a.test', wp_app_password: 'x', github_token: 'y' } as ClientSiteRow
    expect(toClientSiteDto(row)).toEqual({ id: 's1', name: 'Plomberie Martin', url: 'https://a.test' })
  })
})
