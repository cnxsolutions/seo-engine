// ─────────────────────────────────────────────────────────────────────────────
// The CNX Solutions mark, and the product lockup
//
// Copied from cnx-solutions/brand/logo/cnx-mark.svg: two strokes crossing — the
// SEO practice and the SAP practice — one full, one at 60 %, on a tile in the
// brand gradient (#0C6FFF → #6D4AFF). The brand book's rules apply: never
// recoloured, never distorted, never below 24 px.
//
// The tile is CSS (.brand-mark in globals.css), not an SVG gradient: an SVG
// <linearGradient> needs a document-unique id, and the mark appears in more
// than one place of the same page. Only the two strokes are SVG.
// ─────────────────────────────────────────────────────────────────────────────

export type BrandMarkSize = 'sm' | 'md' | 'lg'

interface BrandMarkProps {
  /** sm 28 px (bars), md 36 px (rail), lg 56 px (sign-in). */
  size?: BrandMarkSize
}

export function BrandMark({ size = 'md' }: BrandMarkProps) {
  return (
    <span className={`brand-mark brand-mark--${size}`} aria-hidden="true">
      <svg viewBox="0 0 512 512" focusable="false">
        <g stroke="#ffffff" strokeWidth="62" strokeLinecap="round" fill="none">
          <path d="M166 166 L346 346" />
          <path d="M346 166 L166 346" opacity="0.6" />
        </g>
      </svg>
    </span>
  )
}

interface BrandLockupProps {
  size?: BrandMarkSize
  /** `inverse` on the navy of the hero register (sign-in, status pages). */
  tone?: 'default' | 'inverse'
}

/** The mark, the product name, and who makes it. */
export function BrandLockup({ size = 'md', tone = 'default' }: BrandLockupProps) {
  return (
    <span className={tone === 'inverse' ? 'brand-lockup brand-lockup--inverse' : 'brand-lockup'}>
      <BrandMark size={size} />
      <span className="brand-lockup__text">
        <span className="brand-lockup__name">SEO Engine</span>
        <span className="brand-lockup__by">par CNX Solutions</span>
      </span>
    </span>
  )
}
