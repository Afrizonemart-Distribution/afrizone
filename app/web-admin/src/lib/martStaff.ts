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
  if (code === 'MFA_SIGNIN_REQUIRED') return 'Sign in to AfriZone again with your two-factor code, then connect again.'
  if (status === 403 && /requires role/i.test(message)) return 'Only Owners can manage staff access.'
  if (status === 401) return 'Your AfriZone sign-in has ended. Connect again.'
  return message
}

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  if (!token) throw new MartError(401, 'NOT_CONNECTED', 'Connect your AfriZone Owner account first.')
  const res = await fetch(`${AFRIZONE_API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 401 && !retried) {
    // Access tokens last 15 minutes; renew once from the shared session.
    token = await refreshAfrizoneAccessToken()
    if (token) return call<T>(path, init, true)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const code: string = body?.error?.code ?? 'UNKNOWN'
    const message: string = body?.error?.message ?? `Request failed (${res.status})`
    if (res.status === 401) token = null
    throw new MartError(res.status, code, explain(res.status, code, message))
  }
  return body as T
}

export const martStaff = {
  catalogue: () => call<{ products: MartProductCatalogue[] }>('/api/admin/staff/products').then((r) => r.products),
  list: () => call<{ items: MartStaff[] }>('/api/admin/staff').then((r) => r.items),
  /** Make an existing Afrizonemart account staff (they keep their login). */
  promote: (input: { email: string; name?: string; jobTitle?: string; permissions: string[] }) =>
    call<MartStaff>('/api/admin/staff', {
      method: 'POST',
      body: JSON.stringify({ ...input, role: 'STAFF', promoteExisting: true }),
    }),
  setMembership: (
    userId: string,
    product: MartProduct,
    input: { permissions: string[]; role?: 'MEMBER' | 'PRODUCT_ADMIN'; isFinance?: boolean; startsAt?: string | null; endsAt?: string | null },
  ) =>
    call<MartMembership>(`/api/admin/staff/${encodeURIComponent(userId)}/memberships/${product}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removeMembership: (userId: string, product: MartProduct) =>
    call<void>(`/api/admin/staff/${encodeURIComponent(userId)}/memberships/${product}`, { method: 'DELETE' }),
  /** Take away all staff access (account stays, as a shopper). */
  removeStaff: (userId: string) => call<void>(`/api/admin/staff/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}
