import { describe, expect, it } from 'vitest'
import { clientIp } from './client-ip'

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
