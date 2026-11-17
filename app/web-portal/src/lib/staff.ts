/**
 * The staff workspace client (server: routes/staffWorkspace.ts).
 *
 * Separate from the portal's own session on purpose: a staff session belongs
 * to an AfriZone staff account and reaches only /api/staff/*, never anything a
 * Part Time worker, store or courier session can.
 */
import { getAfrizoneIdentityToken } from './afrizone'

const TOKEN_KEY = 'afz_staff_token'
const API = `${import.meta.env.VITE_API_URL ?? ''}/api/staff`

export function getStaffToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function clearStaffToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode */
  }
}

export class StaffApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const token = getStaffToken()
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) {
    if (res.status === 401) clearStaffToken()
    throw new StaffApiError(json.error ?? json.message ?? 'Something went wrong', res.status)
  }
  return json as T
}

export interface StaffMe {
  id: string
  name: string | null
  email: string | null
  jobTitle: string | null
  hasManager: boolean
  manages: number
  monitor: boolean
  assign: boolean
}

/** Must be called from a click handler: the AfriZone popup opens in the same tick. */
export async function staffSignIn(): Promise<StaffMe> {
  const identityToken = await getAfrizoneIdentityToken()
  const res = await fetch(`${API}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken }),
  })
  const json = (await res.json().catch(() => ({}))) as { token?: string; me?: StaffMe; error?: string }
  if (!res.ok || !json.token || !json.me) throw new StaffApiError(json.error ?? 'Could not sign you in', res.status)
  try {
    localStorage.setItem(TOKEN_KEY, json.token)
  } catch {
    /* private mode: the session lasts this page */
  }
  return json.me
}

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'SUBMITTED' | 'REWORK' | 'DONE' | 'CANCELLED'

export interface StaffTask {
  id: string
  title: string
  description: string | null
  product: string
  kind: 'WORK' | 'OFFSITE'
  status: TaskStatus
  dueAt: string | null
  completion?: 'MANUAL' | 'AUTO'
  autoProgress?: number
  autoTarget?: number | null
  overdue: boolean
  assignee: { id: string; name: string | null; email: string | null }
  permissions: { canStart: boolean; canSubmit: boolean; canApprove: boolean; canRework: boolean }
}

export interface Pillar {
  score: number | null
  weight: number
}

export interface Scorecard {
  kind: 'STAFF' | 'INTERN'
  score: number | null
  period: { start: string; end: string; period: 'week' | 'month' }
  staff: { pillars: Record<'delivery' | 'output' | 'quality' | 'presence', Pillar>; overtimeSeconds: number } | null
  intern: {
    deliverables: { submitted: number; approved: number; rejected: number; trend: number }
    quality: { approvalRate: number | null; reworkRate: number | null }
  } | null
  overdueOpen: number
  flags: string[]
}

export interface TeamRow {
  person: { id: string; name: string | null; email: string | null; jobTitle: string | null }
  kind: 'STAFF' | 'INTERN'
  score: number | null
  flags: string[]
  overdueOpen: number
}

export const staffApi = {
  me: () => call<StaffMe>('/me'),
  tasks: (scope: 'mine' | 'review', status?: string) =>
    call<{ items: StaffTask[]; total: number }>(
      `/tasks?scope=${scope}&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ''}`,
    ),
  start: (id: string) => call<StaffTask>(`/tasks/${id}/start`, { method: 'POST', body: {} }),
  submit: (id: string, note?: string) => call<StaffTask>(`/tasks/${id}/submit`, { method: 'POST', body: { note } }),
  approve: (id: string, qualityScore: number, note?: string) =>
    call<StaffTask>(`/tasks/${id}/approve`, { method: 'POST', body: { qualityScore, note } }),
  rework: (id: string, note: string) => call<StaffTask>(`/tasks/${id}/rework`, { method: 'POST', body: { note } }),
  logOffsite: (body: { product: string; title: string; startAt: string; endAt: string; location: string; description?: string }) =>
    call<StaffTask>('/tasks/offsite', { method: 'POST', body }),
  myKpi: (period: 'week' | 'month') => call<Scorecard>(`/kpi/me?period=${period}`),
  teamKpi: (period: 'week' | 'month', scope: 'team' | 'all') =>
    call<{ items: TeamRow[] }>(`/kpi/team?period=${period}&scope=${scope}`),
}
