// TS types mirroring API_CONTRACT.md entities & responses.

export type Role = 'SUPER_ADMIN' | 'TASK_MANAGER' | 'HR_ADMIN' | 'WORKER'
export type Tier = 'STUDENT' | 'DISPATCH' | 'REMOTE' | 'PROMO' | 'TRADE'
export type KycStatus = 'PENDING' | 'VERIFIED' | 'TIER_APPROVED' | 'REJECTED'
export type PayModel = 'HOURLY' | 'FIXED'
export type LocationType = 'PHYSICAL' | 'REMOTE'
export type TaskStatus = 'OPEN' | 'FILLED' | 'CLOSED' | 'ARCHIVED'
export type AppStatus = 'APPLIED' | 'APPROVED' | 'REJECTED'
export type DisputeStatus = 'OPEN' | 'RESOLVED' | 'CLOSED'
export type DisputeEntityType = 'PAYMENT' | 'TIMESHEET'
export type TimesheetStatus = 'SUBMITTED' | 'APPROVED' | 'DISPUTED'
export type PaymentStatus = 'PENDING' | 'APPROVED' | 'RELEASED' | 'DISPUTED'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  tiers: Tier[]
  kycStatus: KycStatus
  location?: string | null
  rating?: number | null
  completedCount: number
  bankMasked?: string | null
  createdAt?: string
  /** whether the admin account has TOTP 2FA enabled */
  totpEnabled?: boolean
}

export interface Task {
  id: string
  title: string
  description: string
  category: string
  tier: Tier
  payModel: PayModel
  rate?: number | null
  budget?: number | null
  startDate: string
  endDate: string
  locationType: LocationType
  address?: string | null
  lat?: number | null
  lng?: number | null
  geofenceRadius?: number
  slots: number
  status: TaskStatus
  deadline: string
  createdById?: string
  createdAt?: string
  // augmented by GET /api/tasks
  filledCount?: number
  applicantCount?: number
  requiresIdentityVerified?: boolean
  /**
   * Denormalised one-line summary for cards. Display only - it is never used to
   * decide anything, because a stale string on a card is harmless and a wrong
   * reason shown to a worker is not.
   */
  requirementsSummary?: string | null
  requirements?: TaskRequirements
  /** Always null for an admin: a verdict computed against an admin account is noise. */
  eligibility?: Eligibility | null
}

/**
 * STORE fulfils AfriZoneMart orders, COURIER delivers them. One model, because
 * both need the same membership, approval and payout structure - what differs
 * is the work they receive.
 *
 * An individual courier has NO organization: they are a plain worker with
 * accountType COURIER. Do not assume every courier appears on this screen.
 */
export type OrgKind = 'STORE' | 'COURIER'
export type OrgRole = 'OWNER' | 'STAFF'
export type OrgStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED'

export interface Organization {
  id: string
  kind: OrgKind
  name: string
  slug: string
  phone?: string | null
  email?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  /** Full number is returned to admins; bankMasked is what screens display. */
  bankAccountNumber?: string | null
  bankMasked?: string | null
  bankCode?: string | null
  bankName?: string | null
  tin?: string | null
  /**
   * CAC registration - Nigeria's company registry.
   *
   * `cacStatus` gates nothing today. It is a verification recorded against the
   * business, not a condition of trading, and stores are live in the pilot
   * without a number.
   */
  cacNumber?: string | null
  cacStatus?: CacStatus
  /** The name the registry returned, when one was consulted. */
  cacName?: string | null
  cacCheckedAt?: string | null
  cacNote?: string | null
  status: OrgStatus
  createdAt?: string
  /** Added by the admin list endpoint. */
  memberCount?: number
  /** Added by the admin detail endpoint. */
  members?: OrgMember[]
}

export interface OrgMember {
  id: string
  userId: string
  role: OrgRole
  createdAt?: string
  name?: string | null
  email?: string | null
  phone?: string | null
}

export type CacStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'

export interface CreateOrgBody {
  name: string
  kind: OrgKind
  slug?: string
  phone?: string
  email?: string
  address?: string
  bankAccountNumber?: string
  bankCode?: string
  bankName?: string
  tin?: string
  /** Optional: seeds the first OWNER. An org with no owner is unmanageable. */
  ownerEmail?: string
}

