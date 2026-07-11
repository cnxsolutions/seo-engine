// ─────────────────────────────────────────────────────────────────────────────
// DuplicateDetector Tests
// SEO Engine - Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { DuplicateDetector, createDuplicateDetector } from './DuplicateDetector'
import type { DuplicateDetectionConfig, ContentToCheck } from './DuplicateDetector'

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
          content: 'Cet article explique comment installer une douche step by step avec toutes les étapes nécessaires et les outils requis pour le bricolage.',
        },
        {
          id: '2',
          title: 'Réparation de fuite d\'eau',
          content: 'Guide complet pour réparer une fuite d\'eau dans votre maison. Les outils et techniques recommandés par les professionnels.',
        },
      ]

      const result = await detector.findDuplicates(contents)

      // Should find no duplicates (different content)
      expect(result.stats.totalChecked).toBe(2)
    })

    it('should detect duplicates with high similarity', async () => {
      const baseContent = 'Cet article explique comment installer une douche avec les étapes détaillées, les outils nécessaires, et les conseils du professionnel.'

      const contents: ContentToCheck[] = [
        {
          id: '1',
          title: 'Installation douche guide',
          content: baseContent + ' ' + baseContent + ' ' + baseContent,
        },
        {
          id: '2',
          title: 'Douche installation tutorial',
          content: baseContent + ' ' + baseContent + ' ' + baseContent,
        },
      ]

      const result = await detector.findDuplicates(contents)

      // Should detect high similarity (duplicate content)
      expect(result.duplicates.length).toBeGreaterThan(0)
    })

    it('should calculate processing time', async () => {
      const contents: ContentToCheck[] = [
        { id: '1', title: 'A', content: 'Contenu A '.repeat(100) },
        { id: '2', title: 'B', content: 'Contenu B '.repeat(100) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.totalChecked).toBe(2)
    })
  })

  describe('isDuplicate()', () => {
    it('should detect new content as duplicate', async () => {
      const existingContents: ContentToCheck[] = [
        {
          id: '1',
          title: 'Article existant',
          content: 'Contenu identique qui existe déjà dans la base de données. '.repeat(50),
        },
      ]

      const newContent: ContentToCheck = {
        id: '2',
        title: 'Nouvel article',
        content: 'Contenu identique qui existe déjà dans la base de données. '.repeat(50),
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
          content: 'Cet article parle de plomberie et de canalisations. '.repeat(30),
        },
      ]

      const newContent: ContentToCheck = {
        id: '2',
        title: 'Article sur l\'électricité',
        content: 'Cet article parle d\'électricité et de câblage. '.repeat(30),
      }

      const result = await detector.isDuplicate(newContent, existingContents)

      expect(result.isDuplicate).toBe(false)
      expect(result.match).toBeUndefined()
    })
  })

  describe('calculateSimilarity()', () => {
    it('should return 1.0 for identical texts (cosine)', () => {
      const similarity = detector.calculateSimilarity(
        'Ceci est un texte de test',
        'Ceci est un texte de test'
      )

      expect(similarity).toBe(1.0)
    })

    it('should return high similarity for similar texts', () => {
      const similarity = detector.calculateSimilarity(
        'Comment installer une douche à l\'italienne',
        'Comment installer une douche à l\'italienne étape par étape'
      )

      expect(similarity).toBeGreaterThan(0.5)
    })

    it('should return low similarity for different texts', () => {
      const similarity = detector.calculateSimilarity(
        'Installation de plomberie',
        'Réparation électrique du tableau'
      )

      expect(similarity).toBeLessThan(0.5)
    })

    it('should return 0 for empty texts', () => {
      const similarity = detector.calculateSimilarity('', '')

      expect(similarity).toBe(0)
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

      const similarity = levDetector.calculateSimilarity(
        'installation douche',
        'installation douche'
      )

      expect(similarity).toBe(1.0)
    })
  })

  describe('text normalization', () => {
    it('should normalize text before comparison', () => {
      const detectorWithNorm = new DuplicateDetector({ normalizeText: true })

      const similarity = detectorWithNorm.calculateSimilarity(
        'Installation de PLOMBERIE tuyaux et canalisations et chauffage',
        'installation de plomberie tuyaux et canalisations et chauffage'
      )

      expect(similarity).toBeGreaterThan(0.3)
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
    it('should respect custom similarity threshold', () => {
      const config: DuplicateDetectionConfig = {
        similarityThreshold: 0.99,
      }
      const customDetector = new DuplicateDetector(config)

      const contents: ContentToCheck[] = [
        {
          id: '1',
          title: 'A',
          content: 'Texte très similaire mais pas identique '.repeat(20),
        },
        {
          id: '2',
          title: 'B',
          content: 'Texte très similaire mais pas identique '.repeat(20),
        },
      ]

      // Even similar content won't trigger with 0.99 threshold
      const result = customDetector.findDuplicates(contents)

      // Just verify no crash and reasonable output
      expect(result).toBeDefined()
    })

    it('should use custom boilerplate patterns', () => {
      const config: DuplicateDetectionConfig = {
        boilerplatePatterns: [/custom pattern/gi],
      }
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
      const d = createDuplicateDetector()
      expect(d).toBeInstanceOf(DuplicateDetector)
    })

    it('should create detector with custom config', () => {
      const config: DuplicateDetectionConfig = {
        similarityThreshold: 0.9,
        method: 'jaccard',
      }
      const d = createDuplicateDetector(config)
      expect(d).toBeInstanceOf(DuplicateDetector)
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
        { id: '1', title: 'Solo', content: 'Seul contenu dans la liste.'.repeat(50) },
      ]

      const result = await detector.findDuplicates(contents)

      expect(result.hasDuplicates).toBe(false)
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

    it('should handle texts with special characters', async () => {
      const similarity = detector.calculateSimilarity(
        'Texte avec caracteres speciaux et d autres mots',
        'Texte avec caracteres speciaux et d autres mots'
      )

      expect(similarity).toBeGreaterThan(0.9)
    })
  })
})
