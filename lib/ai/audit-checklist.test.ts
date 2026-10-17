import { describe, expect, it } from 'vitest'
import { buildAuditChecklist } from './page-types'
import { AUDIT_THRESHOLDS } from '@/lib/pipeline/seo-audit'

const base = {
  mainKeyword: 'couvreur Châlons-en-Champagne',
  city: 'Châlons-en-Champagne',
  businessName: 'Artisan boisson teddy',
  minFaq: 3,
  enableExternalLinks: true,
  requiredEntities: [] as string[],
}

describe('buildAuditChecklist', () => {
  it('annonce au modele les seuils exacts du controle avant publication', () => {
    // Une seule source : si un seuil change dans le gate, la consigne suit.
    const text = buildAuditChecklist(base)
    expect(text).toContain(`entre ${AUDIT_THRESHOLDS.titleMin} et ${AUDIT_THRESHOLDS.titleComfortMax} caracteres`)
    expect(text).toContain(`entre ${AUDIT_THRESHOLDS.metaComfortMin} et ${AUDIT_THRESHOLDS.metaComfortMax} caracteres`)
    expect(text).toContain(`entre ${AUDIT_THRESHOLDS.directAnswerMin} et ${AUDIT_THRESHOLDS.directAnswerMax} mots`)
    expect(text).toContain('<ul> ou <ol>')
    expect(text).toContain(`"Châlons-en-Champagne" est nomme au moins ${AUDIT_THRESHOLDS.cityMentionsMin} fois`)
    expect(text).toContain('"Artisan boisson teddy" est nomme au moins une fois')
  })

  it('ne reclame une source externe que si les liens externes sont actives', () => {
    expect(buildAuditChecklist(base)).toContain('lien externe https')
    expect(buildAuditChecklist({ ...base, enableExternalLinks: false })).not.toContain('lien externe https')
  })

  it('liste les entites du brief seulement quand il en donne assez pour que le controle les exige', () => {
    expect(buildAuditChecklist({ ...base, requiredEntities: ['Marne'] })).not.toContain('Citer ces entites')
    expect(buildAuditChecklist({ ...base, requiredEntities: ['Marne', 'Fagnières'] })).toContain('Citer ces entites dans le texte : Marne, Fagnières')
  })
})