export interface TaskRequirements {
  requiresIdentityVerified: boolean
  skills: { id: string; name: string }[]
  credentialTypes: { id: string; name: string }[]
  version: number
}

export type BlockerCode =
  | 'TIER'
  | 'IDENTITY'
  | 'SKILL'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_PENDING'
  | 'CREDENTIAL_EXPIRED'

export interface Blocker {
  code: BlockerCode
  ref: string | null
  /** Already worker-facing. Render it as-is; do not re-word it here. */
  message: string
  fix: 'skills' | 'credentials' | 'kyc' | null
}

export interface Eligibility {
  eligible: boolean
  blockers: Blocker[]
  met: string[]
  checks: number
}

/** What POST /api/tasks accepts, which is a Task plus the requirement ids. */
export interface CreateTaskBody extends Partial<Task> {
  skillIds?: string[]
  credentialTypeIds?: string[]
}

/**
 * The answer to "how many workers could actually take this?", asked while the
 * task is still being written.
 */
export interface QualifyingCount {
  total: number
  /** Workers in the chosen tier. The honest denominator for the requirements. */
  inTier: number
  qualifying: number
  blockedBy: { label: string; count: number }[]
}

export interface WorkerSummary {
  id: string
  name: string
  tiers?: Tier[]
  kycStatus?: KycStatus
  rating?: number | null
}

export interface TaskSummary {
  id: string
  title: string
}

export interface Application {
  id: string
  taskId: string
  workerId: string
  pitch?: string | null
  status: AppStatus
  reason?: string | null
  createdAt?: string
  worker?: WorkerSummary
  task?: TaskSummary
}

export interface Timesheet {
  id: string
  taskId: string
  workerId: string
  periodStart: string
  periodEnd: string
  hours: number
  status: TimesheetStatus
  gpsNote?: string | null
  createdAt?: string
  slaHoursLeft?: number
  worker?: WorkerSummary
  task?: TaskSummary
}

export interface Payment {
  id: string
  workerId: string
  taskId: string
  gross: number
  whtRate: number
  whtAmount: number
  net: number
  status: PaymentStatus
  createdAt?: string
  worker?: WorkerSummary
  task?: TaskSummary
}

export interface Worker {
  id: string
  name: string
  email: string
  tiers: Tier[]
  kycStatus: KycStatus
  completedCount: number
  rating?: number | null
}

export interface WorkerDetail extends Worker {
  applications?: Application[]
  /**
   * Set for couriers. Present so a reviewer looking at a vehicle registration
   * can see which vehicle it is claimed for - the document and the plate on it
   * are otherwise two facts nobody can put side by side.
   */
  courier?: { vehicleType: string; label: string; plateNumber: string | null } | null
}

export type KycDocType = 'ID' | 'SELFIE' | 'DOCS'

export interface KycDocument {
  id: string
  docType: KycDocType
  filename: string
  originalName: string
  mimeType: string
  url: string
  createdAt?: string
}

export interface SpendByCategory {
  label: string
  value: number
  tone?: string
}

export interface DashboardUrgent {
  type: string
  title: string
  sub: string
  count: number
}

export interface DashboardActivity {
  icon: string
  title: string
  sub: string
  ago: string
}

export interface DashboardStats {
  activeTasks: number
  fillRate: number
  avgTimeToFillHours: number
  spendThisMonth: number
  budgetThisMonth: number
  spendByCategory: SpendByCategory[]
  fill: { filled: number; open: number }
  urgent: DashboardUrgent[]
  activity: DashboardActivity[]
}

/** Full authentication success: a JWT plus the user record. */
export interface AuthSuccess {
  token: string
  user: User
}

/** Returned by /auth/login when the account has 2FA enabled. */
export interface TwoFactorRequired {
  requires2fa: true
  /** short-lived (~5 min) 2FA challenge JWT: not a full session token */
  challenge: string
}

/** /auth/login may return a full session OR a 2FA challenge. */
export type LoginResponse = AuthSuccess | TwoFactorRequired

export function isTwoFactorRequired(r: LoginResponse): r is TwoFactorRequired {
  return (r as TwoFactorRequired).requires2fa === true
}

/** /auth/2fa/setup: pending secret + provisioning material. */
export interface TwoFactorSetup {
  otpauthUrl: string
  qrDataUrl: string
  secret: string
}

