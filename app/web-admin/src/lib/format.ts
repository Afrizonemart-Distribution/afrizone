import type { PaymentStatus, TaskStatus, AppStatus, TimesheetStatus, Tier } from '../api/types'

const NF = new Intl.NumberFormat('en-NG')

/** Format whole-Naira integers with thousands separators, e.g. 18000 -> "₦18,000" */
export function formatNaira(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '₦0'
  return `₦${NF.format(Math.round(amount))}`
}

/** Compact money for chips/cards, e.g. 4860000 -> "₦4.86M", 2500 -> "₦2.5k" */
export function formatNairaCompact(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '₦0'
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (amount >= 1000) return `₦${(amount / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `₦${NF.format(amount)}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic gradient for an avatar from a string seed. */
const AV_GRADS = [
  'linear-gradient(135deg,#D88E1B,#FBAC34)',
  'linear-gradient(135deg,#5b8bff,#7c5cff)',
  'linear-gradient(135deg,#27c08a,#1f8f68)',
  'linear-gradient(135deg,#FBAC34,#D88E1B)',
  'linear-gradient(135deg,#ff6b5e,#D88E1B)',
]
export function avatarGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AV_GRADS[h % AV_GRADS.length]
}

export const TIER_COLORS: Record<Tier, string> = {
  STUDENT: 'var(--indigo)',
  DISPATCH: 'var(--clay)',
  REMOTE: 'var(--money)',
  PROMO: 'var(--gold)',
  TRADE: 'var(--forest)',
}

export const TIER_LABELS: Record<Tier, string> = {
  STUDENT: 'Student',
  DISPATCH: 'Dispatch',
  REMOTE: 'Remote',
  PROMO: 'Promo',
  TRADE: 'Trade',
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

/**
 * Date AND time, for logs where the gap between two timestamps is the point.
 *
 * formatDate is right for a due date; it is wrong for an event ledger, where
 * "Mart sent it, we received it four minutes later" is invisible without the
 * clock. The year appears only when it is not the current one - carrying it on
 * every row costs width that the time needs, but dropping it entirely is how a
 * two-year-old event reads as todays.
 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// status -> pill variant + canonical word
export type PillVariant = 'pending' | 'active' | 'review' | 'ready' | 'paid' | 'danger'

export function paymentPill(s: PaymentStatus): { variant: PillVariant; label: string } {
  switch (s) {
    case 'PENDING':
      return { variant: 'pending', label: 'Pending' }
    case 'APPROVED':
      return { variant: 'ready', label: 'Approved' }
    case 'RELEASED':
      return { variant: 'paid', label: 'Released' }
    case 'DISPUTED':
      return { variant: 'danger', label: 'Dispute' }
  }
}

export function taskPill(s: TaskStatus): { variant: PillVariant; label: string } {
  switch (s) {
    case 'OPEN':
      return { variant: 'active', label: 'Open' }
    case 'FILLED':
      return { variant: 'ready', label: 'Filled' }
    case 'CLOSED':
      return { variant: 'paid', label: 'Closed' }
    case 'ARCHIVED':
      return { variant: 'paid', label: 'Archived' }
  }
}

export function appPill(s: AppStatus): { variant: PillVariant; label: string } {
  switch (s) {
    case 'APPLIED':
      return { variant: 'pending', label: 'Applied' }
    case 'APPROVED':
      return { variant: 'ready', label: 'Approved' }
    case 'REJECTED':
      return { variant: 'danger', label: 'Rejected' }
  }
}

export function timesheetPill(s: TimesheetStatus): { variant: PillVariant; label: string } {
  switch (s) {
    case 'SUBMITTED':
      return { variant: 'review', label: 'Submitted' }
    case 'APPROVED':
      return { variant: 'ready', label: 'Approved' }
    case 'DISPUTED':
      return { variant: 'danger', label: 'Disputed' }
  }
}

export function disputePill(s: string): { variant: PillVariant; label: string } {
  switch (s) {
    case 'OPEN':
      return { variant: 'danger', label: 'Open' }
    case 'RESOLVED':
      return { variant: 'ready', label: 'Resolved' }
    case 'CLOSED':
      return { variant: 'paid', label: 'Closed' }
    default:
      return { variant: 'pending', label: s }
  }
}

export function kycPill(s: string): { variant: PillVariant; label: string } {
  switch (s) {
    case 'VERIFIED':
      return { variant: 'ready', label: 'Verified' }
    case 'TIER_APPROVED':
      return { variant: 'ready', label: 'Tier approved' }
    case 'PENDING':
      return { variant: 'pending', label: 'Pending' }
    case 'REJECTED':
      return { variant: 'danger', label: 'Rejected' }
    default:
      return { variant: 'pending', label: s }
  }
}

/** A store audit's finding. A failure is a fact about a shop, not an error, but it needs acting on. */
export function auditPill(s: string): { variant: PillVariant; label: string } {
  switch (s) {
    case 'PASS':
      return { variant: 'ready', label: 'Passed' }
    case 'FAIL':
      return { variant: 'danger', label: 'Failed' }
    default:
      return { variant: 'pending', label: s }
  }
}

/**
 * Approval standing of a store or courier company.
 *
 * "Awaiting approval" rather than "Pending": pending reads as something the
 * platform is doing to itself, when in fact it is a queue an admin has to work.
 */
export function orgPill(s: string): { variant: PillVariant; label: string } {
  switch (s) {
    case 'ACTIVE':
      return { variant: 'ready', label: 'Active' }
    case 'SUSPENDED':
      return { variant: 'danger', label: 'Suspended' }
    case 'PENDING':
      return { variant: 'pending', label: 'Awaiting approval' }
    default:
      return { variant: 'pending', label: s }
  }
}

/**
 * What became of a fact Mart sent us.
 *
 * DEFERRED is deliberately not styled as a failure. Nothing went wrong: the
 * event was understood and kept, and the work it would create does not exist
 * yet. Colouring it red would send somebody looking for a bug.
 */
export function martEventPill(s: string): { variant: PillVariant; label: string } {
  switch (s) {
    case 'PROCESSED':
      return { variant: 'ready', label: 'Task created' }
    case 'DEFERRED':
      return { variant: 'pending', label: 'Held for replay' }
    case 'IGNORED':
      return { variant: 'review', label: 'No new work' }
    case 'FAILED':
      return { variant: 'danger', label: 'Failed' }
    default:
      return { variant: 'pending', label: s }
  }
}

/** Display pay for a task ("₦2.5k/h" or "₦18k"). */
export function taskPay(rate?: number | null, budget?: number | null, payModel?: string): string {
  if (payModel === 'HOURLY' && rate != null) return `${formatNairaCompact(rate)}/h`
  if (budget != null) return formatNairaCompact(budget)
  if (rate != null) return `${formatNairaCompact(rate)}/h`
  return '—'
}
