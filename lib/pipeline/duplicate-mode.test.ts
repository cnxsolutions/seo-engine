// ─────────────────────────────────────────────────────────────────────────────
// La passation du mode anti-duplicat, du produit vers le gate
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE FICHIER EXISTE.
//
// `runValidationGate` refuse deliberement de lire process.env : la seule
// fonction par laquelle passe toute publication ne doit pas dependre d'un
// ambiant qu'un test ne peut atteindre qu'en polluant le processus. Sa valeur
// par defaut, DUPLICATE_ENFORCEMENT, vaut donc 'observe' — et l'en-tete de
// gate.ts reclame explicitement que `lib/pipeline/index.ts` passe
// `duplicateMode: duplicateGateMode()`, faute de quoi, mot pour mot,
// « l'interrupteur serait ne mort ».
//
// Il l'a ete. La ligne manquait, SEO_DUPLICATE_GATE n'avait aucun lecteur, et
// la basculer en 'block' n'aurait rien change — il aurait fallu editer le code
// du gate. Rien ne rougissait : le defaut 'observe' est aussi le comportement
// attendu pendant toute la periode d'observation, donc l'oubli etait
// indiscernable du fonctionnement normal jusqu'au jour de la bascule.
//
// Ce test verrouille la couture, pas le comportement : gate.test.ts prouve deja
// ce que chaque mode FAIT. Ici on prouve seulement que le mode ARRIVE.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedPage } from '@/lib/ai/openai'
import type { GateInput } from './gate'

// L'espion enveloppe le VRAI gate plutot que de le remplacer : un test qui
// renvoie un verdict invente prouverait que le pipeline sait appeler un double,
// pas qu'il produit encore un verdict utilisable.
const seen: GateInput[] = []

vi.mock('./gate', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gate')>()
  return {
    ...real,
    runValidationGate: (input: GateInput) => {
      seen.push(input)
      return real.runValidationGate(input)
    },
  }
})

const { runPostGenerationPipeline } = await import('./index')

afterEach(() => {
  seen.length = 0
  vi.unstubAllEnvs()
})

// ─── Une page minimale, sans site : aucun reseau, aucune base ────────────────
//
// `siteId` absent est la maniere documentee de faire tourner le pipeline sans
// inventaire. Les candidats restent vides, ce qui ne change rien ici : c'est le
// CHAMP transmis qu'on observe, pas ce que le detecteur en fait.

function page(): GeneratedPage {
  return {
    title: 'Depannage plomberie a Troyes',
    metaDescription:
      'Un plombier intervient a Troyes pour une fuite, un chauffe-eau en panne ou une canalisation bouchee, avec un devis ecrit avant travaux.',
    focusKeyword: 'depannage plomberie troyes',
    slug: 'depannage-plomberie-troyes',
    htmlContent: '<h1>Depannage plomberie a Troyes</h1><p>Texte.</p>',
    estimatedWordCount: 5,
  } as GeneratedPage
}

function run(over: Record<string, unknown> = {}) {
  return runPostGenerationPipeline({
    page: page(),
    generationId: 'gen-1',
    pageType: 'child',
    siteUrl: 'https://exemple.fr',
    ...over,
  })
}

// ─── La couture ──────────────────────────────────────────────────────────────

describe('le mode anti-duplicat atteint le gate', () => {
  it('transmet un mode, quel que soit l environnement', async () => {
    await run()

    expect(seen).toHaveLength(1)
    // La ligne oubliee laissait ce champ a undefined. Le gate retombait alors
    // sur son defaut, ce qui est CORRECT en observation et FAUX le jour de la
    // bascule — d'ou une assertion sur la presence, pas sur la valeur.
    expect(seen[0].duplicateMode).toBeDefined()
  })

  it('lit SEO_DUPLICATE_GATE, et le fait suivre jusqu au gate', async () => {
    vi.stubEnv('SEO_DUPLICATE_GATE', 'block')
    await run()

    expect(seen[0].duplicateMode).toBe('block')
  })

  it('retombe sur l observation quand la variable est absente', async () => {
    vi.stubEnv('SEO_DUPLICATE_GATE', '')
    await run()

    expect(seen[0].duplicateMode).toBe('observe')
  })

  it('retombe sur l observation quand la variable est mal orthographiee', async () => {
    // Un deploiement qui ecrit 'blok' ne doit pas se mettre a refuser des pages,
    // ni croire qu'il en refuse.
    vi.stubEnv('SEO_DUPLICATE_GATE', 'blok')
    await run()

    expect(seen[0].duplicateMode).toBe('observe')
  })

  it('laisse un appelant forcer le mode sans toucher a l environnement', async () => {
    // C'est ce que fait scripts/replay-duplicate-gate.ts pour mesurer ce que le
    // mode bloquant refuserait. Muter process.env a la place fuirait sur tout
    // ce que le script fait ensuite.
    vi.stubEnv('SEO_DUPLICATE_GATE', 'observe')
    await run({ duplicateMode: 'block' })

    expect(seen[0].duplicateMode).toBe('block')
  })

  it('fait primer l override sur la variable, et non l inverse', async () => {
    vi.stubEnv('SEO_DUPLICATE_GATE', 'block')
    await run({ duplicateMode: 'observe' })

    expect(seen[0].duplicateMode).toBe('observe')
  })
})