/** /auth/2fa/enable and /auth/2fa/disable. */
export interface TwoFactorStatus {
  enabled: boolean
}

/** /auth/password/forgot: never enumerates accounts. */
export interface PasswordForgotResponse {
  sent: true
  /** only present in sim/dev mode */
  devToken?: string
}

/** /auth/password/reset. */
export interface PasswordResetResponse {
  ok: true
}

export interface SearchResults {
  tasks: { id: string; title: string; status: TaskStatus; category: string }[]
  workers: { id: string; name: string; email: string; kycStatus: KycStatus }[]
}

export interface Dispute {
  id: string
  workerId: string
  entityType: DisputeEntityType
  entityId: string
  reason: string
  status: DisputeStatus
  resolution?: string | null
  createdAt?: string
  updatedAt?: string
  worker?: { id: string; name: string }
  entity?: { title: string; gross?: number; net?: number } | null
}

export interface ReleaseAllResponse {
  released: number
  totalNet: number
}

// ===== v2: Hiring, Reports, Settings =====

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT'
export type JobStatus = 'OPEN' | 'CLOSED'
export type Stage = 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED'

export interface Job {
  id: string
  title: string
  department: string
  location: string
  employmentType: EmploymentType
  salaryMin?: number | null
  salaryMax?: number | null
  description: string
  needsCv?: boolean
  needsCover?: boolean
  needsPortfolio?: boolean
  closingDate: string
  status: JobStatus
  createdById?: string
  createdAt?: string
  // augmented by GET /api/jobs
  candidateCount?: number
}

export interface JobSummary {
  id: string
  title: string
}

export interface Candidate {
  id: string
  jobId: string
  name: string
  email: string
  phone?: string | null
  stage: Stage
  cvNote?: string | null
  rating?: number | null
  createdAt?: string
  updatedAt?: string
  job?: JobSummary
}

export interface TaxRate {
  id: string
  jurisdiction: string
  category: string
  whtRate: number
  vatRate: number
  active: boolean
}

export interface Category {
  id: string
  name: string
  tier: Tier
  defaultPayModel: PayModel
  active: boolean
}

export interface Template {
  key: string
  value: string
}

export interface HealthConfig {
  ready: boolean
  criticalIssues: string[]
  services: {
    paystack: { ok: boolean; mode: 'live' | 'simulated'; note: string }
    [key: string]: unknown
  }
}

export interface Funding {
  id: string
  amount: number
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  provider: 'paystack' | 'simulated' | null
  reference: string
  providerRef: string | null
  initiatedBy: string
  createdAt: string
  admin: { id: string; name: string }
  simulated?: boolean
  authorizationUrl?: string
}

/** A point in a rolling six-month series. `month` is the short label ("Jan");
 *  `monthStart` is the unambiguous calendar date (YYYY-MM-01) a time axis needs,
 *  since the window crosses a year boundary. */
interface MonthPoint {
  month: string
  monthStart: string
}

export interface ReportsSummary {
  spendByMonth: (MonthPoint & { spend: number })[]
  spendByCategory: { label: string; amount: number; pct: number }[]
  spendByDepartment: { label: string; amount: number }[]
  tax: { whtCollected: number; vatCollected: number; remittedToFirs: number }
  fillRateTrend: (MonthPoint & { rate: number })[]
  payrollEquivalent: {
    grossPaid: number
    totalWht: number
    netPaid: number
    workersPaid: number
  }
  topCategories: { label: string; tasks: number; spend: number }[]
}

// ── Talent profile: skills and credentials ───────────────────────────────────

export interface Skill {
  id: string
  name: string
  slug: string
  group: string
  active: boolean
  sortOrder: number
}

export type ReviewMode = 'ADMIN_REVIEW' | 'SELF_DECLARED'
export type IssuerMode = 'THIRD_PARTY' | 'AFRIZONE'

export interface CredentialType {
  id: string
  name: string
  slug: string
  reviewMode: ReviewMode
  issuerMode: IssuerMode
  requiresExpiry: boolean
  requiresReference: boolean
  requiresFile: boolean
  issuerHint: string | null
  active: boolean
  sortOrder: number
}

/**
 * `status` is what is stored; `state` is what to show.
 *
 * They differ for two cases the server derives rather than stores: a VERIFIED
 * credential past its expiry reads as EXPIRED, and a self-declared one reads
 * as SELF_DECLARED rather than pretending to be awaiting review. Render
 * `state`, never `status`.
 */
