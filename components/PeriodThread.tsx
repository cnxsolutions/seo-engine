// ─────────────────────────────────────────────────────────────────────────────
// « Le fil » — the signature of the CNX films (docs/design.md § 6): a line in
// the brand gradient, round ends, a white circled dot at today. Drawn once on
// arrival, never looping. One per screen, hence a fixed gradient id.
//
// SVG with PERCENT coordinates and no viewBox: the line stretches with the
// hero while the dot stays round — and the position needs no inline style.
// Colours come from the tokens, through the classes of espace.css.
// ─────────────────────────────────────────────────────────────────────────────

const GRADIENT_ID = 'fil-periode'

export function PeriodThread({ progress, label }: { progress: number; label: string }) {
  const at = `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`

  return (
    <svg className="thread" width="100%" height="16" role="img" aria-label={label}>
      <defs>
        <linearGradient id={GRADIENT_ID} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100%" y2="0">
          <stop className="thread__stop-start" offset="0%" />
          <stop className="thread__stop-end" offset="100%" />
        </linearGradient>
      </defs>
      <line className="thread__track" x1="0" y1="8" x2="100%" y2="8" />
      <line className="thread__fill" x1="0" y1="8" x2={at} y2="8" stroke={`url(#${GRADIENT_ID})`} />
      <circle className="thread__dot" cx={at} cy="8" r="5" />
    </svg>
  )
}
