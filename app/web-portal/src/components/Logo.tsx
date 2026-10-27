import './Logo.css'

/**
 * The real AfriZoneMart mark — the orange continent with the cart inside it.
 *
 * The portal had been showing a navy tile with the letter "A" in it, which was
 * a placeholder that outlived its welcome. Stores and couriers sign in here and
 * hand their business to whatever is on the screen; a stand-in glyph is the
 * wrong first impression for the one surface outsiders actually see.
 *
 * SAME FILES AS EVERYWHERE ELSE, deliberately. These are copied byte-for-byte
 * from `web-admin/public/`, and mobile ships the same artwork. All of them must
 * change together — a portal whose logo has drifted from the console's is worse
 * than one with no logo at all, because it reads as a different company.
 *
 * THE srcSet LADDER IS NOT DECORATION. The artwork is 107x113. Asking a browser
 * to reduce that straight to 30px is a 3.5x downscale and it reads muddy — the
 * cart's outline breaks up. The 76 and 92 variants are resampled in linear
 * light with premultiplied alpha, which browsers do not do, so the browser only
 * ever has to halve a file or use it 1:1 on a 2x screen.
 */

/** Intrinsic aspect of the artwork. Height is derived so the mark never distorts. */
const MARK_ASPECT = 107 / 113

export function LogoMark({
  size = 32,
  tone = 'full',
}: {
  size?: number
  /** `reversed` is the white-continent variant, for grounds that fight the orange. */
  tone?: 'full' | 'reversed'
}) {
  const height = Math.round(size / MARK_ASPECT)
  const stem = tone === 'reversed' ? 'logo-mark-reversed' : 'logo-mark'
  return (
    <span className="az-mark" style={{ width: size, height }}>
      <img
        src={`/${stem}.png`}
        srcSet={`/${stem}-76.png 76w, /${stem}-92.png 92w, /${stem}.png 107w`}
        sizes={`${size}px`}
        width={size}
        height={height}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
    </span>
  )
}

/**
 * Mark plus wordmark.
 *
 * The wordmark stays live text rather than being baked into the image: it has to
 * sit at three different sizes across the landing page and the signed-in chrome,
 * and a fixed lockup would either blur or force a second asset. It also means
 * the name is selectable and readable to a screen reader without alt-text
 * duplication — which is why the mark itself is `aria-hidden` and the label
 * lives on the wrapper.
 */
export default function Logo({
  size = 32,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <span className={`az-logo ${className}`} aria-label="AfriZone PartTime">
      <LogoMark size={size} />
      <span className="az-word">
        AfriZone <b>PartTime</b>
      </span>
    </span>
  )
}