export type CredentialState =
  | 'PENDING'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'REVOKED'
  | 'SELF_DECLARED'

export interface Credential {
  id: string
  title: string
  issuer: string | null
  referenceNumber: string | null
  issuedAt: string | null
  expiresAt: string | null
  status: string
  state: CredentialState
  valid: boolean
  expiringSoon: boolean
  rejectionReason: string | null
  reviewedAt: string | null
  reviewedBy?: { id: string; name: string } | null
  createdAt: string
  credentialType: CredentialType
  worker?: {
    id: string
    name: string
    email: string
    phone: string | null
    kycStatus: string
    tiers: string[]
  }
  document?: {
    id: string
    filename: string
    mimeType: string | null
    originalName: string | null
  } | null
}

/** GET /api/credentials/:id — everything the reviewer needs on one screen. */
export interface CredentialDetail extends Credential {
  otherCredentials: Credential[]
  /**
   * Set when this reference number is already VERIFIED on a different worker -
   * the signature of a document being passed around. A warning for the
   * reviewer to weigh, never an automatic refusal.
   */
  duplicateOf: { workerId: string; workerName: string } | null
  /**
   * The vehicle this courier declared, on the three credential types that are
   * about one. Present so the plate on the paper can be compared with the plate
   * on the account without leaving the screen - a reviewer sent elsewhere to
   * find it will not go.
   */
  courier?: { vehicleType: string; label: string; plateNumber: string | null } | null
}

export type CredentialFilter = 'pending' | 'verified' | 'rejected' | 'revoked' | 'expiring'

export type RejectionReasonCode =
  | 'blurry'
  | 'expired'
  | 'name_mismatch'
  | 'wrong_type'
  | 'not_genuine'
  | 'other'

export interface CredentialCorrections {
  title?: string
  issuer?: string | null
  referenceNumber?: string | null
  issuedAt?: string | null
  expiresAt?: string | null
}

/* ===== AfriZoneMart integration (Blueprint §5) ===== */

export type MartEventStatus = 'PROCESSED' | 'DEFERRED' | 'IGNORED' | 'FAILED'

/** One fact Mart told us, and what we did about it. */
export interface MartEvent {
  id: string
  eventId: string
  type: string
  status: MartEventStatus
  taskId: string | null
  note: string | null
  occurredAt: string
  receivedAt: string
}

export interface MartEventsResponse {
  /** Tallied across every row, not the returned page - the deferred backlog is the number that matters and it is rarely on page one. */
  counts: Partial<Record<MartEventStatus, number>>
  events: MartEvent[]
}

/** What a generator will do with the next event of a given kind. */
export interface TaskRule {
  fee: number
  tier: string
  credentialSlug: string
  windowDays: number
  requiresIdentityVerified: boolean
}

export type TaskRules = Record<string, TaskRule>

/**
 * The delivery offer knobs (MART_INTEGRATION.md §6 D4).
 *
 * Its own block rather than fields on TaskRule: a claim radius means nothing
 * for a remote media task, and folding it in would put dead fields on four
 * cards. Same `rules.DELIVERY.*` prefix, separate concern.
 */
export interface DeliveryOfferRule {
  selfClaim: boolean
  baseRadiusMetres: number
  stepMinutes: number
  maxRadiusMetres: number
  escalateAfterMinutes: number
  /** How many of the best-placed online couriers get it to themselves first. 0 = off. */
  rankedCandidates: number
  /** How long each of them has it. */
  rankedWindowMinutes: number
}

/* ===== Proof of work (server: services/evidence.ts) ===== */
export interface EvidenceItem {
  id: string
  taskId: string
  workerId: string
  stage: string
  stageLabel: string
  /** Behind auth: load with fetchAuthedObjectUrl. */
  url: string
  lat: number | null
  lng: number | null
  accuracyMetres: number | null
  capturedAt: string | null
  receivedAt: string
  distanceMetres: number | null
  distance: string | null
  /** The server's sentences, one per failed check. */
  flags: string[]
  flagged: boolean
}

