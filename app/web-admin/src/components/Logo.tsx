import './Logo.css'

type Tone = 'dark' | 'light'
type MarkTone = 'full' | 'reversed'

interface LogoProps {
  /** pixel size of the square mark */
  size?: number
  /** show the "Afrizone Part Time" wordmark */
  wordmark?: boolean
  /** show the "Made in Africa, delivered worldwide" tagline */
  tagline?: boolean
  /** dark = light wordmark for dark backgrounds (default); light = navy wordmark */
  tone?: Tone
  className?: string
}

// Hand-drawn (not auto-traced) simplified Africa silhouette — straight-line
// points only, matching mobile's src/components/Logo.tsx exactly.
const AFRICA_PATH =
  'M38 6 L58 8 L66 16 L86 30 L72 40 L76 58 L68 78 L58 100 L50 116 L42 100 L30 84 L14 66 L6 50 L16 34 L24 18 Z'

/**
 * Afrizone logo mark — a Sea Buckthorn-orange Africa silhouette with a Deep
 * Navy Blue shopping-cart glyph, per the official Afrizonemart.com logo
 * redesign spec. `markTone="reversed"` swaps the continent to white for use
 * on solid orange/navy backgrounds where the default orange fill would
 * otherwise have no contrast.
 */
export function LogoMark({ size = 38, markTone = 'full' }: { size?: number; markTone?: MarkTone }) {
  const height = size * 1.2
  const continentFill = markTone === 'reversed' ? '#fff' : 'var(--gold-bright)'
  return (
    <span className="az-mark" style={{ width: size, height }}>
      <svg viewBox="0 0 100 120" width="100%" height="100%" aria-hidden="true">
        <path d={AFRICA_PATH} fill={continentFill} />
        <path d="M66 50 L40 62" stroke="var(--navy)" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M40 62 L62 62 L56 84 L34 84 Z" fill="var(--navy)" />
        <rect x="42" y="52" width="8" height="10" rx="2" fill="var(--navy)" />
        <rect x="52" y="54" width="7" height="8" rx="2" fill="var(--navy)" />
        <circle cx="40" cy="90" r="5" fill="var(--navy)" />
        <circle cx="50" cy="90" r="5" fill="var(--navy)" />
      </svg>
    </span>
  )
}

export default function Logo({
  size = 38,
  wordmark = true,
  tagline = false,
  tone = 'dark',
  className = '',
}: LogoProps) {
  return (
    <span className={`az-logo ${className}`} aria-label="Afrizone Part Time">
      <LogoMark size={size} />
      {wordmark && (
        <span className="az-words">
          <span className="az-word">
            <span className={tone === 'dark' ? 'az-afri-dark' : 'az-afri-light'}>Afrizone</span>
            <span className={tone === 'dark' ? 'az-part-dark' : 'az-part-light'}>
              Part&nbsp;Time
            </span>
          </span>
          {tagline && <span className="az-tag">Made in Africa, delivered worldwide</span>}
        </span>
      )}
    </span>
  )
}
