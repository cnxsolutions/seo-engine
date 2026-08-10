// ─────────────────────────────────────────────────────────────────────────────
// DuplicateDetector Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { DuplicateDetector, createDuplicateDetector } from './DuplicateDetector'
import type { DuplicateDetectionConfig, ContentToCheck } from './DuplicateDetector'

const SHARED_SENTENCE =
  'Le plombier propose un devis avec assurance pour chaque intervention urgence fuite ' +
  'canalisation depannage'

/** Two pages with the SAME title and intent but genuinely different prose. */
const CANNIBAL_A: ContentToCheck = {
  id: 'a',
  title: 'Comment choisir un plombier pas cher',
  content: `${SHARED_SENTENCE} a Troyes dans le centre historique du quartier gare. `.repeat(2),
}

const CANNIBAL_B: ContentToCheck = {
  id: 'b',
  title: 'Comment choisir un plombier pas cher',
  content: `${SHARED_SENTENCE} a Reims dans la zone industrielle pres de la cathedrale Marne. `.repeat(2),
}

describe('DuplicateDetector', () => {
  let detector: DuplicateDetector

  beforeEach(() => {
    detector = new DuplicateDetector()
  })

  describe('findDuplicates()', () => {
    it('should not find duplicates for unique content', async () => {
      const contents: ContentToCheck[] = [
        {
          id: '1',
          title: 'Comment installer une douche',
          content: 'Cet article explique comment installer une douche etape par etape avec tous les outils requis pour le bricolage domestique.',
        },
        {
          id: '2',
          title: 'Reparation de fuite d eau',
          content: 'Guide complet pour reparer une fuite dans votre maison. Les techniques recommandees par les professionnels du batiment.',
        },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.stats.totalChecked).toBe(2)
      expect(result.hasDuplicates).toBe(false)
    })

    it('should detect duplicates with high similarity', async () => {
      const baseContent = 'Cet article explique comment installer une douche avec les etapes detaillees, les outils necessaires, et les conseils du professionnel.'

      const contents: ContentToCheck[] = [
        { id: '1', title: 'Installation douche guide', content: baseContent.repeat(3) },
        { id: '2', title: 'Douche installation tutorial', content: baseContent.repeat(3) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.duplicates.length).toBeGreaterThan(0)
      expect(result.duplicates[0].matchType).toBe('exact')
    })

    it('should calculate processing time', async () => {
      const contents: ContentToCheck[] = [
        { id: '1', title: 'A', content: 'Contenu tres original numero un '.repeat(20) },
        { id: '2', title: 'B', content: 'Sujet completement different ici '.repeat(20) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.totalChecked).toBe(2)
    })

    it('compares every pair, including two already-published look-alikes', async () => {
      const old = 'Reparation de fuite d eau dans une salle de bain moderne et fonctionnelle. '.repeat(5)
      const contents: ContentToCheck[] = [
        { id: 'new', title: 'Installer un chauffe-eau', content: 'Installer un chauffe eau thermodynamique demande une etude prealable du logement. '.repeat(5) },
        { id: 'old-a', title: 'Reparer une fuite', content: old },
        { id: 'old-b', title: 'Reparer une fuite', content: old },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.duplicates).toHaveLength(1)
      expect([result.duplicates[0].sourceId, result.duplicates[0].targetId].sort()).toEqual(['old-a', 'old-b'])
    })
  })

  describe('findDuplicatesFor()', () => {
    it('only reports pairs involving the target', async () => {
      // Two already-published pages being duplicates of EACH OTHER must not
      // block a brand new, perfectly original article.
      const old = 'Reparation de fuite d eau dans une salle de bain moderne et fonctionnelle. '.repeat(5)
      const target: ContentToCheck = {
        id: 'new',
        title: 'Installer un chauffe-eau',
        content: 'Installer un chauffe eau thermodynamique demande une etude prealable du logement. '.repeat(5),
      }

      const result = await detector.findDuplicatesFor(target, [
        { id: 'old-a', title: 'Reparer une fuite', content: old },
        { id: 'old-b', title: 'Reparer une fuite', content: old },
      ])

      expect(result.hasDuplicates).toBe(false)
      expect(result.duplicates).toHaveLength(0)
    })

    it('skips a candidate carrying the same id as the target', async () => {
      const content = 'Un contenu suffisamment long pour depasser la longueur minimale de comparaison. '.repeat(3)
      const target: ContentToCheck = { id: 'x', title: 'Titre', content }

      const result = await detector.findDuplicatesFor(target, [{ id: 'x', title: 'Titre', content }])

      expect(result.duplicates).toHaveLength(0)
    })

    it('caps the number of candidates it compares', async () => {
      const content = 'Un contenu suffisamment long pour depasser la longueur minimale de comparaison. '.repeat(3)
      const candidates: ContentToCheck[] = Array.from({ length: 50 }, (_, i) => ({
        id: `c${i}`,
        title: `Page ${i}`,
        content,
      }))

      const limited = new DuplicateDetector({ maxCandidates: 5 })
      const result = await limited.findDuplicatesFor(
        { id: 'target', title: 'Target', content },
        candidates
      )

      expect(result.stats.totalChecked).toBe(6)
      expect(result.duplicates).toHaveLength(5)
    })
  })

  describe('cannibalisation', () => {
    it('flags two pages with the same title and intent but different prose', async () => {
      const result = await detector.findDuplicatesFor(CANNIBAL_A, [CANNIBAL_B])

      expect(result.duplicates).toHaveLength(1)
      expect(result.duplicates[0].reason).toBe('cannibalization')
      expect(result.duplicates[0].matchType).toBe('partial')
      expect(result.duplicates[0].signals!.title).toBeGreaterThanOrEqual(0.9)
      expect(result.duplicates[0].signals!.content).toBeLessThan(0.85)
    })

    it('exposes the individual signals behind every match', async () => {
      const result = await detector.findDuplicatesFor(CANNIBAL_A, [CANNIBAL_B])
      const signals = result.duplicates[0].signals!

      expect(signals).toHaveProperty('content')
      expect(signals).toHaveProperty('shingle')
      expect(signals).toHaveProperty('title')
      expect(signals).toHaveProperty('intent')
    })

    it('does not flag two pages that merely share a topic word', async () => {
      const result = await detector.findDuplicatesFor(
        { id: '1', title: 'Installer un chauffe-eau electrique', content: 'Installer un chauffe eau electrique demande une etude prealable du logement et du budget familial. '.repeat(4) },
        [{ id: '2', title: 'Peindre un plafond sans traces', content: 'Peindre un plafond sans laisser de traces suppose un rouleau adapte et une lumiere rasante correcte. '.repeat(4) }]
      )

      expect(result.hasDuplicates).toBe(false)
    })
  })

  describe('isDuplicate()', () => {
    it('should detect new content as duplicate', async () => {
      const existingContents: ContentToCheck[] = [
        {
          id: '1',
          title: 'Article existant',
          content: 'Contenu identique qui existe deja dans la base de donnees. '.repeat(50),
        },
      ]

      const newContent: ContentToCheck = {
        id: '2',
        title: 'Nouvel article',
        content: 'Contenu identique qui existe deja dans la base de donnees. '.repeat(50),
      }

      const result = await detector.isDuplicate(newContent, existingContents)

      expect(result.isDuplicate).toBe(true)
      expect(result.match).toBeDefined()
    })

    it('should not flag unique content as duplicate', async () => {
      const existingContents: ContentToCheck[] = [
        {
          id: '1',
          title: 'Article sur la plomberie',
          content: 'Cet article parle de plomberie et de canalisations bouchees. '.repeat(30),
        },
      ]

      const newContent: ContentToCheck = {
        id: '2',
        title: 'Article sur l electricite',
        content: 'Cet article parle d electricite et de cablage domestique. '.repeat(30),
      }

      const result = await detector.isDuplicate(newContent, existingContents)

      expect(result.isDuplicate).toBe(false)
      expect(result.match).toBeUndefined()
    })
  })

  describe('calculateSimilarity()', () => {
    it('should return 1.0 for identical texts', () => {
      const similarity = detector.calculateSimilarity(
        'Ceci est un texte de test',
        'Ceci est un texte de test'
      )

      expect(similarity).toBe(1.0)
    })

    it('should return high similarity for similar texts', () => {
      const similarity = detector.calculateSimilarity(
        'Comment installer une douche a l italienne',
        'Comment installer une douche a l italienne etape par etape'
      )

      expect(similarity).toBeGreaterThan(0.5)
    })

    it('should return low similarity for different texts', () => {
      const similarity = detector.calculateSimilarity(
        'Installation de plomberie',
        'Reparation electrique du tableau'
      )

      expect(similarity).toBeLessThan(0.5)
    })

    it('should return 0 for empty texts', () => {
      expect(detector.calculateSimilarity('', '')).toBe(0)
    })

    it('ignores French function words', () => {
      // Without stopword filtering, any two French texts look alike because
      // "les", "des", "pour" and "dans" dominate the vector.
      const similarity = detector.calculateSimilarity(
        'Il est important de bien preparer le chantier avant de commencer les travaux dans la maison',
        'Il est important de bien choisir le moment pour planter les arbres dans le jardin en automne'
      )

      expect(similarity).toBeLessThan(0.5)
    })

    it('catches literal copy-paste through word n-grams', () => {
      const stolen =
        'la reglementation impose une verification systematique des installations existantes avant intervention'
      const first = `${stolen} sur le secteur de troyes`
      const second = `dans un tout autre contexte editorial ${stolen}`

      // The shifted passage would defeat a positional bigram comparison; the
      // shingle set is position independent.
      const shingleOnly = new DuplicateDetector({ method: 'shingle' })

      expect(shingleOnly.calculateSimilarity(first, second)).toBeGreaterThan(0.3)
      expect(detector.calculateSimilarity(first, second)).toBeGreaterThan(0.3)
    })

    it('should use jaccard method', () => {
      const jaccardDetector = new DuplicateDetector({ method: 'jaccard' })

      const similarity = jaccardDetector.calculateSimilarity(
        'plomberie canalisation tuyau',
        'plomberie chauffage radiateur'
      )

      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThanOrEqual(1)
    })

    it('should use levenshtein method', () => {
      const levDetector = new DuplicateDetector({ method: 'levenshtein' })

      expect(levDetector.calculateSimilarity('installation douche', 'installation douche')).toBe(1.0)
    })

    it('should use shingle method', () => {
      const shingleDetector = new DuplicateDetector({ method: 'shingle' })

      expect(
        shingleDetector.calculateSimilarity(
          'installation complete douche italienne moderne',
          'installation complete douche italienne moderne'
        )
      ).toBe(1)
    })
  })

  describe('text normalization', () => {
    it('should normalize text before comparison', () => {
      const detectorWithNorm = new DuplicateDetector({ normalizeText: true })

      const similarity = detectorWithNorm.calculateSimilarity(
        'Installation de PLOMBERIE tuyaux et canalisations et chauffage',
        'installation de plomberie tuyaux et canalisations et chauffage'
      )

      expect(similarity).toBe(1)
    })

    it('folds accents away', () => {
      expect(
        detector.calculateSimilarity(
          'réparation de canalisation bouchée',
          'reparation de canalisation bouchee'
        )
      ).toBe(1)
    })

    it('strips HTML before comparing', () => {
      expect(
        detector.calculateSimilarity(
          '<p>reparation de canalisation bouchee</p>',
          'reparation de canalisation bouchee'
        )
      ).toBe(1)
    })

    it('should handle different text lengths', () => {
      const similarity = detector.calculateSimilarity(
        'Texte court',
        'Texte beaucoup plus long avec plus de mots et de contenu pour comparaison'
      )

      expect(similarity).toBeGreaterThan(0)
      expect(similarity).toBeLessThan(1)
    })
  })

  describe('custom configuration', () => {
    it('should respect custom similarity threshold', async () => {
      const config: DuplicateDetectionConfig = { similarityThreshold: 0.999, titleSimilarityThreshold: 1.1 }
      const customDetector = new DuplicateDetector(config)

      const contents: ContentToCheck[] = [
        { id: '1', title: 'A', content: 'Texte tres similaire mais legerement different sur Troyes '.repeat(20) },
        { id: '2', title: 'B', content: 'Texte tres similaire mais legerement different sur Reims '.repeat(20) },
      ]

      const result = await customDetector.findDuplicates(contents)

      expect(result.hasDuplicates).toBe(false)
    })

    it('should use custom boilerplate patterns', () => {
      const config: DuplicateDetectionConfig = { boilerplatePatterns: [/custom pattern/gi] }
      const customDetector = new DuplicateDetector(config)

      const similarity = customDetector.calculateSimilarity(
        'Contenu avec custom pattern a ignorer et autres mots',
        'Contenu avec custom pattern a ignorer et mots differents'
      )

      expect(similarity).toBeGreaterThan(0)
    })
  })

  describe('createDuplicateDetector factory', () => {
    it('should create detector with default config', () => {
      expect(createDuplicateDetector()).toBeInstanceOf(DuplicateDetector)
    })

    it('should create detector with custom config', () => {
      const config: DuplicateDetectionConfig = { similarityThreshold: 0.9, method: 'jaccard' }
      expect(createDuplicateDetector(config)).toBeInstanceOf(DuplicateDetector)
    })
  })

  describe('edge cases', () => {
    it('should handle empty content list', async () => {
      const result = await detector.findDuplicates([])

      expect(result.hasDuplicates).toBe(false)
      expect(result.duplicates).toHaveLength(0)
      expect(result.stats.totalChecked).toBe(0)
    })

    it('should handle single item list', async () => {
      const contents: ContentToCheck[] = [
        { id: '1', title: 'Solo', content: 'Seul contenu dans la liste. '.repeat(50) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.hasDuplicates).toBe(false)
      expect(result.duplicates).toHaveLength(0)
    })

    it('ignores documents shorter than the minimum length', async () => {
      const result = await detector.findDuplicates([
        { id: '1', title: 'A', content: 'Trop court.' },
        { id: '2', title: 'B', content: 'Trop court.' },
      ])

      expect(result.duplicates).toHaveLength(0)
    })

    it('should handle very long texts', async () => {
      const contents: ContentToCheck[] = [
        { id: '1', title: 'A', content: 'Mot '.repeat(10000) },
        { id: '2', title: 'B', content: 'Mot '.repeat(10000) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.stats.totalChecked).toBe(2)
    })

    it('should handle texts with special characters', () => {
      const similarity = detector.calculateSimilarity(
        'Texte avec caracteres speciaux et d autres mots',
        'Texte avec caracteres speciaux et d autres mots'
      )

      expect(similarity).toBeGreaterThan(0.9)
    })
  })
})