/** A signature taken at a handover, drawn from its SVG path data. */
export interface SignatureItem {
  id: string
  taskId: string
  workerId: string
  stage: string
  stageLabel: string
  signerName: string
  /** SVG path data, M/L/Q/C/Z and numbers only (the server refuses anything else). */
  path: string
  width: number
  height: number
  lat: number | null
  lng: number | null
  capturedAt: string | null
  receivedAt: string
  distance: string | null
  flags: string[]
  flagged: boolean
}

export interface EvidenceReview {
  requirements: { stage: string; count: number; label: string; signature?: boolean; signer?: string | null }[]
  evidence: EvidenceItem[]
  signatures?: SignatureItem[]
  flaggedCount: number
}

export interface MartRules {
  kinds: TaskRules
  offer: DeliveryOfferRule
}

/* ===== Deliveries ===== */

/**
 * Where one AfriZoneMart order has got to.
 *
 * A THIRD status axis, and not interchangeable with the other two. `TaskStatus`
 * is the posting and a contract's status is one courier's engagement with it;
 * this one belongs to the ORDER, starts before any courier exists and can end
 * without one - which is exactly what "the store cannot fulfil" is.
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
  /** CONSIGNMENT owes the store nothing extra; OWN_STOCK is a settlement line. */
  stockSource: 'CONSIGNMENT' | 'OWN_STOCK'
  items: DeliveryItem[]
  pickupAddress: string | null
  pickupLat: number | null
  pickupLng: number | null
  goodsTotal: number
  /** What MART charged the customer. NOT what the courier is paid. */
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

  dropoffAddress: string | null
  dropoffLat: number | null
  dropoffLng: number | null
  dropoffInstructions: string | null
  customerName: string | null
  customerPhone: string | null
  /** True once the seven-day purge has run - not the same as never having had one. */
  customerPurged: boolean
  /**
   * Where this order stands in the offer to couriers (MART_INTEGRATION.md §6
   * D4), or null when it is not on the board - already taken, not yet accepted,
   * or finished. Derived by the server from how long the posting has waited, so
   * it is current at the moment it was read rather than as of some sweep.
   */
  offer: OfferState | null
}

export type OfferStage = 'RANKED' | 'OFFERED' | 'WIDENED' | 'ESCALATED'

export interface OfferState {
  stage: OfferStage
  /** The circle the posting is currently open in, in metres. */
  radiusMetres: number
  waitingMinutes: number
  widenings: number
  atMaxRadius: boolean
  escalated: boolean
  /** The server writes this. No screen composes it. */
  label: string
}

export interface DeliveriesResponse {
  /**
   * Whether MART_BASE_URL and MART_OUTBOUND_SECRET are set. An operator looking
   * at an order that will not complete needs to tell an unconfigured verifier
   * apart from a courier problem.
   */
  martConfigured: boolean
  /**
   * False when an admin has switched self-claim off. Every delivery is then
   * waiting on an approval, which is worth knowing before chasing couriers who
   * are not being offered anything.
   */
  selfClaim: boolean
  /**
   * Unclaimed orders past the escalation threshold, across the WHOLE board
   * rather than the current filter - so a filtered view cannot report nothing
   * is escalated because the escalated ones are on another page.
   */
  escalatedCount: number
  deliveries: Delivery[]
}

export interface DeliveryCourier {
  contractId: string
  status: string
  workerId: string
  name: string | null
  phone: string | null
}

export interface DeliveryDetail extends Delivery {
  task: { id: string; title: string; status: string } | null
  couriers: DeliveryCourier[]
  trail: { id: string; action: string; createdAt: string; meta: string | null }[]
}

/** Whether the seven-day customer-data deletion is actually being kept. */
export interface PurgeStatus {
  due: number
  purgedTotal: number
  oldestDue: string | null
  /** Null means it has never run - which is a different problem from a backlog. */
  lastRunAt: string | null
  cutoff: string
  retentionDays: number
}

/* ===== Store network map (Blueprint §8) ===== */

/** One approved business, as something to travel to. */
export interface MapNode {
  id: string
  kind: OrgKind
  name: string
  slug: string
  address: string | null
  lat: number
  lng: number
  /** Null unless the request carried a reference point. */
  distanceMetres: number | null
  distance: string | null
}

export interface OrgMap {
  count: number
  /**
   * Approved businesses the map cannot show, because nobody set their
   * coordinates. Counted separately so "not approved yet" stays distinguishable
   * from "approved but unplaceable" - they need different people to fix them.
   */
  unplaced: number
  nodes: MapNode[]
}
