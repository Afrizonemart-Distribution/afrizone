/**
 * Staff access across every Afrizonemart product, managed from Part-Time.
 *
 * Part-Time's database isn't connected to Afrizonemart's, so this screen
 * talks to the Afrizonemart API directly as the signed-in Owner, using an
 * AfriZone access token from the shared .afrizonemart.com session (see
 * afrizone.ts). The token lives in memory only, for this tab. Every check
 * (Owner role, 2FA, audit log) happens on the Afrizonemart side; Part-Time
 * itself grants nothing here. Part-Time roles come back to Part-Time
 * through the staff-roles sync (server: services/martStaffSync.ts).
 */
import { AFRIZONE_API_URL, getAfrizoneAccessToken, refreshAfrizoneAccessToken } from './afrizone'

export type MartProduct = 'STOREFRONT' | 'SUPPLIER_OPS' | 'INK' | 'HUD' | 'PARTTIME'

export interface MartCapability {
  key: string
  domain: string
  label: string
}

export interface MartProductCatalogue {
  product: MartProduct
  label: string
  capabilities: MartCapability[]
}

export interface MartMembership {
  product: MartProduct
  role: 'MEMBER' | 'PRODUCT_ADMIN'
  permissions: string[]
  isFinance: boolean
  startsAt: string
  endsAt: string | null
  updatedAt: string
}

export interface MartStaff {
  id: string
  email: string
  name: string | null
  role: 'SELLER' | 'ADMIN' | 'STAFF'
  jobTitle: string | null
  department: string | null
  lastLoginAt: string | null
  mfaEnabled: boolean
  staffSince: string | null
  staffMemberships: MartMembership[]
}

export class MartError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

let token: string | null = null

/**
 * Step-up (afrizonemart-api#242, STAFF_STEP_UP): staff-access changes ask for
 * a fresh 2FA code instead of a code at sign-in. The token from a code lasts
 * 15 minutes and lives in memory only. The Staff access page registers a
 * prompter that shows the code dialog; `verify` checks a code with the API.
 */
let stepUp: { token: string; expires: number } | null = null
type StepUpPrompter = (verify: (code: string) => Promise<string | null>) => Promise<boolean>
let stepUpPrompter: StepUpPrompter | null = null

export function setMartStepUpPrompter(fn: StepUpPrompter | null): void {
  stepUpPrompter = fn
}

function stepUpHeader(): Record<string, string> {
  if (stepUp && stepUp.expires > Date.now()) return { 'X-Step-Up-Token': stepUp.token }
  stepUp = null
  return {}
}

/** Checks a 2FA code; null when it worked, otherwise the message to show. */
async function verifyStepUp(code: string): Promise<string | null> {
  if (!token) return 'Connect your AfriZone account again.'
  const res = await fetch(`${AFRIZONE_API_URL}/api/auth/step-up`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) return body?.error?.message ?? 'That code didn’t work.'
  stepUp = { token: body.stepUpToken, expires: Date.now() + (body.expiresInSeconds - 30) * 1000 }
  return null
}

/** Sign in to AfriZone (popup if needed). Call from a click handler. */
export async function connectMart(): Promise<void> {
  token = await getAfrizoneAccessToken()
}

/** Try the shared session without any popup; true if it worked. */
export async function connectMartSilently(): Promise<boolean> {
  token = await refreshAfrizoneAccessToken()
  return token !== null
}

export function martConnected(): boolean {
  return token !== null
}

export function disconnectMart(): void {
  token = null
}

/** Plain-language reasons for the refusals this screen can meet. */
function explain(status: number, code: string, message: string): string {
  if (code === 'MFA_ENROLLMENT_REQUIRED') return 'Turn on two-factor authentication on your afrizonemart.com account first, then connect again.'
  if (code === 'STEP_UP_REQUIRED') return 'This change needs your two-factor code. Try again and enter the code when asked.'
  if (code === 'MFA_SIGNIN_REQUIRED') return 'Sign in to AfriZone again with your two-factor code, then connect again.'
  if (code === 'NOT_A_STAFF_MANAGER') return 'Only Owners and Product Admins can manage staff access.'
  if (code === 'NO_ACCOUNT') return message
  if (status === 401) return 'Your AfriZone sign-in has ended. Connect again.'
  return message
}

async function call<T>(path: string, init: RequestInit = {}, retried = false, steppedUp = false): Promise<T> {
  if (!token) throw new MartError(401, 'NOT_CONNECTED', 'Connect your AfriZone Owner account first.')
  const res = await fetch(`${AFRIZONE_API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...stepUpHeader(), ...(init.headers ?? {}) },
  })
  if (res.status === 401 && !retried) {
    // Access tokens last 15 minutes; renew once from the shared session.
    token = await refreshAfrizoneAccessToken()
    if (token) return call<T>(path, init, true, steppedUp)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const code: string = body?.error?.code ?? 'UNKNOWN'
    const message: string = body?.error?.message ?? `Request failed (${res.status})`
    // Sensitive change: ask for the 2FA code once, then retry.
    if (res.status === 403 && code === 'STEP_UP_REQUIRED' && !steppedUp && stepUpPrompter) {
      if (await stepUpPrompter(verifyStepUp)) return call<T>(path, init, retried, true)
    }
    if (res.status === 401) token = null
    throw new MartError(res.status, code, explain(res.status, code, message))
  }
  return body as T
}

const BASE = '/api/admin/staff-access'
const enc = encodeURIComponent

export interface MartManagerScope {
  isOwner: boolean
  /** Products the signed-in person may manage. */
  products: MartProduct[]
}

export interface MembershipInput {
  permissions: string[]
  role?: 'MEMBER' | 'PRODUCT_ADMIN'
  isFinance?: boolean
  startsAt?: string | null
  endsAt?: string | null
}

export const martStaff = {
  /** Owner (everything) or Product Admin (their products only). */
  me: () => call<MartManagerScope>(`${BASE}/me`),
  catalogue: () => call<{ products: MartProductCatalogue[] }>(`${BASE}/products`).then((r) => r.products),
  list: () => call<{ items: MartStaff[] }>(`${BASE}/people`).then((r) => r.items),
  /** Give an existing Afrizonemart account access to one product (a shopper becomes staff). */
  add: (product: MartProduct, input: MembershipInput & { email: string; name?: string; jobTitle?: string }) =>
    call<{ userId: string; promoted: boolean; membership: MartMembership }>(`${BASE}/products/${product}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setMembership: (userId: string, product: MartProduct, input: MembershipInput) =>
    call<MartMembership>(`${BASE}/people/${enc(userId)}/products/${product}`, { method: 'PUT', body: JSON.stringify(input) }),
  removeMembership: (userId: string, product: MartProduct) =>
    call<void>(`${BASE}/people/${enc(userId)}/products/${product}`, { method: 'DELETE' }),
  /** Owner only: take away all staff access (account stays, as a shopper). */
  removeStaff: (userId: string) => call<void>(`${BASE}/people/${enc(userId)}`, { method: 'DELETE' }),
  /** Owner only: turn an Owner account into a Product Admin of one product. */
  makeProductAdmin: (userId: string, product: MartProduct) =>
    call<void>(`${BASE}/people/${enc(userId)}/make-product-admin`, { method: 'POST', body: JSON.stringify({ product }) }),
}
