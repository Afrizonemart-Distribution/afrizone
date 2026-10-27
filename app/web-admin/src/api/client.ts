// Small typed fetch wrapper. Injects the JWT from localStorage and hits /api.
// In dev, Vite proxies /api -> http://localhost:4000 (VITE_API_URL unset).
// In production (frontend + API on separate domains), set VITE_API_URL to
// the API's origin, e.g. https://api.afrizoneparttime.com

import type {
  Application,
  AppStatus,
  AuthSuccess,
  EvidenceReview,
  Candidate,
  Category,
  DashboardStats,
  Dispute,
  AuditOutcome,
  AuditResults,
  DisputeStatus,
  Funding,
  HealthConfig,
  Job,
  KycDocument,
  LoginResponse,
  PasswordForgotResponse,
  PasswordResetResponse,
  Payment,
  PaymentStatus,
  ReleaseAllResponse,
  ReportsSummary,
  SearchResults,
  Stage,
  Tier,
  Task,
  Organization,
  OrgKind,
  OrgStatus,
  CreateOrgBody,
  CreateTaskBody,
  QualifyingCount,
  TaxRate,
  Template,
  Timesheet,
  TimesheetStatus,
  TwoFactorSetup,
  TwoFactorStatus,
  User,
  Worker,
  WorkerDetail,
  Skill,
  CredentialType,
  Credential,
  CredentialDetail,
  CredentialFilter,
  RejectionReasonCode,
  CredentialCorrections,
  MartEventsResponse,
  OrgMap,
  CacStatus,
  MartEventStatus,
  MartRules,
  Delivery,
  DeliveryDetail,
  DeliveryStatus,
  DeliveriesResponse,
  PurgeStatus,
} from './types'

const TOKEN_KEY = 'afz_token'
export const API_ORIGIN: string = import.meta.env.VITE_API_URL ?? ''
const API_BASE = `${API_ORIGIN}/api`

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  /**
   * The parsed error body, when there was one.
   *
   * `message` is the headline and is enough for almost every call site. Some
   * refusals carry structure the caller has to act on rather than print - the
   * requirements gate returns the list of blockers and a requiresOverride flag,
   * and an admin cannot be offered "approve anyway" for reasons that were
   * flattened into a sentence on the way here.
   */
  body: unknown
  constructor(message: string, status: number, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  // when true, a 401 will not be treated specially by callers
  signal?: AbortSignal
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
    signal: opts.signal,
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new ApiError(
      'Cannot reach the API. Is the backend running on http://localhost:4000?',
      0,
    )
  }

  if (res.status === 204) {
    return undefined as T
  }

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) ?? `Request failed (${res.status})`
    throw new ApiError(msg, res.status, data)
  }

  return data as T
}

/**
 * Fetches a binary resource (e.g. a KYC document image) with the same auth
 * header `request()` uses, and returns an object URL for it. Needed because
 * `<img src>` can't send an Authorization header itself, and the KYC file
 * route requires one (it's ownership-checked, not a public URL). Caller owns
 * the returned URL and must revoke it (`URL.revokeObjectURL`) when done.
 */
