// ─────────────────────────────────────────────────────────────────────────────
// Interface rules of CLAUDE.md and docs/design.md that a reviewer cannot be
// trusted to spot in a diff:
//
//   · no inline style — only the computed CSS properties of `cssVars()`;
//   · never `window.confirm()` (components/ConfirmDialog.tsx instead);
//   · one motion curve, the CNX one: every transition and animation of the
//     stylesheets runs on `var(--ease)` (docs/design.md § 8), and no curve is
//     written anywhere but in components/tokens.css — a hand-written
//     cubic-bezier is how a bounce gets in. A loop (a spinner, a shimmer) is
//     `linear`, the only other timing allowed.
//
// The L6 lots took the inline styles from 675 to none; this keeps them there.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

function sources(dir: string, extension: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path, extension)
    return entry.name.endsWith(extension) ? [path] : []
  })
}

const FILES = ['app', 'components'].flatMap((dir) => sources(join(ROOT, dir), '.tsx'))
const STYLESHEETS = ['app', 'components'].flatMap((dir) => sources(join(ROOT, dir), '.css'))

const name = (file: string): string => relative(ROOT, file).split(sep).join('/')

/** A comment may name the rule it keeps; only code breaks it. */
const COMMENT = /^\s*(\/\/|\/?\*|\{\/\*)/

function offenders(pattern: RegExp): string[] {
  return FILES.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => (!COMMENT.test(line) && pattern.test(line) ? [`${name(file)}:${index + 1}`] : [])),
  )
}

/** Every `transition:` / `animation:` / `*-timing-function:` value of a stylesheet, comments removed. */
function motionDeclarations(file: string): string[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const values: string[] = []
  for (const match of css.matchAll(/(?<![\w-])(?:transition|animation|[a-z-]+-timing-function)\s*:\s*([^;}]+)/g)) {
    values.push(match[1].replace(/\s+/g, ' ').trim())
  }
  return values
}

/** One part of a shorthand runs on the CNX curve, is a linear loop, or is nothing at all. */
function onTheCurve(part: string): boolean {
  return part === 'none' || part.includes('var(--ease)') || /\blinear\b/.test(part)
}

describe('interface rules', () => {
  // A scan that read nothing would pass the rules below without proving anything.
  it('reads the screens, the shared components and their stylesheets', () => {
    expect(FILES.map(name)).toContain('components/ui.tsx')
    expect(FILES.map(name)).toContain('app/(dashboard)/sites/[id]/pages/page.tsx')
    expect(STYLESHEETS.map(name)).toEqual(expect.arrayContaining(['app/globals.css', 'components/ui.css', 'components/tokens.css']))
  })

  it('has no inline style but the computed properties of cssVars()', () => {
    expect(offenders(/\bstyle=\{(?!cssVars\()/)).toEqual([])
  })

  it('never asks through window.confirm()', () => {
    expect(offenders(/\bwindow\.confirm\(/)).toEqual([])
  })

  it('moves every transition and animation on the CNX curve', () => {
    const offCurve = STYLESHEETS.flatMap((file) =>
      motionDeclarations(file)
        .filter((value) => !value.split(',').every((part) => onTheCurve(part.replace(/!important/, '').trim())))
        .map((value) => `${name(file)}: ${value}`),
    )
    expect(offCurve).toEqual([])
  })

  it('writes a curve nowhere but in the tokens', () => {
    const written = STYLESHEETS.filter((file) => name(file) !== 'components/tokens.css').flatMap((file) =>
      /cubic-bezier\(|\bease-(?:in|out|in-out)\b/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
        ? [name(file)]
        : [],
    )
    expect(written).toEqual([])
  })
})
