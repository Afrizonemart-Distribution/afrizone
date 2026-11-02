/**
 * The portal's API client.
 *
 * Deliberately small and separate from web-admin's. The portal talks to a
 * handful of endpoints that outside parties are allowed to reach; the staff
 * console talks to dozens they are not. Sharing one client would mean shipping
 * the map of every admin endpoint to a store's browser, which is the thing this
 * whole application exists to avoid.
 */
import type {
  AccountType,
  AuthResponse,
  CourierReadiness,
  Delivery,
  Organization,
  PublicProfile,
  OrgKind,
  OrgMember,
  User,
} from './types'

const TOKEN_KEY = 'afz_portal_token'
const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(message: string, status: number, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch {
    throw new ApiError('Cannot reach Afrizone. Check your connection and try again.', 0)
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`
    throw new ApiError(msg, res.status, data)
  }
  return data as T
}

export const api = {
  signIn: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),

  /**
   * accountType is what the person chose on the landing page. The server
   * validates it against its own list and falls back to INDIVIDUAL, so a
   * tampered value here cannot put an account into a state the guards do not
   * recognise.
   */
  register: (name: string, email: string, password: string, accountType: AccountType) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { name, email, password, accountType },
      auth: false,
    }),

  /** Continue with AfriZone: swap an AfriZone identity token for our session. */
  afrizoneSignIn: (identityToken: string) =>
    request<AuthResponse>('/auth/afrizone', {
      method: 'POST',
      body: { identityToken },
      auth: false,
    }),

  me: (signal?: AbortSignal) => request<{ user: User }>('/auth/me', { signal }),

  /** A shared Talent Profile. No auth: the server answers only for LINK profiles. */
  publicProfile: (slug: string, signal?: AbortSignal) =>
    request<PublicProfile>(`/public/profiles/${encodeURIComponent(slug)}`, { auth: false, signal }),

  /** Only the businesses this person belongs to. The server does the scoping. */
  myOrganizations: (kind?: OrgKind, signal?: AbortSignal) =>
    request<Organization[]>(`/organizations${kind ? `?kind=${kind}` : ''}`, { signal }),

  organizationMembers: (id: string, signal?: AbortSignal) =>
    request<OrgMember[]>(`/organizations/${id}/members`, { signal }),

  /** Record the business's CAC registration number. OWNER only, server-side. */
  submitCac: (id: string, cacNumber: string) =>
    request<Organization>(`/organizations/${id}/cac`, { method: 'POST', body: { cacNumber } }),

  /** How far along a courier is. A progress report; it gates nothing. */
  courierReadiness: (signal?: AbortSignal) =>
    request<CourierReadiness>('/me/courier', { signal }),

  // Answers with the whole readiness, not just the row: changing the vehicle
  // changes which papers are required, and a client that has to ask again shows
  // a stale checklist in between.
  saveVehicle: (vehicleType: string, plateNumber: string | null) =>
    request<CourierReadiness>('/me/courier/vehicle', {
      method: 'PUT',
      body: { vehicleType, plateNumber },
    }),

  /* ── Deliveries ─────────────────────────────────────────────────────────
     The store side and the courier side are the same order seen from two
     places, and the server decides which fields each may read. Nothing here
     filters anything for privacy: a client that hides a field still received
     it. */

  /** Every order for this store. Scoped server-side on membership. */
  storeDeliveries: (orgId: string, signal?: AbortSignal) =>
    request<Delivery[]>(`/organizations/${orgId}/deliveries`, { signal }),

  /**
   * The store will fulfil it. This is also what posts the courier job, which is
   * why the response can carry a warning: the order is accepted either way, and
   * an accepted order with no job behind it must not read as success.
   */
  acceptDelivery: (id: string) =>
    request<Delivery>(`/deliveries/${id}/accept`, { method: 'POST' }),

  /** A reason is required - it is the only unavailability signal Mart gets. */
  rejectDelivery: (id: string, reason: string) =>
    request<Delivery>(`/deliveries/${id}/reject`, { method: 'POST', body: { reason } }),

  markPrepared: (id: string) =>
    request<Delivery>(`/deliveries/${id}/prepared`, { method: 'POST' }),

  /** The orders this courier is carrying, keyed on the contracts they hold. */
  myDeliveries: (signal?: AbortSignal) =>
    request<Delivery[]>('/me/deliveries', { signal }),

  markPickedUp: (id: string) =>
    request<Delivery>(`/deliveries/${id}/picked-up`, { method: 'POST' }),

  /**
   * The customer's code, checked with AfriZoneMart.
   *
   * A 503 from here means we could not ask, which is NOT a wrong code. The
   * caller has to keep those apart on screen: a courier who tells a customer
   * they typed it wrong, when nothing was checked, argues on a doorstep about
   * something that never happened.
   */
  completeDelivery: (id: string, code: string) =>
    request<Delivery>(`/deliveries/${id}/complete`, { method: 'POST', body: { code } }),

  failDelivery: (id: string, reason: string) =>
    request<Delivery>(`/deliveries/${id}/failed`, { method: 'POST', body: { reason } }),
}