export async function fetchAuthedObjectUrl(
  path: string,
): Promise<{ url: string; type: string }> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_ORIGIN}${path}`, { headers })
  if (!res.ok) {
    throw new ApiError(`Could not load file (${res.status})`, res.status)
  }
  const blob = await res.blob()
  // The type comes back so the caller can decide how to render: documents may
  // now be PDFs (CVs, certificates), not only photographs, and an <img> tag
  // renders a PDF as a broken image. The server re-validates this type before
  // serving, so it is one of a known-safe set rather than whatever was
  // uploaded.
  return { url: URL.createObjectURL(blob), type: blob.type }
}

// ===== typed endpoint helpers =====
export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request<{ user: User }>('/auth/me'),

  // Auth: 2FA
  twoFactorVerify: (challenge: string, code: string) =>
    request<AuthSuccess>('/auth/2fa/verify', {
      method: 'POST',
      body: { challenge, code },
    }),
  twoFactorSetup: () =>
    request<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code: string) =>
    request<TwoFactorStatus>('/auth/2fa/enable', { method: 'POST', body: { code } }),
  twoFactorDisable: (code: string) =>
    request<TwoFactorStatus>('/auth/2fa/disable', { method: 'POST', body: { code } }),

  // Auth: Google SSO. May throw ApiError(503) when not configured.
  googleSignIn: (idToken: string) =>
    request<AuthSuccess>('/auth/google', { method: 'POST', body: { idToken } }),

  // Auth: password reset
  passwordForgot: (email: string) =>
    request<PasswordForgotResponse>('/auth/password/forgot', {
      method: 'POST',
      body: { email },
    }),
  passwordReset: (token: string, password: string) =>
    request<PasswordResetResponse>('/auth/password/reset', {
      method: 'POST',
      body: { token, password },
    }),

  // Search
  search: (q: string, signal?: AbortSignal) =>
    request<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { signal }),

  // Dashboard
  dashboardStats: (signal?: AbortSignal) =>
    request<DashboardStats>('/dashboard/stats', { signal }),

  // Tasks
  tasks: (signal?: AbortSignal) => request<Task[]>('/tasks', { signal }),
  createTask: (body: CreateTaskBody) =>
    request<Task>('/tasks', { method: 'POST', body }),
  updateTask: (id: string, body: CreateTaskBody) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body }),
  /**
   * How many workers a set of requirements would leave, for a task that does
   * not exist yet. Called as the form is edited, so the trade-off is visible at
   * the moment it is being made rather than a week later as an empty applicant
   * list.
   */
  qualifyingCount: (
    body: {
      tier: Tier
      requiresIdentityVerified?: boolean
      skillIds?: string[]
      credentialTypeIds?: string[]
    },
    signal?: AbortSignal,
  ) => request<QualifyingCount>('/tasks/qualifying-count', { method: 'POST', body, signal }),
  task: (id: string, signal?: AbortSignal) =>
    request<Task & { applications: Application[] }>(`/tasks/${id}`, { signal }),

  // Organizations (stores and courier companies)
  //
  // Admin-only endpoints. The member-facing /api/organizations is the mobile
  // app's, and deliberately returns only what the caller belongs to.
  organizations: (
    filter: { kind?: OrgKind; status?: OrgStatus; cacStatus?: CacStatus } = {},
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams()
    if (filter.kind) q.set('kind', filter.kind)
    if (filter.status) q.set('status', filter.status)
    if (filter.cacStatus) q.set('cacStatus', filter.cacStatus)
    const qs = q.toString()
    return request<Organization[]>(`/admin/organizations${qs ? `?${qs}` : ''}`, { signal })
  },
  organization: (id: string, signal?: AbortSignal) =>
    request<Organization>(`/admin/organizations/${id}`, { signal }),
  createOrganization: (body: CreateOrgBody) =>
    request<Organization>('/admin/organizations', { method: 'POST', body }),
  updateOrganization: (id: string, body: Partial<CreateOrgBody> & { status?: OrgStatus }) =>
    request<Organization>(`/admin/organizations/${id}`, { method: 'PATCH', body }),

  // Applications
  applications: (status?: AppStatus, signal?: AbortSignal) =>
    request<Application[]>(
      `/applications${status ? `?status=${status}` : ''}`,
      { signal },
    ),
  /**
   * `override` is how an admin approves someone the requirements gate refuses.
   * Sent only after they confirm: the server audits the override, and an
   * override nobody chose would be an audit entry nobody can explain.
   */
  approveApplication: (id: string, override = false) =>
    request<Application>(`/applications/${id}/approve`, {
      method: 'POST',
      body: override ? { override: true } : undefined,
    }),
  rejectApplication: (id: string, reason: string) =>
    request<Application>(`/applications/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),

  // Timesheets
  timesheets: (status?: TimesheetStatus, signal?: AbortSignal) =>
    request<Timesheet[]>(
      `/timesheets${status ? `?status=${status}` : ''}`,
      { signal },
    ),
  /** The photos behind a job, for review. */
  evidence: (taskId: string, workerId?: string) =>
    request<EvidenceReview>(
      `/admin/evidence?taskId=${encodeURIComponent(taskId)}${workerId ? `&workerId=${encodeURIComponent(workerId)}` : ''}`,
    ),
  approveTimesheet: (id: string) =>
    request<Timesheet>(`/timesheets/${id}/approve`, { method: 'POST' }),
  disputeTimesheet: (id: string, reason: string) =>
    request<Timesheet>(`/timesheets/${id}/dispute`, {
      method: 'POST',
      body: { reason },
    }),

  // Payments
  payments: (status?: PaymentStatus, signal?: AbortSignal) =>
    request<Payment[]>(
      `/payments${status ? `?status=${status}` : ''}`,
      { signal },
    ),
  releasePayment: (id: string) =>
    request<Payment>(`/payments/${id}/release`, { method: 'POST' }),
  releaseAll: () =>
    request<ReleaseAllResponse>('/payments/release-all', { method: 'POST' }),

  // Workers
  workers: (signal?: AbortSignal) => request<Worker[]>('/workers', { signal }),
  workerDetail: (id: string, signal?: AbortSignal) =>
    request<WorkerDetail>(`/workers/${id}`, { signal }),
  reviewKyc: (id: string, decision: 'TIER_APPROVED' | 'REJECTED') =>
    request<Worker>(`/workers/${id}/kyc`, { method: 'POST', body: { decision } }),
  workerKycDocuments: (id: string, signal?: AbortSignal) =>
    request<KycDocument[]>(`/workers/${id}/kyc/documents`, { signal }),
  rateWorker: (id: string, body: { taskId: string; score: number; note?: string }) =>
    request<{ id: string; rating: number | null; completedCount: number }>(
      `/workers/${id}/rate`,
      { method: 'POST', body },
    ),

  // ===== v2: Hiring =====
  jobs: (signal?: AbortSignal) => request<Job[]>('/jobs', { signal }),
  createJob: (body: Partial<Job>) =>
    request<Job>('/jobs', { method: 'POST', body }),
  job: (id: string, signal?: AbortSignal) =>
    request<Job & { candidates: Candidate[] }>(`/jobs/${id}`, { signal }),
  patchJob: (id: string, body: Partial<Job>) =>
    request<Job>(`/jobs/${id}`, { method: 'PATCH', body }),
  candidates: (jobId?: string, signal?: AbortSignal) =>
    request<Candidate[]>(
      `/candidates${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`,
      { signal },
    ),
  createCandidate: (body: {
    jobId: string
    name: string
    email: string
    phone?: string
    cvNote?: string
  }) => request<Candidate>('/candidates', { method: 'POST', body }),
  moveCandidate: (id: string, stage: Stage) =>
    request<Candidate>(`/candidates/${id}/move`, { method: 'POST', body: { stage } }),

  // Store audit findings (admin)
  audits: (outcome?: AuditOutcome | 'ALL', signal?: AbortSignal) =>
    request<AuditResults>(`/admin/audits${outcome && outcome !== 'ALL' ? `?outcome=${outcome}` : ''}`, { signal }),

  // Disputes (admin)
  disputes: (status?: DisputeStatus | 'ALL', signal?: AbortSignal) =>
    request<Dispute[]>(
      `/disputes${status && status !== 'ALL' ? `?status=${status}` : ''}`,
      { signal },
    ),
  resolveDispute: (id: string, status: 'RESOLVED' | 'CLOSED', resolution?: string) =>
    request<Dispute>(`/disputes/${id}`, { method: 'PATCH', body: { status, resolution } }),

  // ===== v2: Reports =====
  reportsSummary: (signal?: AbortSignal) =>
    request<ReportsSummary>('/reports/summary', { signal }),

  healthConfig: (signal?: AbortSignal) => request<HealthConfig>('/health/config', { signal }),

  // ===== Platform funding (admin) =====
  fundingBalance: (signal?: AbortSignal) =>
    request<{ balance: number }>('/admin/funding/balance', { signal }),
  fundingHistory: (signal?: AbortSignal) =>
    request<Funding[]>('/admin/funding', { signal }),
  initializeFunding: (amount: number) =>
    request<Funding>('/admin/funding/initialize', { method: 'POST', body: { amount } }),
  devSettleFunding: () =>
    request<{ settled: number }>('/admin/funding/dev/settle', { method: 'POST' }),

  // ===== v2: Settings =====
  taxRates: (signal?: AbortSignal) =>
    request<TaxRate[]>('/settings/tax-rates', { signal }),
  createTaxRate: (body: Partial<TaxRate>) =>
    request<TaxRate>('/settings/tax-rates', { method: 'POST', body }),
  patchTaxRate: (id: string, body: Partial<TaxRate>) =>
    request<TaxRate>(`/settings/tax-rates/${id}`, { method: 'PATCH', body }),
  categories: (signal?: AbortSignal) =>
    request<Category[]>('/settings/categories', { signal }),
  createCategory: (body: Partial<Category>) =>
    request<Category>('/settings/categories', { method: 'POST', body }),
  patchCategory: (id: string, body: Partial<Category>) =>
    request<Category>(`/settings/categories/${id}`, { method: 'PATCH', body }),
  // ── Talent profile ─────────────────────────────────────────────────────────
  skills: (all = false, signal?: AbortSignal) =>
    request<Skill[]>(`/settings/skills${all ? '?all=1' : ''}`, { signal }),
  createSkill: (body: Partial<Skill>) =>
    request<Skill>('/settings/skills', { method: 'POST', body }),
  patchSkill: (id: string, body: Partial<Skill>) =>
    request<Skill>(`/settings/skills/${id}`, { method: 'PATCH', body }),

  credentialTypes: (all = false, signal?: AbortSignal) =>
    request<CredentialType[]>(`/settings/credential-types${all ? '?all=1' : ''}`, { signal }),
  createCredentialType: (body: Partial<CredentialType>) =>
    request<CredentialType>('/settings/credential-types', { method: 'POST', body }),
  patchCredentialType: (id: string, body: Partial<CredentialType>) =>
    request<CredentialType>(`/settings/credential-types/${id}`, { method: 'PATCH', body }),

  credentials: (filter: CredentialFilter, signal?: AbortSignal) =>
    request<Credential[]>(`/credentials?filter=${filter}`, { signal }),
  credentialPendingCount: (signal?: AbortSignal) =>
    request<{ pending: number }>('/credentials/pending-count', { signal }),
  credential: (id: string, signal?: AbortSignal) =>
    request<CredentialDetail>(`/credentials/${id}`, { signal }),
  reviewCredential: (
    id: string,
    body:
      | { decision: 'APPROVE'; corrections?: CredentialCorrections }
      | { decision: 'REJECT' | 'REVOKE'; reasonCode: RejectionReasonCode; reasonText?: string },
  ) => request<Credential>(`/credentials/${id}/review`, { method: 'POST', body }),

  workerProfile: (id: string, signal?: AbortSignal) =>
    request<any>(`/workers/${id}/profile`, { signal }),
  setWorkerTiers: (id: string, tiers: string[]) =>
    request<any>(`/workers/${id}/tiers`, { method: 'PATCH', body: { tiers } }),
  grantCredential: (workerId: string, body: { credentialTypeId: string; title?: string; expiresAt?: string; note?: string }) =>
    request<Credential>(`/workers/${workerId}/credentials`, { method: 'POST', body }),

  templates: (signal?: AbortSignal) =>
    request<Template[]>('/settings/templates', { signal }),
  putTemplate: (key: string, value: string) =>
    request<Template>(`/settings/templates/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value },
    }),

  // ===== AfriZoneMart integration =====
  martEvents: (
    filter: { status?: MartEventStatus | 'ALL'; type?: string | 'ALL' },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams()
    if (filter.status && filter.status !== 'ALL') q.set('status', filter.status)
    if (filter.type && filter.type !== 'ALL') q.set('type', filter.type)
    const qs = q.toString()
    return request<MartEventsResponse>(`/admin/mart/events${qs ? `?${qs}` : ''}`, { signal })
  },
  martRules: (signal?: AbortSignal) => request<MartRules>('/admin/mart/rules', { signal }),

  // ===== Deliveries =====
  /**
   * `stuck` narrows to orders that are live and waiting on somebody.
   * `escalated` narrows further, to unclaimed postings that have waited past
   * the threshold in `rules.DELIVERY.escalateAfterMinutes` - MART_INTEGRATION.md
   * §6 D4, the point at which the widening circle has done all it can and a
   * person has to.
   */
  deliveries: (
    filter: {
      status?: DeliveryStatus | 'ALL'
      storeId?: string
      stuck?: boolean
      escalated?: boolean
    },
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams()
    if (filter.status && filter.status !== 'ALL') q.set('status', filter.status)
    if (filter.storeId) q.set('storeId', filter.storeId)
    if (filter.stuck) q.set('stuck', '1')
    if (filter.escalated) q.set('escalated', '1')
    const qs = q.toString()
    return request<DeliveriesResponse>(`/admin/deliveries${qs ? `?${qs}` : ''}`, { signal })
  },
  delivery: (id: string, signal?: AbortSignal) =>
    request<DeliveryDetail>(`/admin/deliveries/${id}`, { signal }),
  /** Terminal, and a reason is required. Mart is not told - see §4. */
  cancelDelivery: (id: string, reason: string) =>
    request<Delivery>(`/admin/deliveries/${id}/cancel`, { method: 'POST', body: { reason } }),
  /** The courier vanished: put the posting back on the board. */
  reopenDelivery: (id: string, reason: string) =>
    request<Delivery>(`/admin/deliveries/${id}/reopen`, { method: 'POST', body: { reason } }),

  /** Is the seven-day customer-data deletion being kept? */
  purgeStatus: (signal?: AbortSignal) =>
    request<PurgeStatus>('/admin/deliveries/purge', { signal }),
  /** Run the sweep now. SUPER_ADMIN only, server-side. */
  runPurge: () =>
    request<{ purged: number; remaining: number; retentionDays: number }>(
      '/admin/deliveries/purge',
      { method: 'POST' },
    ),

  // ===== CAC registration (stores) =====
  cacDecision: (id: string, decision: 'VERIFIED' | 'REJECTED', note?: string) =>
    request<Organization>(`/admin/organizations/${id}/cac-decision`, {
      method: 'POST',
      body: { decision, note },
    }),
  // Whether a registry provider is wired up. The review screen needs it to say
  // "no registry configured, this is a manual check" rather than leaving a
  // reviewer to read a missing registered name as a red flag.
  cacConfig: (signal?: AbortSignal) =>
    request<{ configured: boolean }>('/admin/organizations/cac/config', { signal }),

  // ===== Store network map =====
  // The endpoint is open to any signed-in user by design - a courier needs it -
  // so this is the same call the mobile app makes, not an admin-only one.
  orgMap: (
    kind: OrgKind,
    from: { lat: number; lng: number } | null,
    signal?: AbortSignal,
  ) => {
    const q = new URLSearchParams({ kind })
    if (from) {
      q.set('lat', String(from.lat))
      q.set('lng', String(from.lng))
    }
    return request<OrgMap>(`/organizations/map?${q.toString()}`, { signal })
  },
  // Generation rules are Settings rows, so they are written through the same
  // endpoint every other setting uses rather than a second write path.
  putRule: (kind: string, param: string, value: string) =>
    request<Template>(`/settings/templates/${encodeURIComponent(`rules.${kind}.${param}`)}`, {
      method: 'PUT',
      body: { value },
    }),
}
