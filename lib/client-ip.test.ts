import { describe, expect, it } from 'vitest'
import { clientIp, rateLimitKey } from './client-ip'

describe('clientIp', () => {
  it('lit X-Real-IP, pose par nginx', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.7')
  })

  it('a defaut, lit la DERNIERE entree de X-Forwarded-For, celle que le proxy a ajoutee', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('sans proxy, regroupe tout sous une seule adresse', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})

describe('rateLimitKey', () => {
  it('garde une IPv4 telle quelle', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7')
  })

  it('ramene toutes les adresses d un meme /64 a une seule cle', () => {
    const keys = ['2001:db8:1:2::1', '2001:0db8:0001:0002:ffff:eeee:dddd:cccc', '[2001:db8:1:2:a:b:c:d]', '2001:DB8:1:2::abcd%eth0']
    expect(new Set(keys.map(rateLimitKey))).toEqual(new Set(['2001:db8:1:2::/64']))
  })

  it('separe deux /64 differents', () => {
    expect(rateLimitKey('2001:db8:1:2::1')).not.toBe(rateLimitKey('2001:db8:1:3::1'))
  })

  it('lit une IPv4 deguisee en IPv6 comme une IPv4, et les formes courtes', () => {
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitKey('fe80::1')).toBe('fe80:0:0:0::/64')
  })
})
