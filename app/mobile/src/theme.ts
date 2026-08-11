/**
 * Afrizone Part Time — design tokens for the worker mobile app.
 * Mirrors DESIGN_SPEC.md §1 (brand) and the web-admin tokens.css so the
 * two apps stay visually identical.
 */

export const colors = {
  // Brand — per the official Afrizonemart.com logo redesign spec: Deep Navy
  // Blue #000066 + Sea Buckthorn orange #FBAC34 (Raleway typeface).
  clay: '#FBAC34', // Sea Buckthorn — primary accent (was clay/terracotta)
  clayLight: '#FCC066', // lightened tint for hover/pressed states
  gold: '#FBAC34', // Sea Buckthorn (kept as separate token for existing call sites)
  goldBright: '#FBAC34', // Sea Buckthorn — logo mark color
  navy: '#000066', // Deep Navy Blue — logo square / brand navy
  navyDeep: '#00004D',
  forest: '#14302B', // --forest-900 ink / dark surfaces
  forest700: '#1E4B41',

  // Functional / semantic (shared status language)
  money: '#1F9D6B', // --money-600 available / paid / success
  indigo: '#2D5BA8', // --indigo-600 info / in review
  amber: '#E08A1E', // --amber-500 warnings / alerts (no longer the Pending status)
  danger: '#C8453A', // --danger-600 errors / rejected
  /**
   * Pending / awaiting. Deliberately violet rather than amber: Sea Buckthorn is
   * the action colour used for Active, and amber sits close enough to it that
   * the two statuses read as the same signal. Violet is 53° from the nearest
   * other status hue — slate and steel were rejected for colliding with indigo.
   * `amber` above is kept for genuine warnings, which is most of its call sites.
   */
  pending: '#6B3F94',

  // Neutrals (warm-tinted, never pure gray)
  bg: '#FBF5EC', // --sand-50 app background
  surfaceSand: '#F4EADB', // --sand-100 surface
  surface: '#FFFFFF', // card
  line: '#E7DCC9', // hairline / border
  text: '#241C15', // primary text
  textMuted: '#7A6B58', // muted text
  white: '#FFFFFF',

  // Tints for status pill backgrounds (semi-opaque feel without alpha math)
  amberSoft: '#FBEBD3',
  pendingSoft: '#EDE8F2',
  claySoft: '#FDECD1',
  indigoSoft: '#DDE6F4',
  moneySoft: '#D6F0E4',
  forestSoft: '#D6E2DE',
  dangerSoft: '#F6DAD7',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  input: 12,
  button: 12,
  card: 16,
  sheet: 22,
  pill: 100,
  /** "Sunrise Cut" signature — the sharp corner paired with `card`/`button`
   * on the opposite corner to give every surface an asymmetric, angular
   * silhouette instead of a uniform rounded rectangle. */
  cut: 4,
} as const;

/**
 * "Sunrise Cut" motif — a repeating chevron pattern echoing the angular
 * lines of the Africa+cart logo mark. Used sparingly as a thin section
 * divider or a low-opacity background watermark on brand moments only
 * (never behind dense data, per DESIGN_SPEC §7).
 */
export const motif = {
  watermarkOpacityDark: 0.12,
  watermarkOpacityLight: 0.05,
  dividerOpacityDark: 0.35,
  dividerOpacityLight: 0.5,
} as const;

export const shadow = {
  // Soft warm shadow — restrained (fintech, not glass) per §1.5
  card: {
    shadowColor: '#241C15',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 4,
  },
  soft: {
    shadowColor: '#241C15',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
} as const;

/**
 * Typography. Sizes/weights approximate the display/body split from §1.4;
 * Raleway is applied via `fontFamily` below on brand-critical text. `tabular`
 * is used for money/timesheets.
 */
export const type = {
  // sizes from the §1.4 scale
  size: {
    xs: 12,
    sm: 13,
    base: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 30,
    displayLg: 38,
    hero: 48,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  lineHeight: 1.5,
} as const;

export const layout = {
  /** Minimum accessible touch target (§7). */
  hitTarget: 44,
  screenPadding: spacing.xl,
} as const;

/**
 * Raleway (per the brand spec: extrabold headings, medium body), loaded via
 * @expo-google-fonts/raleway in app/_layout.tsx. Applied explicitly on the
 * highest-visibility shared/brand text (screen headers, logo, buttons)
 * rather than every style in the app — React Native registers each static
 * weight as its own font family name, so a blanket global override isn't a
 * simple one-line change the way it is on web.
 */
export const fontFamily = {
  extrabold: 'Raleway_800ExtraBold',
  medium: 'Raleway_500Medium',
} as const;

export type Theme = {
  colors: typeof colors;
  spacing: typeof spacing;
  radii: typeof radii;
  type: typeof type;
};

export const theme: Theme = { colors, spacing, radii, type };
