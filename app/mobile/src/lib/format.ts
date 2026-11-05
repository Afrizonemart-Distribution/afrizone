import { colors } from '../theme';
/** Whole-Naira integer formatting. Amounts are NEVER kobo (API_CONTRACT.md). */
export function formatNaira(amount: number | null | undefined): string {
  const n = Math.round(Number(amount ?? 0));
  return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

/** Naira sign as a standalone glyph. */
export const NAIRA = '₦';

/** "₦2,500/hr" or "₦18,000 fixed" depending on pay model. */
export function payLabel(
  payModel: 'HOURLY' | 'FIXED' | 'PER_UNIT',
  rate?: number | null,
  budget?: number | null,
  unitLabel?: string | null
): string {
  if (payModel === 'PER_UNIT') return `${formatNaira(rate)} per ${unitLabel || 'unit'}`;
  if (payModel === 'HOURLY') return `${formatNaira(rate)}/hr`;
  return `${formatNaira(budget ?? rate)} fixed`;
}

/** net = gross − WHT (round). Mirrors API_CONTRACT money math. */
export function netFromGross(gross: number, whtRate = 0.05): number {
  return Math.round(gross - gross * whtRate);
}

/** Friendly relative-ish date for deadlines. */
export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/**
 * Same, but keeps the year.
 *
 * formatDate drops it, which is right for task dates a week or two out. It is
 * wrong for anything where the year carries the meaning - a licence reading
 * "Expires 1 Jun" tells the holder nothing about whether it is still valid.
 */
export function formatDateWithYear(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Build an E.164 phone from a country prefix (e.g. "+234") and a locally typed
 * national number. Strips a leading 0 (common NG entry) and all non-digits.
 * e.g. ("+234", "0803 000 0001") → "+2348030000001".
 */
export function toE164(prefix: string, local: string): string {
  const cc = prefix.replace(/[^\d]/g, '');
  let nat = local.replace(/\D/g, '');
  if (nat.startsWith('0')) nat = nat.replace(/^0+/, '');
  return `+${cc}${nat}`;
}

/** Loose NG validity check: 10 national digits after stripping a leading 0. */
export function isValidNgNumber(local: string): boolean {
  let nat = local.replace(/\D/g, '');
  if (nat.startsWith('0')) nat = nat.replace(/^0+/, '');
  return nat.length === 10;
}

/**
 * Same palette + hash as web-admin's avatarGradient (src/lib/format.ts):
 * a worker's avatar color is deterministic by id, so it matches across both
 * apps instead of mobile defaulting every avatar to the same navy/gold.
 */
// The blue, green and coral pairs are deliberately OFF-palette: the point is
// that two workers rarely get the same avatar. The gold pairs are the brand,
// so they reference it - they had been carrying #C98518, a clayDeep that
// src/theme.ts retired as having no source behind it.
const AVATAR_GRADIENTS: [string, string][] = [
  [colors.clayDeep, colors.gold],
  ['#5B8BFF', '#7C5CFF'],
  ['#27C08A', '#1F8F68'],
  [colors.gold, colors.clayDeep],
  ['#FF6B5E', colors.clayDeep],
];

export function avatarGradient(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

/** mm:ss / h:mm:ss elapsed timer formatting. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}
