import { describe, expect, it } from 'vitest'
import { DEFAULT_FROM, readEmailConfig } from './config'

const PRODUCTION = {
  NODE_ENV: 'production',
  SMTP_HOST: 'smtp.example.net',
  SMTP_PORT: '465',
  SMTP_USER: 'contact@cnx-solutions.fr',
  SMTP_PASSWORD: 'secret',
  OPERATOR_EMAIL: 'contact@cnx-solutions.fr',
  APP_PUBLIC_URL: 'https://seo.cnx-solutions.fr/',
}

describe('readEmailConfig', () => {
  it('lit la configuration de production', () => {
    expect(readEmailConfig(PRODUCTION)).toEqual({
      ok: true,
      config: {
        smtp: { host: 'smtp.example.net', port: 465, secure: true, auth: { user: 'contact@cnx-solutions.fr', pass: 'secret' } },
        from: DEFAULT_FROM,
        operatorEmail: 'contact@cnx-solutions.fr',
        publicUrl: 'https://seo.cnx-solutions.fr',
      },
    })
  })

  it('ne fait rien partir sans hôte SMTP', () => {
    expect(readEmailConfig({ ...PRODUCTION, SMTP_HOST: '' }).ok).toBe(false)
  })

  it('refuse hors production un SMTP qui n’est pas local : aucun envoi réel depuis un poste', () => {
    const result = readEmailConfig({ ...PRODUCTION, NODE_ENV: 'development' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('seul un SMTP local')
  })

  it('accepte le Mailpit local, sans identifiants, avec les liens sur localhost', () => {
    const result = readEmailConfig({ NODE_ENV: 'development', SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325' })
    expect(result).toEqual({
      ok: true,
      config: {
        smtp: { host: '127.0.0.1', port: 54325, secure: false, auth: null },
        from: DEFAULT_FROM,
        operatorEmail: null,
        publicUrl: 'http://localhost:3000',
      },
    })
  })

  it('exige en production une adresse publique en https', () => {
    expect(readEmailConfig({ ...PRODUCTION, APP_PUBLIC_URL: undefined }).ok).toBe(false)
    expect(readEmailConfig({ ...PRODUCTION, APP_PUBLIC_URL: 'http://seo.cnx-solutions.fr' }).ok).toBe(false)
  })

  it('refuse un identifiant sans mot de passe, et un port invalide', () => {
    expect(readEmailConfig({ ...PRODUCTION, SMTP_PASSWORD: '' }).ok).toBe(false)
    expect(readEmailConfig({ ...PRODUCTION, SMTP_PORT: 'abc' }).ok).toBe(false)
  })
})
