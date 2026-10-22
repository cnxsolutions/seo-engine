// ─────────────────────────────────────────────────────────────────────────────
// Hero image of a page
// SEO Engine - One realistic photo per page, generated only when it ships.
// ─────────────────────────────────────────────────────────────────────────────
//
// Until 2026-10-22 the engine generated no image at all: the « Images » setting
// only asked the model for alt-text suggestions nobody displayed, and Flowyne's
// first page opened on a broken picture its template had invented. This module
// is the generator.
//
// Three decisions shape it:
//
//   - GENERATED AT PUBLICATION, not with the text. A page the gate refuses, or a
//     destination that turns out occupied, must cost nothing: the connector gets
//     a SOURCE and calls it only once its own guards have passed.
//   - ONE photo, realistic, without any text in it — image models still render
//     letters badly, and a hero image with garbled words looks worse than none.
//   - NEVER BLOCKING. A failed generation publishes the page without an image;
//     the article is the product, the photo is a bonus.

import { getOpenAiClient } from './openai'

export type HeroImageFormat = 'webp' | 'jpeg'

export interface HeroImage {
  data: Buffer
  format: HeroImageFormat
  mimeType: 'image/webp' | 'image/jpeg'
  width: number
  height: number
  alt: string
}

/**
 * The image, produced on demand.
 *
 * Next.js asks for webp (served from the repository, the lighter the better);
 * WordPress asks for jpeg, which every installation accepts where webp needs
 * WordPress 5.8 and a server that decodes it.
 */
export type HeroImageSource = (format: HeroImageFormat) => Promise<HeroImage | null>

/** Landscape, the shape of an article header. */
export const HERO_IMAGE_SIZE = { width: 1536, height: 1024 } as const

/**
 * The newest model whose parameters the installed OpenAI SDK documents
 * (`gpt-image-2` exists on the account, but its accepted sizes are not those
 * the SDK lists). Overridable with IMAGE_MODEL once a newer one is checked.
 */
const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5'

/** An image model can take a minute or more; the default client timeout is shorter. */
const IMAGE_TIMEOUT_MS = 180_000

interface ImageSubject {
  title: string
  imagePrompt?: string
  imageAlts?: string[]
}

/**
 * The prompt sent to the image model.
 *
 * The scene comes from the page itself — the model that wrote the article
 * describes the photo that illustrates it (`imagePrompt`). The constraints
 * around it are fixed here, in English, which image models follow best.
 */
export function heroImagePrompt(page: ImageSubject): string {
  const scene = page.imagePrompt?.trim() || `a scene that illustrates a web article titled "${page.title}"`
  return [
    'Realistic editorial photograph for the header of a web article, natural light, shallow depth of field.',
    `Scene: ${scene}`,
    'Strictly no text, letters, numbers, logos, brand names, watermarks or readable screens anywhere in the image.',
    'People, if any, are ordinary people photographed naturally, never public figures.',
  ].join('\n')
}

/** The alt text: the one the model wrote for this photo, else the page title. */
export function heroImageAlt(page: ImageSubject): string {
  return (page.imageAlts ?? []).map((alt) => alt.trim()).find(Boolean) ?? page.title
}

/**
 * Generate the photo. Null on any failure, and when generation is switched off
 * (IMAGE_GENERATION=off) or no OpenAI key is configured.
 */
export async function generateHeroImage(page: ImageSubject, format: HeroImageFormat = 'webp'): Promise<HeroImage | null> {
  if (process.env.IMAGE_GENERATION === 'off' || !process.env.OPENAI_API_KEY) return null

  try {
    const quality = process.env.IMAGE_QUALITY
    const response = await getOpenAiClient().images.generate(
      {
        model: process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
        prompt: heroImagePrompt(page),
        size: '1536x1024',
        quality: quality === 'low' || quality === 'high' ? quality : 'medium',
        output_format: format,
        output_compression: 80,
        n: 1,
      },
      { timeout: IMAGE_TIMEOUT_MS }
    )

    const encoded = response.data?.[0]?.b64_json
    if (!encoded) {
      console.warn('[image] le modele n a renvoye aucune image')
      return null
    }

    return {
      data: Buffer.from(encoded, 'base64'),
      format,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/webp',
      ...HERO_IMAGE_SIZE,
      alt: heroImageAlt(page),
    }
  } catch (error) {
    console.warn(`[image] generation impossible : ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * A source that pays at most once per format, whatever the connector does
 * with it — two calls during one publication are one generation.
 */
export function onceHeroImage(source: HeroImageSource): HeroImageSource {
  const made = new Map<HeroImageFormat, Promise<HeroImage | null>>()
  return (format) => {
    const existing = made.get(format)
    if (existing) return existing
    const pending = source(format)
    made.set(format, pending)
    return pending
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Put the photo at the head of the article, as a figure.
 *
 * AFTER the direct answer, never before it: that paragraph has to stay the
 * first block under the H1 — the audit checks it, and it is the passage answer
 * engines quote. Without one, right after the H1; without an H1, first.
 */
export function withHeroFigure(
  html: string,
  image: { src: string; alt: string; width: number; height: number }
): string {
  const figure =
    `<figure class="seo-hero-image"><img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}" ` +
    `width="${image.width}" height="${image.height}" loading="eager" decoding="async"></figure>`

  const answer = /<p\b[^>]*class\s*=\s*["'][^"']*\breponse-directe\b[^"']*["'][^>]*>[\s\S]*?<\/p\s*>/i.exec(html)
  if (answer) return `${html.slice(0, answer.index + answer[0].length)}${figure}${html.slice(answer.index + answer[0].length)}`

  const h1 = /<\/h1\s*>/i.exec(html)
  if (h1) return `${html.slice(0, h1.index + h1[0].length)}${figure}${html.slice(h1.index + h1[0].length)}`

  return `${figure}${html}`
}
