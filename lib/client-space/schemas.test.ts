import { describe, expect, it } from 'vitest'
import { CodeRequestBody, readJson } from './schemas'

const post = (body: string, type = 'application/json') =>
  new Request('http://localhost/api/espace/connexion/code', { method: 'POST', headers: { 'content-type': type }, body })

describe('readJson', () => {
  it('lit un corps JSON declare comme tel', async () => {
    expect(await readJson(post('{"email":"a@b.test"}', 'application/json; charset=utf-8'))).toEqual({ email: 'a@b.test' })
  })

  it('refuse ce qu un formulaire HTML peut envoyer depuis un autre site', async () => {
    expect(await readJson(post('{"email":"a@b.test"}', 'text/plain'))).toBeNull()
    expect(await readJson(post('email=a@b.test', 'application/x-www-form-urlencoded'))).toBeNull()
  })

  it('abandonne un corps trop gros sans le lire en entier', async () => {
    expect(await readJson(post(JSON.stringify({ email: 'a'.repeat(5000) })))).toBeNull()
  })

  it('rend null pour un JSON illisible', async () => {
    expect(await readJson(post('{pas du json'))).toBeNull()
  })
})

describe('CodeRequestBody', () => {
  it('normalise l adresse avant d en verifier la forme', () => {
    expect(CodeRequestBody.parse({ email: '  Marie@Martin.TEST ' })).toEqual({ email: 'marie@martin.test' })
    expect(CodeRequestBody.safeParse({ email: 'pas-une-adresse' }).success).toBe(false)
  })
})
