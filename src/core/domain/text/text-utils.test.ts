// ─────────────────────────────────────────────────────────────────────────────
// text-utils — la boite a outils textuelle du domaine
//
// Rassemble les deux suites qui existaient de part et d autre du deplacement :
// celle qui couvrait les fonctions d extraction quand le module vivait dans
// src/adapters/rag/validation, et celle ecrite au moment ou il est descendu
// dans le domaine (normalisation francaise, vocabulaire d intention).
//
// Un module, un fichier de test. Le shim qui justifiait la separation a ete
// supprime au lot 5 : le garder aurait laisse deux suites diverger au premier
// correctif.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  INTENT_MARKERS,
  containsKeywordPhrase,
  contentTokens,
  countImages,
  countKeywordOccurrences,
  detectIntents,
  estimatePixelWidth,
  extractHeadingOutline,
  extractLinks,
  jaccardIndex,
  keywordTokenCoverage,
  normalizeForMatch,
  splitSentences,
  stripAccents,
  stripHtmlToText,
  tokenizeWords,
  wordShingles,
} from './text-utils'

// ─── Extraction et mesure (suite historique) ─────────────────────────────────
describe('stripHtmlToText', () => {
  it('turns block tags into sentence boundaries', () => {
    const text = stripHtmlToText('<h2>Un titre</h2><p>Une phrase</p><p>Une autre</p>')

    expect(text).toContain('Un titre')
    expect(splitSentences(text)).toHaveLength(3)
  })

  it('drops script and style bodies', () => {
    const text = stripHtmlToText('<p>Visible</p><script>var invisible = 1</script><style>.x{}</style>')

    expect(text).toContain('Visible')
    expect(text).not.toContain('invisible')
  })

  it('does not create word tokens out of the inserted punctuation', () => {
    const html = '<p>Un deux trois quatre cinq six sept huit neuf dix.</p>'.repeat(10)

    expect(tokenizeWords(stripHtmlToText(html))).toHaveLength(100)
  })
})

