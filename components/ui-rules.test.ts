// ─────────────────────────────────────────────────────────────────────────────
// Two interface rules of CLAUDE.md that a reviewer cannot be trusted to spot in
// a diff: no inline style — only the computed CSS properties of `cssVars()` —
// and never `window.confirm()` (components/ConfirmDialog.tsx instead).
//
// The L6 lots took the inline styles from 675 to none; this keeps them there.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

const FILES = ['app', 'components'].flatMap((dir) => sources(join(ROOT, dir)))

/** A comment may name the rule it keeps; only code breaks it. */
const COMMENT = /^\s*(\/\/|\/?\*|\{\/\*)/

function offenders(pattern: RegExp): string[] {
  return FILES.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) => (!COMMENT.test(line) && pattern.test(line) ? [`${relative(ROOT, file)}:${index + 1}`] : [])),
  )
}

describe('interface rules', () => {
  // A scan that read nothing would pass the two rules below without proving anything.
  it('reads the screens and the shared components', () => {
    const read = FILES.map((file) => relative(ROOT, file).split(sep).join('/'))
    expect(read).toContain('components/ui.tsx')
    expect(read).toContain('app/(dashboard)/sites/[id]/pages/page.tsx')
  })

  it('has no inline style but the computed properties of cssVars()', () => {
    expect(offenders(/\bstyle=\{(?!cssVars\()/)).toEqual([])
  })

  it('never asks through window.confirm()', () => {
    expect(offenders(/\bwindow\.confirm\(/)).toEqual([])
  })
})
