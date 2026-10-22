// ─────────────────────────────────────────────────────────────────────────────
// Hero image — tests
// SEO Engine - One realistic photo per page, never blocking the page.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generate = vi.fn()
vi.mock('./openai', () => ({ getOpenAiClient: () => ({ images: { generate } }) }))

const {
  generateHeroImage, heroImageAlt, heroImagePrompt, onceHeroImage, withHeroFigure,
} = await import('./images')

const PAGE = {
  title: 'Application de réservation pour barber',
  imagePrompt: 'A barber checks the next appointments on a tablet in a bright barbershop.',
  imageAlts: ['Un barber consulte ses rendez-vous sur une tablette'],
}

beforeEach(() => {
  generate.mockReset()
  vi.stubEnv('OPENAI_API_KEY', 'sk-test')
  vi.stubEnv('IMAGE_GENERATION', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('heroImagePrompt', () => {
  it('describes the scene the page asked for, and forbids text in the image', () => {
    const prompt = heroImagePrompt(PAGE)
    expect(prompt).toContain('Scene: A barber checks the next appointments')
    expect(prompt).toContain('Realistic editorial photograph')
    expect(prompt).toMatch(/no text, letters, numbers, logos/)
  })

  it('falls back on the title when the page described no scene', () => {
    expect(heroImagePrompt({ title: 'Agenda en ligne' })).toContain('a web article titled "Agenda en ligne"')
  })
})

describe('heroImageAlt', () => {
  it('uses the alt text written for the photo, else the title', () => {
    expect(heroImageAlt(PAGE)).toBe('Un barber consulte ses rendez-vous sur une tablette')
    expect(heroImageAlt({ title: 'Agenda en ligne', imageAlts: ['  '] })).toBe('Agenda en ligne')
  })
})

describe('generateHeroImage', () => {
  it('returns the decoded photo in the format asked for', async () => {
    generate.mockResolvedValue({ data: [{ b64_json: Buffer.from('jpeg-bytes').toString('base64') }] })

    const image = await generateHeroImage(PAGE, 'jpeg')

    expect(image?.data.toString()).toBe('jpeg-bytes')
    expect(image).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg', width: 1536, height: 1024 })
    expect(generate.mock.calls[0][0]).toMatchObject({ size: '1536x1024', output_format: 'jpeg', n: 1, quality: 'medium' })
  })

  it('never throws: a failed or empty generation is no image', async () => {
    generate.mockRejectedValueOnce(new Error('quota'))
    expect(await generateHeroImage(PAGE)).toBeNull()

    generate.mockResolvedValueOnce({ data: [] })
    expect(await generateHeroImage(PAGE)).toBeNull()
  })

  it('generates nothing when switched off or without an OpenAI key', async () => {
    vi.stubEnv('IMAGE_GENERATION', 'off')
    expect(await generateHeroImage(PAGE)).toBeNull()

    vi.stubEnv('IMAGE_GENERATION', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(await generateHeroImage(PAGE)).toBeNull()

    expect(generate).not.toHaveBeenCalled()
  })
})

describe('onceHeroImage', () => {
  it('pays once per format, however often the connector asks', async () => {
    const source = vi.fn(async () => null)
    const once = onceHeroImage(source)

    await Promise.all([once('webp'), once('webp'), once('jpeg')])

    expect(source).toHaveBeenCalledTimes(2)
  })
})

describe('withHeroFigure', () => {
  const IMAGE = { src: '/images/seo/barber.webp', alt: 'Un "barber" au travail', width: 1536, height: 1024 }

  it('places the photo AFTER the direct answer, which stays first under the H1', () => {
    const html = '<h1>Titre</h1><p class="reponse-directe">Réponse.</p><h2>Suite</h2>'
    const out = withHeroFigure(html, IMAGE)
    expect(out.indexOf('reponse-directe')).toBeLessThan(out.indexOf('<figure'))
    expect(out.indexOf('<figure')).toBeLessThan(out.indexOf('<h2>'))
    expect(out).toContain('alt="Un &quot;barber&quot; au travail"')
  })

  it('falls back to right after the H1, then to the very top', () => {
    expect(withHeroFigure('<h1>Titre</h1><p>Texte</p>', IMAGE)).toMatch(/<\/h1><figure class="seo-hero-image">/)
    expect(withHeroFigure('<p>Texte</p>', IMAGE)).toMatch(/^<figure class="seo-hero-image">/)
  })
})