describe('extractHeadingOutline', () => {
  it('returns levels, not just text', () => {
    const outline = extractHeadingOutline('<h1>Titre</h1><h2>Section</h2><h3>Detail</h3>')

    expect(outline).toEqual([
      { level: 1, text: 'Titre' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Detail' },
    ])
  })

  it('strips nested markup from the heading text', () => {
    const outline = extractHeadingOutline('<h2>Un <strong>titre</strong> riche</h2>')

    expect(outline[0].text).toBe('Un titre riche')
  })
})

describe('extractLinks', () => {
  it('accepts single-quoted hrefs, which is what the generator emits', () => {
    const links = extractLinks("<a href='/plomberie-troyes'>ancre</a>")

    expect(links.internal).toEqual(['/plomberie-troyes'])
  })

  it('separates internal from external links', () => {
    const links = extractLinks(
      '<a href="/interne">a</a><a href="https://example.com/x">b</a><a href="mailto:x@y.z">c</a>'
    )

    expect(links.internal).toEqual(['/interne'])
    expect(links.external).toEqual(['https://example.com/x'])
  })

  it('treats an absolute link to the site itself as internal', () => {
    const links = extractLinks('<a href="https://monsite.fr/page">a</a>', 'https://monsite.fr')

    expect(links.internal).toHaveLength(1)
    expect(links.external).toHaveLength(0)
  })
})

describe('countImages', () => {
  it('counts images and non-empty alt attributes', () => {
    const result = countImages('<img src="a.jpg" alt="Un plombier"><img src="b.jpg"><img src="c.jpg" alt="">')

    expect(result.total).toBe(3)
    expect(result.withAlt).toBe(1)
  })
})

describe('keyword matching', () => {
  it('ignores case and accents', () => {
    expect(containsKeywordPhrase('Plomberie à TROYES en urgence', 'plomberie a troyes')).toBe(true)
  })

  it('reports token coverage when the exact phrase is broken up', () => {
    // "plomberie a troyes" never appears verbatim, but both terms are there.
    const text = 'Notre service de plomberie intervient partout a Troyes et dans l Aube.'

    expect(containsKeywordPhrase(text, 'plomberie Troyes')).toBe(false)
    expect(keywordTokenCoverage(text, 'plomberie Troyes')).toBe(1)
  })

  it('reports zero coverage for an off-topic text', () => {
    expect(keywordTokenCoverage('Un texte sur la peinture murale', 'plomberie Troyes')).toBe(0)
  })

  it('counts exact phrase occurrences', () => {
    expect(countKeywordOccurrences('plombier troyes et plombier troyes', 'plombier Troyes')).toBe(2)
  })

  it('normalises punctuation away', () => {
    expect(normalizeForMatch("L'électricité, c'est cher !")).toBe('l electricite c est cher')
  })
})

describe('estimatePixelWidth', () => {
  it('makes wide characters cost more than narrow ones', () => {
    expect(estimatePixelWidth('mmmmmmmmm')).toBeGreaterThan(estimatePixelWidth('iiiiiiiii'))
  })

  it('puts a 60-character lowercase title near the 600px SERP budget', () => {
    const width = estimatePixelWidth('a'.repeat(60))

    expect(width).toBeGreaterThan(500)
    expect(width).toBeLessThan(700)
  })
})

describe('shingles and similarity primitives', () => {
  it('builds word n-grams', () => {
    expect(wordShingles(['a', 'b', 'c', 'd', 'e'], 4)).toEqual(new Set(['a b c d', 'b c d e']))
  })

  it('falls back to a single shingle for short token lists', () => {
    expect(wordShingles(['a', 'b'], 4)).toEqual(new Set(['a b']))
  })

  it('computes the Jaccard index', () => {
    expect(jaccardIndex(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 5)
    expect(jaccardIndex(new Set<string>(), new Set(['a']))).toBe(0)
  })

  it('drops French stopwords from topical tokens', () => {
    expect(contentTokens('Le plombier est dans la maison avec des outils')).toEqual([
      'plombier',
      'maison',
      'outils',
    ])
  })
})

// ─── Normalisation et intentions (apport du deplacement) ─────────────────────

describe('normalisation', () => {
  it('retire les accents sans toucher au reste', () => {
    expect(stripAccents('référencement à Troyes')).toBe('referencement a Troyes')
  })

  it('retire accents et ponctuation, et rend une forme stable', () => {
    const once = normalizeForMatch("L'électricité, c'est cher !")

    expect(once).toBe('l electricite c est cher')
    // Idempotence : la forme normalisee est comparee a d'autres formes
    // normalisees. Si un second passage la changeait, deux textes identiques
    // pourraient scorer differemment selon le nombre de normalisations subies.
    expect(normalizeForMatch(once)).toBe(once)
  })

  it('rapproche deux ecritures du meme mot-cle', () => {
    expect(normalizeForMatch('Plomberie à Troyes')).toBe(normalizeForMatch('plomberie a troyes'))
  })
})

describe('detectIntents', () => {
  it('reconnait une intention transactionnelle', () => {
    const intents = detectIntents(normalizeForMatch('Prix et devis pour un dépannage'))

    expect(intents.has('transactional')).toBe(true)
  })

  it('reconnait une intention locale', () => {
    const intents = detectIntents(normalizeForMatch('Un taxi à proximité de la gare'))

    expect(intents.has('local')).toBe(true)
  })

  it('ne reconnait rien dans un texte qui ne vise aucune intention', () => {
    expect(detectIntents(normalizeForMatch('Le plombier repare la maison'))).toEqual(new Set())
  })

  it('rend le meme verdict a chaque appel', () => {
    // Un marqueur porteur du drapeau `g` conserverait son lastIndex : la
    // deuxieme detection repartirait du milieu du texte precedent et
    // manquerait l'intention. Ce test tombe le jour ou quelqu'un ajoute `g`.
    const text = normalizeForMatch('Tarif du depannage a proximite')

    expect(detectIntents(text)).toEqual(detectIntents(text))
    expect(INTENT_MARKERS.every(marker => !marker.pattern.global)).toBe(true)
  })
})
