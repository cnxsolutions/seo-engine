// ─────────────────────────────────────────────────────────────────────────────
// La purge nocturne des journaux — le journal doit-il dire vrai ?
// SEO Engine - Un succes annonce sur une suppression qui n'a pas eu lieu.
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUI EST VERROUILLE ICI, ET POURQUOI CE FICHIER EXISTE.
// cleanupOldLogs supprime chaque nuit les job_executions de plus de sept jours.
// La suppression partait autrefois dans un `.then()` sans branche d'erreur : or
// supabase-js RETOURNE l'erreur au lieu de la lever
// (@supabase/postgrest-js/dist/index.cjs:155 rattrape et rend
// `{ error, data: null, status: 0 }` tant que shouldThrowOnError n'est pas
// arme, ce que cette requete ne fait jamais). Le `.then()` s'executait donc
// aussi sur un echec, et « Cleaned up job executions older than ... » etait
// journalise alors que rien n'avait ete supprime.
//
// Le bug empeche n'est pas un plantage — il ne peut pas y en avoir. C'est un
// journal qui MENT : un droit revoque ou une derive de schema laisse la table
// grossir sans fin pendant que le seul temoin disponible annonce une purge
// reussie chaque nuit. Personne ne va verifier une chose qui se declare faite.
//
// LA BASE N'EST JAMAIS TOUCHEE. `@/lib/supabase` est remplace par une fabrique
// qui rend le resultat voulu : ces tests decrivent les deux reponses possibles
// de PostgREST, pas une base reelle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Le resultat que la suppression rendra. Mutable entre les tests : c'est la
 * seule variable de ces cas, tout le reste est identique de part et d'autre.
 */
const { deleteResult } = vi.hoisted(() => ({
  deleteResult: { current: { error: null } as { error: { message: string } | null } },
}))

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }))

vi.mock('@/lib/supabase', () => {
  const client = {
    from: () => ({
      delete: () => ({
        lt: () => Promise.resolve(deleteResult.current),
      }),
    }),
  }
  return { createServiceClient: () => client, createBrowserClient: () => client }
})

import { cleanupOldLogs, getJobLogs } from './cron'

/** Les entrees de journal que la purge vient d'ecrire, elle seule. */
function journauxDePurge() {
  return getJobLogs(500).filter(entry => entry.job === 'cleanup')
}

let dejaVues = 0

beforeEach(() => {
  // Le tampon de journaux est un module-level partage : on ne remet pas a zero,
  // on note ou on en etait et on ne regarde que ce qui vient apres.
  dejaVues = journauxDePurge().length
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  deleteResult.current = { error: null }
})

/** Ce que la purge a journalise pendant CE test. */
function nouveauxJournaux() {
  return journauxDePurge().slice(dejaVues)
}

describe('cleanupOldLogs', () => {
  it('annonce le succes quand la suppression a reellement eu lieu', async () => {
    deleteResult.current = { error: null }

    await cleanupOldLogs()

    const entrees = nouveauxJournaux()
    expect(entrees).toHaveLength(1)
    expect(entrees[0].level).toBe('INFO')
    expect(entrees[0].message).toContain('Cleaned up job executions older than')
  })

  // ─── LE CAS QUI COMPTE : PostgREST a refuse, et il faut que ca se sache ────

  it('n annonce PAS un succes quand supabase a rendu une erreur', async () => {
    deleteResult.current = { error: { message: 'permission denied for table job_executions' } }

    await cleanupOldLogs()

    // C'est l'assertion qui tient tout le fichier : la phrase de succes ne doit
    // exister nulle part. Retirer la lecture du `{ error }` la fait reapparaitre.
    const messages = nouveauxJournaux().map(entry => entry.message)
    expect(messages.join('\n')).not.toContain('Cleaned up job executions older than')
  })

  it('journalise un WARN qui nomme la cause rendue par la base', async () => {
    deleteResult.current = { error: { message: 'permission denied for table job_executions' } }

    await cleanupOldLogs()

    const entrees = nouveauxJournaux()
    expect(entrees).toHaveLength(1)
    expect(entrees[0].level).toBe('WARN')
    expect(entrees[0].message).toContain('Could not purge old job executions')
    // Sans la cause, l'operateur sait que ca rate et ne sait pas pourquoi : un
    // droit revoque et une colonne renommee se corrigent tres differemment.
    expect(JSON.stringify(entrees[0].context)).toContain('permission denied')
  })

  it('ne leve jamais : un echec de purge ne doit pas emporter le tick de minuit', async () => {
    deleteResult.current = { error: { message: 'la base a dit non' } }

    await expect(cleanupOldLogs()).resolves.toBeUndefined()
  })
})
