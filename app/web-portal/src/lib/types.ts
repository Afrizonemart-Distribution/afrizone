/**
 * Shapes the portal reads. Mirrors the server's own types for the endpoints an
 * outside party may reach - nothing more.
 */

/** What kind of outside party an account is. A separate axis from staff role. */
export type AccountType = 'INDIVIDUAL' | 'STORE' | 'COURIER'

export type OrgKind = 'STORE' | 'COURIER'
export type OrgRole = 'OWNER' | 'STAFF'
export type OrgStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED'

export interface User {
  id: string
  name: string
  email: string
  phone?: string | null
  role: string
  accountType?: AccountType
  kycStatus?: string
}

export interface AuthResponse {
  token?: string
  user?: User
  isNewUser?: boolean
  /** Staff accounts with 2FA get a challenge instead of a session. */
  requires2fa?: boolean
  challenge?: string
}

/** Where a business's CAC registration has got to. */
export type CacStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface Organization {
  id: string
  kind: OrgKind
  name: string
  slug: string
  phone?: string | null
  email?: string | null
  address?: string | null
  bankMasked?: string | null
  bankName?: string | null
  cacNumber?: string | null
  cacStatus?: CacStatus
  /** The name the registry holds, when it was consulted. */
  cacName?: string | null
  cacNote?: string | null
  status: OrgStatus
  myRole?: OrgRole
  /** Returned by the CAC submission, which answers with the updated business. */
  message?: string
}

export interface OrgMember {
  id: string
  userId: string
  role: OrgRole
  name?: string | null
  email?: string | null
}

/* ===== Courier onboarding ===== */

/**
 * WAITING is deliberately distinct from TODO. A rider who has uploaded a
 * document and is waiting on Afrizone has nothing left to do, and showing that
 * as incomplete sends them looking for work that is not theirs.
 */
export type StepState = 'DONE' | 'WAITING' | 'TODO' | 'PROBLEM'

export interface ReadinessStep {
  key: string
  label: string
  state: StepState
  /** Written by the server. No client composes this sentence. */
  detail: string
}

export interface CourierReadiness {
  ready: boolean
  steps: ReadinessStep[]
  /** TODO and PROBLEM steps only - the ones the courier can act on. */
  outstanding: number
  vehicle: { type: string; label: string; plateNumber: string | null } | null
  vehicleTypes: { value: string; label: string; requiresPlate: boolean }[]
}

/* ===== Delivery ===== */

/**
 * Where an AfriZoneMart order has got to.
 *
 * A THIRD AXIS, and not the same thing as a task's status or a contract's. This
 * one belongs to the ORDER: it starts before any courier is involved and can end
 * without one, which is exactly what "the store cannot fulfil" is.
 */
export type DeliveryStatus =
  | 'RECEIVED'
  | 'STORE_ACCEPTED'
  | 'STORE_REJECTED'
  | 'COURIER_ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'

export interface DeliveryItem {
  ref?: string
  name?: string
  qty?: number
}

export interface Delivery {
  id: string
  martOrderId: string
  organizationId: string
  storeName: string | null
  taskId: string | null
  stockSource: 'CONSIGNMENT' | 'OWN_STOCK'
  items: DeliveryItem[]
  pickupAddress: string | null
  pickupLat: number | null
  pickupLng: number | null
  goodsTotal: number
  deliveryFee: number
  expectedBy: string | null
  status: DeliveryStatus
  /** Written by the server. No client composes this phrase. */
  statusLabel: string
  preparedAt: string | null
  storeDecidedAt: string | null
  storeNote: string | null
  assignedAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  failureReason: string | null
  createdAt: string

  /** Only ever sent to the store, the assigned courier, and staff. */
  dropoffAddress: string | null
  dropoffLat: number | null
  dropoffLng: number | null
  dropoffInstructions: string | null
  customerName: string | null
  customerPhone: string | null
  /**
   * True once the seven-day purge has run. Distinct from the fields simply
   * being null: "we deleted this, as promised" and "this order never had a
   * contact" are different facts and an empty field says neither.
   */
  customerPurged: boolean

  contractId?: string | null
  /** Returned by the accept call - the order is accepted either way. */
  posted?: boolean
  warning?: string
}

/** GET /api/public/profiles/:slug: the public cut of a Talent Profile. */
export interface PublicProfile {
  name: string
  headline: string | null
  bio: string | null
  location: string | null
  openTo: string[]
  memberSince: string
  identityVerified: boolean
  workRecord: {
    paidTasks: number
    byCategory: { category: string; count: number }[]
    rating: number | null
    ratingsCount: number
  }
  experience: {
    id: string
    title: string
    company: string
    location: string | null
    startDate: string
    endDate: string | null
    description: string | null
  }[]
  education: {
    id: string
    institution: string
    qualification: string
    field: string | null
    startYear: number | null
    endYear: number | null
  }[]
  portfolio: { id: string; title: string; description: string | null; url: string | null }[]
  skills: { name: string; group: string | null; years: number | null }[]
  credentials: {
    id: string
    title: string
    type: string
    issuer: string | null
    issuedAt: string | null
    expiresAt: string | null
    verified: boolean
  }[]
}
